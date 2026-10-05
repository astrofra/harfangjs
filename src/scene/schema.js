import {requireCondition} from '../core/errors.js';
import {profile, requireCapabilities, validateLogicalPath} from '../profile.js';
import {materialContract} from '../render/material-contract.js';

export const nullReference = value => value === null || value === undefined || value === 4294967295;
export function validateSceneJSON(scene, {source = 'scene', structure = false, lighting = false, ignoreShadows = false, ambientEnvironment = false, maxNodes=profile.limits.maxNodes, instances=false, animationStubs=false, nativeUniforms=false} = {}) {
  const check = (ok, message, path = '') => requireCondition(ok, 'INVALID_SCENE', message, `${source}${path}`);
  check(scene && typeof scene === 'object' && !Array.isArray(scene), 'Expected native JSON scene object');
  requireCapabilities(scene.requires ?? [], source);
  const fields = ['nodes', 'transforms', 'cameras', 'objects', 'lights', 'instances', 'anims', 'scene_anims', 'rigid_bodies', 'collisions', 'scripts', 'scene_scripts'];
  const known = new Set([...fields, 'canvas', 'environment', 'key_values', 'requires']);
  for (const key of Object.keys(scene)) requireCondition(known.has(key), 'UNSUPPORTED_SCENE_FEATURE', `Unknown scene field ${key}`, source);
  const only = (object, keys, path) => {
    check(object && typeof object === 'object' && !Array.isArray(object), 'Expected an object', path);
    for (const key of Object.keys(object)) requireCondition(keys.includes(key), 'UNSUPPORTED_SCENE_FEATURE', `Unknown field ${key}`, `${source}${path}`);
  };
  for (const key of fields) check(scene[key] === undefined || scene[key] === null || Array.isArray(scene[key]), `${key} must be an array`);
  for (const key of ['instances', 'anims', 'scene_anims', 'rigid_bodies', 'collisions', 'scripts', 'scene_scripts', 'videos']) {
    if((key==='instances'&&instances)||(['anims','scene_anims'].includes(key)&&animationStubs))continue;
    requireCondition(!scene[key]?.length, 'UNSUPPORTED_SCENE_FEATURE', `${key} is not implemented by W1`, source);
  }
  requireCondition(lighting || structure || !scene.lights?.length, 'UNSUPPORTED_SCENE_FEATURE', 'Lighting requires a forward scene', source);
  const transforms = scene.transforms ?? [], cameras = scene.cameras ?? [], objects = scene.objects ?? [], nodes = scene.nodes ?? [];
  check(nodes.length <= maxNodes, 'Node budget exceeded');
  const ids = new Map();
  nodes.forEach((node, i) => {
    const path = `.nodes[${i}]`;
    only(node, ['idx','name','disabled','components','instance','collisions','scripts'], path);
    check(node && typeof node.name === 'string' && Number.isSafeInteger(node.idx) && node.idx >= 0 && node.idx < 4294967295 && !ids.has(node.idx), 'Invalid or duplicate node index/name', path);
    ids.set(node.idx, node);
    check(node.disabled === undefined || typeof node.disabled === 'boolean', 'disabled must be boolean', path);
    check(Array.isArray(node.components) && node.components.length === 5, 'Expected five native component slots', path);
    [transforms, cameras, objects, scene.lights ?? [], []].forEach((list, slot) => {
      const ref = node.components[slot];
      if (!nullReference(ref)) check(Number.isInteger(ref) && ref >= 0 && ref < list.length, `Invalid component reference at slot ${slot}`, path);
    });
    if(instances&&!nullReference(node.instance))check(Number.isInteger(node.instance)&&node.instance>=0&&node.instance<(scene.instances?.length??0),'Invalid instance reference',path);
    requireCondition((lighting || structure || nullReference(node.components[3])) && nullReference(node.components[4]) && (instances||nullReference(node.instance)) && !node.collisions?.length && !node.scripts?.length,
      'UNSUPPORTED_SCENE_FEATURE', 'Required node component is outside W1', `${source}${path}`);
    if (!nullReference(node.components[1]) || !nullReference(node.components[2]) || !nullReference(node.components[3])) check(!nullReference(node.components[0]), 'Camera/object/light node requires a transform', path);
  });
  const vec = (v, count, path) => check(Array.isArray(v) && v.length === count && v.every(Number.isFinite), 'Invalid numeric vector', path);
  if(instances)for(const [i,instance] of (scene.instances??[]).entries()) {
    only(instance,['name','anim','loop_mode'],`.instances[${i}]`);validateLogicalPath(instance.name);
    requireCondition(animationStubs||!instance.anim,'UNSUPPORTED_SCENE_FEATURE','Instance animation playback is unavailable',source);
  }
  transforms.forEach((t, i) => {
    only(t, ['pos','rot','scl','parent'], `.transforms[${i}]`);
    ['pos', 'rot', 'scl'].forEach(key => vec(t[key], 3, `.transforms[${i}].${key}`));
    if (!nullReference(t.parent)) check(ids.has(t.parent), 'Missing parent node', `.transforms[${i}].parent`);
  });
  for (const node of nodes) {
    const seen = new Set(); let current = node;
    while (current && !nullReference(current.components[0])) {
      check(!seen.has(current.idx) && seen.size < profile.limits.maxHierarchyDepth, 'Cyclic or too-deep parent hierarchy', `.nodes[${node.idx}]`);
      seen.add(current.idx); current = ids.get(transforms[current.components[0]].parent);
    }
  }
  cameras.forEach((camera, i) => {
    only(camera, ['zrange','fov','ortho','size'], `.cameras[${i}]`);
    const near = camera.zrange?.znear ?? 0.01, far = camera.zrange?.zfar ?? 1000;
    check(Number.isFinite(near) && Number.isFinite(far) && near >= (camera.ortho ? 0 : Number.MIN_VALUE) && far > near, 'Invalid camera clip range', `.cameras[${i}]`);
    check(camera.ortho === undefined || typeof camera.ortho === 'boolean', 'Invalid camera projection', `.cameras[${i}]`);
    check(camera.size === undefined || (Number.isFinite(camera.size) && camera.size > 0), 'Invalid camera size', `.cameras[${i}]`);
    check(camera.fov === undefined || (Number.isFinite(camera.fov) && camera.fov > 0 && camera.fov < Math.PI), 'Camera FOV is radians in (0, pi)', `.cameras[${i}]`);
  });
  objects.forEach((object, i) => {
    only(object, ['name','materials','material_infos','bones'], `.objects[${i}]`);
    validateLogicalPath(object.name);
    requireCondition(!object.bones?.length, 'UNSUPPORTED_SCENE_FEATURE', 'Skinning requires W7', `${source}.objects[${i}]`);
    check(Array.isArray(object.materials) && object.materials.length > 0, 'Object has no materials', `.objects[${i}]`);
    for (let slot = 0; slot < object.materials.length; ++slot) validateMaterial(object.materials[slot], {source: `${source}.objects[${i}].materials[${slot}]`, structure, lighting, nativeUniforms});
  });
  if (lighting) for (const [i, light] of (scene.lights ?? []).entries()) validateLight(light, {source:`${source}.lights[${i}]`, ignoreShadows});
  const current = scene.environment?.current_camera;
  if (!nullReference(current)) check(ids.has(current) && !nullReference(ids.get(current).components[1]), 'Invalid current camera');
  if (scene.canvas) {
    if (scene.canvas.color !== undefined) vec(scene.canvas.color, 4, '.canvas.color');
    for (const key of ['clear_color', 'clear_z']) check(scene.canvas[key] === undefined || typeof scene.canvas[key] === 'boolean', 'Invalid canvas clear flag', `.canvas.${key}`);
  }
  if (!structure) {
    const env = scene.environment ?? {};
    requireCondition(lighting || !env.fog_far, 'UNSUPPORTED_SCENE_FEATURE', 'Fog requires a forward scene', source);
    requireCondition((lighting && ambientEnvironment) || (!env.brdf_map && !env.irradiance_map && !env.radiance_map && !env.probe?.irradiance_map && !env.probe?.radiance_map),
      'UNSUPPORTED_SCENE_FEATURE', 'Environment maps require explicit ambientEnvironment approximation', source);
    for (const key of ['ambient','fog_color']) if (env[key] !== undefined) vec(env[key],4,`.environment.${key}`);
    const near = env.fog_near ?? 0, far = env.fog_far ?? 0;
    check(Number.isFinite(near) && Number.isFinite(far) && (far === near || far > near), 'Invalid fog range');
  }
  check(scene.key_values == null || (typeof scene.key_values === 'object' && !Array.isArray(scene.key_values) && Object.values(scene.key_values).every(v => typeof v === 'string')), 'Invalid key_values metadata');
  return scene;
}

export function validateMaterial(material, {source = 'material', structure = false, lighting = true, nativeUniforms=false} = {}) {
  const diagnostic = structure && material?.program === 'core/shader/pbr.hps';
  const family = Object.hasOwn(materialContract.families,material?.program) ? materialContract.families[material.program] : undefined;
  requireCondition(family && (lighting || material.program === 'shaders/unlit.hps' || diagnostic), 'UNSUPPORTED_PROGRAM', 'No approved material adapter in this scene profile', source);
  const keys = ['program','values','textures','flags','face_culling','depth_test','blend_mode','write_r','write_g','write_b','write_a','write_z'];
  for (const key of Object.keys(material)) requireCondition(keys.includes(key), 'UNSUPPORTED_MATERIAL', `Unknown material field ${key}`, source);
  for (const key of ['values', 'textures', 'flags']) requireCondition(material[key] === undefined || Array.isArray(material[key]), 'INVALID_MATERIAL', `${key} must be an array`, source);
  requireCondition((material.flags ?? []).every(flag => lighting && family.flags.includes(flag)), 'UNSUPPORTED_MATERIAL', 'Unsupported material feature flag', source);
  requireCondition(diagnostic || (lighting ? materialContract.blendModes.includes(material.blend_mode ?? 'opaque') : (material.blend_mode ?? 'opaque') === 'opaque'), 'UNSUPPORTED_MATERIAL', 'Unsupported blend mode', source);
  requireCondition(materialContract.culling.includes(material.face_culling ?? 'cw') && materialContract.depthTests.includes(material.depth_test ?? 'less'), 'UNSUPPORTED_MATERIAL', 'Unsupported depth/culling state', source);
  for (const key of ['write_r', 'write_g', 'write_b', 'write_a', 'write_z']) requireCondition(material[key] === undefined || typeof material[key] === 'boolean', 'INVALID_MATERIAL', `${key} must be boolean`, source);
  const names = new Set(), samplers = new Set();
  for (const v of material.values ?? []) {
    requireCondition(v?.type === 'vec4' && (v.count ?? 1) === 1 && Array.isArray(v.value) && v.value.length === 4 && v.value.every(n => Number.isFinite(n) && Number.isFinite(Math.fround(n))), 'INVALID_MATERIAL', 'Expected one finite float32 vec4 material value', source);
    requireCondition(Object.hasOwn(family.values,v.name)||(nativeUniforms&&Object.hasOwn(family.nativeInactiveValues??{},v.name)), 'UNSUPPORTED_MATERIAL', `Unknown uniform ${v.name}`, source);
    requireCondition(!names.has(v.name), 'INVALID_MATERIAL', `Duplicate uniform ${v.name}`, source); names.add(v.name);
  }
  for (const texture of material.textures ?? []) {
    requireCondition(texture && Object.keys(texture).every(k => ['name','path','stage'].includes(k)) &&
      typeof texture.name === 'string' && Number.isInteger(texture.stage) && texture.stage >= 0 && texture.stage < 16 &&
      !samplers.has(texture.name), 'INVALID_MATERIAL', 'Invalid/duplicate texture reference', source); samplers.add(texture.name);
    requireCondition(family.textures[texture.name] === texture.stage, 'UNSUPPORTED_MATERIAL', 'Unsupported sampler or stage', source);
    if (texture.path) validateLogicalPath(texture.path);
  }
  return material;
}

export function validateLight(light, {source = 'light', ignoreShadows = false} = {}) {
  const check = (ok, message) => requireCondition(ok,'INVALID_LIGHT',message,source);
  check(light && ['linear','point','spot'].includes(light.type), 'Unknown light type');
  const keys = ['type','shadow_type','diffuse','specular','diffuse_intensity','specular_intensity','radius','inner_angle','outer_angle','priority','pssm_split','shadow_bias','shadow_near','shadow_far'];
  for (const key of Object.keys(light)) check(keys.includes(key),`Unknown light field ${key}`);
  requireCondition(!light.shadow_type || light.shadow_type === 'none' || (ignoreShadows && light.shadow_type === 'map'), 'UNSUPPORTED_SCENE_FEATURE', 'Shadow maps require W3 or an explicit ignoreShadows adaptation', source);
  for (const key of ['diffuse','specular']) check(Array.isArray(light[key]) && light[key].length === 4 && light[key].every(n => Number.isFinite(n) && n >= 0), `Invalid ${key} color`);
  for (const key of ['diffuse_intensity','specular_intensity','radius']) check(light[key] === undefined || (Number.isFinite(light[key]) && light[key] >= 0), `Invalid ${key}`);
  check(light.priority === undefined || Number.isFinite(light.priority),'Invalid light priority');
  const inner = light.inner_angle ?? Math.PI/6, outer = light.outer_angle ?? Math.PI/4;
  check(Number.isFinite(inner) && Number.isFinite(outer) && inner >= 0 && outer >= inner && outer <= Math.PI/2, 'Invalid spot angles');
  return light;
}
