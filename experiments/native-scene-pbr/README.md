# Native PBR Scene on HG JS Web

The original `harfang3d/tutorials/scene_pbr.js` runs unchanged through the shared
native-compatible API. Only `js/window.js` selects the browser host. The authored
scene retains its twelve spheres, PBR base/normal/ORM textures, HDR environment,
transparent sphere and spotlight shadow.

From `harfangjs/`:

```powershell
python experiments/native-scene-pbr/build.py
python experiments/native-scene-pbr/serve.py
```

Open **http://localhost:8004/**. Asset loading shows a percentage. Pause/Resume,
Restart and Escape are available. Canvas dimensions follow the browser; the
tutorial's MSAA request produces one warning and is ignored. This tutorial needs
neither AAA nor animation stubs.

Building needs Python, CMake and a C++17 compiler. The build creates the standalone
native `assetc-web` executable. Use `--skip-compiler-build` after building it when
only JavaScript changes. The browser runs JavaScript/WebGL 2 without Wasm.

## Static deployment

Upload the complete **contents of `dist/experiments/native-scene-pbr/`** to Apache
or another static HTTP(S) server, preserving the directory structure. Subdirectory
deployment works with the included relative import map. Include the packaged
`js/window.js`, `src/` and `resources_compiled/manifest.json` with all payloads.
The native tutorial's window helper imports `harfang-host` and is not the browser
helper.

## Compiled assets

| Role | Directory |
| --- | --- |
| Original sources | `../harfang3d/tutorials/resources/` |
| Staged compiler inputs | `build/experiments/native-scene-pbr/asset-input/` |
| Compiled Web assets | `build/experiments/native-scene-pbr/resources_compiled/` |
| HTTP release | `dist/experiments/native-scene-pbr/` |
| Packaged Web assets | `dist/experiments/native-scene-pbr/resources_compiled/` |

The scene uses 27 JPEG source images and one PNG. **JPEG support is in assetc-web,
not the runtime:** the compiler decodes them offline, produces RGBA8 mipmaps and
retains the original paths, including `.jpg`. Those compiled files contain raw
texture data described by the manifest; opening them as JPEG images is not a
valid inspection method. Native assetc also preserves source filenames while
replacing their contents with compiled textures.

BC2/BC3/BC5/ETC1 source compression requests are recorded and explicitly reported
as converted to portable RGBA8. HDR probes and BRDF data remain RGBA16F. Texture
dimensions are preserved by default, subject to authored `max-size` metadata.
The release contains 37 compiled assets, about **161.94 MiB** of payloads and
**163.11 MiB** of tracked GPU allocations at the validation viewport.

This browser host explicitly sets `maxAssetBytes` and `maxGPUBytes` to **256 MiB**;
the other experiments retain their 128 MiB defaults. These are asset and tracked
GPU budgets, not a cap on total browser process memory. For a lighter build:

```powershell
python experiments/native-scene-pbr/build.py --skip-compiler-build --max-texture-size 512
```

This limits PNG/JPEG dimensions before mip generation, leaving source files and
HDR/BRDF conversion untouched. Running the default build restores original
dimensions. The native comparison validator below expects the default build.

## Validation

```powershell
.venv/Scripts/python.exe experiments/native-scene-pbr/validate.py --skip-build --native ../install/js_bullet/hgjs/hgjs.exe
```

The validator compares the unchanged entry in native OpenGL and browser WebGL 2
at 960x625 with MSAA disabled, using 12 fixed-step frames. Captures 4 and 12 have
a mean channel error of about 1.509/255; 1.128% of pixels differ by more than 16.
Native GPU compression and Web RGBA8 filtering produce some visible differences
in fine texture and reflection detail. The gate is below 2/255 mean error and
below 3% of pixels over 16.

Checks also cover JPEG conversion, original filenames and metadata, optional
resizing, rejection of a truncated JPEG without damaging previous output, scene
and entry preservation, camera state, budgets, alpha sorting with two instances
sharing one material, opaque-only shadow casting, pause/resume, resize, restart
and zero tracked GPU resources after stopping.

Reports and captures: `build/experiments/native-scene-pbr/reports/`. Add
`?test&frames=12` to the URL and inspect `window.pbrScene` for captures, progress,
scene state and renderer counters. The source fixture submits 12 opaque draws,
one transparent draw and 12 shadow draws per frame.

See the [implementation specification](../../../harfang3d/specifications/SPECS_HARFANGJS_WEB_NATIVE_SCENE_PBR.md)
for the supported API and rendering boundaries.
