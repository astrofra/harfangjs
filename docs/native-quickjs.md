# Native HarfangJs compatibility gate

HARFANG's `HarfangJs` target adds an external QuickJS binding and the `hgjs`
launcher. Enable `HG_BUILD_HG_JS`; the engine keeps its Lua VM and scene systems.
QuickJS is confined to `languages/hg_quickjs` and its runtime dependency. The web
implementation remains JavaScript/WebGL 2 with no QuickJS or Wasm.

The [compatibility priorities](contract.md#compatibility-priorities) are
**HG Lua -> native HG JS -> web HG JS**. Native conformity with HG Lua comes
first. The browser runtime adapts on a best-effort basis to native JS projects;
web exclusions and resource limits do not restrict the native target. Native
conformity and web compatibility results are reported separately.

Read [the native integration documentation](../../harfang3d/languages/hg_quickjs/README.md)
and [the three native tutorial ports](../../harfang3d/tutorials/README_JS.md).

The normal native invocation is `hgjs script.js [args...]`, with JavaScript read
directly from disk and imports resolved relative to the importing file. Programs
choose their resource folders through `hg.AddAssetsFolder()` or mount archives
with `hg.AddAssetsPackage()`. The launcher does not mount any resource directory.

```powershell
python tools/build_hgjs.py --quickjs-source C:/deps/quickjs-2026-06-04 --zig C:/deps/zig-0.14.1/zig.exe
.venv/Scripts/python.exe tools/validate_native_js.py --native-render
python tools/package_hgjs.py
dist/native/hgjs/run.cmd draw_lines.js
dist/native/hgjs/run.cmd draw_model_no_pipeline.js
dist/native/hgjs/run.cmd filesystem_assets.js
```

JavaScript runs directly from disk. Validation compiles the original tutorial
shaders and owl texture through native assetc into `resources_compiled`, using
the native graphics API default. A separate `opengl/resources_compiled` folder
contains the shaders for the explicit OpenGL tutorial checks.
The package keeps JavaScript entry files separate from those resources.
`--native-render` additionally requires the generated scene sources
from `tools/build_assets.py`; these are recompiled for the native default.
The installed package includes GLFW and Lua's DLL.

`tests/shared/native-web.js` exercises the same 19 math/scene contract groups
through C++ bindings and the browser implementation. Numbers use `1e-6` tolerance;
BigInt strings, names and validity compare exactly. Three launcher runs each
create four ordinary Lua scene VMs and update a Lua component from JavaScript.
Six negative cases cover missing/invalid modules, rejections, stalled completion
and stack overflow. Native programs have no execution deadline or fixed heap
cap. Window checks cover output-array order and close-during-await. All three
native tutorial ports execute their actual drawing/loading paths with both the
native default renderer and explicitly selected OpenGL, each with matching
shader binaries. The default package uses the native renderer, as in Lua.

Optional native scene captures cover the room, lighting gallery and ambient PBR
fixture. Those prove execution through QuickJS; the W2 C++/browser image comparison
is a separate gate. Results are in `build/reports/native-js-conformance.json`,
`hgjs-*.log` and captures.

The native binding's API surface is checked against Lua and Squirrel by
`harfang3d/languages/hg_quickjs/check_api_parity.py`, including exports of the
compiled executable when `--hgjs` is passed. The native CLI gate also exercises
`SceneLuaVM.Pack/Unpack`, cross-VM values and reference lifetimes, Bullet when
enabled, synchronous execution past five seconds and a heap above 256 MiB.
This does not assert behavioral equivalence for every native overload.

This scope is the native language target and tutorial ports. It does not add a
JavaScript scene VM. Full portable W1/W2 host, assets and rendering interfaces,
`.data` typed arrays, strict portable conversions and API filtering remain open.
