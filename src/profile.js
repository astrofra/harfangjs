import {requireCondition} from './core/errors.js';

// Runtime limits shared by compiled-asset loading, scenes and GPU resources.
export const profile = Object.freeze({
  api: 'harfang-js/1', id: 'web-native-forward/1', assetSchema: 'harfang-web-program-assets/1',
  capabilities: Object.freeze(['math.foundation', 'scene.handles', 'scene.static', 'scene.hierarchy',
    'scene.camera', 'scene.lights', 'scene.animation-trs', 'input.keyboard', 'input.mouse', 'render.lines', 'render.mesh',
    'render.forward', 'render.spot-shadow', 'render.directional-shadow', 'render.draw-instancing',
    'render.environment', 'render.textures', 'render.alpha-blend', 'render.fog', 'render.ambient',
    'material.default', 'material.pbr', 'material.alpha-cut', 'material.blend']),
  limits: Object.freeze({maxNodes:16384, maxHierarchyDepth:128, maxGPUBytes:134217728,
    maxResourceBytes:67108864, maxMeshVertices:4000000, maxMeshIndices:12000000,
    maxTextureSize:4096, maxLineVertices:131072, lights:8, shadowMaps:1,
    maxPixelRatio:2, maxDrawingBufferSize:4096, maxFrameDeltaMs:100})
});

export function requireCapabilities(required, source = 'application') {
  requireCondition(Array.isArray(required), 'INVALID_PROFILE', 'requires must be an array', source);
  for (const capability of required) requireCondition(profile.capabilities.includes(capability),
    'UNSUPPORTED_CAPABILITY', `The Web runtime does not implement ${capability}`, source);
}

export function validateLogicalPath(id) {
  requireCondition(typeof id === 'string' && id.length > 0 &&
    !/[\\:%?#\u0000-\u001f\u007f]/.test(id) && id.split('/').every(p => p && p === p.trim() && p !== '.' && p !== '..'),
  'INVALID_ASSET_PATH', 'Expected a relative compiled logical path without traversal or URL syntax', String(id));
  return id;
}
