# harfangjs

HARFANG's **C/W0 foundations, W1 static scenes/assets, and W2 materials/forward lighting**, using JavaScript ES modules and WebGL 2. The browser runtime has no package dependencies or Wasm code.

**Compatibility priority: HG Lua -> native HG JS -> web HG JS.** Native HG JS
prioritizes conformity with HG Lua. This web implementation adapts on a
best-effort basis to run native HG JS projects, with documented adaptations and
limitations. Browser restrictions do not constrain native functionality. See the
[compatibility policy](docs/contract.md#compatibility-priorities).

**Asset compiler roadmap:** the common input for all destinations is the same
uncompiled asset tree. Existing native `assetc` produces the compiled assets shared
by HG Lua, Python and HG JS native. HG JS Web requires a separate, standalone
native desktop compiler in `tools/native/` for scenes, models, textures and HDR
probes, distributed for Windows/macOS/Linux on x86-64 and ARM64. Its CLI follows `assetc`, with fewer
options and a fixed WebGL 2 target (no graphics-backend selection). This product
is still pending; see the [compiler specification](../harfang3d/specifications/SPECS_HARFANG_WEB_ASSETC.md).

W1 adds native JSON scene loading, hierarchy, perspective/orthographic cameras, indexed meshes and material slots, unlit PNG/JPEG materials, fixed cube/plane drawing, and an offline web asset writer. The room includes two cameras, a parented prop, negative scale, UV seams, and a disabled object. Existing line, input, lifecycle, and JS behavior examples remain available.

W2 adds the historical Phong and HARFANG PBR material families, normal/ORM/emissive maps, alpha cut, blending, eight prioritized light slots, and fog. The default gallery has interactive lighting and material controls. Environment lighting uses an explicitly declared ambient approximation; shadows remain W3.

Build and run the current prototype from this directory with Python 3.10 or later:

```powershell
python tools/build_native.py
python tools/build.py
python tools/serve.py --dist
```

Open **http://127.0.0.1:8000/examples/tutorials/**. In the gallery, click the canvas: **Space** cycles the light rig, **F** toggles fog, **N** toggles the normal map, and **R** changes roughness. **Escape** stops the application. The room retains its Space camera switch. The page includes pause/resume, restart, live counters, and conformance tests.

The prototype offline build needs a native HARFANG build and `assetc`; the resulting `dist/web/` needs only an HTTP(S) server. Defaults match this workspace: `../harfang3d`, `../build/python-cmake`, and `../install/assetc/assetc.exe`. `build_native.py --harfang-build PATH` links the bridge against an existing MSVC Release x64 build without changing it. Other platforms can add `tools/native` to a HARFANG CMake build containing the `engine` target. These development requirements do not define the final standalone compiler package. See [the W1 asset workflow](docs/static-assets.md) for current prototype commands and custom paths.

For source development, run `python tools/build_assets.py` followed by `python tools/serve.py`. The server maps `/assets-web/` to generated compiled assets. Editable fixture recipes, generated native inputs, native/web compiled assets, and the HTTP release remain separate.

Validate with an installed Chrome, Edge, or Chromium:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
.venv/Scripts/python.exe tools/validate.py --native-render
```

On Unix, use `.venv/bin/python`. `--browser PATH` selects the browser. Omit `--native-render` when native OpenGL capture is unavailable; native asset compilation and scene-state checks still run. The full run checks 66 browser cases, ten compiler cases, real input/resize/restart, resource cleanup, runtime asset boundaries, absence of Wasm, and five native C++ rendered views. Reports, startup measurements, and captures are in `build/reports/`. Browser capture uses ANGLE SwiftShader.

The selector includes **`scene_pbr.materials`**, `material_update_value.no_shadows`, `scene_light_priority`, and `scene_many_nodes.small.no_shadows`. The earlier `scene_pbr.structure` remains a separate diagnostic case. See [materials and forward lighting](docs/forward-materials.md) for shader mappings, tutorial adaptations, and limits.

Details: [acceptance evidence](docs/acceptance.md), [portable contract](docs/contract.md), [asset format and tooling](docs/static-assets.md), [binding inventory](contract/binding-inventory.json), and [56-family tutorial manifest](contract/tutorials.json).

**Native HarfangJs has an executable compatibility gate.** Its external QuickJS binding uses the existing engine with Lua scene systems. Three native tutorials are ported from Lua/Squirrel: animated lines, models without a scene pipeline, and texture loading. Shared math/scene fixtures run through C++ bindings and the browser. See [native QuickJS integration](docs/native-quickjs.md) for commands and limits. The complete W1/W2 portable application facade remains pending. Shadows, environment probes, scene instances, animation, skinning, audio, and portable UI remain deferred in the web profile.
