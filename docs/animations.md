# Rigid node animation playback

The `scene-trs/1` profile implements authored node animation in JavaScript.
Engine plays its `Take 001` clip (29 parts, 10 seconds) in a loop while the
script independently rotates the engine root. No native engine or WASM is
required in the browser. LZ4 transport and logical asset names are unchanged.

```javascript
const clip = scene.GetSceneAnim('Take 001');
const play = scene.PlayAnim(clip, hg.ALM_Loop);
scene.Update(dt); // BigInt nanoseconds; evaluate tracks, then world matrices
scene.StopAnim(play);
```

Supported channels follow the native evaluator:

| JSON track | Target | Interpolation |
| --- | --- | --- |
| `vec3` | `Position`, `Scale`, Euler `Rotation` | Hermite using key tension/bias and neighboring values |
| `quat` | `Rotation` | Component linear interpolation, normalized before conversion to native YXZ Euler angles |
| `bool` | `Enable` | Step |

`UseQuaternionForRotation` selects quaternion rotation; without flags, a
quaternion track takes precedence as in the native legacy loader. Euler track
values are radians, while static scene transform rotations are degrees.
Sampling clamps to the first/last key outside the key range. Stopping a player
keeps the last evaluated pose. Empty tracks leave the property unchanged.

The API includes `GetSceneAnims`, `GetSceneAnim`, `PlayAnim`, `IsPlaying`,
`StopAnim`, `StopAllAnims`, `GetPlayingAnimNames`, `GetPlayingAnimRefs`,
`UpdatePlayingAnims`, `GetSceneAnimInfo`, typed reference lists and invalid refs.
References are scoped to their scene; clearing/disposal invalidates clips and
players. Deleted target nodes are skipped. `UpdatePlayingAnims` evaluates local
properties only; use `Scene.Update` for world matrix updates as well. Do not
call both for the same frame unless intentionally advancing twice.

`PlayAnim(ref, loop, easing, start, end, paused, scale)` preserves the native
argument order and defaults. Times are signed 64-bit BigInts and
`UnspecifiedAnimTime` selects the clip range. `ALM_Once` evaluates the endpoint
then stops; `ALM_Infinite` keeps advancing with clamped track sampling;
`ALM_Loop` wraps the range. Reverse and initially paused playback are supported.
Speed uses native sixteenths (signed 8-bit, -8 through 7.9375). Playback starts
at `start`, also for negative speed, matching native behavior. A zero-duration
loop holds its pose without spinning. Only `E_Linear` playback is supported.

Scene load flag `LSSF_Anims` controls clip import. Instanced scenes remap track
bindings to their own created nodes. Their clips stay out of the scene-global
list/name lookup; `node.GetInstanceSceneAnim(name)` retrieves them. Authored
instance `anim` and `loop_mode` fields start playback on instantiation. Removing
an instance's clips stops its players; failed scene imports roll back the new
clips and players along with the created nodes/components.

The compiler and loader validate unique track indices/targets, binding indices,
finite values, nonzero quaternions and strictly increasing key times. JSON
timestamps must be safe integer nanoseconds. Limits are 16,384 source animations
and clips per scene asset, one million keys per scene asset, and 16,384 loaded
clips/active players per runtime scene.

Skinning, animation blending/players, non-linear playback easing, camera/light/
material/environment channels, events and keyed instance-animation switching
are outside this profile. Unsupported authored channels fail explicitly.
Older manifests with `animationPlayback: "stub"` retain their warned no-playback
behavior; rebuild them without `--animation-stubs` to enable supported tracks.

Validation: `python tools/validate_animation.py` covers interpolation, playback
boundaries, reverse/paused/zero-duration cases, scope and lifetime. Engine's
validator covers rendering, the complete 10-second loop, animated instances and
rollback; its optional native reference compares all 29 world matrices over
60 frames and images at frames 4 and 60.
