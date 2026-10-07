import {requireCondition} from '../core/errors.js';
import {Color,Inverse} from '../core/math.js';
import {selectLights} from './lights.js';

export function frameLighting(scene, view) {
  const env = scene.environment, [ok,world] = Inverse(view);
  requireCondition(ok,'INVALID_CAMERA','Singular view matrix');
  const camera=world.data;
  requireCondition(env.ambient instanceof Color && env.fog_color instanceof Color && env.ambient.data.every(Number.isFinite) && env.fog_color.data.every(Number.isFinite) &&
    Number.isFinite(env.fog_near) && Number.isFinite(env.fog_far) && env.fog_far >= env.fog_near,
    'INVALID_ENVIRONMENT', 'Invalid ambient color or fog range');
  return {view, eye:camera.slice(9,12), ambient:env.ambient.data.slice(0,3), fogColor:env.fog_color.data.slice(0,3),
    fog:[env.fog_near,env.fog_far === env.fog_near ? 0 : 1/(env.fog_far-env.fog_near)], lights:selectLights(scene)};
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
