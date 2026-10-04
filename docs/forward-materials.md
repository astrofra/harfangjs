# W2 materials and forward lighting

`web-forward/1` extends W1 with the approved material families below. The runtime compiles reviewed GLSL ES adapters, never source `.sc`, native shader binaries, or arbitrary custom shaders. The shared, data-only registry is `src/render/material-contract.js`; both the JavaScript validator and Python compiler consume it. The shader bodies are in `src/render/forward-shaders.js`, native input recipes in `tools/generate_lighting_fixture.py`, and regressions in `tests/lighting-suite.js`.

The source reference is `harfang3d/tutorials/resources/core/shader/{default,pbr}_{vs,fs}.sc` and `forward_pipeline.sh`, plus `harfang/engine/{forward_pipeline,scene_forward_pipeline,render_pipeline}.cpp`. `contract/shader-adapters.json` records reviewed hashes; each fixture build also records the input hashes and native comparison adaptations in `build/fixtures/shader-provenance.json`.

## Material mapping

| Program | Uniforms and texture slots | Behavior |
| --- | --- | --- |
| `shaders/unlit.hps` | `uColor`; optional `uColorMap` at 0 | Multiply uniform and encoded texture RGBA. No lighting or output gamma. Generated native fixture adapter. |
| `core/shader/default.hps` | `uDiffuseColor`, `uSpecularColor`, `uSelfColor`; optional `uDiffuseMap` at 0 | Map replaces diffuse RGB without sRGB decoding. Phong specular exponent is `64 / uSpecularColor.w`. Self is additive; output alpha is 1. |
| `core/shader/pbr.hps` | `uBaseOpacityColor`, `uOcclusionRoughnessMetalnessColor`, `uSelfColor`; `uBaseOpacityMap` at 0, `uOcclusionRoughnessMetalnessMap` at 1, `uNormalMap` at 2, `uSelfMap` at 4 | Maps replace corresponding uniforms. Base-map RGB uses native piecewise sRGB decoding; other maps are sampled as encoded channel values. ORM is occlusion R, roughness G, metalness B. Alpha comes from base uniform/map. |

PBR uses the native GGX implementation, including its diffuse normalization and `NdotV` clamp to .99. With probes absent, its ambient path is `(direct + ambient) * AO + self`; AO affects direct light as in the source shader. Default uses `diffuse * (directDiffuse + ambient) + specular * directSpecular + self`. Both forward families apply view-space distance fog followed by the native non-AAA output power `1/2.2`. Emissive maps are **not** sRGB decoded.

Native unsigned-byte normal quantization is retained. PBR preserves its row-normalized model normal matrix and view-facing normal, while default uses normalized columns. Normal maps reconstruct positive Z from encoded XY, then apply the source tangent/binormal frame and native transform convention. Negative/nonuniform scales and tangent handedness are tested against native rendering. UV1, world-space normal maps, skinning, additional default-family samplers, and custom program paths reject.

`EnableAlphaCut` discards alpha **below .8**, retaining equality. It is supported by PBR and unlit. The original PBR shader body implements this branch, but its original `.hps` omits the feature: the generated native comparison descriptor explicitly adds `OptionalAlphaCut` and removes unneeded skinning variants. No upstream shader file is edited. Default's reviewed `.hps` subset only exposes the diffuse-map feature.

Missing uniforms get deterministic defaults from the registry: unlit white; default diffuse/self zero and specular `[0,0,0,1]`; PBR base/self zero and ORM `[1,1,0,0]`. Supply authored values for meaningful appearance. Degenerate normalization, zero specular-width division, and normal-map XY outside the unit disc use finite guards; behavior at these otherwise undefined inputs is a documented extension.

## Material API and render state

```js
const mat = node.GetObject().GetMaterial(0);
hg.SetMaterialValue(mat, 'uBaseOpacityColor', new hg.Vec4(.6, .2, .1, 1));
hg.SetMaterialTexture(mat, 'uNormalMap', picture, 2);
hg.UpdateMaterialPipelineProgramVariant(mat);
hg.SetMaterialTexture(mat, 'uNormalMap', hg.InvalidTextureRef, 2);
```

`createMaterial(nativeMaterialJSON, pictures = new Map())` creates a validated `Material`. Every authored nonempty texture path must resolve to the corresponding Picture in the map. Scene loading does this automatically. `createUnlitMaterial` remains the W1 convenience wrapper. Materials are shared mutable objects: `ObjectComponent.GetMaterial()` returns the assigned material, while `.source`, `.value(name)`, and the JS convenience `GetMaterialValue()` return copies. `SetMaterialValue` implements the Vec4/Color subset; scalar/matrix/array overloads are outside this profile. Texture resources are borrowed, so their owning scene/caller must keep them alive. Removing a texture changes selection, not ownership; destroying a referenced texture makes subsequent rendering fail.

`SetMaterialBlendMode`, `SetMaterialDepthTest`, `SetMaterialFaceCulling`, `SetMaterialWriteZ`, `SetMaterialWriteRGBA`, and `SetMaterialAlphaCut` validate changes. Native-named `BM_*`, `DT_*`, and `FC_*` constants map to the native JSON strings, rather than numeric bgfx enum values. Undefined blend mode is excluded.

| Blend string | RGB factors / equation |
| --- | --- |
| `opaque` | Blending disabled |
| `alpha` | SrcAlpha, OneMinusSrcAlpha, add |
| `add` | One, One, add |
| `multiply` | DstColor, Zero, add |
| `screen` | One, OneMinusSrcColor, add |
| `darken` / `lighten` | Min / Max |
| `linearburn` | DstColor, OneMinusDstColor, subtract (the actual native bgfx state) |
| `alphaRGB_addAlpha` | Alpha blend for RGB; One, One for alpha |

All nine native depth comparisons, `cw/ccw/disabled` culling, and RGBA/depth writes are supported. The browser canvas is opaque; alpha is still used in blending. Negative scale preserves winding. Opaque submeshes draw first; transparent ones sort back to front by their nearest transformed AABB corner, at millimeter precision, then stable node/submesh insertion order. Authored depth writes remain authoritative. Intersecting transparent surfaces have the usual object-sort limitation.

## Lighting and environment

`Scene.CreateLight()` creates a point component with native defaults. `Node.GetLight/SetLight` use scene-scoped generation-checked handles. `Light` exposes type, diffuse/specular Color, independent intensities, radius, inner/outer angles, and priority getters/setters. Types are `LT_Linear`, `LT_Point`, and `LT_Spot`; angles are radians. Color getters copy. `Scene.GetLights()` is a JS convenience returning light nodes; `DestroyLight` and scene disposal invalidate components.

Slot 0 is reserved for the highest-priority directional light; it stays empty if none exists. Slots 1–7 take the highest-priority enabled point/spot lights. Higher priority wins; equal priorities retain scene node order. This stabilizes the unspecified native `std::sort` tie order. Overflow is visible in `renderer.stats.omittedLights`; selected names and active count are also reported. Native slot arrays and 16-light tutorial selection at 48/1048/2048 ms are checked directly against C++ HARFANG.

Radius attenuation is `max(1 - distance / radius, 0)`; radius zero is unbounded. Spot falloff interpolates between the inner/outer angle cosines using the native world Z direction, without an inverse-square falloff. World direction scale is preserved. Diffuse and specular intensities multiply their colors independently. HDR scene light colors are converted from native JSON by dividing by 255 without clamping.

`scene.environment` exposes `ambient`, `fog_color` Colors, and numeric `fog_near/fog_far`. Equal fog distances disable fog. Probe sampling is deferred: `ambientEnvironment: true` is an explicit compiler adaptation permitting retained probe paths and using authored ambient color. Similarly, `ignoreShadows: true` explicitly disables authored map shadows. These choices appear in manifest reports and `scene.metadata.adaptations`; otherwise required probes/shadows reject.

## Offline assets and variants

Use `--forward-scene scenes/example.scn` with `tools/assetc_web.py`. The Python `compile_assets(..., forward_scenes=[...])` API also accepts dictionaries with `name`, optional `alias`, `ignore_shadows`, and `ambient_environment`. The build uses an alias `materials/materials-forward.scn` so the original PBR JSON bytes can serve both the W1 structural and W2 material cases with separate manifest modes. `loadScene()` takes its forward capability/adaptations from that manifest; `loadSceneJSON(body, {lighting:true, ...})` is the explicit development equivalent.

Source tangent frames are exported by the native geometry reader. Mesh schema `harfang-web-mesh/2` stores position/normal/UV0/tangent/binormal float32 at byte offsets 0/12/24/32/44, stride 56; indices follow at `vertexCount * 56`. Schema 1 remains valid for meshes without frames. Bounds for transparent sorting are computed per submesh. Missing tangent frames on a normal-mapped mesh fail offline and at load/draw time.

W2 retains PNG/JPEG, encoded RGBA8, base-level bilinear filtering, repeat addressing, and no browser color conversion/premultiplication. W4 will add authored compressed formats, mip chains, and anisotropy. For visual comparison, the separately named native PBR derivative uses RAW textures without mipmaps, disables shadows, and omits probes. This compares the same declared W2 rendering path on both targets; it is not the original fully configured native tutorial.

Only **two forward programs** are possible: default and PBR. Texture/alpha-cut feature selection uses uniforms within those programs. `variantKey` is program ID plus sorted populated sampler names and flags: default has 2 logical combinations, PBR 32, and unlit 4. Value changes do not affect keys. `UpdateMaterialPipelineProgramVariant` returns the key; edits take effect on the next draw without compilation. Scene initialization prepares referenced families. Programs are retained as a bounded renderer cache across scene reloads and freed on renderer disposal. Mesh/image GPU allocations are freed on resource disposal.

`shaderCompileMs` measures synchronous shader compile/link preparation, separately from asset initialization and first-frame cost. `build/reports/validation.json` records per-tutorial init time, four completed frame times, program count, draw count, GPU payload bytes, viewport, DPR, and zero shadow maps. These software-renderer timings are observations, not hardware performance claims. The gallery uses 12 draws, 7,692 triangles, five textures, and 247,532 accounted GPU payload bytes; shader/driver overhead and the fallback white texel are excluded.

## Tutorial gates

| Case | Retained behavior and declared adaptations |
| --- | --- |
| `material_lighting` | Supplemental controllable gallery: metal/dielectric/roughness spheres, mapped planes, alpha foliage, emission, transparent overlaps; Space light rig, F fog, N normal map, R roughness. |
| `scene_pbr.materials` | Original scene JSON/material maps; explicit ambient/no-shadow adaptation and initial texture policy above. W1 `scene_pbr.structure` stays separate. |
| `material_update_value.no_shadows` | Original diffuse-map toggle and variant update every second. Spot shadows disabled; specular width explicitly 1. Texture remains alive while disabled. |
| `scene_light_priority` | Original 16 moving point-light equations and distance priorities, with compiled shared spheres. Seven local slots plus empty reserved directional slot. |
| `scene_many_nodes.small.no_shadows` | 11×11 moving spheres sharing one model/material/object component, original wave equation; adjusted camera, shadows disabled. Separate correctness gate, not a performance comparison with the original 10,201-node workload. |

The original large stress workload remains independently recorded for W10. Shared native JavaScript execution remains N; native evidence here uses C++ HARFANG. The 56 source-family counts are unchanged by these derivatives.
