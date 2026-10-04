# harfangjs

HARFANG's **C/W0 foundations and W1 static scenes/assets**, using JavaScript ES modules and WebGL 2. The browser runtime has no package dependencies or Wasm code.

W1 adds native JSON scene loading, hierarchy, perspective/orthographic cameras, indexed meshes and material slots, unlit PNG/JPEG materials, fixed cube/plane drawing, and an offline web asset writer. The room includes two cameras, a parented prop, negative scale, UV seams, and a disabled object. Existing line, input, lifecycle, and JS behavior examples remain available.

Build and run from this directory with Python 3.10 or later:

```powershell
python tools/build_native.py
python tools/build.py
python tools/serve.py --dist
```

Open **http://127.0.0.1:8000/examples/tutorials/**. Click the canvas; **Space** switches the room camera and **Escape** stops the application. The page includes pause/resume, restart, live counters, and conformance tests.

The offline build needs a native HARFANG build and `assetc`; the resulting `dist/web/` needs only an HTTP(S) server. Defaults match this workspace: `../harfang3d`, `../build/python-cmake`, and `../install/assetc/assetc.exe`. `build_native.py --harfang-build PATH` links the bridge against an existing MSVC Release x64 build without changing it. Other platforms can add `tools/native` to a HARFANG CMake build containing the `engine` target. See [the W1 asset workflow](docs/static-assets.md) for custom paths and standalone compilation.

For source development, run `python tools/build_assets.py` followed by `python tools/serve.py`. The server maps `/assets-web/` to generated compiled assets. Editable fixture recipes, generated native inputs, native/web compiled assets, and the HTTP release remain separate.

Validate with an installed Chrome, Edge, or Chromium:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
.venv/Scripts/python.exe tools/validate.py --native-render
```

On Unix, use `.venv/bin/python`. `--browser PATH` selects the browser. Omit `--native-render` when native OpenGL capture is unavailable; native asset compilation and scene-state checks still run. The full run checks 47 browser cases, seven compiler cases, real input/resize/restart, resource cleanup, runtime asset boundaries, absence of Wasm, and both room cameras against native C++ rendered images. Reports and captures are in `build/reports/`. Browser capture uses ANGLE SwiftShader.

The selector includes `draw_model_no_pipeline`, `render_resize_to_window`, `filesystem_assets`, `picture_load`, and **`scene_pbr.structure`**. The last case preserves the original tutorial scene and assignments but renders opaque unlit diagnostic colors; PBR appearance belongs to W2/W4.

Details: [acceptance evidence](docs/acceptance.md), [portable contract](docs/contract.md), [asset format and tooling](docs/static-assets.md), [binding inventory](contract/binding-inventory.json), and [56-family tutorial manifest](contract/tutorials.json).

**Native QuickJS execution remains slice N.** The same JS application has not yet run on a native JS facade; current native references use C++ HARFANG. Lighting, shadows, scene instances, animation, skinning, audio, and portable UI remain outside W1. Required unsupported features fail explicitly.
