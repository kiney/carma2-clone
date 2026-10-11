# Ordinary pedestrian support and falling

## Evidence and phase

Verified installed read-only HW instructions, SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`, PE32
base400000, entry577eb0. rec2 `src/carma2/common/pedestrn.c`, `mainloop.c`
and `include/rec2_types.h` provide names/layouts; RecacheAndSetFace remains a
stub and its address differs. No reference code or proprietary data is copied.

Installed `MungePedestrians 4d3510` runs once before physics: main-loop call
`492af3` precedes `ApplyPhysicsToCars 416360` at `492c0c`. Process/render/body
slot admission, flag20 then40 arming, process-cache ownership, gravity and
existing wet/burning handling precede ordinary grounding. The ordinary path
starts `4d3c50`: character physics bit4 must be clear and action must be
walking0 or running1; replay requires its explicit override `7429a4`.

Root position means `GetCharacterMatrixPtr 407a90` translation+24, which
selects the stored matrix, temporary matrix or stable root ACT matrix. It is
neither personality feet, procedural outer group position nor body COM.
`GetPedPos` uses this root translation. The source pointer is retained while
later animation changes the same root matrix.

The ordinary path accelerates the current animation period, clears pedestrian
flags2/4, tests changed-point squared distance strictly below double400, then
runs support recaching. After support, it performs proximity/turn/wander/threat
avoidance. Later it checks powerup move substitution, calls
`MungeCharacterAnimation`, copies character world V into the passive physical
body, and copies current root translation into `ped.pos`. Thus support queries
the **current** root before this frame's BON displacement. There is no predicted
nextX/Z derived from mean walking speed in this phase.

## Retained finite face cache

`RecacheAndSetFace 4d1b30` returns a cache pointer and two separate outputs:
`needGround` and `needProximityRescan`, initially0. Cache record stride34hex:
faces pointer+0, actual count byte+4, bucket capacity byte+5, time+8,
owner+14, six stored world bounds+18..2c, selected support face+30. Source
face records have stride50hex. These offsets refine rec2's incomplete cache
declaration, which labels the bytes ambiguously.

Rebuild `4d1e20` occurs on explicit invalidation, no cache, or failure of any
interior-margin comparison:

```text
root[i] - cache.max[i] <= double(-1.5/6.9)
cache.min[i] - root[i] <= double(-1.5/6.9)
```

Equality retains. The earlier strict-inequality interpretation was corrected
by inspecting `4d1b7c–4d1bfa`: each finite comparison executes `fcomp` against
double `589b00`, then `test AH,41` and `JE` to rebuild. Less/equal set C0/C3
and continue; greater rebuilds. Differences are not stored Float32 before this
comparison. Explicit invalidation ORs replay override with any nearby
changed point. Completion also invalidates the owning support cache. This
function has no generic view-distance/floor-ray-per-tick substitute.

Before construction, `4d1e2d–4d1e52` tests signed pedestrian HP byte+4. When
HP is nonpositive and replay override is clear, it leaves the cache unchanged
and selects move94 with period−1, restart0, completion1, action6 and the actual
`GetTotalTime 514610` result. The preceding stack push6 is an action argument,
not a random range; this branch consumes no RNG. A NULL cache makes the caller
repeat this branch once, just as it repeats a failed ordinary cache acquisition.

Creation `4d1e61–4d1f77` uses the actual character basis+5c..7c and current
root translation. The authored local box is:

```text
min = (f32(-3/6.9), f32(-2.5/6.9 - jumpHeight), f32(-2/6.9))
max = (f32( 3/6.9), f32( 2.5/6.9 + jumpHeight), f32(10/6.9))
```

X/Z constants are stored Float32; Y adds/subtracts the personality Float32
jumpHeight from a double2.5/6.9 before the store. Transforming that source
box through `45fb90` creates its retained world bounds. Do not reconstruct a
fresh normalized direction/up basis if an actual character basis is available.
Collector `4b5570` gets maximum bucket capacity+1, then clamps to75 and sets
the overflow diagnostic. Buckets are5,10,40,75 (`65c318`). Ordered finite
face emission, pool reuse/eviction and ACT transform callbacks belong to the
collector/cache owner; an unordered scene-ray list is not the same provider.

When the cached support face exists and its projected XZ triangle contains
the current root, the function returns without changing either output or
recasting. The installed sign products `4d1c0b–4d1d36` are equivalent, for
finite coordinates without spill-boundary ambiguity, to:

```text
area = crossXZ(B-A, C-A)
area * crossXZ(B-A, P-A) >= 0
area * crossXZ(C-B, P-B) >= 0
area * crossXZ(A-C, P-C) >= 0
```

Edges are inclusive. Original intermediate differences and several duplicated
products spill Float32; exact numerical porting must preserve these stores.
A projected-degenerate support triangle passes zero products; do not invent
an epsilon rejection here. This retention is compatible with ordinary motion
along the selected surface orientation; it is not permission to flatten
sloped root displacement into XZ before animation.

Triangle exit/no support triggers reselecting within retained faces. It sets
`needGround=1`; old/new absence or old normal dot process-cache floor normal
strictly below double.99 sets `needProximityRescan=1`. Rebuilding sets
`needGround=(newCache!=NULL)` and `needProximityRescan=1`. Caller repeats once
if returned cache is NULL (`4d3e67–4d3e8b`). A cache-allocation failure with
needGround0 is not equivalent to a successfully queried unsupported floor.

## Ground hit selection and clearance

Support selection is `461de0→422610→CheckSingleFace 45f1c0`.
`422610` scans retained faces in order, skips raw face+40 bit80, chooses a
strictly smaller parameter than initial Float322 and returns NULL if no
parameter below2. Ties retain the first emitted face. The common finite-face
helper performs actual segment intersection, one/two-sided policy and native
material-prefix rejection, not an infinite support plane.

First cast is from the current root with segment `(0,-1,0)`. If no hit and
personality move-slot0 grounding clearance is nonzero, `461e29–461e67`
retries from `(root.x, f32(root.y+clearance0), root.z)` with the same segment.
The hit point is the actual helper output. This is not a nearest global
floor search from an arbitrary root+0.2 or ground+0.05 position. Walking/running
material exceptions belong to the separate avoidance scanner; support
selection itself does not consult the pedestrian spawn exclusion list.

`GetClearanceFromCharacterInstance 40bae0` with argument0 reads personality
**move slot0**'s grounding offset, not the selected current move ID's offset.
The accepted root positioning later uses the selected move's offset.

## Supported position versus active fall

Caller `4d3e94–4d3fb6` acts only when needGround is nonzero and action is not
falling3, dead6 or impacting5. Its successful support test is:

```text
drop = f32(f32(root.y - hitPoint.y) - clearance0)
supportFace != NULL
drop <= personality.jumpHeight + double(3/6.9)
supportFace.normal.y > configured Float32 cosMaxSlope
```

The installed `589b80` constant is **double**−.43478260869565216; rec2's
Float32 `.4347826f` is not exact evidence for this boundary. This is a signed
drop test with inclusive equality, not `abs(ground-root)<.4347826`. Large upward
height differences are not rejected by an invented symmetric step limit.

Successful `SetCharacterPosition(mode1) 40b0a0` receives the source hit point,
sets target root X/Z from it and Y to
`f32(hitPoint.y + currentMove.groundingOffset)`. Grounding offset is not
multiplied by the move translation scale. Mode0 instead casts using
`FindYVerticallyBelow2 4e43c0`; mode−1 copies a supplied root directly.
Active characters normally reject this setter outside replay. Existing
animation-frame/root-motion adjustment inside the setter must be retained
through the instance root API, rather than moving only a render wrapper.

After successful grounding, a smooth turn is stopped and its saved target
direction is applied; otherwise the retained character direction is applied,
then the proximity-rescan output is set1 (`4d4018–4d403f`).

On failed support:

- If pedestrian eligibility flag40 is absent, `4d3f24–4d3f6c` makes the
  pedestrian vanish/releases render scope. It does not activate a fresh body.
- With flag40, clear selected support face, stop smooth turn, request physics
  level5 through `4cc610→409570`, then select move72/action3 at
  `4d3f8b–4d3faf`. `SetPedMove` arguments are period−1, restart0, completion0,
  actual game time, action3. Level5 activates the existing body with character
  world V, preserves omega and enables halt callbacks; it adds no falling kick
  or random spin. Source writes action3 after the selection call.

Existing wet fully immersed activation later in this outer update is a separate
branch with its own random omega; it is not evidence to add spin to unsupported
floor falling. An already active character bypasses ordinary support and lets
the physical/moved/halt owner control its ACT.

## Completion93 and get-up boundaries

Installed completion switch `4cbcc0`, tables `4cbfc4/4cbfe4`, distinguishes:

| Completed move IDs | Result                                                            |
| ------------------ | ----------------------------------------------------------------- |
| 72,93,94,95        | Default: no new move/action or automatic physics transition       |
| 90,91,92           | Move97, action5, completion requested                             |
| 96,97              | Move93 if alive,94 if dead; action5; living head sequence updated |
| 80..85             | Ordinary StartPedRunning; blind/valium select walk30/action0      |

Every completion tail clears support cache ownership/pointer
`4cbf90–4cbfa9`, then enables overall movement through `40c630`. Thus even
default93 completion invalidates cached support but does not invent a get-up
or time-based fall finish. Physical halt decides lying/get-up with authored
axes and current body orientation; reuse [the halt kernel](c2-ped-halt-re.md)
instead of implementing another recovery timer here.

## Required host seam

The displayed host needs actual current root matrix and character basis, source
FORM move-slot mapping, slot0/current clearance, personality jumpHeight,
cosMaxSlope, support-cache identity/bounds/ordered faces/selected face, raw
face flags/material/two-sided fields, changed points and source outer clock.
It also needs actual processing flag40, current action/physics level,
smooth-turn state, stable-body level5 activation, move72 selection and vanish
outlets. Existing `pedFaceCacheBox`/finite-box tests and native instance root
helpers provide much of the geometric/posing machinery. The present
`PedestrianSystem.floorAt` and mean-speed movement block still use a fresh
ray, symmetric height threshold and heading reversal; those are concrete
adapters to replace at this native outer-frame seam.

`src/ped-grounding.ts` implements the current-root retained-cache decision,
partial Float32 spills in the projected triangle/changed-point tests, source
cache bounds, ordered two-pass support selection and ordered supported/fall/
vanish/dead-cache effects. It does not mutate supplied state. The actual finite
`CheckSingleFace` query and ordered ACT collector remain explicit host providers;
missing providers preserve input
state and return `provider-required`. A successful cache with no hit requests
fall/vanish, whereas two failed acquisitions return `allocation-failed` with
needGround0. The displayed outer-frame host must apply mode1 through the native
character position/notification path and apply effects before BON advancement.
Unspilled x87 expressions use JavaScript double; no extended-precision emulator
or guessed geometric tolerance is supplied. Focused tests cover source numeric
boundaries and read authored BIPED1/BIPEDF/DOG1 default clearances when installed.

`src/ped-ground-cache.ts` supplies the actual bounded cache owner: installed
`4cae92` allocates40/25/15/5 lists holding5/10/40/75 faces respectively
(`65c318`, `65c328` verified in the local HW data),85 stable slots total.
`4d1fab–4d2099` reuses a same-capacity slot; otherwise it clears the old slot's
owner and takes the next bucket head. Eviction clears the old process pointer
before rebinding and sets diagnostic bit1 for eviction at the same uint32 clock.
Taking the head advances the ring; reusing a non-head moves it behind the head's
predecessor, making it the last entry before the next head. Retained support
lookups do not rotate a slot. Face fields are copied from collector scratch
storage, not borrowed as a mutable scratch array. Installed reset`4d59a0`
restores next-chain allocation order and clears owners while retaining face
storage. Unlike the current rec2 reset loop, the installed code compares against
the current bucket's count−1. The installed final link writes last.prev=last
(`4d59f1–4d59fe`) rather than repairing base.prev; the array-backed host uses a
valid finite order instead of reproducing that unsafe backward-pointer defect.
This is an explicit ownership-safety deviation, not a literal pointer-layout
emulation. Nine deterministic ownership/order/bounds tests cover
this allocator. The source cache provider still must be connected to the
displayed population and finite ACT collector; this module alone does not
replace the old fresh-ray host.

Validation: 21 focused tests pass, including all three installed FORM/default
movement tables; absent installations skip those reads cleanly. An isolated
32-bit capture harness loaded the original HW image read-only, stubbed only
root/clearance/query outlets and called installed `RecacheAndSetFace 4d1b30`
on 1,000 synthetic finite triangle/root cases. Retained versus reselect decisions
matched the kernel in every case. Capture tooling/output remain under `/tmp`;
no original executable bytes or proprietary fixtures are included here. This
does not validate the separately required finite `CheckSingleFace` provider.
