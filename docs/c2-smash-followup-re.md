# C2 followup smashes and the shared delayed pool

## Evidence and confidence

Installed HW executable: SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`;
PE32 image base `0x400000`, entry `0x577eb0`, timestamp October 18, 1998.
The following control flow, layouts and constants were verified in that binary.
`madebr/rec2` provides symbol/structure and parser maps; its partially reconstructed
followup function does not establish behavior independently. This module is an
independent implementation of the documented behavior, with no copied reference
source or executable content.

Installed functions:

| Function                | Address    | Role                                        |
| ----------------------- | ---------- | ------------------------------------------- |
| ReadShrapnelSideEffects | `0x4ef2d0` | Authored cuboids and target classes         |
| DoSmashingSideEffects   | `0x4ed950` | Collect faces, select targets, retain tasks |
| FindFacesInBox          | `0x4b5570` | Triangle clipping, maximum 400 results      |
| IRandomBetween          | `0x512f00` | Inclusive integer delay                     |
| MungeDelayedSideEffects | `0x4ec9f0` | Shared physical-slot due scan               |
| DoPullActorFromWorld    | `0x41ff40` | Release numbered ACT into physics           |
| BashObject              | `0x4f5090` | Numbered-object smash dispatch              |
| World smash dispatcher  | `0x4f0ec0` | Captured face dispatch                      |
| GetTotalTime            | `0x514610` | Outer-frame game clock                      |

## Selection and retained context

`DoSmashingSideEffects` samples GetTotalTime once on entry, then processes authored
cuboids and collected faces in source order. Relative coordinates transform only
the two authored endpoints through the **live original source physics matrix**
(`physics+0x8c`) and swap each inverted axis. They do not compute an eight-corner
AABB or use the smashed target ACT transform. Absolute endpoints are copied
without the relative branch's swaps. The picker matrix is the track-root ACT
matrix (`gTrack_actor`, global `0x759080`), verified from the track load assignment
at `0x5055f3`. Bounds are expressed in the corresponding native model units.

FindFacesInBox receives a capacity of 400 and null custom callbacks. Capacity
applies before followup target filtering. Reference traversal visits track columns
in X/Z order, then ACT children, prepared model groups/faces, then extra ACTs.
ModelPickBox clips each triangle against six inclusive planes and requires at
least three polygon vertices. Bounds/origin tests alone cannot reproduce this
selection; non-solid smash faces must remain discoverable. Current collision
surfaces omit pass-through geometry, and their broad query alone is insufficient.
The module's `collectFaces(query,400)` adapter contract requires the final clipped
face order; the module also caps oversized adapter output to 400 before filtering.

Reader target classes are:

| Authored selector                 | Class / runtime comparison                |
| --------------------------------- | ----------------------------------------- |
| `*` or unrecognized selector      | All admitted smash targets                |
| Leading `*`, suffix `.MAT`        | Material targets                          |
| Leading `*`, suffix `.DAT`/`.ACT` | Ordinary ACT targets                      |
| `&*`                              | Numbered ACT targets                      |
| Leading `&` followed by digit     | First two digit characters must match     |
| Named `.MAT`                      | Exact, case-sensitive material identifier |
| Named `.DAT`/`.ACT`               | Exact, case-sensitive ACT identifier      |

Suffix classification is case-insensitive. Runtime named comparisons are
`strcmp`, not case folding. Installed reader ordinary-name classification differs
from a duplicate/incorrect branch in the reconstructed rec2 reader.

Selection precedence:

1. A material with a 12-character identifier and `identifier[5]=='|'` owns the
   candidate path. Material classes all/material-wildcard/exact-material may
   admit it. A rejected material never falls through to the ACT path. Its target
   point is the triangle centroid, multiplying the sum by float32 `1/3`
   (`0x589f58`, `0.3333333432674408`). Identifier positions 6–7 select the packed
   spec at track-spec base `0x6a37c8`, stride `0x2e0`.
2. Otherwise ACT admission requires a packed ordinary identifier, pickup marker
   `identifier[1]==0xa3`, or a leading-ampersand numbered identifier with a
   non-null registered noncar lookup (`0x6b7e00`). Arbitrary scene ACTs are not
   wildcard candidates. Ordinary ACTs accept all/ordinary-wildcard/exact-name.
   Numbered ACTs accept all/number-wildcard/two-digit-name and reject
   `identifier[3]=='!'`. Their point is ACT **local** translation, not a bounds
   center. Normal selector eligibility, including numbered bit two, is not an
   enqueue gate.
3. Exclude the ACT equal to the original source physics ACT (`0x4edd3c`).
4. Pending dedup scans active type-one slots (`0x4edcdc–0x4edd32`). Incoming ACT
   candidates reject any pending smash on that ACT. Incoming material candidates
   reject only matching ACT/group/face, including a pending ACT task with that
   face. This is asymmetric and retains the first context; no tier/force update
   occurs. Duplicate candidates consume no delay random draw.
5. Copy raw source velocity (`physics+0x68`), draw delay and build payload before
   searching for a free slot (`0x4edd53–0x4edf89`). Saturation still consumes each
   admitted candidate's random draw, even for fixed or zero delay, and continues
   later faces/cuboids.

The runtime semantic proxy uses independently resolved material bindings or
ordinary model specs in place of native packed ID bytes. Existing
`actor.userData.worldSmashSpecIndices` unions number/material/model bindings, so
it cannot by itself admit every tagged ACT as an ordinary wildcard. The exported
resolver filters model bindings and chooses the last source index matching the
actual face DAT/ACT identity. Authoritative registration survives runtime ACT
renaming: Carrier core is observed as `&coR0122.ACT` while its spec is
`&CORE.ACT`. When all model tags share one original identity, a renamed-name
miss falls back to that binding. Names can be omitted when the adapter explicitly
accepts the metadata union. Multiple sibling DATs sharing one ACT require the
face's actual model identity; choosing the last index from the union is unsafe.
Material bindings remain independent of that ACT metadata and take precedence.
The current constructor populates these tags during its retained-actor traversal.

Native cuboid record stride is `0x4c`: delay words `+0/+2`, coordinate enum `+4`,
target string `+8`, target class `+0x28`, min/max `+0x2c/+0x38`, direction
`+0x44`, strength `+0x48`. Reader uses integer seconds; each milliseconds endpoint
wraps to 16 bits, then enqueue zero-extends it. Inclusive delay is
`lo+trunc(rand15*(hi-lo+1)/32768)`; due time is unsigned 32-bit entry-clock plus
delay. Reversed wrapped bounds retain signed truncation toward zero. Existing
parser float pairs are accepted only when their values are integers by this module.

Direction `towards` is live source physics origin minus target point; `away` is
its opposite. Normalize the unrounded difference; length at most `2^-22`
(`0x589ee4`) falls back to `(1,0,0)`. Store normalized components as float32.
Nonnegative strength is magnitude; negative strength gives
`float32(-float32(incomingMagnitude)*float32(strength))`. Multiply direction by
that stored magnitude, rounding each output to float32. The caller supplies
actual direct solved impulse or queued first-contact starting speed times 6.9,
according to its native connotation path. Do not recompute from later velocities.

**Unresolved parallel direction:** the installed branch divides scratch
`esp+0x10/+0x14/+0x18` by incoming magnitude at `0x4eda38–0x4eda61`, but the
function does not initialize that scratch from its incoming vector argument.
Later candidates can leave values there. There is no evidence supporting an
invented normalized impact direction. `WorldFollowupRuntime` explicitly skips
parallel records and offers `onUnsupportedDirection`; this is a documented gap,
not native equivalence. Installed authored records inspected below do not use it.

Payload copied size is `0x94`: source velocity `+0`, target point `+0xc`, due
`+0x18`, force vector `+0x1c`, target spec pointer `+0x34`, face reference
`+0x38` (80 bytes), target kind `+0x88`, magnitude `+0x8c`, original source
physics pointer `+0x90`. Face reference contains material, three vertices, three
UV pointers, normal, flags, plane distance, ACT pointer and signed group/face
shorts. Actor/group/face appear at payload `+0x80/+0x84/+0x86`.
The module retains actor/source identity and copies numerical face/velocity/force
values; optional `face.source` lets the adapter retain UV/source face identity.
The native does not retain a source pose matrix: derived point/direction use the
live matrix during enqueue, while execution retains the original physics object.

## Shared slots, outer-frame ordering and execution

All delayed tasks occupy the same twenty physical slots at `0x6a53d0`, stride
`0xc8`: kind `+0` (zero activation, one followup), active source-physics pointer
`+4`, payload `+8`. Followup allocation scans first free slot from zero. The root
`NativeDelayedSideEffects<NativeDelayedTask>` pool preserves that capacity and
physical order; this runtime does not own a second pool or per-step clock.

Main invokes the delayed dispatcher at `0x493752`, then final
`FlushSmashQueue(0)` at `0x49378b`, once per outer frame. Delayed tasks created by
that final flush wait until the next outer frame, even with zero authored delay.
Unsigned `now>=due` is the actual comparison, without wrap-aware subtraction.
The current slot remains active throughout its callback and clears afterward
(`0x4ecbe7`). A child placed in a later free slot may execute in this same scan;
a reused earlier slot waits until the next scan. The owning update is:

```ts
sharedDelayed.update(gameClockMs, (entry, now) => entry.context.advance(now));
// The outer owner then performs final smash/powerup queue flush.
```

When an ACT task is due, read the ACT's **live** identifier. A leading `&` followed
by a digit routes to DoPullActorFromWorld, then writes `identifier[3]='!'`, then
BashObject. Pull is called even if already pulled; its null result does not
suppress BashObject. The BashObject selector-one gate requires numbered trigger
argument bit two (`0x4f50e2–0x4f510e`). Ordinary contact gates (attached bit one,
released bit four) are different. The due callback receives the numbered route
and explicit eligibility so the adapter can pull/mark **before** checking bit two.
It must not return early on `eligibleAfterRelease==false` before those release
operations. Root should resolve the live numbered binding if it can change.

Every other due task uses the copied face reference in the world dispatcher,
original source physics, captured magnitude/point/raw velocity/force, selector
one and final caller flag zero. The returned cap is discarded. Do not add an
extra direct physical impulse: this vector is the smash context. The callback
may create normal smash, delayed activation/followup and powerup queues; ordinary
phase ownership then applies. The module calls `onDue` while the slot remains
held and returns true only afterward; exceptions preserve the pending slot.

## Activation pool comparison

DoSmashingNoncarActivation (`0x4ed5d0`) is the other pool producer. Its relative
matrix is the smashed ACT matrix for leading-ampersand targets; otherwise source
physics matrix. This differs from followups, which always use source physics.
Source raw velocity still comes from original source physics. One activation
cuboid occupies one slot, even when zero ACTs are selected. Its payload holds
source velocity `+0`, selected origin `+0xc`, authored speed pointer `+0x18`,
count `+0x1c`, then twenty `{ACT pointer,due uint32}` records at `+0x20`.
Thus activation alone can hold 400 actors, but followups reduce available groups.

Callback `0x4ed890` admits numbered ACTs with inclusive **ACT translation** bounds
and optional signed-eight-bit two-digit type match; it does not deduplicate ACT
identity. It builds candidates and draws delays before checking shared capacity
at `0x4ed803`. Due execution compacts future records and consumes every due record
even if pull fails or the ACT was already pulled. Installed already-pulled branch
`0x4ecad8` reaches started-count increment `0x4ecba4`; rec2's reconstructed
already-pulled count discrepancy is absent in this binary. Independent activation
groups and per-physics-step updates cannot preserve these shared-slot semantics.

## Browser integration and current limits

`main.ts` binds connotation side effects to the live `VehicleSimulation` source
body and its game-clock-owned delayed pool. `WorldDestruction.collectFollowupFaces`
includes pass-through render triangles and tests triangle/cuboid intersection,
applies the 400-face cap before registration filtering, and substitutes current
physics poses for interpolated dynamic render poses. Original model registration
survives batching/reparenting and renamed Carrier core actors. Due dispatch
preserves captured velocity, point, force and spec identity. Numbered dispatch
wakes/pulls the registered noncar, writes its release marker, and selects only
numbered specs through bit two; it cannot additionally fire a material handler.
Ordinary delayed dispatch bypasses the solved-contact `.02` entry gate while
retaining authored removal thresholds and contact flags. Geometry changes
invalidate static/dynamic collision and pedestrian face caches. Texture admission
reads the source car's current starting-step velocity rather than replacing it
with the cuboid-time snapshot. Generic noncar starting-velocity storage remains
unreconstructed and currently supplies zero to that separate texture field.

The current collector traverses the batched render hierarchy. It **does not**
reconstruct native X-outer/Z-inner track-column order, prepared group pointer
ordering or the additional-actors-last list. This can change admitted targets
when either face or delayed-slot capacity is reached. Triangle/box intersection
uses the equivalent separating-axis test rather than native polygon temporaries;
borderline rounding has not been compared exhaustively. Retained face/group
identity is a browser semantic proxy. Parallel direction, additional shrapnel
classes, slicks and fancy-headup outlets remain open. These limits prevent a
claim of complete WLD-05/DMG-02 compatibility.

Focused integration tests exercise original Stock/Advanced Carrier registration,
material precedence, live poses, pass-through faces, face saturation, held slots,
captured context, entry gates and numbered bit-two dispatch. Proprietary assets
are read locally and skipped when absent; no asset fixtures are copied.

## Authored coverage and validation

Installed Stock and Advanced inventories contain the same 79 sideeffect records
across 78 payloads: all target `*.DAT`, all direction `away`; 66 relative and 13
absolute cuboids; 12 fixed two-second delays, 66 one-to-three-second delays, one
zero-delay record; 64 strength 1001 and 15 strength -10. No followup records were
found in the installed 52-car WAM inventory.

Examples: carrier `&CORE.ACT` has absolute bounds `(53,-50,-2.5)` to
`(58,-42,2.5)`, fixed two seconds, strength 1001. Desert `&gascyl.act` uses relative
`(-2,-2,-2)` to `(2,2,2)`, one-to-three seconds, strength 1001. New city
`&comsat1.act` uses relative unit bounds with strength -10. Silo `&20` has the
sole zero-delay absolute cuboid `(-130,-4,-20)` to `(-110,8,-10)`.

Nine focused tests pass, including numerical payloads, asymmetric pending dedup,
material precedence, two-corner rotated bounds, face limit before filtering,
shared saturation/RNG, unsigned delay wrap and live numbered due dispatch.
Stock and Advanced carrier configurations are read directly when installed and
skip cleanly when absent. TypeScript validation passes. The adapter's exact scene
triangle collection, original actor packing proxy and application callback wiring
remain integration responsibilities; these unit tests do not establish browser
behavior for those adapters.
