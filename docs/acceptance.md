# C / W0 implementation evidence

Implemented in `harfangjs` on 2026-10-04 against HARFANG checkout `5fe83f1adabf26294003be4c6e13ea068413b5d9`. The existing native tutorials and source repository are unchanged.

This delivery provides the portable contract subset and executable browser foundations. **The specification's complete cross-host C/W0 acceptance gate is still open:** the native QuickJS launcher/facade belongs to N. The current native math comparison is against a real C++ HARFANG Python module, not native JavaScript. No unsupported scene feature or unported native tutorial is counted as passing.

## Recorded validation

`python tools/validate.py` builds `dist/web`, runs the same browser suite available at `/tests/`, then drives real DOM input and lifecycle actions. The recorded run passed **32 conformance cases**, including nine tutorial cases, and all browser integration checks. It used Chrome 154.0.8037.97 with WebGL 2 through ANGLE SwiftShader. This is software-rendered desktop validation; hardware GPUs, Firefox/WebKit/mobile and native QuickJS remain unvalidated.

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

`contract/tutorials.json` preserves the specification's **25 retained, 12 deferred, 19 excluded** families, plus the named resize derivative. Later retained families remain unported; deferred/excluded cases never inflate success counts. W1's model, image, filesystem-assets and structural PBR examples are not implemented here.

## Native reference provenance

`tests/fixtures/native-math.json` was produced by the existing native Python build `50625de17460342c2d69c536c4e80e0c91400523` (HARFANG 3.3.0, Windows x64). Its exact module SHA-256, inspected source revision and source-file hashes are recorded separately. The binary predates the current checkout; that distinction is retained instead of claiming it was rebuilt for this change.

No renderer is initialized in the reference generator, so native NDC uses depth `[0,1]`. Browser tests explicitly remap the recorded projection rows and screen depth to WebGL `[-1,1]`, while preserving native scene-space conventions. Matrix/world tolerance is `1e-4`, and screen-coordinate tolerance is `0.001` pixel to accommodate float32 rounding. Expected values are recorded from native code, never regenerated from the JS implementation.

Regenerate with a compatible local native module, for example from the workspace layout used here:

```powershell
python tools/native_fixtures.py --module-dir ../build/python-cmake/languages/hg_python/Release --dll-dir ../build/python-cmake/languages/hg_python/bdist_wheel/harfang --native-build 50625de17460342c2d69c536c4e80e0c91400523
```

Normal browser validation consumes the checked-in fixtures and does not require a native installation. Before ratifying a native release, regenerate them from that release and run the shared tutorial suite against its QuickJS adapter. Full C completion also requires native ownership/type conversion, native portable-mode enforcement and native async/job scheduling tests from N.
