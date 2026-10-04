import {forwardVertexSource, forwardFragmentSource} from './forward-shaders.js';
import {requireCondition} from '../core/errors.js';
import {Color} from '../core/math.js';
import {selectLights} from './lights.js';

export function frameLighting(scene, view) {
  const env = scene.environment, camera = scene.GetCurrentCamera().GetTransform().GetWorld().data;
  requireCondition(env.ambient instanceof Color && env.fog_color instanceof Color && env.ambient.data.every(Number.isFinite) && env.fog_color.data.every(Number.isFinite) &&
    Number.isFinite(env.fog_near) && Number.isFinite(env.fog_far) && env.fog_far >= env.fog_near,
    'INVALID_ENVIRONMENT', 'Invalid ambient color or fog range');
  return {view, eye:camera.slice(9,12), ambient:env.ambient.data.slice(0,3), fogColor:env.fog_color.data.slice(0,3),
    fog:[env.fog_near,env.fog_far === env.fog_near ? 0 : 1/(env.fog_far-env.fog_near)], lights:selectLights(scene)};
}

export class ForwardPrograms {
  #gl; #programs = new Map(); #compileMs = 0;
  constructor(gl) { this.#gl = gl; }
  prepare(material) {
    const family = material.family;
    if (family === 'unlit') return;
    requireCondition(['default','pbr'].includes(family), 'UNSUPPORTED_PROGRAM', 'Unknown forward material');
    if (this.#programs.has(family)) return this.#programs.get(family);
    const gl = this.#gl, start = performance.now(), shaders = []; let program;
    try {
      for (const [type,source] of [[gl.VERTEX_SHADER,forwardVertexSource(family === 'pbr')],[gl.FRAGMENT_SHADER,forwardFragmentSource(family === 'pbr')]]) {
        const shader = gl.createShader(type); requireCondition(shader,'GPU_ALLOCATION_FAILED','Cannot create forward shader'); shaders.push(shader);
        gl.shaderSource(shader,source); gl.compileShader(shader);
        requireCondition(gl.getShaderParameter(shader,gl.COMPILE_STATUS),'SHADER_FAILED',gl.getShaderInfoLog(shader),family);
      }
      program = gl.createProgram(); requireCondition(program,'GPU_ALLOCATION_FAILED','Cannot create forward program');
      shaders.forEach(shader => gl.attachShader(program,shader)); gl.linkProgram(program);
      requireCondition(gl.getProgramParameter(program,gl.LINK_STATUS),'SHADER_FAILED',gl.getProgramInfoLog(program),family);
      const names = 'mvp world view eye ambient fogColor fog lightPos lightDir lightDiffuse lightSpecular base surface self baseMap surfaceMap normalMap selfMap maps alphaCut'.split(' ');
      const entry = {program,uniforms:Object.fromEntries(names.map(name => [name,gl.getUniformLocation(program,`u_${name}`)]))};
      this.#programs.set(family,entry); this.#compileMs += performance.now()-start; return entry;
    } catch (error) { if (program) gl.deleteProgram(program); throw error; }
    finally { shaders.forEach(shader => gl.deleteShader(shader)); }
  }
  bind(material, world, mvp, frame, texture) {
    requireCondition(frame,'INVALID_ARGUMENT','Forward model drawing requires scene lighting');
    const gl = this.#gl, {program,uniforms:u} = this.prepare(material), pbr = material.family === 'pbr';
    gl.useProgram(program);
    gl.uniformMatrix4fv(u.mvp,false,mvp); gl.uniformMatrix4fv(u.world,false,world.toArray()); gl.uniformMatrix4fv(u.view,false,frame.view.toArray());
    for (const name of ['eye','ambient','fogColor']) gl.uniform3fv(u[name],frame[name]);
    gl.uniform2fv(u.fog,frame.fog);
    for (const [name,value] of [['lightPos','positions'],['lightDir','directions'],['lightDiffuse','diffuse'],['lightSpecular','specular']]) gl.uniform4fv(u[name],frame.lights[value]);
    gl.uniform4fv(u.base,material.value(pbr ? 'uBaseOpacityColor' : 'uDiffuseColor'));
    gl.uniform4fv(u.surface,material.value(pbr ? 'uOcclusionRoughnessMetalnessColor' : 'uSpecularColor'));
    gl.uniform4fv(u.self,material.value('uSelfColor'));
    const names = pbr ? ['uBaseOpacityMap','uOcclusionRoughnessMetalnessMap','uNormalMap','uSelfMap'] : ['uDiffuseMap',null,null,null];
    const flags = names.map(name => name ? material.texture(name) : null);
    ['baseMap','surfaceMap','normalMap','selfMap'].forEach((name,i) => {
      const stage = [0,1,2,4][i]; gl.uniform1i(u[name],stage); gl.activeTexture(gl.TEXTURE0+stage);
      gl.bindTexture(gl.TEXTURE_2D,texture(flags[i]));
    });
    gl.uniform4iv(u.maps,flags.map(Boolean).map(Number)); gl.uniform1i(u.alphaCut,material.source.flags?.includes('EnableAlphaCut') ?? false);
  }
  get stats() { return {forwardPrograms:this.#programs.size, shaderCompileMs:this.#compileMs}; }
  dispose() { for (const {program} of this.#programs.values()) this.#gl.deleteProgram(program); this.#programs.clear(); }
}

export function applyMaterialState(gl, state) {
  const cull = state.face_culling ?? 'cw';
  if (cull === 'disabled') gl.disable(gl.CULL_FACE);
  else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(cull === 'cw' ? gl.CCW : gl.CW); }
  const depth = state.depth_test ?? 'less';
  if (depth === 'disabled') gl.disable(gl.DEPTH_TEST);
  else { gl.enable(gl.DEPTH_TEST); gl.depthFunc({less:gl.LESS,leq:gl.LEQUAL,eq:gl.EQUAL,geq:gl.GEQUAL,greater:gl.GREATER,neq:gl.NOTEQUAL,never:gl.NEVER,always:gl.ALWAYS}[depth]); }
  gl.depthMask(state.write_z ?? true); gl.colorMask(...['r','g','b','a'].map(c => state[`write_${c}`] ?? true));
  const blend = state.blend_mode ?? 'opaque';
  if (blend === 'opaque') { gl.disable(gl.BLEND); return; }
  gl.enable(gl.BLEND); gl.blendEquation(blend === 'darken' ? gl.MIN : blend === 'lighten' ? gl.MAX : blend === 'linearburn' ? gl.FUNC_SUBTRACT : gl.FUNC_ADD);
  if (blend === 'alphaRGB_addAlpha') gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE);
  else gl.blendFunc(...({alpha:[gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA],add:[gl.ONE,gl.ONE],multiply:[gl.DST_COLOR,gl.ZERO],screen:[gl.ONE,gl.ONE_MINUS_SRC_COLOR],
    darken:[gl.ONE,gl.ONE],lighten:[gl.ONE,gl.ONE],linearburn:[gl.DST_COLOR,gl.ONE_MINUS_DST_COLOR]}[blend]));
}

// Native transparent keys use the closest bound corner, quantized to millimeters.
export function transparentDepth(bounds, worldView) {
  const m = worldView.data; let depth = Infinity;
  for (const x of [bounds.min[0],bounds.max[0]]) for (const y of [bounds.min[1],bounds.max[1]]) for (const z of [bounds.min[2],bounds.max[2]])
    depth = Math.min(depth,m[2]*x+m[5]*y+m[8]*z+m[11]);
  return Math.max(0,Math.min(0xffffffff,Math.trunc(depth*1000)));
}
