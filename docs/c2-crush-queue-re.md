# C2 deferred car crush queue

## Executive Summary

Installed C2 applies component damage during collision processing, but collects
ordinary car crush in one shared queue for the complete outer physics update.
It deforms physical candidate vertices and model geometry afterward, then swaps
eligible shapes, processes flaps and detachments, and applies structural bends.
The queue admits eight car identities with four independent events each. Equal
weakest events retain the **first** slot. Contact deduplication uses **double
0.005** against differences between F32 coordinates.

`src/physics/crush-queue.ts` now feeds the simulation's outer `updateFrame`
and legacy `update` paths. Component damage stays immediate; ordinary physical
candidate and mesh crush wait until the fixed-step budget finishes. Candidate
hulls are committed afterward. A real original-Eagle/finite-wall numerical
test checks this phase separation. Explicit single-step diagnostic calls keep
their earlier immediate behavior. Native structural-bend phase/RNG ordering
and browser acceptance remain separate work.
SPAM uses a separate eight-car queue. Full repair cancels pending SPAM and
detach/door records, but does **not** remove ordinary queued crush events.

## Evidence and confidence

All installed addresses below were verified by static inspection of the
read-only `carma2_HW.exe`, image base `0x400000`, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
PE sections used for inspection are `.text` VMA `0x401000`, file `0x400`;
`.rdata` VMA `0x588000`, file `0x186c00`; and `.data` VMA `0x58e000`,
file `0x18c800`. `madebr/rec2` supplied symbol and structure hints, including
some stale addresses. No reference implementation or proprietary asset data
was copied into source or this document.

Queue layout, comparison branches, F32 stores, call order and RNG recurrence
have high confidence from installed instructions. Names for unresolved fields
are descriptive. JavaScript uses double arithmetic between explicit F32
stores; it does not emulate the native x87 register precision/control word.
Thus the documented store boundaries and tested threshold examples are
reconstructed, without a claim of bit identity for every possible norm or
transcendental input.

## Immediate contact work and deferred execution

`DamageCar` at `0x41ded0` calls immediate component damage at `0x41e24b`
(`0x43fa60`) before `QueueCarCrush` at `0x41e267` (`0x42d350`). The queue
copies the contact primitive; it does not deform the model, change physical
candidate vertices, or rebuild the active collision shape during that call.
Collision impulses, component programs and any separate collision topology
operations must retain their own immediate call order.

The main loop calls outer `ApplyPhysicsToCars` (`0x416360`) at `0x492c0c`,
then `CrushBendFlapRend` at `0x492d16`. Its installed address is `0x4360c0`,
rather than rec2's annotation `0x436170`. Its order is:

1. Drain deferred SPAM (`0x4360d9–0x4360f6`).
2. Visit ordinary car buckets and events (`0x436109–0x43621e`).
3. Process drone crush (`0x436224–0x4362bf`).
4. Swap eligible active-car shapes (`0x434910`, call `0x4362ed`).
5. Flapping (`0x438100`, call `0x4362ff`).
6. Scheduled detachment (`0x436a20`, call `0x436304`).
7. Full detachment (`0x438850`, call `0x436309`).
8. Structural bending (`0x4389e0`, call `0x43630e`).
9. Clear the ordinary queue identity prefix (`0x436313–0x436335`).

Ordinary execution calls `CrushCar` (`0x436340`) at `0x4361ee`. Its root
physical candidate records have stride `0x38`; current XYZ at record `+0x18`
are written at `0x43662f/0x436632/0x436637`, and shape-dirty flags are set
at `0x4366af`. Model traversal follows at `0x4366d2` through callback
`0x431d70`. Active hull swapping is a later phase, not an enqueue side effect.
The existing WAM version and physical candidate eligibility gates still apply.

Model callback `0x431d70` converts saved car-local contacts using the current
actor traversal transform (`0x4225d0`, call `0x431df3`). That helper subtracts
the live translation with F32 stores and applies the transposed rotation
(`0x532cd0`). The ordinary event does not capture an actor transform, mesh,
world-space contact, or starting velocity. WAM smash creation reached by this
deferred callback samples its own physics starting-velocity fields at that
later enqueue; see [shared smash evidence](c2-smash-queue-re.md).

## Queue layout, capacity and replacement

The ordinary backing array begins at `0x677f68`. Each of eight buckets is
`0x158` bytes: car reference at `+0`, event count at `+4`, and four `0x54`-byte
events beginning at `+8`. Capacity eight is explicit at `0x42d664–0x42d667`;
the search boundary is `0x678a28`. An older general physics note's ten-car
interpretation is superseded by these installed instructions.

| Event offset | Meaning                                              |
| ------------ | ---------------------------------------------------- |
| `+00`        | Unique contact count, one through four               |
| `+04`        | Up to four F32 XYZ contact positions                 |
| `+34`        | F32 mean contact XYZ                                 |
| `+40`        | Saved F32 force, capped at ten                       |
| `+44`        | F32 normalized direction XYZ                         |
| `+50`        | Captured physics tick, used as a later bend RNG seed |

`0x42d6c0` copies the event; unused contact tails retain old storage. The
physics tick is loaded from `gPHIL_last_physics_tick` at `0x74878c` by
`0x41e250`, passed at `0x41e25e`, and copied to event `+0x50` at `0x42d729`.
It is not an effect flag or a flush timestamp.

Within an existing car bucket, a new event appends while count is below four.
At four, native selects the weakest stored force. `FCOM` at `0x42d609`
compares the current weakest against the candidate; the `AH & 0x41` branch
skips replacement when current is less than or equal to candidate. Therefore
ties retain the **first** weakest slot. Only a strictly stronger incoming
saved/capped force replaces that complete event (`0x42d620–0x42d629`).
For stored forces `[2,1,1,3]`, incoming `1.1` replaces slot one, yielding
`[2,F32(1.1),1,3]`. An incoming tie is discarded. There is no force sum,
contact merge, or mean merge between events or separate collisions.

Different cars retain first insertion order; events retain slot order,
including replacement in place. A ninth new car is dropped. A full eight-car
queue can still append or replace an event for an already retained car.
Ordinary insertion is distinct from the smash and SPAM queues' capacity-before-
deduplication rules.

## Numerical order and boundary examples

Input vector XYZ and car softness (`car +0x18d0`) are F32 values. Instructions
`0x42d3a1–0x42d3bf` compute:

```text
norm = sqrt((y*y + z*z) + x*x)        // no intervening F32 stores
rawForce = norm * softness
savedForce = F32(rawForce)           // FST, does not pop rawForce
reject if rawForce <= GENERAL_minimum_force_F32
force = savedForce > 10F ? 10F : savedForce
reciprocal = 1.0_double / norm
direction = F32_each(vector * reciprocal)
```

The force store is `0x42d3c5`; the following `FCOMP DWORD [0x677f58]` at
`0x42d3c9` tests the still-unrounded register value against the F32 authored
GENERAL minimum. The original authored value `0.06` becomes
`0.05999999865889549`. The cap compares the saved F32 value at
`0x42d3da–0x42d3eb` against float ten at `0x588a80`. The reciprocal uses
double one at `0x588a60` (`0x42d3f3`); direction XYZ stores occur at
`0x42d41d/0x42d427/0x42d432`. Capping or softness does not change direction.

For vector `(0.06, 1e-6, 0)`, softness one and minimum `0.06`, the double
reconstruction gives raw norm `0.05999999866722883`, above the F32 minimum.
Native accepts, even though saved force equals that F32 minimum. Direction is
`(1, 0.000016666666851961054, 0)`. Testing saved force against either minimum
would wrongly reject. A lone vector `(0.06,0,0)` is rejected at equality.

Finite F32 inputs can overflow the saved force before capping: vector
`(3.4028234663852886e38,0,0)` and softness two produce saved positive infinity,
then capped force ten and direction `(1,0,0)`. Browser guards can reject
nonfinite rounded inputs or raw force while allowing this saved overflow.

Only the first four supplied contacts are considered. The first is copied,
then each later point is compared against all retained points. It is a
duplicate only when all three absolute coordinate differences are strictly
less than **double** `0.005`, stored at `0x588a88`. Native subtracts the F32
coordinates in registers and does not store/round the difference before
comparison (`0x42d489–0x42d4c3`).

- `F32(0.005) = 0.004999999888241291` deduplicates against zero.
- The next F32 value, `0.005000000353902578`, survives against zero.
- `F32(0.005)` and `F32(-2e-10)` differ by `0.005000000088241294`, so both
  survive. Rounding this difference to F32 would incorrectly deduplicate.

The sum initializes directly from the first contact (`0x42d449–0x42d455`).
Every additional unique point performs an addition followed by a F32 sum
store (`0x42d4f4–0x42d50c`). Native divides each saved sum by the integer
unique count and stores the result to F32 (`0x42d52a–0x42d55e`). For four
unique X coordinates `[1,2^-25,-1,0.25]`, native mean X is `0.0625`; an
unrounded JavaScript running sum gives `0.0625000074505806`. Initializing with
the first point also preserves a lone negative-zero coordinate.

## Structural branch and RNG

Deferred ordinary processing first evaluates the source bendability/force
gate at `0x436163`. When this branch is selected, a probability draw runs at
`0x43617d`. Success negates event force at `0x43618b`, marking it for the
later bending pass. Both success and failure skip that event's ordinary
dent (`0x436184/0x43618e` to `0x4361f3`). Structural execution therefore
belongs after shape swapping and detach processing, rather than inside each
ordinary deformation callback.

`DoBending` recognizes negative force at `0x438a4b–0x438a58`, restores its
positive value at `0x438a72`, and retains the source mean/pivot eligibility
checks. Its dominant-Z branch tests `abs(direction.z) > F32(0.707107)`,
then seeds the shared native RNG from event tick `+0x50`
(`0x438b2f/0x438b3b`) and draws `PercentageChance(50)`
(`0x438b43–0x438b48`) to choose the upper/lower pivot. X/Y branches beginning
at `0x438cd4` do not perform that seed or pivot draw. `BendCar` is called at
`0x438c3c` (`0x433bc0`). The bucket car pointer is cleared at `0x438c91`.

Installed `srand` at `0x575f70` assigns global state `0x671ff0`; `rand` at
`0x575f80` implements the MSVC recurrence:

```text
state = (214013 * state + 2531011) modulo 2^32
rand = (state >>> 16) & 0x7fff
IRand(lo, hi) = lo + floor(rand * (hi-lo+1) / 32768)
PercentageChance(percent) = floor(rand * 100 / 32768) < percent
```

`IRand` is `0x512f00`; `PercentageChance` is `0x512f30`, and probability
zero returns without drawing. The initial bendability chance uses the
existing shared RNG state before the later seed. Reseeding is not isolated
to one car: subsequent effect/random consumers observe its changed state.
The current structural helper's injected `damageContext.random`/`Math.random`
does not establish this tick-seeded Z choice or shared-state side effect.

## SPAM, repair and cancellation

`TotallySpamTheModel` is installed at `0x431560`. When physics is active
(`gPHIL_doing_physics` at `0x748798`, tested `0x431579–0x431580`), it queues
into the separate array `0x67a5b8`, count `0x67a06c`, eight records of eight
bytes `{car, F32 strength}`. Capacity is checked before car deduplication at
`0x43158c–0x43158f`. Below capacity, repeats retain the larger strength
(`0x4315d5–0x4315f5`), with no addition. The SPAM phase drains these before
ordinary crush and clears its count at `0x4360f6`.

Outside physics, SPAM executes directly. It sends ten generated rays through
its special physical crush path (`0x432dc0`, call `0x431ae8`) and model
callback (`0x431d70`, call `0x431b05`), without ordinary queue admission.
Its child-first full-detach prepass (`0x435d20` to `0x4332a0`) and later
special split/bend behavior remain separate from ordinary contact processing.

Full repair at `0x439460` directly restores component/model/physical state,
calls `SwapShapesIfPossible` at `0x43978c`, then
`RemoveCarFromCrushLists` (`0x429ce0`) at `0x43979d`. This removal function
stable-compacts survivors in these lists, preserving their order and updating
their counts:

| Installed list base | Count      | Record size | Meaning             |
| ------------------- | ---------- | ----------- | ------------------- |
| `0x678b30`          | `0x67a690` | `0x24`      | Network detach      |
| `0x67a0e0`          | `0x67a0d8` | `0x4c`      | Network semi-detach |
| `0x67a078`          | `0x67a600` | `0x0c`      | Network full-detach |
| `0x67a6b0`          | `0x67a068` | `0x0c`      | Network reattach    |
| `0x677df8`          | `0x67a370` | `0x14`      | Scheduled detach    |
| `0x677cf0`          | `0x67a5f8` | `0x10`      | Toggled doors       |
| `0x67a5b8`          | `0x67a06c` | `0x08`      | Deferred SPAM       |

The complete function `0x429ce0–0x429ee4` never accesses the ordinary
`0x677f68` queue. Thus repair does not create ordinary holes or reclaim an
ordinary bucket's capacity, and pending ordinary events are not canceled by
this function. Per-car ordinary cancellation would be a browser deviation.

Ordinary buckets form a contiguous non-null prefix. Deferred iteration and
lookup stop at the first null car pointer. `ClearCrushLists` and the bending
pass clear identity pointers, leaving event counts/storage stale. The next
new enqueue uses the first null bucket, writes its car, sets count to one,
and overwrites event zero. Creating an isolated null hole would hide later
cars from lookup and flushing; a cancellation API must not introduce such
holes. SPAM cancellation instead compacts and immediately restores capacity.

## Integration boundary and remaining work

Collect ordinary events across all fixed physics steps in one outer frame;
apply component damage during each collision. After the outer physics budget,
run the ordered deferred phases before synchronizing/rendering changed shapes.
Keep SPAM's active-physics queue and direct outside-physics execution distinct.
Use captured physics ticks for the structural RNG seed and the relevant live
game clock for effect execution.

The twenty-entry WAM/world smash queue is a separate mechanism with its own
physics and final-frame flush barriers. Preserve its world/noncar barrier
before collision restart/early-exit paths; do not replace it with either one
per-impact queue or one flush after every car's ordinary crush. See
[shared smash queue evidence](c2-smash-queue-re.md) for the complete barriers.

Focused pure-queue tests establish numerical admission/replacement behavior.
The original-Eagle simulation test also checks the deferred phase, while
source structural RNG ordering and Chromium crash/repair validation remain
separate acceptance work. The car WAM adapter uses the twenty-entry effect
queue with live tiers, first-hit context and per-record flush time. World
texture/decal sharing and intermediate physics flush barriers are being
integrated separately; this does not establish complete native scheduling.
