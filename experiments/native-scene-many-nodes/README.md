# Native Many Nodes on HG JS Web

The native `harfang3d/tutorials/scene_many_nodes.js` now runs **byte for byte
unchanged**, with all 10,201 animated spheres, the ground, original camera and
materials, and a 4096 x 4096 spotlight shadow map. The runtime is JavaScript and
WebGL 2; no Wasm or native library is loaded by the browser.

Public APIs used by the scene follow native HG JS. The window helper is replaced
by a two-line browser adapter, as permitted for this experiment. The application
still imports `harfang` and calls `main(options)` without a Web branch. Native
HG JS remains the reference; this does not establish parity for the entire binding.

## Build and run

From `harfangjs/`:

```powershell
python experiments/native-scene-many-nodes/build.py
python experiments/native-scene-many-nodes/serve.py
```

Open **http://127.0.0.1:8001/**. Pause/resume and restart use the page controls;
Escape stops the scene while the canvas has focus. The browser owns canvas size
and presentation. Requested MSAA4X is ignored with one console warning per run.

The build requires Python 3.10+, CMake, a C++17 compiler (MSVC x64 here), and the
sibling `harfang3d` source checkout. It builds the standalone native `assetc-web`,
stages six unchanged shader source dependencies, compiles them and packages the
entry. After the first build, `--skip-compiler-build` reuses the existing executable.

The resulting `dist/experiments/native-scene-many-nodes/` runs from any local HTTP
server or HTTPS host. It contains no Python, compiler executable, original `.sc`
sources or native shader binaries. The source checkout is not required to serve it.
Use localhost or HTTPS for the browser's SHA-256 integrity checks.

## Native/Web public API contract

`src/compat/harfang.js` is the experimental `harfang` mapping; reusable scene,
math and model implementations remain in `src/`. `src/compat/browser.js` supplies
asset preparation, scheduling, input and cleanup. The existing W2 gallery keeps
its own import map and asset profile.

The implemented native call surface covers:

- `CreateForwardPipeline/DestroyForwardPipeline`, `PipelineResources`, typed
  `ModelRef` and `PipelineProgramRef`, `LoadPipelineProgramRefFromAssets`, and
  zero/one/two named-Vec4 `CreateMaterial` overloads.
- Procedural cube/sphere models, `CreateCamera`, `CreateObject`, the Color/Color
  `CreateSpotLight` overload used here, and scene/component access and mutation.
- `Scene.Update(BigInt)` and reusable `Scene.Clear()`; copy semantics for
  transforms and per-object material copies; native numeric light constants.
- Native `BigInt` results for `Scene.GetNodeCount` and `Object.GetMaterialCount`.
  These also correct the shared W1/W2 runtime; internal array lengths explicitly
  convert them to Number.
- `SubmitSceneToPipeline` with current camera, horizontal FOV and a full-canvas
  rectangle, returning `[nextViewId, SceneForwardPipelinePassViewId]`; pass IDs
  are read through `GetSceneForwardPipelinePassViewId`, including native sentinel
  behavior. These are logical pass IDs, independent of GPU batching.

`contract.js` runs unchanged on both hosts. It compares constants, defaults,
reference types and names, cached model registration, time/count types, transform
copies and hierarchy updates, view IDs with/without a light/shadow, and clearing
and reuse. It records BigInt values explicitly in JSON. Rendering comparison
also checks the native sphere topology and shader behavior.

The `web-native-forward/1` profile allows 16,384 nodes, eight light slots, one
shadow-casting local spotlight, and 128 MiB of accounted GPU buffers/textures.
The shadow caster must occupy the first local light slot. Materials are opaque,
untextured, unskinned `core/shader/default.hps`. Unsupported variants/shadows fail
explicitly. W2 texture/PBR/scene loading is not yet integrated into this profile.
No promise is made for other overloads or native window APIs.

## Standalone Web asset compiler

```powershell
build/assetc-web/Release/assetc-web.exe build/experiments/native-scene-many-nodes/asset-input build/experiments/native-scene-many-nodes/resources_compiled
```

`tools/native/assetc_web.cpp` is a native C++ executable with a static MSVC runtime
and embedded Web shader adapters. It has no HARFANG DLL, Python, shaderc or other
runtime tool dependency. Its source build uses the native checkout's JSON header.
The CLI accepts input/output directories, quiet/verbose/progress/logging switches,
and a job count; omitted output defaults to `<input>_compiled`. The target is fixed
to WebGL 2. Unsupported switches and content are errors.

This is the **program compiler slice**, not the complete Web assetc product.
It verifies the reviewed default shader and its includes against normalized
source hashes, then emits versioned forward/depth GLSL ES descriptors and a
content-addressed manifest. Modified source requires a reviewed adapter update;
it is not an arbitrary `.sc` translator. Native and Web compilers consume the same
six source files. No hand-authored alternative asset tree is required.

The browser verifies payload size/hash before application creation and links the
GPU programs when the native-compatible load call executes. Application-level loads
remain synchronous after the preload boundary. Compiler output directories must
be marked and disjoint from input; validation failures preserve the previous
manifest. Old immutable objects are retained for open clients.

Scenes, mesh files, textures, mipmaps, HDR probes and the Windows/macOS/Linux
x86-64/ARM64 distribution matrix remain work under the
[compiler specification](../../../harfang3d/specifications/SPECS_HARFANG_WEB_ASSETC.md).
Only the Windows x64 executable has been built and tested here.

## Validation

Install the repository's Playwright development dependency and run:

```powershell
.venv/Scripts/python.exe experiments/native-scene-many-nodes/validate.py --native ../install/js_bullet/hgjs/hgjs.exe
.venv/Scripts/python.exe tools/validate.py --source
```

The first command builds the package, tests the compiler, runs the common API
fixture, captures the original tutorial through native HG JS/OpenGL and the
browser, and checks lifecycle and package boundaries. `--native-assetc PATH`
overrides `../install/assetc/assetc.exe`; `--browser PATH` selects Chromium.
`--skip-build` tests an existing package. Without `--native`, native execution and
image comparison are skipped. `--software` selects SwiftShader for smoke testing;
it does not enforce hardware image parity. On Unix use `.venv/bin/python`.

Observed on 2026-10-05, Chromium 154.0.8037.97, ANGLE/D3D11, NVIDIA RTX 4060:

| Check | Result |
| --- | --- |
| Original entry bytes | Identical, recorded in `release.json` |
| Scene | 10,204 nodes; 10,202 objects; 2 shared models; 1 camera; 1 light |
| Rendering | 2 forward + 2 shadow draw calls; 2,937,900 triangles per pass |
| Shadow | D16, 4096 x 4096, authored bias unchanged |
| Accounted GPU buffers/textures | 34,614,632 bytes; zero after cleanup |
| Capture | Frame 4 at 16,666,667 ns/frame, 960 x 625, AA off on both hosts |
| Native/browser RGB mean absolute error | 0.7524 / 255; threshold < 2 |
| Pixels with a channel difference > 16 | 1.672%; threshold < 3% |
| 60-frame draw CPU timings | Median 20.30 ms; P95 32.40 ms on this run |
| Existing regression suite | 66 browser cases and 10 prototype compiler cases pass |

Draw timing includes animation, scene update and WebGL submission; it is not a
GPU timer or a frame-rate guarantee. Driver allocations and the default browser
framebuffer are outside the GPU byte counter. SwiftShader showed D16 shadow
artifacts and much lower speed; hardware capture is the visual acceptance evidence.

The dedicated validator also checks 11 compiler scenarios and partial shader
startup failure, independent material mutation/rebatching, GPU/device limits,
resize, pause/resume, three restarts, Escape, stop while paused, corrupt assets,
and context loss. It forbids any WebAssembly access and audits HTTP requests.

## Files and follow-up

```text
experiments/native-scene-many-nodes/    # bootstrap, browser helper, build and tests
src/compat/                           # experimental native-compatible API/host
src/render/instanced-forward.js        # shared-model batching and spotlight pass
tools/native/                         # native compiler and reviewed shader adapters
build/experiments/native-scene-many-nodes/
  asset-input/                        # unchanged subset of common source assets
  assets-native/                      # native assetc output for comparison
  resources_compiled/                 # Web program compiler output
  native-reference/                   # unchanged entry + deterministic native host
  reports/                            # captures, native logs, validation JSON
dist/experiments/native-scene-many-nodes/ # independent HTTP package
```

`probe.py` is retained as a baseline audit of the original module pair against the
W2 import map. It does not launch the implemented compatibility experiment; its
original result is historical evidence in the
[feasibility specification](../../../harfang3d/specifications/SPECS_HARFANGJS_WEB_NATIVE_SCENE_MANY_NODES_FEASIBILITY.md).

The [Mouse Flight experiment](../native-game-mouse-flight/README.md) now extends
the same API facade and compiler to textures, authored scenes, instances and HDR.
The common facade returns native `NodeList` values from `GetNodes`/`GetAllNodes`
and caches world matrices until the next scene update. Browser diagnostics use
`nodes.get(i)` accordingly. The reduced gallery case
`scene_many_nodes.small.no_shadows` remains separate from this full experiment.
