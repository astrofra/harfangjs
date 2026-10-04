# harfangjs

The first browser implementation of the HARFANG hybrid delivery plan: the **C portable contract and W0 browser foundations**, using JavaScript ES modules and WebGL 2. The runtime has no package dependencies, Wasm engine, or Wasm codecs.

It includes float math checked against native HARFANG outputs, generation-checked nodes and resources, explicit disposal, cancellable/deduplicated byte loading, per-component JavaScript behaviors, keyboard/mouse snapshots, an asynchronous application lifecycle, and dynamic white/colored lines.

The browser tutorial selector runs `basic_loop`, `draw_lines`, seeded `draw_lines_starfield`, four input examples, a line-based resize derivative, and the JS adaptation of `scene_lua_script`. Applications import the bare name `harfang`.

From this directory, with Python 3.10 or later:

```powershell
python tools/serve.py
```

Open **http://127.0.0.1:8000/examples/tutorials/**. Click the canvas for input; Escape stops it. The page includes pause/resume, restart, live counters, and a link to conformance tests.

Build a standalone HTTP package:

```powershell
python tools/build.py
python tools/serve.py --dist
```

The result is `dist/web/`, including source modules, tutorials, conformance fixtures, the license, and a hashed `release.json`. Serve it over HTTP(S), including when deployed below a URL prefix. No Node installation or bundling step is required. This W0 package has no authored scene assets; the `assetc` web target belongs to W1.

Run automated validation using an installed Chrome, Edge, or Chromium:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
.venv/Scripts/python.exe tools/validate.py
```

On Unix, use `.venv/bin/python`. An explicit browser can be selected with `--browser PATH`. The runner builds and tests the packaged output, exercises real keyboard/mouse/focus/resize/restart behavior, records fixed-time tutorial captures, and checks package imports and runtime/network activity for Wasm. Results are written to `build/reports/validation.json`; the headless renderer uses ANGLE SwiftShader. Tests can also be run interactively at `/tests/`.

Current scope and evidence are recorded in [the acceptance report](docs/acceptance.md). [The contract](docs/contract.md) defines supported overloads, ownership, timing, input, scripts, and error behavior. [The binding inventory](contract/binding-inventory.json) comes from the actual native binding declarations; [the tutorial manifest](contract/tutorials.json) preserves all 56 families and their retained/deferred/excluded decisions.

**Native QuickJS execution is slice N and is not implemented here.** `examples/tutorials/main.js` records the explicit desktop entry contract and requires that host. Native math reference fixtures are evidence for numeric conventions, not native-JS execution. The cross-host C/W0 acceptance gate remains open. Static scene loading, meshes, materials, lighting, hierarchy, animation, audio, and portable UI begin in later slices; unsupported required capabilities fail explicitly.
