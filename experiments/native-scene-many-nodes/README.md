# Native `scene_many_nodes.js` experiment

Status: feasibility workspace, 2026-10-05. The original tutorial does **not** run
in the current Web runtime. No compatibility facade, shadow renderer or new asset
compiler is implemented here yet.

The design, problems, alternatives and acceptance gates are in
[the feasibility specification](../../../harfang3d/specifications/SPECS_HARFANGJS_WEB_NATIVE_SCENE_MANY_NODES_FEASIBILITY.md).

The target is to copy `harfang3d/tutorials/scene_many_nodes.js` without editing it,
retain its full 101 x 101 grid and spotlight shadows, and find a useful common
surface between native HG JS and Web HG JS. Native HG JS remains authoritative
for JavaScript API behavior; HG Lua remains the native functionality reference.

## Reproduce the current blockers

From `harfangjs/`, using the existing development environment:

```powershell
.venv/Scripts/python.exe experiments/native-scene-many-nodes/probe.py --native ../install/js_bullet/hgjs/hgjs.exe
```

On Unix, use `.venv/bin/python`. Omit `--native` to run only the browser probe;
`--browser PATH` selects an installed Chrome, Edge or Chromium. Playwright is a
development dependency from `requirements-dev.txt`, not a browser dependency.
The supplied native executable must belong to the native build being studied.

The probe copies both the entry and its `js/window.js` dependency byte for byte,
records their hashes and repository revisions, opens a temporary local HTTP
server, and inspects the actual Web module exports in a headless browser. It
checks the scene allocation limit, transform copy semantics and source import
failure. The optional native probe checks selected values and scene clearing
without creating a window. All processes and the server are closed afterwards.

Outputs are under `build/experiments/native-scene-many-nodes/`:

```text
source/scene_many_nodes.js   # exact generated copy; never edit
source/js/window.js         # exact generated copy; never edit
baseline-probe.json         # observed exports, limits, source hashes
native-value-probe.js       # optional generated native probe
native-value-probe.log      # optional native output
```

A successful probe exit means the **audit** ran. It does not mean the tutorial
ran, assets were compiled or rendering parity was established. On the initial
baseline, 31 of 43 referenced `hg` export names are absent, `Scene.Update/Clear`
are absent, allocation stops at 10,000 nodes, and the exact source import fails
on `harfang-host`. Some missing names belong to optional wrapper branches.

## Workspace boundaries

Keep experiment-owned bootstrap/adapters/recipes beside this README when they
are implemented. Promote reusable runtime APIs into `src/` after validation.
The standalone Web compiler belongs in `tools/native/`, as required by
[the compiler contract](../../../harfang3d/specifications/SPECS_HARFANG_WEB_ASSETC.md).

Reserve these separate generated locations for subsequent milestones:

```text
build/experiments/native-scene-many-nodes/
  source/                   # exact tutorial/module copies
  asset-input/              # optional unchanged source dependency subset
  assets-native/            # native assetc output for comparison
  resources_compiled/       # assetc-web output + manifest for the Web host
  reports/                  # state checks, timings and capture comparisons
dist/experiments/native-scene-many-nodes/
                            # self-contained HTTP package
```

These future outputs are not produced by `probe.py`. The existing `build/` and
`dist/` ignore rules cover generated files. Do not mix runtime assets with copied
JavaScript modules or hand-copy source assets into `resources_compiled/`.

## Milestones

1. Exact entry import and host/API compatibility, with explicit missing-feature
   failures and an asset preload boundary.
2. Full 10,201-sphere rendering with shadows explicitly disabled in a separately
   named diagnostic profile. This cannot close the original tutorial gate.
3. Original spotlight shadow behavior at 4096, requested MSAA and full workload,
   with deterministic native/Web comparisons and measured resource use.
4. Reuse the resulting surface for the neighboring native tutorials; extend the
   compiler to textures, scenes and HDR under its existing product contract.

Do not relabel the existing `scene_many_nodes.small.no_shadows` Web example as
this experiment. It remains a separate, intentionally reduced correctness case.
