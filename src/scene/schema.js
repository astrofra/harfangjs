import {requireCondition} from '../core/errors.js';
import {profile, requireCapabilities, validateLogicalPath} from '../profile.js';

export const nullReference = value => value === null || value === undefined || value === 4294967295;
export function validateSceneJSON(scene, {source = 'scene', structure = false} = {}) {
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
    requireCondition(!scene[key]?.length, 'UNSUPPORTED_SCENE_FEATURE', `${key} is not implemented by W1`, source);
  }
  requireCondition(structure || !scene.lights?.length, 'UNSUPPORTED_SCENE_FEATURE', 'Lighting requires W2 (or explicit structural diagnostic mode)', source);
  const transforms = scene.transforms ?? [], cameras = scene.cameras ?? [], objects = scene.objects ?? [], nodes = scene.nodes ?? [];
  check(nodes.length <= profile.limits.maxNodes, 'Node budget exceeded');
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
    requireCondition((structure || nullReference(node.components[3])) && nullReference(node.components[4]) && nullReference(node.instance) && !node.collisions?.length && !node.scripts?.length,
      'UNSUPPORTED_SCENE_FEATURE', 'Required node component is outside W1', `${source}${path}`);
    if (!nullReference(node.components[1]) || !nullReference(node.components[2])) check(!nullReference(node.components[0]), 'Camera/object node requires a transform', path);
  });
  const vec = (v, count, path) => check(Array.isArray(v) && v.length === count && v.every(Number.isFinite), 'Invalid numeric vector', path);
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
    for (let slot = 0; slot < object.materials.length; ++slot) validateMaterial(object.materials[slot], {source: `${source}.objects[${i}].materials[${slot}]`, structure});
  });
  const current = scene.environment?.current_camera;
  if (!nullReference(current)) check(ids.has(current) && !nullReference(ids.get(current).components[1]), 'Invalid current camera');
  if (scene.canvas) {
    if (scene.canvas.color !== undefined) vec(scene.canvas.color, 4, '.canvas.color');
    for (const key of ['clear_color', 'clear_z']) check(scene.canvas[key] === undefined || typeof scene.canvas[key] === 'boolean', 'Invalid canvas clear flag', `.canvas.${key}`);
  }
  if (!structure) {
    const env = scene.environment ?? {};
    requireCondition(!env.fog_far && !env.brdf_map && !env.irradiance_map && !env.radiance_map && !env.probe?.irradiance_map && !env.probe?.radiance_map,
      'UNSUPPORTED_SCENE_FEATURE', 'Fog/environment lighting requires W2', source);
  }
  check(scene.key_values == null || (typeof scene.key_values === 'object' && !Array.isArray(scene.key_values) && Object.values(scene.key_values).every(v => typeof v === 'string')), 'Invalid key_values metadata');
  return scene;
}

export function validateMaterial(material, {source = 'material', structure = false} = {}) {
  const diagnostic = structure && material?.program === 'core/shader/pbr.hps';
  requireCondition(material?.program === 'shaders/unlit.hps' || diagnostic, 'UNSUPPORTED_PROGRAM', 'No W1 material adapter; PBR structure requires explicit diagnostic mode', source);
  const keys = ['program','values','textures','flags','face_culling','depth_test','blend_mode','write_r','write_g','write_b','write_a','write_z'];
  for (const key of Object.keys(material)) requireCondition(keys.includes(key), 'UNSUPPORTED_MATERIAL', `Unknown material field ${key}`, source);
  for (const key of ['values', 'textures', 'flags']) requireCondition(material[key] === undefined || Array.isArray(material[key]), 'INVALID_MATERIAL', `${key} must be an array`, source);
  requireCondition(!material.flags?.length, 'UNSUPPORTED_MATERIAL', 'Material flags require a later slice', source);
  requireCondition(diagnostic || (material.blend_mode ?? 'opaque') === 'opaque', 'UNSUPPORTED_MATERIAL', 'Only opaque W1 materials are supported', source);
  requireCondition(['disabled', 'cw', 'ccw'].includes(material.face_culling ?? 'cw') && ['less', 'leq', 'always', 'disabled'].includes(material.depth_test ?? 'less'), 'UNSUPPORTED_MATERIAL', 'Unsupported depth/culling state', source);
  for (const key of ['write_r', 'write_g', 'write_b', 'write_a', 'write_z']) requireCondition(material[key] === undefined || typeof material[key] === 'boolean', 'INVALID_MATERIAL', `${key} must be boolean`, source);
  const names = new Set(), samplers = new Set();
  for (const v of material.values ?? []) {
    requireCondition(v.type === 'vec4' && (v.count ?? 1) === 1 && Array.isArray(v.value) && v.value.length === 4 && v.value.every(Number.isFinite), 'INVALID_MATERIAL', 'Expected one vec4 material value', source);
    requireCondition(diagnostic || v.name === 'uColor', 'UNSUPPORTED_MATERIAL', `Unknown uniform ${v.name}`, source);
    requireCondition(!names.has(v.name), 'INVALID_MATERIAL', `Duplicate uniform ${v.name}`, source); names.add(v.name);
  }
  for (const texture of material.textures ?? []) {
    requireCondition(texture && Object.keys(texture).every(k => ['name','path','stage'].includes(k)) &&
      typeof texture.name === 'string' && Number.isInteger(texture.stage) && texture.stage >= 0 && texture.stage < 16 &&
      !samplers.has(texture.name), 'INVALID_MATERIAL', 'Invalid/duplicate texture reference', source); samplers.add(texture.name);
    requireCondition(diagnostic || (texture.name === 'uColorMap' && texture.stage === 0), 'UNSUPPORTED_MATERIAL', 'Only uColorMap at stage 0 is supported', source);
    if (texture.path) validateLogicalPath(texture.path);
  }
  return material;
}
