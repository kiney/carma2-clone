# C2 ordinary pedestrian halt and recovery

## Scope and evidence

Verified from the installed, read-only `carma2_HW.exe`, SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
PE32 image base is `0x400000`; metadata is recorded in the related physics
notes. `madebr/rec2` is a symbol/layout map only. Its halt, move-completion,
direction and ground-cache callbacks are stubs, and its pedestrian addresses
are generally shifted relative to this installation. No reference code or
binary fixtures were copied into the implementation.

This note covers the ordinary, intact BIPED1 simple body with no pedestrian
powerup, replay, missing bones or special-volume effects. It identifies the
other branches explicitly rather than treating their behavior as ordinary
recovery. No runtime changes accompany this note.

Two corrections to earlier lifecycle shorthand are material: the retry input
to `0x417fd0` is the selected **negative principal actor axis** times a signed
global scalar, not the support normal; and ordinary get-up completion selects
**running move41**, not walking move30.

## Installed addresses

| Address                | Role                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x409400`             | Character halt wrapper; derives character orientation from physical root/current animation and clears active character bit4 before callback |
| `0x4d0de0`             | `CBActiveHalted`, supplies null optional face                                                                                               |
| `0x4d0df0–0x4d19c8`    | Full pedestrian halt callback                                                                                                               |
| `0x417fd0`             | Independently documented/implemented angular settling helper                                                                                |
| `0x4cba70`             | `SetPedMove`, ID/substitution/fallback and action dispatch                                                                                  |
| `0x4cbcc0–0x4cbfc0`    | `CBMoveCompleted`                                                                                                                           |
| `0x4cc060`             | `SetPedXZDirection`                                                                                                                         |
| `0x4cc410`             | `StartPedRunning`                                                                                                                           |
| `0x4ccc20`             | `KillPedestrian`, including model/gore and score/death dispatch                                                                             |
| `0x4cd010`             | Death state dispatch: HP0, action6, death time                                                                                              |
| `0x4d1b30`             | `RecacheAndSetFace`                                                                                                                         |
| `0x4d1e20`             | Build/rebuild ground face cache                                                                                                             |
| `0x461de0`             | Vertical selection wrapper over cached face list                                                                                            |
| `0x422610`             | Nearest ray/face selection over ordered 80-byte face records                                                                                |
| `0x4cf860`             | `RescanPedProximity`                                                                                                                        |
| `0x4ced30`             | `PedScanForObjects`                                                                                                                         |
| `0x409ca0`             | Non-morph animation advancement/completion dispatcher                                                                                       |
| `0x4d3510`             | Outer pedestrian update                                                                                                                     |
| `0x4d2f13`             | `BuildPedestrian` signed-byte HP initializer100                                                                                             |
| `0x4d6d90`, `0x4d6e00` | Gore getter/setter                                                                                                                          |

## Halt decision from the physical pose

The caller has already requested sleep using PHIL's quiet/contact-ring rules;
see `c2-ped-physics-lifecycle-re.md`. There is no settle-duration test here.
The callback first writes pedestrian position from the root actor's
translation and obtains `GetTotalTime 0x514610` for move/event timestamps.

The optional face path uses its normal directly. The normal simple-body
callback supplies no face, so `0x4d0ead–0x4d0efc` scans rigid face range
`[u16 +0x174, u16 +0x176)` in source order. It starts best normalY at0 and
chooses each **strictly larger** normalY. Ties retain the earlier face;
negative/zero-Y faces do not replace the initial value. This support normal is
from the physics face list, not the later pedestrian ground-face cache. No
positive-Y face leaves normalY0 and undefined X/Z stack values in the native
callback; a bounded provider should diagnose that case rather than invent a
floor normal or use an undefined sign to select a recovery animation.

For living HP (`signed byte ped+4 > 0`),
`character.orientation[1][1] > double(0.93)` is upright. This is character
orientation `+0x8c`, already reconstructed from root actor and the inverse
current animation frame by the halt wrapper. It is not the visual yaw matrix
and not the root actor's raw basis. Upright bypasses the alignment retry test.

Otherwise, `0x4d0f2d–0x4d1002` selects the strict greatest inertia component:
X only if `Ix > Iy && Ix > Iz`; Y only if `Iy > Iz && Iy > Ix`; otherwise Z.
Ties therefore select Z. Let `a` be the negative corresponding **root actor**
basis row. Its components and `dot = a·supportNormal` spill to float32.
The retry condition is `supportNormal.Y != 0 && abs(dot) < double(0.706)`.

If that condition holds, a pedestrian cache exists, and cache byte `+0x19`
is below3 alive or below2 dead, the callback rejects halt:

1. If the current move ID is90,91,92,97 or113, select93 when alive or94
   when dead, with speed-1, arg4=0, completion=0, time=now, action5.
   Other IDs90–113 take the default continuation without replacing the move.
   The installed jump tables are `0x4d19cc/0x4d19dc` and
   `0x4d19f4/0x4d1a04`; both contain that same ID membership.
2. Run the source head/model sequence branch when applicable (see limitations).
   This is head animation/model state, not automatic severing: `0x4c8a30`
   records `PipeSinglePedModelChange`, then `0x40b420` changes the head model
   state using the first entry1 of sequence `0x65d050`. Retain sequence pointer,
   start time `cache+78` and sequence index `cache+1a=0` for later head animation.
3. `PercentageChance(50) 0x512f30` conditionally negates the **shared persistent**
   float at `0x65c348`, whose image initializer is8.0. Do not create a new
   random signed8 per pedestrian or reset its sign on each invocation.
4. Set action3, then call settling with `worldVector = float32(a * scalar)`,
   gain `float32(1.39)`, minSpeed0. The pushes at `0x4d11b2/0x4d11b8` shift
   the Y/Z input loads: `[ESP+0x38]` and `[ESP+0x3c]` are the saved axisY/Z,
   not the saved support-normal components.
5. Increment cache retry byte, clear rigid `ec`, copy root actor basis to
   rigid pose basis `+0x8c`, OR rigid flag0x100, return0. The character wrapper
   restores active bit4. The helper may be gated/no-op; retry bookkeeping still
   occurs. Do not add linear velocity, a car kick, a frame delta or another RNG.

When not retrying, `0x4d1257` records the existing status/physical level5,
increments pedestrian signed16 impact serial `+6`, performs the same
90/91/92/97/113 move replacement, and resets cache retry byte0.

For a living pedestrian it forcibly calls `RecacheAndSetFace` (arg5=1) before
selecting recovery. It does **not** turn the returned cache validity booleans
into a second sleep-acceptance gate. If the alignment retry condition still
holds after exhausting/missing its cache, and immortal-pedestrian mode is off,
`0x4d1400–0x4d1421` selects action5 and calls `KillPedestrian`. This sets HP0
and action6 through `0x4cd026/0x4cd04b`; it is not a guaranteed recoverable fall.
The separate suicidal-powerup branch can also enter that kill path from an
upright pose. Full native kill includes model replacement, score and gore
side effects; HP0 alone is not a complete implementation of that branch.

## Ordinary living recovery

At `0x4d16da` the callback clears pedestrian bit8 (wall-squash state).

An upright survivor calls `SetPedXZDirection` using character orientation row2
(`+0xa4`), distance/turn arg0, now. It sets action0 temporarily, then selects
move41, speed100 with a cache (otherwise-1), arg4=0, completion=0, now,
action1. With intact legs and a cache, it stores cache `+0x80=100` and
float32 `+0xb8=.09`. Pedestrian `+0x28` receives now.

A non-upright survivor uses the sign of the saved float32 dot:

| Condition  | Direction input                                             | Move | Caller arguments                           |
| ---------- | ----------------------------------------------------------- | ---- | ------------------------------------------ |
| `dot > 0`  | Signed character-orientation row given by FORM byte `+0x4e` | 80   | speed-1, arg4=0, completion1, now, action4 |
| `dot <= 0` | Signed character-orientation row given by FORM byte `+0x4f` | 81   | same                                       |

For original BIPED1 these signed axes are-1/+1, respectively: the input is
minus/plus character orientation row1. Signed axis selects/negates the row;
it does not request a Three Y-major box rotation. The direction call again
uses arg0. Source recovery subsequently rescans proximity (return discarded)
and scans objects before its accepted tail.

`SetPedXZDirection` requires an actual pedestrian cache `b0` and its selected
face `+0x30`; without either it returns without changing direction. With
ordinary nondegenerate inputs, it computes
`normalize(cross(cross(worldY, desiredDirection), faceNormal))`. Both crosses
are `DRVector3SafeCross 0x403f90`, retaining its epsilon/fallback semantics
documented in the root/settling notes. The installed helper checks all three
cross components, unlike the duplicated-X test in the reconstructed rec2
source. Final norm epsilon is float32 `2^-22`; final degenerate fallback is
worldX. If a smooth turn already exists and its cached target dot new direction
is greater than double.95, the function returns. Otherwise it writes target
direction `cache+48`, clears smooth-turn timestamp `+6c` for arg0, and calls
`SetCharacterDirection` preserving character up `+cc`. It also synchronizes
root/rigid basis and flag0x100 when source actor/rigid row dot checks fall below
float32.7. This is not ordinary horizontal yaw projection on sloped ground.

The accepted tail `0x4d1933` synchronizes the actor basis, ORs rigid flag0x100,
restores filterA0x40000 for type5 (else0x10000) and filterB0x50000, invokes
`0x4fec00` for special-volume state, and returns1. The outer character wrapper
keeps active bit4 clear and converts the body header to passive state1, rigid
bit0x20, restoring PHIL properties3/4/5. Animation/root movement resumes in
the outer animation phase from this physical pose.

## Get-up animation completion

Original FORM `BIPED1.TXT` plus original SKL and default `DEFBIP1.TXT`:

| Move | Motion                 | Frames | FORM period | Flags | Personality scale / grounding / offset |
| ---- | ---------------------- | ------ | ----------- | ----- | -------------------------------------- |
| 30   | `walk_normal_male.SKL` | 30     | 33ms        | 0     | .35 / GROUND / .154                    |
| 41   | `run_fast.SKL`         | 24     | 33ms        | 0     | .35 / GROUND / .154                    |
| 80   | `get_up_back.SKL`      | 60     | 33ms        | 1     | .25 / NONE / .075                      |
| 81   | `get_up_front.SKL`     | 50     | 33ms        | 1     | .25 / NONE / .075                      |
| 93   | `FALL.SKL`             | 40     | 33ms        | 0     | .35 / NONE / .154                      |
| 94   | `dead_body_flat.SKL`   | 40     | 33ms        | 0     | .35 / NONE / .154                      |

The offsets/scales are float32 fields, not arbitrary foot offsets. Get-up NONE
grounding does not justify snapping the root to the road every animation tick.
Use the source root frame/displacement helpers. Frame counts are not recovery
timers: period changes, freeze/replay, animation clock's ten-frame clamp and
phase ordering determine the actual completion time.

`SetCharacterMove 0x40a050` sets character callback byte `+9 bit2` when its
completion argument is1. In non-replay positive advancement,
`0x409e2c–0x409e96` increments the frame; at `frame >= frameCount` it clamps to
`frameCount-1`, clears callback bit2 **before** calling vtable `+0xc` (installed
`CBMoveCompleted 0x4cbcc0`). It honors move changes/queued moves made by that
callback before continuing pose advancement. Do not dispatch completion again
on each render tick of the final frame or silently modulo a one-shot move.

The completion jump table `0x4cbfc4/0x4cbfe4` maps80–85 to `0x4cbf52`. With
blind-pedestrian powerup `0x742970=0` and valium time `0x69eaac=0`, it clears
action0 and calls `StartPedRunning(ped, now, 0) 0x4cc410`. This selects41,
speed100/cache b8=.09 for intact cached legs, action1, completion0, and records
ped timestamp+28. In the alternate branch it selects walking30 with speed-1,
completion0, action0. Thus the ordinary default exit is **fast running**.
Completion clears/releases the selected face-cache ownership (`cache+b0`,
faceCache+14) at `0x4cbf90–0x4cbfaf`.

Other relevant completion table entries:90/91/92→97 with action5,
96/97→93 alive or94 dead;93/94/95 and98–112 have no special completion
transition;113 calls its separate forced-reaction helper `0x4cc490`.

## Dead ordinary bodies, initialization and outer flags

Dead HP is never treated as upright. Its alignment retry limit is2, followed
by the accepted dead branch `0x4d185e`, which keeps the current move ID (`-1`)
and sets its period/speed to0 when mutant speed `0x742944` is0, or its negative
value when nonzero. It does not select80/81 or resume locomotion. The normal
outer corpse path also stillifies a nonactive action6 corpse; motion113 is a
specific exception. The corpse-slick branch additionally tests special-volume
gravity, PercentageChance75, pedestrian bit0x10 and positive gore level.

`BuildPedestrian` writes **signed byte** HP100 at `0x4d2f13`; no float HP or
arbitrary body-mass-scaled initial health. The outer in-sight processed path
`0x4d37c4–0x4d37d2`, outside replay, ORs ped flag0x20 on its first visit and
ORs0x40 when0x20 was already set. Those are outer-update visits, not physics
substeps or quiet-state samples. The general falling-ground branch uses0x40
to choose activation versus vanishing when a newly spawned ped has no valid
walk support. Do not set0x40 merely because a passive box was allocated.

Gore field `0x65c344` has installed image initializer2; the local original
`data/OPTIONS.TXT` has `GoreLevel 0`. Installed getter `0x4d6d90` returns
`2 - internal`; setter `0x4d6e00` stores `2 - option`. Therefore this local
installation uses internal2/full gore. rec2's source initializer1 is not proof
of this installed default. Keep gore preference separate from health/contact.

## Ground-cache provider and remaining branches

Halt forces recache, so the reuse tests are bypassed for this call. The reuse
branch is nevertheless bounded by a negative margin double(-.21739130434782608)
from both cached bounds in all three dimensions, cached XZ triangle inclusion,
and a normal/direction comparison double.99. Forced `0x4d1e20` obtains a world
face list through `FindFacesInBox 0x4b5570` and stores ordered 80-byte face
records in one of capacities5/10/40/75; the installed cache pool counts are
40/25/15/5 (`0x65c318/0x65c328`). Face+34 is normal, +40 flags, +44 planeD.
`0x461de0` first casts down `[0,-1,0]`; its second cast is conditional on the
first returned crossing. `0x422610` ignores face flag0x80, keeps strictly
nearest t starting2, and returns a face only with t<2. It delegates triangle
intersection to `0x45f1c0`. A production face provider must preserve the source
selection, contact point and cache lifetime; a global synthetic floor normal
does not satisfy it. Full box-query construction and triangle reuse algebra
are not implemented by this note.

Required ordinary container fields: signed-byte HP; signed16 impact serial;
u16 pedestrian flags; action; source move slot/ID, clock/fraction/queued slot,
callback bits; world position; character orientation/direction/up/worldV;
selected simple pool slot/physical actor; per-ped cache retry byte19, smooth
turn timestamp6c, target direction48, run speed80/b8, selected face-cache b0;
rigid face range, ec and the header/flags/filters described in the lifecycle
note. Retain running timestamp28 and death timestamp30 separately.

Remaining branches outside the verified ordinary integration: missing-leg
bits8/32 (`0x58e2e4/0x58e2ec`) and corresponding substituted moves82–85;
head/model sequence65d050 and its subsequent model animation; replay; boned bodies;
suicidal/immortal/drunk/dancing/panicking/mutant powerups; water/special-volume
state; corpse slick/gore/scoring ownership. The direct source object scan also
calls CRT `srand(pedPointer) 0x575f70` at `0x4ced54`, then source random draws.
A pointer-identity RNG provider is unresolved in a browser container; skipping
or replacing that reseed silently changes shared CRT consumption. Valium
`0x69eaac` is decremented by outer frame period at `0x4d3527–0x4d3543` and
clamped to0; this suppresses the default running exit while active. The drunk
substitution flag is instead `0x742958`, consumed by `SetPedMove`.

Confidence: **high** for binary addresses, finite ordinary halt comparisons,
retry scalar/state, move selection/completion, stock frame/default data, HP and
gore defaults. **High** for the forced-cache requirement and listed ray gates;
**incomplete** for a full face-cache implementation and excluded branches.
