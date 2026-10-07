# Browser runtime contract

HarfangJS has one runtime target: client-side JavaScript and WebGL 2, consuming
assets produced by the native `assetc-web` tool. Its public entry points are
`src/index.js` (`harfang`) and `src/browser.js` (`harfang/browser`).

## Compatibility

The reference direction is **HG Lua -> native HG JS -> Web HG JS**. Supported
calls retain native names, signatures, defaults and value/reference semantics.
Browser limitations do not redefine the native binding. The facade in
`src/compat/` adapts the shared math, scene and rendering implementations to the
supported native-shaped calls; it is the implementation of the public Web API.

Math values use float32 storage. Times and native-sized counts use `BigInt` where
required by the API. Scene node enumeration returns `NodeList`; transform world
matrices are updated by the scene update. Materials assigned to objects are
copied. The demo `contract.js` fixtures exercise these semantics in the browser
and can optionally be compared with an external native HARFANG executable.

## Application lifecycle and assets

Browser startup calls `createNativeBrowserApplication({canvas, manifestURL, ...})`.
It asynchronously loads the compiled manifest and payloads before running the
shared application. `onAssetProgress` reports downloaded byte counts and reaches
100 percent after validation/decoding. `runWindow` is the browser window helper
used by the tutorials. Native-style asset loads operate on the preloaded data.

The host provides frame scheduling, input, resize, pause/resume, restart and
cleanup. Context loss stops the application and releases resources. Keyboard
and mouse input are scoped to the canvas, with focus-loss reset. The browser
owns presentation; requested MSAA is currently ignored with a warning.

The accepted manifest schema and two content profiles are described in
[asset compilation](assets.md). No source-asset fallback or runtime native tool
is supported. The runtime has no package or Wasm dependency.

## Rendering and limits

The current implementation includes scenes, instances, rigid node animations, indexed models,
procedural models, default and PBR materials, normal/ORM/emissive maps,
transparency, fog, HDR environments, line rendering, instancing and bounded
directional/spot shadow support. Shader families and variants must have reviewed
compiler adapters. Feature combinations remain bounded by the demos and their
validators; this is not complete HARFANG API compatibility.

The shared limits in `src/profile.js` include 16,384 nodes, hierarchy depth 128,
eight light slots, 4096-pixel texture/drawing dimensions, 64 MiB per payload and
a default 128 MiB asset/GPU budget. PBR Scene explicitly raises its budgets to
256 MiB for original-resolution textures. Device limits can be tighter.

Skinning, physics, audio and arbitrary shader translation are unsupported.
Rigid node animation playback supports TRS and enable tracks, including instance
autoplay; [animation playback](animations.md) lists the supported API and limits.
The Engine demo plays its authored mechanical animation. AAA calls still use the
warned forward rendering fallback. Global environment
probes are supported; parallax-corrected probes are rejected. See each demo's
README for its actual rendering scope and validation evidence.
