# Scene Instances in the browser

The packaged `scene_instances.js` is byte-identical to
`harfang3d/tutorials/scene_instances.js`. Only `js/window.js` selects the browser
host. Twenty bipeds switch independently between idle, walk and run, using the
original rigid node animations, movement and playground scene.

From `harfangjs/`:

```sh
python tools/build.py --demo instances
python tools/serve.py --demo instances
```

Open **http://127.0.0.1:8000/**. Focus the canvas, then press **S** to add an actor
or **D** to remove the oldest actor. **Escape** stops the scene. Pause/Resume and
Restart are available in the toolbar. The standalone `serve.py` defaults to
port 8005. MSAA remains unsupported and produces the standard browser warning.

Upload the contents of **`dist/experiments/native-scene-instances/`** to a static
HTTPS server, preserving all relative paths. Transfer assets in binary mode.
The release includes its JavaScript runtime and 92 compiled asset payloads,
about 6.1 MiB with LZ4 compression. No native engine, WASM or server code runs
online. `build/experiments/native-scene-instances/` contains compiler inputs,
compiled output and reports; source assets remain in the native tutorials.

The initial scene has 3,778 nodes and 1,637 drawable objects, batched into 83
main-pass draws plus four directional shadow passes. All eleven biped clips
are compiled. Each actor has private animation bindings and 187 child nodes;
destroying its instance stops its players and invalidates its children/clips.
`scene.GarbageCollect()` releases components no longer referenced by nodes.
Shared models and textures stay cached until the tutorial disposes them.

The runtime now supports the tutorial's explicit `ComputePerspectiveViewState`
submission, `Mat4LookAt`, random helpers, vector `Clamp`, `Keyboard` and S/D keys.
The bipeds consist of rigid articulated meshes; this does not add skinning.
The existing limit of 16,384 nodes still applies when adding actors.

```sh
.venv/Scripts/python.exe tools/validate.py --demo instances --skip-build
```

The validator checks the unchanged entry, compiled payload integrity, independent
animation poses and loop timing, instance teardown, shared-component collection,
S/D including removal of every actor, restart, pause, resize and GPU cleanup.
Reports and a screenshot are written to
`build/experiments/native-scene-instances/reports/`.
