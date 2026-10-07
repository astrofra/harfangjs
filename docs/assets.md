# Web asset pipeline

`tools/native/assetc_web.cpp` and `scene_assets.h` implement **assetc-web**.
It compiles source assets directly into the format consumed by the browser.
The native desktop HARFANG asset compiler produces a different format; its output
is not an input to this Web pipeline.

## Build the compiler

```sh
python tools/build_compiler.py
```

This builds the current host target with CMake. `--harfang PATH` selects the
HARFANG source checkout and `--build-dir PATH` selects the output directory.
Only source headers and vendored dependencies are used; the engine and a native
reader bridge are not linked. CMake can also be used directly:

```sh
cmake -S tools/native -B build/assetc-web -DHARFANG_SOURCE=/path/to/harfang3d -DCMAKE_BUILD_TYPE=Release
cmake --build build/assetc-web --config Release --target assetc-web
cmake --install build/assetc-web --config Release --prefix dist/assetc-web
```

With the usual Visual Studio generator the executable is
`build/assetc-web/Release/assetc-web.exe`. A single-configuration Linux/macOS build
produces `build/assetc-web/assetc-web`. CMake installs the executable and the
vendored LZ4 library's license under `licenses/LZ4.txt`.
Windows x64 has been exercised in this workspace. Linux/macOS and x86-64/ARM64
release packages still require validation; this repository does not claim that
all six combinations have shipped.

## Compile sources

```text
assetc-web [options] input-directory [output-directory]
```

Omitted output defaults to `<input>_compiled`. The fixed rendering target is
WebGL 2. `--help` lists the supported flags, including `--max-texture-size N`
and the explicit `--animation-stubs` opt-in. Unsupported content/options fail.
Lossless LZ4 HC level 12 compression is enabled by default for all payload kinds.
Use `--compression none` for raw output, or `--compression lz4` explicitly.

The current compiler handles the reviewed default/PBR/line shader adapters,
JSON scenes and static source geometry, PNG/JPEG/DDS textures, mipmaps and HDR
probe preprocessing. It checks shader source provenance; it is not a general
translator for arbitrary HARFANG shaders. Skinning is unsupported.

The demos stage the required subset of the original assets into
`build/experiments/<demo>/asset-input/`, then invoke this same compiler. Python
selects inputs and packages outputs; it does not compile the asset formats.

## Compiled format and browser boundary

`manifest.json` declares schema `harfang-web-program-assets/1`, API `harfang-js/1`
and either `web-native-forward/1` (program assets) or `web-native-scene/1`
(programs, scenes, geometry and textures). These are two content profiles of the
same compiler and runtime.

Logical source paths are retained, while `uri` names the stored file. Compressed
files append `.lz4` to the original path; raw files keep the original filename.
These are compiled Web payloads: a `.jpg.lz4` output, for example, contains
compressed prepared texture data rather than the source JPEG. Entries include byte length, SHA-256, dependencies and
texture layout metadata where applicable. Programs contain reviewed GLSL ES
sources; scenes and geometry have JSON payloads. Texture payloads use the
manifest's RGBA8/RGBA16F face and mip descriptions.

Each asset that becomes smaller is stored as one independent **LZ4 block**
(not an LZ4 frame, no dictionary or embedded size prefix). Its manifest entry
adds `compression: "lz4-block"`, `storedByteLength` and `storedSha256`.
The existing `byteLength` and `sha256` always describe the **decoded** payload;
texture offsets remain offsets into those decoded bytes. Assets with no size
benefit retain the raw format and omit the three storage fields. The manifest
itself stays plain JSON. Mixed compressed/raw bundles and older raw bundles are
supported by the current loader; older loaders cannot read compressed bundles.

The native compiler statically links the checked-in LZ4 v1.10.0 sources in
`tools/native/third_party/lz4/` (BSD-2-Clause; version and source hashes in
`provenance.json`). Builds do not download a codec. The browser decoder in
`src/compat/lz4.js` is JavaScript only, without WASM, external modules or server
configuration. Normal static HTTP hosting suffices; do not label these files
with an HTTP `Content-Encoding: lz4` header. Upload the runtime, manifest and
assets together so they describe the same release.
Use **binary transfer mode** when uploading compiled assets over FTP. The `.lz4`
suffix avoids automatic text-mode selection for extensionless logical assets
such as `shaders/pos_rgb`; text-mode transfer can strip bytes and break integrity.
The loader also accepts previous compressed manifests whose `uri` had no suffix.

`src/compat/program-assets.js` fetches the manifest and payloads, checks budgets
and integrity, and prepares the browser resources. Application asset APIs read
this preloaded set. The browser does not access source assets, native compiled
assets, Python, an executable compiler, or a reader bridge.

The loader validates sizes before fetching assets, checks stored SHA-256 before
LZ4 decoding, and checks decoded size/SHA-256 before parsing or GPU upload.
Resource and bundle budgets still use decoded sizes; this transport compression
does not reduce GPU memory. A compressed buffer and its decoded buffer can
temporarily coexist. Loading progress counts stored asset bytes (after any
automatic HTTP decoding); it reaches 100% only after integrity and parsing pass.

Compilation validates before replacing its marked output directory. Inputs and
outputs must be disjoint. Packaging verifies the manifest's payload hashes and
copies the current assets via `tools/package_assets.py`. `tools/package_runtime.py`
audits the module graph and removes obsolete runtime files from regenerated
packages. Upload the complete `dist/experiments/<demo>/` contents.
Packaging verifies stored hashes for compressed files without needing a Python
LZ4 dependency. The optional validation suite uses Python LZ4 as an independent
oracle for decoded bytes and tests the JS decoder against upstream encodings.

The wider distribution requirements are recorded in the sibling
[compiler specification](../../harfang3d/specifications/SPECS_HARFANG_WEB_ASSETC.md).
