# Original pickup respawn policy

## Executive Summary

PUP-21 restores eligible original pickup actors using the authored single-player
mask and a fixed native queue. Both supplied installations specify 90 seconds
plus half of a 60-second extra field: **120 seconds**, without a random draw.
Only actual world collections schedule an actor. Debug and connotation grants
do not. The current approximate pickup contact detector remains PUP-17; this
change does not claim to replace it with native wheel/body contacts.

## Evidence

The following addresses were verified in the installed read-only HW executable,
using the revision and hashes recorded in [the physics notes](c2-physics-re.md).
Rec2 supplied function names and mapping hints; no reference code was copied.
These are static binary conclusions, not an original-game play recording.

| Operation             | Installed HW evidence                                                                                                            | Browser behavior                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Parse masks           | `0x4d999a–0x4d9a19`: spec count, then per-spec index groups; a negative group value gives a count followed by its starting index | Bounds-checked optional tail, before the separate network auto-goodies section                       |
| Enable singleton zero | `0x4d99dc` is **JGE** to the singleton branch; `0x4d9a0a` stores mask[index] = 1                                                 | Index zero is a valid singleton, not a terminator                                                    |
| Select mask           | Race initialization `0x4da400` selects `[network != 0]`                                                                          | Local single-player spec zero; no networking claim                                                   |
| Read time             | `0x487a7a–0x487aaa`: labelled GENERAL integer seconds become signed32 milliseconds                                               | Signed32 input bounds and exact integer multiplication                                               |
| Queue                 | `MayQueuePowerupRespawn 0x4e0590`: non-null ACT, enabled original index, first free of 100 entries                               | No deduplication or random timer; null-source grants cannot schedule                                 |
| Deadline              | `now + minimumMs + trunc(extraMs / 2)`, signed32 stores                                                                          | Native integer clock and signed comparison, including wrap behavior                                  |
| Restore               | `0x4db670`: physical slot order, renderStyle = 4 at `0x4db693–0x4db698`, then notification/effects, then free                    | Actor visible and collectible again, retaining live pose/model state                                 |
| Frame phase           | Expiry `0x492de7`, delayed effects `0x493752`, respawns `0x493770`, final smash/grant flush `0x49378b`                           | Final-flush callback runs after delayed work and before queued grants; collection resumes next frame |

Each original table has two masks. Single player enables 2–11, 13–65 and
90–97; network enables 0–97. Disabled entries stay consumed. The browser reads
these masks rather than hard-coding those ranges. `PowerupSystem`'s combined
tool/test update performs expiry then respawns; the application uses the explicit
phase hook. Pause stops the game clock; freezing only the race countdown does
not stop respawn time. Disposal clears all queue entries.

## Dedicated respawn effects

`0x4ecc10` consumes only sound, explosions and slick fields from the authored
GENERAL respawn connotations. It does not execute their parsed shrapnel,
activation, followup, award, variable or room-code fields. Both supplied records
select sound 5402 and two original TWINK/BING explosion groups, with no slick.

Sound draws fixed-point pitch in `[0xe000, 0x12000]` before selecting an
alternative, even for a singleton list. Native volume 255 maps to gain 1.
The existing non-positional audio mixer is retained; native spatial audio
remains AUD-03. Sound is independent of the visibility gate.

Explosion allocation uses `PointOutOfSight` with native Yon squared, the owning
ACT's own MODEL bounds, and no additional local anchor offset. The animation
applies the live ACT's complete matrix to local offsets. An optional matrix
provider in `ExplosionRuntime` now preserves scale/shear for this path while
existing position/quaternion callers retain their behavior. Spawn and update
use the same simulation clock. Missing/custom MODEL bounds report a diagnostic
rather than substituting aggregate render bounds.

Slick processing follows the explosion block and runs even when the actor is
out of view. Its native car argument is null; the existing ACT/MODEL follower
and world-slick allocator provide the corresponding ownership. Full native
network notifications are outside the local engine's current scope.

## Validation and remaining boundary

Policy, parser, effect-outlet and integration tests cover malformed input,
Stock/Advanced masks, exact due boundaries, signed arithmetic, first-free slot
order, queue capacity, callback timing, source-index preservation for random
pickups, null-source grants, disabled entries, actor-state retention, repeated
collection and race disposal. Explosion tests separately exercise a changing
matrix with scale/shear. Effect tests prove sound RNG order and prevent generic
smash gameplay outlets from leaking into respawns.

The remaining PUP-17 collector currently extracts `&£NN` actors before collision
construction and uses a cached-index swept sphere of radius 0.7 around the
vehicle position. Original `0x4f0ec0` instead receives owning ACT world-face
contacts from wheel (`0x419add`) and body (`0x41c84c`) paths, reads the live
identifier/render style, and queues the grant before its smash behavior.
Ordinary pickup eligibility is driver 8; the special mine-14 helper permits
qualifying car drivers greater than 5. Correct contact/source ownership,
visibility/collision restoration and the mine path require that separate
integration. A car remaining inside the current approximate radius may collect
a restored pickup on the next frame. Respawn policy completion does not close
that contact-fidelity ticket.

The final headless Chromium check uses original Newcity/Eagle3 and a real world
pickup. It checks the exact 120,000 ms deadline, due-minus-one boundary, source
actor and mesh identity, disabled entries, null-source debug grants, sound 5402
at gain 1, and loaded original TWINK sprites. This caught and corrected a real
preload gap: startup had loaded only WASTED explosion frames. The preload now
includes every frame referenced by the respawn groups, including delayed BING
frames. The final capture had fourteen visible, map-backed TWINK sprites; the
remaining delayed sprite correctly had no current frame at that instant.

An explicitly shortened 300 ms in-memory timing fixture checks the live frame
hook while the debug countdown stays frozen, followed by pause stability and
reload cleanup. The backend was confirmed as ANGLE/Vulkan SwiftShader, WebGL2,
1280×800, with no console errors/warnings, failed requests, respawn diagnostics
or GL errors. Existing compatibility entries in the diagnostics panel are not
claimed absent. These checks establish runtime/state/resource integration,
not real-GPU performance or original-game visual parity.

A separate read-only census checked 122 original primary track ACTs and 40,610
pickup occurrences. For the 24,520 respawn-enabled occurrences, the existing
initialization's decomposition/recomposition differs by at most 9.69e-9 per
upper 3×3 matrix entry; parent composition adds no translation difference.
Respawning does not repeat that decomposition. This supports the original
corpus while preserving a distinction from arbitrary custom nested transforms.
