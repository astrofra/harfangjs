import {requireCondition} from './core/errors.js';

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const profile = freeze({
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

export function requireCapabilities(required, source = 'application') {
  requireCondition(Array.isArray(required), 'INVALID_PROFILE', 'requires must be an array', source);
  for (const capability of required) requireCondition(profile.capabilities.includes(capability),
    'UNSUPPORTED_CAPABILITY', `Profile ${profile.id} does not implement ${capability}`, source);
}

export function validateManifest(manifest) {
  requireCondition(manifest?.schema === profile.assetSchema && manifest.api === profile.api && manifest.profile === profile.id,
    'INCOMPATIBLE_MANIFEST', `Expected ${profile.assetSchema}, ${profile.api}, ${profile.id}`, 'manifest');
  requireCapabilities(manifest.requires ?? [], 'manifest');
  requireCondition(manifest.assets && typeof manifest.assets === 'object' && !Array.isArray(manifest.assets),
    'INVALID_MANIFEST', 'assets must be a logical-ID map', 'manifest');
  for (const [id, entry] of Object.entries(manifest.assets)) {
    validateLogicalPath(id);
    requireCondition(entry && entry.kind === 'bytes', 'UNSUPPORTED_ASSET', 'W0 supports byte resources only', id);
    validateLogicalPath(entry.uri);
    requireCapabilities(entry.requires ?? [], id);
    requireCondition(!entry.dependencies?.length, 'UNSUPPORTED_ASSET', 'Dependency graphs require W1', id);
  }
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
