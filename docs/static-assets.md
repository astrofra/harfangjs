# W1 static assets

The prototype writer is `tools/assetc_web.py`. It follows the feasibility study's temporary helper allowance: native binary scenes and source geometry are read by a C++ bridge linked to HARFANG, while Python validates the W1 subset and writes web payloads. Native `assetc` itself is unchanged. Consolidating this writer into the shared compiler remains future work.

## Build paths

| Role | Location |
| --- | --- |
| Authored room recipe and shader source | `tools/generate_fixture.py` |
| Existing tutorial authoring assets | sibling `harfang3d/tutorials/resources` |
| Generated room source and native binary input | `build/fixtures/source`, `build/fixtures/binary-input` |
| Native compiled output | `build/assets-native` |
| Web compiled output | `build/assets-web` |
| Offline native reader and optional renderer | `build/native/Release/harfang_web_asset_bridge.exe` |
| Standalone HTTP package | `dist/web` |

`python tools/build_assets.py` generates the room source, compiles that same tree with native `assetc -api GL` and the web writer, converts a native binary copy offline, and records native scene state for the source room, native compiled room, and structural PBR tutorial. It then compiles the original tutorial meshes/images through the web writer. The browser never mounts either source tree or the native compiled directory.

Custom build paths:

```powershell
python tools/build_native.py --harfang-build ../build/python-cmake
python tools/build_assets.py --harfang ../harfang3d --bridge build/native/Release/harfang_web_asset_bridge.exe --assetc ../install/assetc/assetc.exe
python tools/build.py --assets build/assets-web
```

Compile another supported scene independently:

```powershell
python tools/assetc_web.py path/to/source path/to/assets-web --scene scenes/example.scn --bridge build/native/Release/harfang_web_asset_bridge.exe
```

`--mount DIR` adds a logical source root. `--image pictures/image.png` compiles a standalone image. `--structure-scene materials/materials.scn` explicitly permits the tutorial PBR family as an opaque unlit diagnostic. It reports that adaptation; normal scene compilation rejects lights/PBR. No runtime source fallback exists.

Source and output directories must be disjoint. Conversion finishes in staging before replacing a previously marked compiler output. An unmarked output directory is never replaced. Failed discovery/conversion leaves the previous output intact. The writer emits compiler/bridge hashes, content hashes, and a deterministic asset build ID; the native assetc log and build report are in `build/`.

## Manifest and payloads

The manifest declares `harfang-web-assets/1`, API `harfang-js/1`, and profile `web-static/1`. Logical paths stay native-style names such as `models/seamed-cube.geo` and `pictures/owl.jpg`; emitted URIs are content-addressed under `objects/`. Each compiled entry declares kind, byte length, SHA-256, dependencies, and required capabilities. Runtime checks validate references/cycles, length, and integrity before interpreting the payload. Use HTTPS or localhost for browser SHA-256 support.

| Kind | Payload |
| --- | --- |
| `scene-json` | Unmodified supported native JSON bytes; native binary scenes are converted with native load/save code offline. `mode` is `static` or explicit `structure`. |
| `mesh` | JSON descriptor using `harfang-web-mesh/1`, plus one dependent `bytes` buffer. Native compiled bgfx `.geo` is rejected. |
| `image` | Ordinary PNG/JPEG bytes emitted by the compiler, with checked dimensions/MIME, encoded RGB color space, linear filtering, repeat addressing, no mip chain. |
| `bytes` | Mesh buffers or diagnostic native state references. |

Mesh buffers are little-endian indexed triangles: tightly interleaved float32 position XYZ, normal XYZ and UV0 XY, stride 32, offsets 0/12/24. Uint16 or uint32 indices follow at `vertexCount * 32`. Submesh ranges partition the index buffer and carry material slot numbers. AABB bounds are validated against positions. Native polygon fans/winding and per-corner attributes survive conversion; the fixture splits eight source positions into 24 vertices to retain face normals and UV seams. Skin/bind-pose data is rejected.

Image orientation is unchanged from the decoded rows: UV `(0,0)` addresses the first/top source row. No implicit vertical flip, browser color conversion, gamma transform, or alpha premultiplication occurs. Unlit output multiplies sampled encoded RGB by `uColor` directly. PNG alpha is sampled, but W1 draws opaque materials. This is an explicit simple material convention; it does not claim PBR color-space support or W4 texture delivery.

The room's `shaders/unlit.hps` is provided by the fixture generator. Native and web versions implement the same `uColor` vec4 and stage-0 `uColorMap` multiplication. The native fixture supplies a white texture for solid-color materials. Other program paths, nonempty flags, and unsupported uniforms/states reject. `shaders/mdl` is the separate reviewed direct-drawing tutorial adapter, including its packed-normal decoding and original lighting formula.

## Runtime use and ownership

```js
const scene = await ctx.assets.loadScene('scenes/room.scn', {signal: ctx.signal});
ctx.renderer.submit(scene);
scene.SetCurrentCamera(scene.GetNode('Orthographic'));
// On application disposal:
scene.dispose();
```

`StaticAssets` extends byte leases with `loadScene`, `loadModel`, `loadPicture`, and `loadTexture`. Exported `LoadSceneFromAssetsAsync`, `LoadPictureFromAssetsAsync`, and `LoadTextureFromAssetsAsync` take the assets service as their first argument. Texture loading returns `[Picture, {width,height}]`; the picture owns its decoded bitmap and renderer texture. This is an async context-service adaptation, not an unchanged native signature.

`loadSceneJSON(body, options)` accepts a supported native body directly for development; dependencies must still be in the compiled manifest. `structure: true` is required for the named PBR derivative, and compiled scene loading also requires its manifest to opt in. Authored lights/environment and PBR material fields are retained as metadata; the derivative does not sample its PBR textures or implement blending/lighting. Environment-map paths remain diagnostic metadata rather than runtime dependencies.

Scene loads are transactions. Validation happens before allocation, and failures/cancellation release all acquired models, decoded images, components and leases. Errors include the scene and failing logical dependency. A successful scene owns its meshes/images; sharing is deduplicated within that scene. Independent scene loads have independent ownership. Standalone loads belong to the caller and are also released by service disposal. Model/picture disposal invalidates the resource and immediately releases renderer allocations watching it. No garbage collector timing is required for cleanup.

The prototype caps scenes at 10,000 nodes and hierarchy depth 128, meshes at four million vertices/twelve million indices, images at 4096 per dimension, retained byte leases at 64 MiB, and static GPU payloads at 128 MiB. A single compiled payload must also fit the byte budget. Counters exclude driver overhead and the renderer's four-byte default white texture. Streaming allocation limits, compressed textures, general model building, and context restoration are later work.

## Validation

`python tools/validate.py --native-render` includes compiler rejection/reproducibility tests, source and binary scene loading, native numeric/material references, checker texture orientation, missing/corrupt/dependency cancellation rollback, repeated unload/reload, all W0 cases and six W1 examples. It launches a hidden native OpenGL window solely for the room reference captures. Native and web images are compared at 256x256 for both cameras, allowing antialiasing differences: mean RGB channel error below 2/255 and fewer than 3% of pixels with any channel error over 16/255.

Native captures use the real C++ engine and native compiled shader/model/texture files. They do not validate the pending native QuickJS facade or native execution of the shared JS application. Linked native libraries in this workspace originate from build `50625de17460342c2d69c536c4e80e0c91400523`; inspected source is `5fe83f1adabf26294003be4c6e13ea068413b5d9`. Bridge and payload hashes identify each generated build.
