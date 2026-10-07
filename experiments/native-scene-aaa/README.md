# Native Engine Scene on HG JS Web

The JavaScript port of `harfang3d/tutorials/scene_aaa.lua` runs through the same
native-shaped API as Many Nodes and Mouse Flight. The packaged `scene_aaa.js` is
byte-identical to `harfang3d/tutorials/scene_aaa.js`; only `js/window.js` selects
the browser host. The browser renders forward, with explicit AAA and animation
stubs. The engine's scripted 15-degree-per-second rotation remains active.

From `harfangjs/`:

```powershell
python experiments/native-scene-aaa/build.py
python experiments/native-scene-aaa/serve.py
```

Open **http://localhost:8003/**. Pause, Resume and Restart are available; Escape
stops the scene. MSAA, AAA and animation playback each produce one console
warning per browser session. Animation stubs never report successful playback.

The build needs Python for orchestration, CMake and a C++17 compiler. It builds
the standalone native `assetc-web`; no native engine, Python or Wasm runs in the
browser. After a compiler build, use `--skip-compiler-build` for JS-only changes.

## Deploying to Apache or another static server

Upload the complete **contents of `dist/experiments/native-scene-aaa/`**, preserving
its directory structure. The release is self-contained and supports a subdirectory
such as `/HarfangJs/native-scene-aaa/` without changing the import map.

Use the packaged `js/window.js`. Its browser implementation is:

```javascript
export {runWindow} from 'harfang/browser';
```

Transfer compiled assets in **binary mode** over FTP. Their `.lz4` extension
marks binary transport files; logical scene/material paths are unchanged.
Replace `resources_compiled/manifest.json` together with its referenced files.
An `ASSET_INTEGRITY` error can indicate an incomplete or text-mode upload.

The `js/window.js` in `harfang3d/tutorials/` is the native helper and imports
`harfang-host`, a module supplied by the native executable. Uploading that helper
causes the browser's **bare specifier `harfang-host` was not remapped** error.
Replace the deployed helper with the one from the Web release and reload without
cache. The shared tutorial entry is identical across targets; the window helper
is intentionally specific to each host.

## Assets

| Role | Directory |
| --- | --- |
| Original sources | `../harfang3d/tutorials/resources/` |
| Staged compiler inputs | `build/experiments/native-scene-aaa/asset-input/` |
| Compiled Web assets | `build/experiments/native-scene-aaa/resources_compiled/` |
| HTTP release | `dist/experiments/native-scene-aaa/` |
| Packaged Web assets | `dist/experiments/native-scene-aaa/resources_compiled/` |

The original scene, animation data and logical filenames are preserved. Assets
include the 123 authored nodes and three instanced cyclorama nodes, PBR base/ORM/
normal maps, tangent frames, the HDR environment, four directional shadow splits
and one spotlight shadow. The engine scene's probe has zero parallax and uses
the existing global environment sampling path.

The build passes `--animation-stubs --max-texture-size 1024` to `assetc-web`.
Only compiled PNG textures are resized; source files are untouched. Twelve
2048-square textures would exceed the current 128 MiB budget in portable RGBA8.
Native BC3 metadata is reported and converted to RGBA8; the manifest records both
the source compression request and the actual format. The 1024 limit produces
about 118.4 MiB of decoded payloads and 90.8 MiB of tracked GPU resources.
Default LZ4 HC transport compression reduces the packaged asset payloads to
about 31.1 MiB (74% smaller), including scenes, geometry, textures and probes.
The browser decompresses them in JavaScript without server configuration or
WASM. This reduces transfer size; decoded/GPU memory budgets are unchanged.
The original 11-square logo remains 11-square.

The compiler's default keeps original texture dimensions. This experiment's
`build.py --max-texture-size N` changes its PNG limit; increasing it may exceed
the unchanged browser asset/GPU budgets. Parallax-corrected probes, skinning,
additional blend modes beyond opaque/alpha and additional shadow-casting local lights remain outside
this profile and fail explicitly.

The later [PBR Scene experiment](../native-scene-pbr/README.md) adds sorted alpha
blending to the shared native scene renderer; the engine fixture remains opaque.

## Native reference and validation

The native tutorial uses real AAA by default, as the Lua tutorial does. Calling
`main({aaa:false})` selects native forward rendering for comparison. Native
animation support is unchanged; stubs belong only to the Web facade.

```powershell
.venv/Scripts/python.exe experiments/native-scene-aaa/validate.py --skip-build --native ../install/js_bullet/hgjs/hgjs.exe
```

The validator runs 60 fixed-step frames in native OpenGL and browser WebGL2,
compares rotation and native API defaults/return types, and checks images 4 and
60. Native textures retain their original resolution/compression; the image
threshold is mean channel error below 2/255 and fewer than 3% of pixels differing
by more than 16. It also checks stub warnings, typed empty animation lists,
instance views, cycle rollback, pause/resume, resize, restart and zero GPU
resources after stopping. Compiler checks cover deterministic output, resizing,
explicit animation opt-in and failed-build preservation.

Reports and captures: `build/experiments/native-scene-aaa/reports/`. Add
`?test&frames=60` to the page URL for fixed-step capture and inspect
`window.engineScene` for counters, warnings and samples.

Model: Toyota 2JZ-GTE Engine by Serhii Denysenko (`serhiidenysenko8256` on
CGTrader); attribution is preserved in the tutorial. See the
[implementation specification](../../../harfang3d/specifications/SPECS_HARFANGJS_WEB_NATIVE_SCENE_AAA.md)
for the exact public API slice and omissions.
