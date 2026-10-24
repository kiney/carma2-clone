# Resource lifetime audit

`node tools/audit-resources.mjs` performs a short, serial browser capture across
repeated loads of one original race and car. It builds a temporary production
copy before launching Chromium, so the capture uses an immutable bundle while
the shared working tree remains available for other work. The installation is
opened through the asset server and remains read-only. The JSON report defaults
to ignored `artifacts/resource-lifetime.json`.

The default run makes six total loads of New City 1 with Eagle 3: the initial
startup load plus five reloads. After startup it pins two native opponent IDs
(defaults to IDs 1 and 2 when both are present in the warm population; otherwise
it chooses two valid IDs from that first population) and verifies the same pair
on every repeated load. `--second-scene PATH` adds one other scene and a return
to the primary scene; the total is capped at eight loads. The car, track and
population stay fixed within the repeated portion. Simulation remains paused;
there is no driving loop or parallel asset stress.

The audit waits for both opponent and pedestrian populations to leave
`loading` before every snapshot. It records their settled `ready`/`failed`
states and actual opponent, pedestrian and group counts alongside the WebGL
version/vendor/renderer, drawing-buffer size,
`renderer.info.memory` counts, active scene resource UUIDs, shared texture-map
entry count, fetched-byte cache entry count/bytes, and CDP JavaScript heap size
after collection. It wraps the live Three.js `dispose()` methods for textures,
materials and geometries and correlates emitted dispose UUIDs with the active
resource identities from immediately before that load. The temporary server
uses the production bundle from its isolated directory and the configured
`CARMA2_ROOT` installation for assets.

For texture attribution, the report also samples the pinned Three.js renderer's
`properties.get(texture).__webglInit` state for shared `Assets.textures` and
active renderable material textures, including Mesh, Sprite, Line and Points
owners and nested uniforms. It records texture source UUIDs, WebGL handle
identities and matching shared-cache keys, plus retained native MAT maps from
the process-wide resource set. An init-script probe wraps WebGL2 texture
creation, deletion, binding and upload calls on the renderer's context. It
reports explicit create/delete counts, upload dimensions and source-object
identities, the last observed scene/cache owners and short allocation stacks;
it never copies or prints pixel bytes. The probe holds JavaScript references
to tracked WebGL handles so it can distinguish explicit deletion from current
ownership. This can affect wrapper garbage collection, and the counts do not
prove how long a driver retains memory after a context is discarded. These
renderer/context internals are diagnostic, not application APIs.

Interpretation requires separating resource classes. The `Assets.cache` byte
map is a session-wide reuse cache and is expected to grow when a new scene or
car is first visited; repeated identical loads should stop adding those
entries. The report treats the first explicit reload as an additional warm-up
because a pinned opponent set or lazy resource can add assets after initial
startup. Its `steadyState` section compares later same-scene reloads.
`Assets.textures` holds shared installation textures and should remain stable
during same-track reloads. WebGL texture/geometry counts and repeated failure
to dispose prior scene identities are the stronger signals for an orphaned
GPU resource. `oldResourcesStillActive` separates identities that remain live
in the new scene from identities that should have been retired. Heap size can
vary after collection because browser
internals and module caches are not fully controlled. A stable repeated-load
count does not prove memory behavior over an entire campaign or on physical
GPU hardware.

The audit writes no source assets and does not change application behavior. If
Chromium or an installation is absent it exits with a clean skip. A missing
requested race/car also skips. Page errors, failed requests, or an unexpected
explicit opponent set fail the run rather than being reported as successful
resource validation.

## Observed bounded runs

An earlier five-load capture reproduced a cross-scene increase from 220 to 228
renderer-counted textures. A WebGL allocation capture attributed eight 64×64
handles to pixel sources from the prior primary scene's pedestrian materials:
CitySwat, HOLIDAHE, Spec3, BISMANbm, oscar, Spec4, Spec1 and Spec8. The handles
were uploaded while Timber2 loaded and had no current scene or cache owner on
return to New City 1. The evidence supports a stale-scene render during
asynchronous resource release. The animation loop now keeps the last complete
frame displayed while `loading` is true or `stats.ready` is false, preventing
the old scene from being rendered in that window.

The post-guard five-load capture used New City 1/Eagle 3, two primary reloads,
Timber2 and a return to New City 1. It sampled settled opponent and pedestrian
populations each time. All four awaited transitions had identical frame
counters immediately before and after `loadRace`. Primary samples held at 246
geometries, 220 textures and 7 programs; Timber2 had 118/117/7; returning to
New City 1 restored 246/220/7. Every sample contained only the same two
unowned 1×1 default uploads (2D and cube-map targets). No 64×64 unowned
pedestrian handles remained. There were no page errors, console errors or
failed requests. The backend was Chromium WebGL2 on ANGLE/Vulkan SwiftShader at
960×640, so this is a bounded headless software-renderer check, not a
physical-GPU or full-session memory guarantee.

The session byte cache reached 644 entries after the alternate scene was
visited, as expected for first use of another scene. Same-scene primary
renderer counts stayed stable. Earlier captures that did not wait for settled
pedestrians or instrument WebGL allocation calls are superseded for attribution
and transition behavior. Neither the old nor new bounded capture establishes
all-day campaign behavior or physical-GPU memory behavior.
