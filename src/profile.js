import {requireCondition} from './core/errors.js';

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const foundationProfile = freeze({
  api: 'harfang-js/1',
  id: 'web-foundation/1',
  assetSchema: 'harfang-web-assets/1',
  capabilities: ['math.foundation', 'scene.handles', 'scripts.factory', 'assets.bytes',
    'host.async-init', 'input.keyboard', 'input.mouse', 'render.lines'],
  sceneComponents: ['programmatic-node', 'programmatic-transform'],
  materialFamilies: [],
  linePrograms: ['shaders/white', 'shaders/pos_rgb'],
  lineLayouts: ['position:f32x3', 'position:f32x3,color0:f32x3'],
  limits: {maxLineVertices: 131072, maxResourceBytes: 67108864, maxFrameDeltaMs: 100,
    maxPixelRatio: 2, maxDrawingBufferSize: 4096, lights: 0, shadowMaps: 0},
  approximations: ['Browser timing has host clock precision, despite nanosecond units.',
    'Mouse position uses drawing-buffer pixels, positive Y upward; wheel is normalized to signed steps.',
    'Lines are one pixel wide; multisampling is chosen by the browser.'],
  excluded: ['physics', 'video', 'navigation', 'vr', 'aaa', 'wasm'],
  deferred: ['scene', 'mesh', 'materials', 'lights', 'shadows', 'instances', 'animation', 'skinning', 'audio', 'ui'],
  nativeJS: 'pending-slice-N'
});

export const staticProfile = freeze({...foundationProfile,
  id: 'web-static/1',
  capabilities: [...foundationProfile.capabilities, 'scene.static', 'scene.hierarchy', 'scene.camera', 'render.mesh', 'material.unlit', 'assets.images'],
  sceneComponents: ['node', 'transform', 'camera', 'object'],
  materialFamilies: ['shaders/unlit.hps'],
  modelPrograms: ['shaders/mdl', 'shaders/unlit.hps'],
  limits: {...foundationProfile.limits, maxNodes: 10000, maxHierarchyDepth: 128, maxMeshVertices: 4000000,
    maxMeshIndices: 12000000, maxTextureSize: 4096, maxGPUBytes: 134217728},
  deferred: ['lights', 'shadows', 'instances', 'animation', 'skinning', 'audio', 'ui'],
  approximations: [...foundationProfile.approximations, 'Explicit scene_pbr.structure mode draws unlit diagnostic colors; no PBR, light or environment rendering is claimed.']
});

export const profile = freeze({...staticProfile,
  id:'web-forward/1',
  capabilities:[...staticProfile.capabilities,'scene.lights','material.default','material.pbr','material.alpha-cut','material.blend','render.forward','render.fog','render.ambient'],
  sceneComponents:[...staticProfile.sceneComponents,'light'],
  materialFamilies:['shaders/unlit.hps','core/shader/default.hps','core/shader/pbr.hps'],
  modelPrograms:[...staticProfile.modelPrograms,'core/shader/default.hps','core/shader/pbr.hps'],
  limits:{...staticProfile.limits, lights:8, maxForwardPrograms:2},
  deferred:['shadows','environment-probes','instances','animation','skinning','audio','ui'],
  approximations:[...staticProfile.approximations,'W2 environment lighting uses authored ambient color; probe maps require an explicit ambientEnvironment compiler adaptation.',
    'Forward shader output matches native non-AAA gamma. Equal light priorities retain node order. Transparent submeshes sort by nearest bound depth, then node/submesh order.']
});

export function requireCapabilities(required, source = 'application') {
  requireCondition(Array.isArray(required), 'INVALID_PROFILE', 'requires must be an array', source);
  for (const capability of required) requireCondition(profile.capabilities.includes(capability),
    'UNSUPPORTED_CAPABILITY', `Profile ${profile.id} does not implement ${capability}`, source);
}

export function validateManifest(manifest) {
  requireCondition(manifest?.schema === profile.assetSchema && manifest.api === profile.api && [profile.id, staticProfile.id, foundationProfile.id].includes(manifest.profile),
    'INCOMPATIBLE_MANIFEST', `Expected ${profile.assetSchema}, ${profile.api}, ${profile.id}`, 'manifest');
  requireCapabilities(manifest.requires ?? [], 'manifest');
  requireCondition(manifest.assets && typeof manifest.assets === 'object' && !Array.isArray(manifest.assets),
    'INVALID_MANIFEST', 'assets must be a logical-ID map', 'manifest');
  for (const [id, entry] of Object.entries(manifest.assets)) {
    validateLogicalPath(id);
    requireCondition(entry && ['bytes', 'scene-json', 'mesh', 'image'].includes(entry.kind), 'UNSUPPORTED_ASSET', 'Unsupported compiled asset kind', id);
    validateLogicalPath(entry.uri);
    if (entry.kind !== 'bytes') requireCondition(Number.isSafeInteger(entry.byteLength) && typeof entry.sha256 === 'string', 'INVALID_MANIFEST', 'Compiled content requires byte length and SHA-256', id);
    if (entry.kind === 'scene-json') requireCondition(['static', 'structure', 'forward'].includes(entry.mode), 'INVALID_MANIFEST', 'Unknown scene mode', id);
    if (entry.lighting !== undefined) requireCondition(entry.mode === 'forward' && entry.lighting && typeof entry.lighting === 'object' && !Array.isArray(entry.lighting) &&
      Object.entries(entry.lighting).every(([key,value]) => ['ignoreShadows','ambientEnvironment'].includes(key) && typeof value === 'boolean'),
      'INVALID_MANIFEST', 'Invalid forward scene adaptations', id);
    if (entry.kind === 'image') requireCondition(['image/png', 'image/jpeg'].includes(entry.mime) &&
      [entry.width, entry.height].every(n => Number.isInteger(n) && n > 0 && n <= profile.limits.maxTextureSize) &&
      entry.colorSpace === 'encoded-rgb' && entry.sampler?.filter === 'linear' && entry.sampler?.wrap === 'repeat',
      'INVALID_MANIFEST', 'Unsupported image format, dimensions or sampling metadata', id);
    requireCapabilities(entry.requires ?? [], id);
    requireCondition(entry.dependencies === undefined || Array.isArray(entry.dependencies), 'INVALID_MANIFEST', 'dependencies must be an array', id);
    for (const dependency of entry.dependencies ?? []) {
      validateLogicalPath(dependency);
      requireCondition(Object.hasOwn(manifest.assets, dependency), 'MISSING_ASSET', `Missing dependency ${dependency}`, id);
    }
    if (entry.sha256 !== undefined) requireCondition(/^[a-f0-9]{64}$/.test(entry.sha256), 'INVALID_MANIFEST', 'Invalid SHA-256', id);
    if (entry.byteLength !== undefined) requireCondition(Number.isSafeInteger(entry.byteLength) && entry.byteLength >= 0 && entry.byteLength <= profile.limits.maxResourceBytes,
      'RESOURCE_BUDGET', 'Invalid compiled byte length', id);
  }
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    requireCondition(!visiting.has(id), 'ASSET_CYCLE', 'Cyclic compiled dependencies', id);
    if (visited.has(id)) return;
    visiting.add(id);
    requireCondition(visiting.size <= profile.limits.maxHierarchyDepth, 'RESOURCE_BUDGET', 'Dependency graph is too deep', id);
    for (const dependency of manifest.assets[id].dependencies ?? []) visit(dependency);
    visiting.delete(id); visited.add(id);
  }
  Object.keys(manifest.assets).forEach(visit);
  return manifest;
}

export function validateLogicalPath(id) {
  requireCondition(typeof id === 'string' && id.length > 0 &&
    !/[\\:%?#\u0000-\u0020]/.test(id) && id.split('/').every(p => p && p !== '.' && p !== '..'),
  'INVALID_ASSET_PATH', 'Expected a relative compiled logical path without traversal or URL syntax', String(id));
  return id;
}

export function validatePortableModule(specifier, source) {
  requireCondition(specifier !== 'harfang-native' && !specifier.startsWith('harfang/native'),
    'NATIVE_ONLY', `Native extension import ${specifier} is outside ${profile.id}`, source);
  return specifier;
}
