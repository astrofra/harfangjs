import {InstancedForwardRenderer} from './instanced-forward.js';
import {Mat4,Mat44,Vec2,Vec3,Vec4,Inverse,GetZ,ComputeAspectRatioX,ComputeOrthographicProjectionMatrix,ComputePerspectiveProjectionMatrix,FovToZoomFactor,Len} from '../core/math.js';
import {requireCondition} from '../core/errors.js';
import {LT_Linear,LT_Spot} from '../scene/scene.js';
import {frameLighting,applyMaterialState,transparentDepth} from './forward.js';

// Same split construction and texel stabilization as GenerateLinearShadowMapForForwardPipeline.
export function directionalShadowMatrices(scene,lightNode,projection,resolution,viewState) {
  const camera=viewState?undefined:scene.GetCurrentCamera();
  const world=viewState?Inverse(viewState.view)[1]:camera.GetTransform().GetWorld();
  const near=viewState?-projection.data[14]/(projection.data[10]+1):camera.GetCamera().GetZNear();
  const lightWorld=lightNode.GetTransform().GetWorld(),lightInverse=Inverse(lightWorld)[1],splits=lightNode.GetLight().GetPSSMSplit().data;
  const [ok,inverseProjection]=Inverse(projection);requireCondition(ok,'INVALID_CAMERA','Singular camera projection');
  const corners=[];
  for(const z of [0,1])for(const [x,y] of [[-1,1],[1,1],[1,-1],[-1,-1]]) {
    const v=inverseProjection.mul(new Vec4(x,y,z,1));corners.push(new Vec3(v.x/v.w,v.y/v.w,v.z/v.w));
  }
  const scale=splits[3]/(corners[4].z-corners[0].z);
  for(let i=0;i<4;++i)corners[i+4]=corners[i+4].sub(corners[i]).mul(scale);
  const points=corners.map(v=>world.mul(v)),result=[];let c0=near;
  for(const c1 of splits) {
    const part=[];let center=Vec3.Zero;
    for(let j=0;j<4;++j) {
      const delta=points[j+4].sub(points[j]);
      const a=points[j].add(delta.mul((c0-near)/(splits[3]-near))),b=points[j].add(delta.mul((c1-near)/(splits[3]-near)));
      part.push(a,b);center=center.add(a.add(b));
    }
    center=center.div(8);const radius=Math.max(...part.map(v=>Len(v.sub(center)))),texel=2*radius/resolution;
    const position=lightInverse.mul(center.sub(GetZ(lightWorld).mul(200)));
    position.x-=position.x%texel;position.y-=position.y%texel;
    const shadowWorld=new Mat4(lightWorld);shadowWorld.data.set(lightWorld.mul(position).data,9);
    result.push(ComputeOrthographicProjectionMatrix(0,200+radius,2*radius,new Vec2(1,1)).mul(Inverse(shadowWorld)[1]));c0=c1;
  }
  return result;
}

// Native scene profile: opaque PBR maps, global IBL, directional splits and one spot shadow.
export class NativeSceneRenderer extends InstancedForwardRenderer {
  constructor(canvas,options) {
    super(canvas,options);this.textures=new Map();this.stats.textures=0;
    this.anisotropy=this.gl.getExtension('EXT_texture_filter_anisotropic');
  }
  texture(resource) {
    requireCondition(resource?.IsValid(),'INVALID_HANDLE','Invalid compiled texture');
    if(this.textures.has(resource))return this.textures.get(resource).handle;
    const gl=this.gl,record=resource.record,target=record.faces===6?gl.TEXTURE_CUBE_MAP:gl.TEXTURE_2D;
    const bytes=record.bytes.byteLength;this.checkBudget(bytes);
    requireCondition(record.levels.every(v=>v.width<=this.capabilities.maxTextureSize&&v.height<=this.capabilities.maxTextureSize),
      'TEXTURE_LIMIT','Texture exceeds device limits');
    const handle=gl.createTexture();requireCondition(handle,'GPU_ALLOCATION_FAILED','Cannot create texture');
    try {
      gl.activeTexture(gl.TEXTURE8);gl.bindTexture(target,handle);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      for(const level of record.levels) {
        const half=record.format==='rgba16f',data=half?new Uint16Array(record.bytes,level.offset,level.byteLength/2):new Uint8Array(record.bytes,level.offset,level.byteLength);
        gl.texImage2D(record.faces===6?gl.TEXTURE_CUBE_MAP_POSITIVE_X+level.face:target,level.mip,half?gl.RGBA16F:gl.RGBA8,
          level.width,level.height,0,gl.RGBA,half?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,data);
      }
      gl.texParameteri(target,gl.TEXTURE_MAX_LEVEL,record.mips-1);
      gl.texParameteri(target,gl.TEXTURE_MIN_FILTER,record.mips>1?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR);gl.texParameteri(target,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,...(record.faces===6?[gl.TEXTURE_WRAP_R]:[])])gl.texParameteri(target,axis,record.sampler.wrap==='repeat'?gl.REPEAT:gl.CLAMP_TO_EDGE);
      if(record.sampler.anisotropic&&this.anisotropy)gl.texParameterf(target,this.anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,gl.getParameter(this.anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT));
      requireCondition(gl.getError()===gl.NO_ERROR,'GPU_UPLOAD_FAILED','Texture upload failed');
      this.textures.set(resource,{handle,bytes});this.stats.gpuBytes+=bytes;this.stats.textures=this.textures.size;return handle;
    } catch(error){gl.deleteTexture(handle);throw error;}
  }
  releaseTexture(resource) {
    const entry=this.textures.get(resource);if(!entry)return;
    this.gl.deleteTexture(entry.handle);this.stats.gpuBytes-=entry.bytes;this.textures.delete(resource);this.stats.textures=this.textures.size;
  }
  fallbackTextures() {
    if(this.fallback2D)return;
    const gl=this.gl;
    this.fallback2D=gl.createTexture();this.fallbackCube=gl.createTexture();this.fallbackDepth=gl.createTexture();
    requireCondition(this.fallback2D&&this.fallbackCube&&this.fallbackDepth,'GPU_ALLOCATION_FAILED','Cannot allocate fallback textures');
    gl.bindTexture(gl.TEXTURE_2D,this.fallback2D);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP,this.fallbackCube);
    for(let face=0;face<6;++face)gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X+face,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));
    gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D,this.fallbackDepth);gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT16,1,1,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_SHORT,new Uint16Array([65535]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_COMPARE_MODE,gl.COMPARE_REF_TO_TEXTURE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_COMPARE_FUNC,gl.LEQUAL);
    this.stats.gpuBytes+=30;
  }
  submit(scene,pipeline,viewState) {
    this.alive();requireCondition(this.program?.adapter.startsWith('pbr-scene-instanced/'),'PROGRAM_NOT_READY','Load a compiled PBR program first');
    this.collect(scene);this.fallbackTextures();
    const gl=this.gl,{view,proj,viewProjection}=viewState??scene.ComputeCurrentCameraViewState(ComputeAspectRatioX(this.canvas.width,this.canvas.height));
    const opaque=[],transparent=[];
    for(const batch of this.batches.values()) {
      if(batch.transparent) {
        batch.depth=transparentDepth(batch.submesh.bounds,view.mul(new Mat4(...batch.world)));transparent.push(batch);
      } else opaque.push(batch);
    }
    transparent.sort((a,b)=>b.depth-a.depth);
    const frame=frameLighting(scene,view),lights=scene.GetLights().filter(n=>n.IsEnabled());
    const directional=lights.filter(n=>n.GetLight().GetType()===LT_Linear).sort((a,b)=>b.GetLight().GetPriority()-a.GetLight().GetPriority())[0];
    const locals=lights.filter(n=>n.GetLight().GetType()!==LT_Linear).sort((a,b)=>b.GetLight().GetPriority()-a.GetLight().GetPriority());
    const shadowLocals=locals.filter(n=>n.GetLight().GetShadowType()===1);
    requireCondition(shadowLocals.length<=1&&(!shadowLocals.length||(shadowLocals[0].equals(locals[0])&&locals[0].GetLight().GetType()===LT_Spot)),
      'UNSUPPORTED_SHADOW','Only the highest-priority local spotlight may cast shadows');
    const spot=shadowLocals[0]?.GetLight();let spotMatrix=Mat44.Identity;
    const light=directional?.GetLight().GetShadowType()===1?directional.GetLight():undefined;
    const matrices=light?directionalShadowMatrices(scene,directional,proj,pipeline.resolution,viewState):Array(4).fill(Mat44.Identity);
    Object.assign(this.stats,{drawCalls:0,opaqueDrawCalls:0,transparentDrawCalls:0,shadowDrawCalls:0,triangles:0,shadowTriangles:0,shadowPasses:(light?4:0)+(spot?1:0),shadowAtlasSize:light?pipeline.resolution*2:0});
    if(light) {
      this.ensureShadow({resolution:pipeline.resolution*2,sixteenBit:pipeline.sixteenBit});this.stats.shadowResolution=pipeline.resolution;
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.shadow.framebuffer);gl.enable(gl.SCISSOR_TEST);
      gl.useProgram(this.depth.handle);
      for(let i=0;i<4;++i) {
        const x=(i&1)*pipeline.resolution,y=(i>>1)*pipeline.resolution;
        gl.viewport(x,y,pipeline.resolution,pipeline.resolution);gl.scissor(x,y,pipeline.resolution,pipeline.resolution);
        gl.colorMask(false,false,false,false);gl.depthMask(true);gl.clearDepth(1);gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.uniformMatrix4fv(this.depth.uniforms.viewProjection,false,matrices[i].data);
        for(const batch of opaque) {
          applyMaterialState(gl,{...batch.state,write_r:false,write_g:false,write_b:false,write_a:false,write_z:true});
          this.draw(batch);++this.stats.shadowDrawCalls;this.stats.shadowTriangles+=batch.submesh.indexCount/3*batch.count;
        }
      }
      gl.disable(gl.SCISSOR_TEST);
    } else this.releaseShadow('shadow');
    if(spot) {
      this.ensureShadow(pipeline,'spotShadow');
      const [ok,lightView]=Inverse(shadowLocals[0].GetTransform().GetWorld());requireCondition(ok,'INVALID_LIGHT','Singular spotlight transform');
      spotMatrix=ComputePerspectiveProjectionMatrix(spot.GetShadowNear(),spot.GetShadowFar(),FovToZoomFactor(2*spot.GetOuterAngle()),new Vec2(1,1)).mul(new Mat44(lightView));
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.spotShadow.framebuffer);gl.viewport(0,0,pipeline.resolution,pipeline.resolution);
      gl.colorMask(false,false,false,false);gl.depthMask(true);gl.clearDepth(1);gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.depth.handle);gl.uniformMatrix4fv(this.depth.uniforms.viewProjection,false,spotMatrix.data);
      for(const batch of opaque) {
        applyMaterialState(gl,{...batch.state,write_r:false,write_g:false,write_b:false,write_a:false,write_z:true});
        this.draw(batch);++this.stats.shadowDrawCalls;this.stats.shadowTriangles+=batch.submesh.indexCount/3*batch.count;
      }
    } else this.releaseShadow('spotShadow');
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.colorMask(true,true,true,true);gl.depthMask(true);gl.clearColor(...scene.canvas.color.data);gl.clearDepth(1);
    gl.clear((scene.canvas.clear_color?gl.COLOR_BUFFER_BIT:0)|(scene.canvas.clear_z?gl.DEPTH_BUFFER_BIT:0));
    gl.useProgram(this.forward.handle);const u=this.forward.uniforms;
    gl.uniformMatrix4fv(u.viewProjection,false,viewProjection.data);gl.uniformMatrix4fv(u.view,false,view.toArray());
    gl.uniformMatrix4fv(u['linearProjection[0]'],false,new Float32Array(matrices.flatMap(m=>[...m.data])));
    gl.uniform4fv(u.linearSplits,light?.GetPSSMSplit().data??[10,50,100,500]);gl.uniform1i(u.hasLinearShadow,!!light);
    gl.uniform1f(u.linearShadowBias,light?.GetShadowBias()??0);gl.uniform1f(u.linearShadowTexel,1/(2*pipeline.resolution));
    gl.uniformMatrix4fv(u.shadowProjection,false,spotMatrix.data);gl.uniform1i(u.hasShadow,!!spot);
    gl.uniform1f(u.shadowBias,spot?.GetShadowBias()??0);gl.uniform1f(u.shadowTexel,1/pipeline.resolution);
    for(const name of ['eye','ambient','fogColor'])gl.uniform3fv(u[name],frame[name]);gl.uniform2fv(u.fog,frame.fog);
    for(const [name,key] of [['lightPos','positions'],['lightDir','directions'],['lightDiffuse','diffuse'],['lightSpecular','specular']])gl.uniform4fv(u[name],frame.lights[key]);
    const bind=(unit,target,handle,uniform)=>{gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(target,handle);gl.uniform1i(u[uniform],unit);};
    const env=scene.environment,hasEnvironment=!!(env.brdf_map?.IsValid()&&env.irradiance_map&&env.radiance_map);gl.uniform1i(u.hasEnvironment,hasEnvironment);
    bind(1,gl.TEXTURE_2D,hasEnvironment?this.texture(env.brdf_map.value):this.fallback2D,'brdfMap');
    bind(2,gl.TEXTURE_CUBE_MAP,hasEnvironment?this.texture(env.irradiance_map):this.fallbackCube,'irradianceMap');
    bind(3,gl.TEXTURE_CUBE_MAP,hasEnvironment?this.texture(env.radiance_map):this.fallbackCube,'radianceMap');
    bind(4,gl.TEXTURE_2D,this.shadow?.texture??this.fallbackDepth,'linearShadowMap');
    bind(7,gl.TEXTURE_2D,this.spotShadow?.texture??this.fallbackDepth,'shadowMap');
    for(const batch of [...opaque,...transparent]) {
      applyMaterialState(gl,batch.state);const material=batch.material,map=material.texture('uBaseOpacityMap');
      gl.uniform1i(u.hasBaseMap,!!map);bind(0,gl.TEXTURE_2D,map?this.texture(map):this.fallback2D,'baseMap');
      const normal=material.texture('uNormalMap'),orm=material.texture('uOcclusionRoughnessMetalnessMap');
      gl.uniform1i(u.hasNormalMap,!!normal);bind(5,gl.TEXTURE_2D,normal?this.texture(normal):this.fallback2D,'normalMap');
      gl.uniform1i(u.hasORMMap,!!orm);bind(6,gl.TEXTURE_2D,orm?this.texture(orm):this.fallback2D,'ormMap');
      gl.uniform4fv(u.base,material.value('uBaseOpacityColor'));gl.uniform4fv(u.surface,material.value('uOcclusionRoughnessMetalnessColor'));
      gl.uniform4fv(u.self,material.value('uSelfColor'));this.draw(batch);++this.stats.drawCalls;this.stats.triangles+=batch.submesh.indexCount/3*batch.count;
      ++this.stats[batch.transparent?'transparentDrawCalls':'opaqueDrawCalls'];
    }
    gl.bindVertexArray(null);requireCondition(gl.getError()===gl.NO_ERROR,'GPU_RENDER_FAILED','WebGL reported a scene rendering error');
    this.stats.viewport=[this.canvas.width,this.canvas.height];
  }
  releaseShadow(slot) {
    if(slot)super.releaseShadow(slot);
    else {super.releaseShadow('shadow');super.releaseShadow('spotShadow');}
  }
  dispose() {
    if(this.disposed)return;
    for(const resource of [...this.textures.keys()])this.releaseTexture(resource);
    if(this.fallback2D){this.gl.deleteTexture(this.fallback2D);this.gl.deleteTexture(this.fallbackCube);this.fallback2D=this.fallbackCube=undefined;this.stats.gpuBytes-=28;}
    super.dispose();
  }
}
