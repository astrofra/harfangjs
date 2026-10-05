# Native Mouse Flight on HG JS Web

The original `harfang3d/tutorials/game_mouse_flight.js` runs byte-for-byte unchanged
through the same native-compatible facade as Many Nodes. Only `js/window.js` is
substituted by the browser host. The release uses JavaScript and WebGL 2; it has
no Wasm, runtime Python, native engine library or external service dependency.

## Run

From `harfangjs/`, with Python 3.10+, CMake and a C++17 toolchain installed:

```powershell
python experiments/native-game-mouse-flight/build.py
python experiments/native-game-mouse-flight/serve.py
```

Open **http://localhost:8002/**. Move the pointer inside the scene to steer the
paper plane. Click the canvas to focus keyboard input; **Escape** stops the
application. **Pause**, **Resume** and **Restart** are available above the scene.
The host starts the pointer at the canvas center until a real pointer event arrives.

After JavaScript-only changes, use `build.py --skip-compiler-build`. Source assets
and the compiler executable are hashed; unchanged compiled assets are reused.
`serve.py --port 8012` selects another port.

The browser controls window dimensions and presentation. Requested MSAA 8x is
ignored with a console warning, as allowed for this experiment. Flight speed
remains frame-based because that is the behavior of the original tutorial.

## Source and asset boundaries

```text
experiments/native-game-mouse-flight/     bootstrap, host helper, build and validation
build/experiments/native-game-mouse-flight/
  asset-input/                          unchanged subset of tutorial source assets
  resources_compiled/                   standalone assetc-web output
  assets-native/                        native assetc output for reference tests
  native-reference/                     unchanged entry and controlled native host
  reports/                              captures, measurements and contract results
dist/experiments/native-game-mouse-flight/ independent HTTP release
```

`assetc-web` is a native C++ executable built under `build/assetc-web/`. It reads
the original `.scn`, `.geo`, PNG, floating-point DDS and HDR inputs directly.
CMFT is statically linked for image conversion and CPU irradiance/radiance
filtering. Python orchestrates packaging and testing, not asset conversion.
The generated scene manifest uses `web-native-scene/1` and contains 12 assets:
three reviewed programs, two scenes, three geometries and four textures.
The compiled payloads occupy approximately 13.6 MB before HTTP compression.

The compiler embeds reviewed WebGL adapters for native PBR, depth and `pos_rgb`.
It verifies the original shader source hashes; it is not a general shader
translator. Unknown variants, unsupported sampler metadata, missing dependencies
and malformed supported geometry fail explicitly. Publication preserves the
previous manifest when compilation fails.

The vendored CMFT revision has defects in its memory input cursor. CMake corrects
a private build copy, allowing conversion from validated bytes and Unicode
source paths without changing `harfang3d/extern/cmft`.

## Shared API behavior

- `LoadSceneFromAssets` returns a synchronous boolean after the browser host has
  asynchronously preloaded and verified all dependencies.
- `CreateInstanceFromAssets` returns `[Node, boolean]`, parents the instantiated
  scene under its root and preserves the world's environment with default flags.
  A missing asset returns a valid instance root and `false`, matching native.
- `GetNodes` excludes instantiated children; `GetAllNodes` includes them. Both
  return native-shaped `NodeList` values: use `get(i)`/`at(i)`, `length` and
  `size()` (`BigInt`), not JavaScript array indexing or `.map()`.
- `Transform.GetWorld()` returns the matrix from the last scene update. Local
  TRS edits become visible in world space through `Scene.Update()` or the native
  `ReadyWorldMatrices()`/`ComputeWorldMatrices()` sequence. This includes the
  original camera behavior during the first frames.
- `Mouse`, `Mat3LookAt`, default-order `ToEuler`, `Clamp`, `GetZ`, numeric render
  constants, `RenderState`, color-float vertices, `SetView2D` and `DrawLines` retain
  the native signatures used here. Pointer coordinates use drawing-buffer pixels
  and a bottom-left origin. The line layout carries all four color components.
- The shared resource facade exposes texture references and native numeric
  material-state setters alongside the existing model and program references.

Rendering retains the authored PBR materials, base-color texture, global HDR
environment, fog and four directional shadow splits (1024 pixels per split in
a 2048-square depth atlas). The cursor is a separate depth-cleared 2D line view.
This scene has 21 total nodes, 18 objects, 372 main-pass triangles, five main
draws, 20 shadow draws and one line draw. Tracked GPU allocations are about
21.9 MB plus the 1,848-byte line buffer, and return to zero after shutdown.

## Validation

With the repository's Playwright development environment:

```powershell
.venv/Scripts/python.exe experiments/native-game-mouse-flight/validate.py --skip-build --native ../install/js_bullet/hgjs/hgjs.exe
```

Use `--assetc PATH` and `--browser PATH` to override the reference compiler and
browser. Omit `--native` for browser/compiler checks alone. Native comparison
uses an offscreen OpenGL window; both hosts disable AA and use 960 × 625 pixels.
The test host injects identical pointer coordinates outside the copied entry.

Validated on Windows x64, Chrome 154 and NVIDIA RTX 4060 / ANGLE D3D11:

| Check | Result |
| --- | --- |
| Original entry SHA-256 / bytes | Identical |
| 60-frame plane and camera replay | Each component agrees within `1e-5` |
| Shared native/Web API fixture | Pass |
| Frame 4 RGB mean absolute error | 0.0073 / 255 |
| Frame 60 RGB mean absolute error | 0.2807 / 255 |
| Frame 60 pixels with any channel error >16 | 0.172% |
| Compiler checks | 9 pass, including Unicode paths and failed publication |
| Browser/input/lifecycle checks | 8 pass, including context loss and corrupt assets |
| GPU resource cleanup | Zero remaining tracked allocations |

Image gates are an RGB mean error below 2/255 and fewer than 3% of pixels with
any channel error above 16. CPU draw submission was approximately 1.2 ms median
in an isolated run; it is not a GPU frame-time or cross-device guarantee.
Reports are saved in `build/experiments/native-game-mouse-flight/reports/`.

Many Nodes and the existing W0/W1/W2 validation suites are also regression gates.

## Remaining scope

This is an executable compatibility slice, not the complete HARFANG binding.
The scene profile currently accepts opaque, unskinned PBR materials with a base
color map, global legacy environment probes, static scene instances and
directional shadows. Nested authored instances, animation, physics, skinning,
other PBR maps, volume probes, transparency and arbitrary shader families remain
outside this experiment. Other texture encodings and metadata are not silently
substituted. The full Windows/macOS/Linux × x64/ARM64 compiler distribution is
still pending; this run validates Windows x64.

The [implementation specification](../../../harfang3d/specifications/SPECS_HARFANGJS_WEB_NATIVE_GAME_MOUSE_FLIGHT.md)
records the common-surface decisions and remaining work.
