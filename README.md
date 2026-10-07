# HarfangJS

HarfangJS runs HARFANG applications **in the browser**, using JavaScript ES modules
and WebGL 2. Its assets are prepared offline by **assetc-web**, a standalone native
C++ compiler intended for Windows, Linux and macOS.

```text
Source scenes, models, textures and shaders
    -> assetc-web (native desktop tool)
    -> compiled Web assets + manifest.json
    -> HarfangJS (client-side loading and rendering)
```

The deployed application needs only a static HTTP(S) server. Python is used for
building, packaging and testing; it does not run in the browser or on the server.
The compiler has no dependency on a separately installed HARFANG engine or reader.
Windows x64 is exercised here; Linux/macOS and the complete architecture release
matrix still need platform validation and distribution work.

## Build and run

Requirements for a source build: Python 3.10+, CMake, a C++17 compiler and the
sibling `../harfang3d` checkout (compiler dependencies and original demo assets).

```sh
python tools/build.py --demo many-nodes
python tools/serve.py --demo many-nodes
```

Open **http://127.0.0.1:8000/**. Upload the contents of the generated demo directory
under `dist/experiments/` to publish it. Preserve its relative paths and use HTTPS
or localhost for browser integrity checks.

| Demo | Build selector | Source and details |
| --- | --- | --- |
| Many Nodes | `many-nodes` | [10,201 moving spheres and spotlight shadows](experiments/native-scene-many-nodes/README.md) |
| Mouse Flight | `mouse-flight` | [Authored scenes, input, instances and HDR](experiments/native-game-mouse-flight/README.md) |
| Engine | `engine` | [PBR engine scene, normal/ORM maps and shadows](experiments/native-scene-aaa/README.md) |
| PBR Scene | `pbr` | [PBR materials, transparency and HDR](experiments/native-scene-pbr/README.md) |

`--demo all` builds all four. `--skip-compiler-build` reuses the existing compiler.
Each demo also retains its own `build.py`, `serve.py` and `validate.py`.
The `native-` names identify the original HARFANG tutorials; these packages run
client-side. The native JS binding itself belongs to the sibling HARFANG project.

## Public modules

Applications import `harfang`; browser startup imports `harfang/browser`.
`package.json` and the demo import maps point to the same public modules:

```html
<script type="importmap">
{"imports":{"harfang":"./src/index.js","harfang/browser":"./src/browser.js"}}
</script>
```

`src/index.js` exposes the supported HARFANG API. `src/browser.js` exposes
`createNativeBrowserApplication` and `runWindow`. Browser startup downloads and
validates the compiled manifest and payloads before entering application code.
Supported native-style asset calls then use these preloaded resources.
Compiled payloads use LZ4 HC transport compression by default, decoded locally
in JavaScript; static hosting needs no compression configuration. The loader
also accepts older uncompressed assets. See [asset compilation](docs/assets.md)
for the manifest fields and `--compression none` option.

## Repository layout

- `src/`: browser API, compiled-asset loader, scene model and WebGL rendering.
- `tools/native/`: native asset compiler, image/probe processing and shader adapters.
- `tools/`: Python build, package and validation orchestration.
- `experiments/`: the four working Web demos and their regression checks.
- `build/`: generated compiler inputs, binaries, assets and validation reports.
- `dist/`: standalone static Web packages.

## Validation and scope

```sh
python -m pip install -r requirements-dev.txt
python tools/validate.py
```

Use `--demo many-nodes` (or another selector) for one demo, and `--skip-build` to
check existing packages. Validation runs an installed Chromium browser via
Playwright. Optional native reference comparisons in the individual validators
verify Web compatibility; they are not a second product or deployment path.

See [asset compilation](docs/assets.md), [browser API contract and limits](docs/contract.md)
and [validation](docs/acceptance.md). Native names and semantics are preserved
where supported; this is not the complete HARFANG binding. Rigid node animations
(position, rotation, scale and enable tracks) play through the native-shaped API;
see [animation playback](docs/animations.md). Skinning, physics and arbitrary
shader translation remain unsupported. The Engine demo plays `Take 001` in a
loop and uses the warned AAA fallback to the forward pipeline.
