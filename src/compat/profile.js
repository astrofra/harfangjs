// This experiment is independent of the W2 gallery's scene-asset/rendering profile.
export const profile=Object.freeze({
  api:'harfang-js/1', id:'web-native-forward/1', assetSchema:'harfang-web-program-assets/1',
  capabilities:Object.freeze(['render.forward','render.spot-shadow','render.draw-instancing']),
  limits:Object.freeze({maxNodes:16384,maxGPUBytes:134217728,maxResourceBytes:67108864,
    lights:8,shadowMaps:1,maxPixelRatio:2,maxDrawingBufferSize:4096,maxFrameDeltaMs:100})
});
