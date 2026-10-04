# C / W0 / W1 / W2 implementation evidence

Implemented in `harfangjs` on 2026-10-04 against HARFANG checkout `5fe83f1adabf26294003be4c6e13ea068413b5d9`. The existing native tutorials and source repository are unchanged.

This delivery provides the portable contract subset, executable browser foundations, W1 static scenes/assets, and W2 materials/forward lighting. **The complete shared-JS cross-host acceptance gate is still open:** the native QuickJS launcher/facade belongs to N. Native references use real C++ HARFANG, not native JavaScript. No unsupported feature or unported native tutorial is counted as passing.

## Recorded validation

`python tools/validate.py --native-render` builds `dist/web`, checks the offline writer, runs the browser suite at `/tests/`, drives real DOM input/lifecycle actions and compares five native renders. The recorded run passed **66 browser cases**, including 20 tutorial cases, **ten compiler cases**, and all browser integration checks. It used Chrome 154.0.8037.97 with WebGL 2 through ANGLE SwiftShader, plus native C++ HARFANG with bgfx OpenGL. Browser hardware GPUs, Firefox/WebKit/mobile and native QuickJS remain unvalidated.

The machine-readable result is generated at `build/reports/validation.json`; fixed-time captures are beside it. Generated reports/builds are ignored by git. The checked-in tutorial manifest is deliberately execution-neutral and retains native/browser statuses independently; each run's report is authoritative for that run.

| Coverage | Evidence |
| --- | --- |
| Math | Eight native transform cases, axis rotations, nonuniform/negative scales, inverse round trips, perspective/orthographic matrices, front/behind-camera and near/far screen projection |
| Values and handles | Copied get/change/set, output order, named-node lookup, foreign/stale generations, explicit destruction, empty resource counters |
| Exact values | Signed int64 extrema, out-of-range rejection, unsafe JSON timestamp rejection, decimal-string preservation |
| Async lifecycle | Init barrier, variable deltas, clamp, suspension during loading, resume timing reset, stop during loading/update, Promise callback errors, cleanup after errors, repeated runs |
| Assets | Concurrent deduplication, independent cancellation, final-consumer abort, late completion, retry after failure, copied bytes, disposal accounting |
| Behaviors | Independent factory state, parameter notification, value/function/handle communication, missing functions, cancelled imports, node-valid detachment and cleanup through exceptions |
| Rendering | Actual white and interpolated-color pixels, visible clear frame, shader/layout errors, GPU program/buffer release, declared context-loss failure |
| DOM integration | Key state, canvas focus loss, mouse buttons, resize, pause/resume, restart three times, Escape and cleanup |
| No Wasm | Dependency-free package allowlist/import checks, payload/code-path scan, runtime access trap, recorded local network requests |

## Tutorial cases

Each case uses the same `examples/tutorials/application.js` source and bare `harfang` import. Deterministic test callbacks are at `[0,16,32,48]` ms, seed 1337, viewport 128×128, DPR 1. A separate live browser run checks scheduling/input/resize at larger viewports. Line examples preserve 1,000 lines / 2,000 vertices and use reviewed versions of their original programs.

| Case | Adaptation and boundary |
| --- | --- |
| `basic_loop` | Green clear, scheduled update/render, Escape, cleanup; no busy loop |
| `draw_lines` | Original trigonometric vertex equations and elapsed-time angle; context-owned line submission |
| `draw_lines_starfield` | Original motion/wrap threshold retained, deterministic PRNG, explicit near-zero depth guard; no Lua GC call |
| Four keyboard/mouse cases | Canvas-scoped frame snapshots, current state and transitions shown by the diagnostic panel; DOM physical key codes and normalized wheel |
| `scene_lua_script.js` | Fresh JS behavior instances, parameter/value/function/handle communication, missing-call error; no Lua VM |
| `render_resize_to_window.lines` | Named reduced derivative using orthographic line drawing; does not claim the original model-rendering tutorial passes |

`contract/tutorials.json` preserves the specification's **25 retained, 12 deferred, 19 excluded** families, plus named derivatives and the supplemental room. Later retained families remain unported; deferred/excluded cases never inflate success counts.

## W1 results

The room is built from one source tree into native and web assets. Both raw native JSON and native binary input converted offline load through the browser scene reader. Native scene-state references compare all transforms, parents, enabled flags, camera settings/current selection, material values/textures and slot names. The fixture includes a nonuniformly scaled parent, negative scale, two cameras, a disabled node, UV seams, and two material slots. Original JSON bytes remain unchanged.

The browser renders the same room as the native C++ forward pipeline using the fixture's unlit shader. At 256x256, perspective/orthographic RGB channel mean absolute errors were **0.344/0.322 out of 255**, with **1.28%/1.35%** of pixels exceeding 16 in any channel. Both pass the declared thresholds of mean error below 2 and fewer than 3% such pixels. These tolerate edge sampling differences; they are not PBR or native-JS parity claims.

| W1 case | Evidence |
| --- | --- |
| `scene_static_room` | Both native camera renders, numeric/material references, camera switching, visibility, repeated CPU/GPU release |
| `draw_model_no_pipeline` | Fixed native cube/plane construction, original mdl normal-lighting adapter and transforms, deterministic drawing |
| `render_resize_to_window` | Original cube/camera/projection, browser drawing-buffer resize; earlier line derivative retained separately |
| `filesystem_assets` | Compiled logical `pictures/owl.jpg`, valid texture and dimensions; async API and supplemental preview |
| `picture_load` | Decoded compiled JPEG and dimensions; original source-filesystem access replaced by compiled ID |
| `scene_pbr.structure` | Unmodified 15-node, 13-object tutorial body and native assignments; explicit opaque unlit colors only |

Compiler checks cover deterministic output, payload hashes, seam-preserving buffers/native winding, missing dependencies/material slots, output-directory protection, unsupported features, native compiled geometry rejection, and binary conversion. Browser checks add malformed indices/bounds/truncation, missing/corrupt images, integrity failure, transactional cancellation, unsupported features, texture orientation, and repeated scene disposal. Runtime network requests remain within the packaged modules, test fixtures and `assets-web`; source/native asset directories are never requested.

The W1/W2 web asset package has 55 entries totaling 12,710,280 logical payload bytes, mostly the original PBR tutorial images. Structural rendering does not decode/sample those PBR images; the separate W2 material case does. Native/web asset tooling, ownership and limitations are detailed in [static assets](static-assets.md). The offline writer is a prototype frontend using native readers, not an upstream `assetc --target web` integration.

## W2 results

The gallery and tutorial gates use reviewed unlit, default/Phong, and HARFANG PBR adapters. Native comparisons use the same material values, geometry, tangent frames, light rig and camera. The PBR tutorial reference explicitly disables shadows/probes and uses RAW base-level bilinear texture sampling to match the declared W2 web profile. The original scene JSON remains byte-for-byte intact in the web output; its adaptation is separate manifest metadata. The native fixture exposes the PBR shader body's existing alpha-cut branch through its generated `.hps` descriptor. These comparisons do not claim the original full native environment/shadow/texture configuration.

| Native/web comparison at 256×256 | RGB channel MAE / 255 | Pixels exceeding 16 in any RGB channel |
| --- | --- | --- |
| Material gallery | 0.636 | 1.83% |
| Gallery with fog | 0.584 | 1.72% |
| `scene_pbr.materials`, ambient/no shadows | 1.329 | 2.07% |

All pass the W1 thresholds: MAE below 2/255 and fewer than 3% differing pixels. The gallery exercises roughness/metalness extremes, a negative and nonuniformly scaled normal-mapped panel, ORM channels, foliage alpha cut, a self map, emissive values, and overlapping transparency.

Independent pixel tests verify map replacement, PBR base-map sRGB decoding, the native output gamma, AO's effect on direct lighting, metal diffuse suppression, self-map selection, exact .8 alpha-cut threshold, radius/cone attenuation, separate light intensities, fog, nine blend modes, nine depth states, culling orientations, RGBA/depth writes and transparent ordering. Native light arrays match within `1e-5`; the original 16-light motion/priority selection matches native slots at 48, 1048 and 2048 ms. Equal-priority overflow has a stable browser node-order policy.

The one-second material texture toggle and 11×11 shared-model wave grid have separate named no-shadow derivatives. The original 10,201-node stress case remains pending W10. W2 cancellation/corrupt-map tests release partially loaded scene dependencies; scene reloads return mesh/image GPU counters to zero. Actual DOM tests exercise the gallery's lighting/fog/normal/roughness controls and restart it three times, checking final CPU/GPU/program cleanup.

Forward program count stays at two, including repeated map/alpha-cut toggles; edits do not compile additional programs. The gallery records 12 draws, 7,692 triangles and 247,532 accounted GPU payload bytes. Per-case asset initialization, compile/link preparation and four completed frame timings are recorded in `validation.json` under `lightingStartup`, with backend, viewport and quality settings. Shader/driver overhead is outside the byte counter. See [the W2 contract](forward-materials.md) for defaults, approximation boundaries, ownership and source hashes.

## Native reference provenance

`tests/fixtures/native-math.json` was produced by the existing native Python build `50625de17460342c2d69c536c4e80e0c91400523` (HARFANG 3.3.0, Windows x64). Its exact module SHA-256, inspected source revision and source-file hashes are recorded separately. The binary predates the current checkout; that distinction is retained instead of claiming it was rebuilt for this change.

No renderer is initialized in the reference generator, so native NDC uses depth `[0,1]`. Browser tests explicitly remap the recorded projection rows and screen depth to WebGL `[-1,1]`, while preserving native scene-space conventions. Matrix/world tolerance is `1e-4`, and screen-coordinate tolerance is `0.001` pixel to accommodate float32 rounding. Expected values are recorded from native code, never regenerated from the JS implementation.

Regenerate with a compatible local native module, for example from the workspace layout used here:

```powershell
python tools/native_fixtures.py --module-dir ../build/python-cmake/languages/hg_python/Release --dll-dir ../build/python-cmake/languages/hg_python/bdist_wheel/harfang --native-build 50625de17460342c2d69c536c4e80e0c91400523
```

W0 math validation consumes checked-in fixtures. W1 asset generation additionally uses the native bridge and assetc; once generated, the packaged browser suite runs without those tools. Native room/state captures use the same existing native library build noted above. Before ratifying a native release, regenerate references from that release and run the shared tutorial suite against its QuickJS adapter. Full C completion also requires native ownership/type conversion, native portable-mode enforcement and native async/job scheduling tests from N.
