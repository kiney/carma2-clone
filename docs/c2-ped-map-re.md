# Pedestrians on the map (PUP-19)

## Executive Summary

Original powerup index24/action29 now enables pedestrian markers on the existing
browser minimap. Both installed Stock and Advanced tables author duration0:
the effect lasts for the race until removed, rather than expiring after an
invented fixed interval. Authored timed variants still use the ordinary powerup
renewal and expiry path. Pedestrian missions show selected target groups even
without the powerup. Markers use original render-palette entry52 and represent
living processed pedestrians, independently of graphical object visibility.

This implements the powerup and its single-player map consumer. The browser's
existing path-based minimap presentation remains independent; this change does
not reconstruct the original map texture, map transform or other HUD elements.

## Native evidence

Addresses are installed HW absolute VAs for SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
The binary identity was freshly rechecked during the preceding PUP-18 audit:
PE32 i386, image base 0x400000, entry RVA 0x177eb0, timestamp
1998-10-18 20:13:36 UTC. See [binary metadata](c2-physics-re.md) and
[powerup lifetimes/group removal](c2-powerup-overlap-re.md).

[rec2](https://github.com/madebr/rec2) is the initial function map. Its source
fetch was unavailable in this session; the evidence below is **verified by
static inspection of the installed original binary and read-only original
data**, rather than copied reconstruction code or an original-game recording.

| Behavior                | Installed evidence                                                                                                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Action29 mapping        | Got-handler table at `0x65d4f4` selects `0x4dea20`; reset table at `0x65d5d4` selects `0x4dea60`.                                                                                                                                                               |
| Grant                   | `0x4dea20–0x4dea31` requires a non-null car whose driver at `+0xc` is8, then writes1 to global `0x74b23c`.                                                                                                                                                      |
| Reset                   | `0x4dea60–0x4dea71` uses the same non-null/driver8 guard, then writes0 to that global. Active browser records retain their recipient reference so loss checks the recipient role.                                                                               |
| Fresh race              | `0x481c66` clears `0x74b23c`. Each new browser PowerupSystem starts false; normal disposal also removes its live effects.                                                                                                                                       |
| Display gate            | `0x495cbd–0x495ceb` enables pedestrian iteration for the map powerup or race type2 (pedestrian mission). Networking adds a separate policy.                                                                                                                     |
| Pedestrian eligibility  | `GetPedPosition 0x4d2a10–0x4d2a72`: signed HP byte `+4` must be positive; processed flag1 at `+8` must be set, with a replay exception. For race type2, selected-target flag `0x200` is additionally required. Eligible position is copied from `+0x1c..+0x24`. |
| Mission target identity | `0x4d3019` selects target flag `0x200` using the authored spawn-group index. This mapping was already verified in [race rules](c2-race-rules-re.md).                                                                                                            |
| Marker color            | `0x495d0b` passes palette index `0x34` (52) into `0x496610`.                                                                                                                                                                                                    |
| Pixel output            | `0x496610–0x49672e` projects a position and rejects negative coordinates and coordinates at/above the destination width/height before writing one pixel. Its `0x575190` float-to-integer helper explicitly selects truncation toward zero.                      |

Stock `data/powerup.txt` and Advanced `adv_data/powerup.txt` both define record24
as action29, message `Pedestrians shown on map`, icon `pedsonmap`, duration0,
initial value0, no parameters, group0, Pratcam38, flags66. The effect's native
whole-race type follows the common loader distinction between negative/zero/
positive durations. PUP-19's earlier description as a temporary effect does not
justify replacing the authored zero duration.

## Implementation

`src/powerups.ts` exposes the `pedestriansOnMap` modifier and a getter for map
presentation while paused. Grants, including debug grants, run through the
normal action handler and definition-index lifecycle. The native local-human
set/reset guards are retained. Cancellation, conflict removal and timed expiry
invoke the same reset handler; no separate map clock or debug-only activation
path is introduced.

`src/ped-map.ts` defines single-player eligibility, the palette color and
clipped one-pixel output. `PedestrianSystem.forEachMapPedestrian` borrows actual
live position objects while filtering `alive`, `active` and authored group.
It does not build the diagnostic `states` array or clone every position each
frame. Graphical `object.visible` is deliberately not a map eligibility input.

`drawMap` reads this policy and overlays eligible points before the existing
car markers. The M-key visibility setting still governs whether the map is
drawn. Color comes from the complete loaded original render palette, rather
than a guessed CSS color. If that palette is unavailable, no substitute color
is invented. The ordinary powerup event label now shows the original supported
message; unrelated unsupported powerups retain their existing labels.

Pedestrian missions enable this policy without a pickup and restrict it to
`definition.pedGroupsToKill`. An active map pickup does not bypass that mission
filter. Other single-player race types need the effect. Replay and multiplayer
policy are outside the current application modes and are not claimed here.
Common powerup flag eligibility/substitution remains PUP-16; implementing
action29 does not imply that all definition flags or icon/fizzle metadata work.

## Validation

`tests/ped-map.test.mjs` covers whole-race duration, true timed renewal and exact
post-physics expiry, cancellation, conflict loss, disposal/fresh-race state,
local-human set/reset guards, processed/living/mission filtering, borrowed
position identity, palette selection and float-boundary clipping. Original
checks read both installed powerup tables and `DRRENDER.PAL`; they skip cleanly
when the installation is absent. The fixture vehicle factory is explicitly the
legacy test helper, while production remains on the existing physics path.

`tests/browser-ped-map.mjs` runs the actual production application in a separate
headless Chromium process. It checks original New City population, the normal
opt-in debug grant, source palette52 pixels in the real Canvas2D minimap,
whole-race persistence without advancing a long simulation loop, cancellation,
a bounded mission-context fixture against the real paused population, and
race reload reset. The mission fixture verifies the real map binding but is
not an original mission playthrough. Results and backend metadata are written
to ignored `artifacts/browser-ped-map.json`. These are functional checks on
SwiftShader, not GPU performance measurements or a physical-display playtest.

Validation on 2026-10-24: the eight new unit tests pass; the missing-install run
passes seven and skips the one original-data test. The existing powerup suite
passes all 28 tests. Production build, TypeScript and changed-file whitespace
checks pass. The headless application reports seven eligible New City peds and
seven matching palette52 pixels after grant, zero before/after cancellation,
and correct mission-context/reload results, with no browser errors or failed
requests. Backend is ANGLE Vulkan SwiftShader at a 1024x768 drawing buffer.
The original palette's entry52 is RGB(255,255,0). An initial browser harness
timeout was caused by comparing Canvas's canonical hex fillStyle getter with
the input rgb string; normalizing that test comparison resolved it.
