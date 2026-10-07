import {integer,requireCondition} from '../core/errors.js';
import {Mat44, Vec2, Inverse, ComputeAspectRatioX, ComputePerspectiveProjectionMatrix, FovToZoomFactor} from '../core/math.js';
import {modelData, watchModel} from './models.js';
import {frameLighting, applyMaterialState} from './forward.js';
import {allSceneNodes,transformWorldData, objectModel, LT_Linear, LT_Spot} from '../scene/scene.js';
import {profile} from '../profile.js';

// Experimental native-call renderer. Shader programs come only from assetc-web.
// The batching key includes material values/state; scene components remain distinct.
export class InstancedForwardRenderer {
  constructor(canvas, {antialias = false,maxGPUBytes=profile.limits.maxGPUBytes} = {}) {
    this.maxGPUBytes=integer(maxGPUBytes,1,536870912,'GPU byte budget');
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {alpha:false, depth:true, antialias});
    requireCondition(this.gl, 'WEBGL2_REQUIRED', 'WebGL 2 is unavailable');
    const gl = this.gl;
    this.capabilities = {maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE), maxRenderbufferSize:gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      maxViewport:gl.getParameter(gl.MAX_VIEWPORT_DIMS), antialias:gl.getContextAttributes().antialias,
      samples:gl.getParameter(gl.SAMPLES), renderer:gl.getParameter(gl.RENDERER)};
    this.meshes = new Map(); this.batches = new Map(); this.nextMesh = 0;
    this.stats = {drawCalls:0,shadowDrawCalls:0,triangles:0,shadowTriangles:0,instances:0,shadowMaps:0,
      gpuBytes:0,programs:0,meshes:0,instanceBuffers:0,shaderCompileMs:0,shadowResolution:0};
  }
  alive() { requireCondition(!this.disposed && !this.gl.isContextLost(), 'RENDERER_UNAVAILABLE', 'Renderer disposed or context lost'); }
  checkBudget(bytes) { requireCondition(this.stats.gpuBytes+bytes<=this.maxGPUBytes,'RESOURCE_BUDGET',`Native forward GPU budget exceeded (${this.maxGPUBytes/1048576} MiB)`); }
  prepare(program) {
    this.alive();
    requireCondition(['default-spot-instanced/1','pbr-scene-instanced/1','pbr-scene-instanced/2','pbr-scene-instanced/3'].includes(program.adapter), 'UNSUPPORTED_PROGRAM', 'Unknown compiled program adapter');
    if (this.program === program) return;
    requireCondition(!this.program, 'UNSUPPORTED_PROGRAM', 'This renderer supports one compiled program family');
    const start = performance.now(), made = [];
    const compile = ({vertex,fragment}) => {
      const gl = this.gl, shaders = []; let handle;
      try {
        for (const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
          requireCondition(typeof source === 'string', 'INVALID_PROGRAM', 'Missing compiled shader source');
          const shader = gl.createShader(type); requireCondition(shader,'GPU_ALLOCATION_FAILED','Cannot allocate shader'); shaders.push(shader);
          gl.shaderSource(shader,source); gl.compileShader(shader);
          requireCondition(gl.getShaderParameter(shader,gl.COMPILE_STATUS),'SHADER_FAILED',gl.getShaderInfoLog(shader));
        }
        handle = gl.createProgram(); requireCondition(handle,'GPU_ALLOCATION_FAILED','Cannot allocate program');
        shaders.forEach(shader => gl.attachShader(handle,shader)); gl.linkProgram(handle);
        requireCondition(gl.getProgramParameter(handle,gl.LINK_STATUS),'SHADER_FAILED',gl.getProgramInfoLog(handle));
        const names = 'viewProjection view shadowProjection eye ambient fogColor fog lightPos lightDir lightDiffuse lightSpecular base surface self shadowMap hasShadow shadowBias shadowTexel linearProjection[0] linearSplits linearShadowMap linearShadowBias linearShadowTexel hasLinearShadow hasBaseMap baseMap brdfMap irradianceMap radianceMap hasEnvironment normalMap ormMap hasNormalMap hasORMMap'.split(' ');
        return {handle,uniforms:Object.fromEntries(names.map(name => [name,gl.getUniformLocation(handle,`u_${name}`)]))};
      } catch (error) { if (handle) gl.deleteProgram(handle); throw error; }
      finally { shaders.forEach(shader => gl.deleteShader(shader)); }
    };
    try { made.push(compile(program.forward)); made.push(compile(program.depth)); }
    catch (error) { made.forEach(p => this.gl.deleteProgram(p.handle)); throw error; }
    [this.forward,this.depth] = made; this.program = program; this.stats.programs = 2;
    this.stats.shaderCompileMs += performance.now()-start;
  }
  releasePrograms() {
    if (this.forward) this.gl.deleteProgram(this.forward.handle);
    if (this.depth) this.gl.deleteProgram(this.depth.handle);
    this.forward = this.depth = this.program = undefined; this.stats.programs = 0;
  }
  mesh(model) {
    const data = modelData(model);
    if (this.meshes.has(model)) return this.meshes.get(model);
    const gl = this.gl, mesh = {id:++this.nextMesh,model,data,vertices:gl.createBuffer(),indices:gl.createBuffer(),
      bytes:data.vertices.byteLength+data.indices.byteLength,indexType:data.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      indexSize:data.indices.BYTES_PER_ELEMENT};
    const release = () => {
      for (const [key,batch] of this.batches) if(batch.mesh===mesh) { this.releaseBatch(batch); this.batches.delete(key); }
      gl.deleteBuffer(mesh.vertices); gl.deleteBuffer(mesh.indices); mesh.unwatch?.();
      if(this.meshes.delete(model)) { this.stats.gpuBytes-=mesh.bytes; --this.stats.meshes; }
    };
    mesh.release = release;
    try {
      this.checkBudget(mesh.bytes);
      requireCondition(mesh.vertices && mesh.indices,'GPU_ALLOCATION_FAILED','Cannot allocate model buffers');
      gl.bindBuffer(gl.ARRAY_BUFFER,mesh.vertices); gl.bufferData(gl.ARRAY_BUFFER,data.vertices,gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,mesh.indices); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,data.indices,gl.STATIC_DRAW);
      requireCondition(gl.getError()===gl.NO_ERROR,'GPU_UPLOAD_FAILED','Model upload failed');
      mesh.unwatch = watchModel(model,release); this.meshes.set(model,mesh);
      this.stats.gpuBytes+=mesh.bytes; ++this.stats.meshes; return mesh;
    } catch(error) { release(); throw error; }
  }
  releaseBatch(batch) {
    this.gl.deleteBuffer(batch.buffer); this.gl.deleteVertexArray(batch.vao);
    this.stats.gpuBytes-=batch.gpuBytes; --this.stats.instanceBuffers;
  }
  batch(mesh, material, submeshIndex, instanceKey) {
    // Transparent instances must remain separate draws to preserve depth order.
    const key = `${mesh.id}/${submeshIndex}/${material.batchKey}/${instanceKey??''}`;
    if (this.batches.has(key)) return this.batches.get(key);
    const state = material.source;
    const pbr=this.program.adapter.startsWith('pbr-scene-instanced/');
    requireCondition(material.family===(pbr?'pbr':'default') && (pbr||!material.textures().length) && !(state.flags?.length) &&
      (material.blendMode==='opaque'||(this.program.adapter==='pbr-scene-instanced/3'&&material.blendMode==='alpha')),
      'UNSUPPORTED_MATERIAL', 'Expected opaque default/PBR material or alpha PBR material');
    const gl = this.gl, batch = {mesh,material,state,submesh:mesh.data.submeshes[submeshIndex],count:0,
      transparent:material.blendMode==='alpha',matrices:new Float32Array(16*(material.blendMode==='alpha'?1:64)),gpuBytes:0,buffer:gl.createBuffer(),vao:gl.createVertexArray()};
    if (!batch.buffer || !batch.vao) {
      gl.deleteBuffer(batch.buffer); gl.deleteVertexArray(batch.vao);
      requireCondition(false,'GPU_ALLOCATION_FAILED','Cannot allocate instance batch');
    }
    gl.bindVertexArray(batch.vao); gl.bindBuffer(gl.ARRAY_BUFFER,mesh.vertices); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,mesh.indices);
    for (let i=0;i<2;++i) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i,3,gl.FLOAT,false,mesh.data.stride*4,i*12); }
    gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,2,gl.FLOAT,false,mesh.data.stride*4,24);
    if(mesh.data.stride===14) {
      gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,3,gl.FLOAT,false,56,32);
      gl.enableVertexAttribArray(8);gl.vertexAttribPointer(8,3,gl.FLOAT,false,56,44);
    } else requireCondition(!material.texture('uNormalMap'),'INVALID_MESH','Normal maps require compiled tangent frames');
    gl.bindBuffer(gl.ARRAY_BUFFER,batch.buffer);
    for(let i=0;i<4;++i) { gl.enableVertexAttribArray(4+i); gl.vertexAttribPointer(4+i,4,gl.FLOAT,false,64,i*16); gl.vertexAttribDivisor(4+i,1); }
    gl.bindVertexArray(null); this.batches.set(key,batch); ++this.stats.instanceBuffers; return batch;
  }
  collect(scene) {
    for(const batch of this.batches.values()) batch.count=0;
    let instances=0;
    for(const [nodeIndex,node] of allSceneNodes(scene).entries()) {
      if(!node.IsEnabled()) continue;
      const object=node.GetObject(); if(!object.IsValid()) continue;
      const mesh=this.mesh(objectModel(object)), world=transformWorldData(node.GetTransform());
      mesh.data.submeshes.forEach((part,index) => {
        const material=object.GetMaterial(part.material);
        const batch=this.batch(mesh,material,index,material.blendMode==='alpha'?nodeIndex:undefined);
        if(batch.transparent)batch.world=world;
        if((batch.count+1)*16>batch.matrices.length) {
          const larger=new Float32Array(batch.matrices.length*2); larger.set(batch.matrices); batch.matrices=larger;
        }
        const offset=batch.count++*16;
        for(let c=0;c<4;++c) {
          for(let r=0;r<3;++r) batch.matrices[offset+c*4+r]=world[c*3+r];
          batch.matrices[offset+c*4+3]=c===3?1:0;
        }
        ++instances;
      });
    }
    const gl=this.gl;
    for(const [key,batch] of this.batches) {
      if(!batch.count) { this.releaseBatch(batch); this.batches.delete(key); continue; }
      gl.bindBuffer(gl.ARRAY_BUFFER,batch.buffer);
      if(batch.gpuBytes!==batch.matrices.byteLength) {
        this.checkBudget(batch.matrices.byteLength-batch.gpuBytes);
        gl.bufferData(gl.ARRAY_BUFFER,batch.matrices.byteLength,gl.DYNAMIC_DRAW);
        this.stats.gpuBytes+=batch.matrices.byteLength-batch.gpuBytes; batch.gpuBytes=batch.matrices.byteLength;
      }
      gl.bufferSubData(gl.ARRAY_BUFFER,0,batch.matrices.subarray(0,batch.count*16));
    }
    this.stats.instances=instances;
  }
  ensureShadow(pipeline,slot='shadow') {
    if(this[slot]?.resolution===pipeline.resolution && this[slot]?.sixteenBit===pipeline.sixteenBit) return;
    this.releaseShadow(slot);
    const gl=this.gl, size=pipeline.resolution;
    requireCondition(size<=Math.min(this.capabilities.maxTextureSize,this.capabilities.maxRenderbufferSize),
      'SHADOW_LIMIT',`Requested ${size} shadow map exceeds device limits`);
    this.checkBudget(size*size*(pipeline.sixteenBit?2:4));
    const shadow={resolution:size,sixteenBit:pipeline.sixteenBit,texture:gl.createTexture(),framebuffer:gl.createFramebuffer(),bytes:size*size*(pipeline.sixteenBit?2:4)};
    this[slot]=shadow;
    requireCondition(shadow.texture&&shadow.framebuffer,'GPU_ALLOCATION_FAILED','Cannot allocate spotlight shadow map');
    gl.bindTexture(gl.TEXTURE_2D,shadow.texture);
    gl.texImage2D(gl.TEXTURE_2D,0,pipeline.sixteenBit?gl.DEPTH_COMPONENT16:gl.DEPTH_COMPONENT32F,size,size,0,
      gl.DEPTH_COMPONENT,pipeline.sixteenBit?gl.UNSIGNED_SHORT:gl.FLOAT,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_COMPARE_MODE,gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_COMPARE_FUNC,gl.LEQUAL);
    gl.bindFramebuffer(gl.FRAMEBUFFER,shadow.framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,shadow.texture,0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    requireCondition(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE && gl.getError()===gl.NO_ERROR,
      'SHADOW_ALLOCATION_FAILED',`Cannot render a ${size} depth shadow map`);
    shadow.accounted=true; this.stats.gpuBytes+=shadow.bytes; this.stats.shadowMaps=[this.shadow,this.spotShadow].filter(v=>v?.accounted).length; this.stats.shadowResolution=size;
  }
  releaseShadow(slot='shadow') {
    const shadow=this[slot];if(!shadow) return;
    this.gl.deleteTexture(shadow.texture); this.gl.deleteFramebuffer(shadow.framebuffer);
    if(shadow.accounted) this.stats.gpuBytes-=shadow.bytes;
    this[slot]=undefined; this.stats.shadowMaps=[this.shadow,this.spotShadow].filter(v=>v?.accounted).length; this.stats.shadowResolution=0;
  }
  submit(scene,pipeline) {
    this.alive(); requireCondition(this.forward,'PROGRAM_NOT_READY','Load a compiled forward program first');
    this.collect(scene);
    const gl=this.gl, {view,viewProjection}=scene.ComputeCurrentCameraViewState(ComputeAspectRatioX(this.canvas.width,this.canvas.height));
    const frame=frameLighting(scene,view);
    const lights=scene.GetLights().filter(n=>n.IsEnabled()), local=lights.filter(n=>n.GetLight().GetType()!==LT_Linear)
      .sort((a,b)=>b.GetLight().GetPriority()-a.GetLight().GetPriority());
    const shadowLights=lights.filter(n=>n.GetLight().GetShadowType()===1);
    requireCondition(shadowLights.length<=1 && (!shadowLights.length || (shadowLights[0].equals(local[0]) && local[0].GetLight().GetType()===LT_Spot)),
      'UNSUPPORTED_SHADOW','Only the highest-priority local spotlight may cast shadows in this profile');
    const light=shadowLights[0]?.GetLight(); let shadowProjection=Mat44.Identity;
    this.stats.drawCalls=this.stats.shadowDrawCalls=this.stats.triangles=this.stats.shadowTriangles=0;
    if(light) {
      this.ensureShadow(pipeline);
      const [ok,lightView]=Inverse(shadowLights[0].GetTransform().GetWorld());
      requireCondition(ok,'INVALID_LIGHT','Singular spotlight transform');
      shadowProjection=ComputePerspectiveProjectionMatrix(light.GetShadowNear(),light.GetShadowFar(),FovToZoomFactor(2*light.GetOuterAngle()),new Vec2(1,1)).mul(new Mat44(lightView));
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.shadow.framebuffer); gl.viewport(0,0,this.shadow.resolution,this.shadow.resolution);
      gl.colorMask(false,false,false,false); gl.depthMask(true); gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.depth.handle); gl.uniformMatrix4fv(this.depth.uniforms.viewProjection,false,shadowProjection.data);
      for(const batch of this.batches.values()) {
        applyMaterialState(gl,{...batch.state,write_r:false,write_g:false,write_b:false,write_a:false,write_z:true});
        this.draw(batch); ++this.stats.shadowDrawCalls; this.stats.shadowTriangles+=batch.submesh.indexCount/3*batch.count;
      }
    } else this.releaseShadow();
    if(!this.shadow && !this.fallbackDepth) {
      this.fallbackDepth=gl.createTexture();requireCondition(this.fallbackDepth,'GPU_ALLOCATION_FAILED','Cannot create fallback depth texel');
      gl.bindTexture(gl.TEXTURE_2D,this.fallbackDepth);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT16,1,1,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_SHORT,new Uint16Array([65535]));
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_COMPARE_MODE,gl.COMPARE_REF_TO_TEXTURE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_COMPARE_FUNC,gl.LEQUAL);
      this.stats.gpuBytes+=2;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.colorMask(true,true,true,true); gl.depthMask(true); gl.clearColor(...scene.canvas.color.data); gl.clearDepth(1);
    gl.clear((scene.canvas.clear_color?gl.COLOR_BUFFER_BIT:0)|(scene.canvas.clear_z?gl.DEPTH_BUFFER_BIT:0));
    gl.useProgram(this.forward.handle); const u=this.forward.uniforms;
    gl.uniformMatrix4fv(u.viewProjection,false,viewProjection.data); gl.uniformMatrix4fv(u.view,false,view.toArray());
    gl.uniformMatrix4fv(u.shadowProjection,false,shadowProjection.data);
    for(const name of ['eye','ambient','fogColor']) gl.uniform3fv(u[name],frame[name]); gl.uniform2fv(u.fog,frame.fog);
    for(const [name,key] of [['lightPos','positions'],['lightDir','directions'],['lightDiffuse','diffuse'],['lightSpecular','specular']]) gl.uniform4fv(u[name],frame.lights[key]);
    gl.uniform1i(u.hasShadow,!!light); gl.uniform1f(u.shadowBias,light?.GetShadowBias()??0); gl.uniform1f(u.shadowTexel,1/pipeline.resolution);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,this.shadow?.texture??this.fallbackDepth); gl.uniform1i(u.shadowMap,0);
    for(const batch of this.batches.values()) {
      applyMaterialState(gl,batch.state);
      gl.uniform4fv(u.base,batch.material.value('uDiffuseColor')); gl.uniform4fv(u.surface,batch.material.value('uSpecularColor'));
      gl.uniform4fv(u.self,batch.material.value('uSelfColor')); this.draw(batch);
      ++this.stats.drawCalls; this.stats.triangles+=batch.submesh.indexCount/3*batch.count;
    }
    gl.bindVertexArray(null);
    requireCondition(gl.getError()===gl.NO_ERROR,'GPU_RENDER_FAILED','WebGL reported a rendering error');
    this.stats.viewport=[this.canvas.width,this.canvas.height];
  }
  draw(batch) {
    const gl=this.gl; gl.bindVertexArray(batch.vao);
    gl.drawElementsInstanced(gl.TRIANGLES,batch.submesh.indexCount,batch.mesh.indexType,batch.submesh.firstIndex*batch.mesh.indexSize,batch.count);
  }
  dispose() {
    if(this.disposed) return; this.disposed=true;
    for(const mesh of [...this.meshes.values()]) mesh.release();
    this.releaseShadow(); this.releasePrograms();
    if(this.fallbackDepth) {this.gl.deleteTexture(this.fallbackDepth);this.fallbackDepth=undefined;this.stats.gpuBytes-=2;}
  }
}
