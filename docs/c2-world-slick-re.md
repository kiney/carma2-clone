# World connotation slicks and the shared oil runtime

## Evidence and conclusion

Verified against the read-only installed `carma2_HW.exe`, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`,
PE32 image base `0x400000`, entry `0x577eb0`. The rec2 reference is
`/tmp/carma-rec2/src/carma2/common/{oil,skidmark,smashing,pedestrn,car,mainloop}.c`
and `include/rec2_types.h`. Its oil function addresses and several field tests
are stale for this executable; installed instructions take precedence here.
This is an independent behavioral description, not copied reference code.

World/WAM slicks, oil powerups and settled pedestrian blood share **one pool
of 32 oil spill records**. World slick production is an authored invocation
of the existing oil allocator, not an explosion, particle cloud or independent
decal pool. The browser now dispatches this connotation outlet through the same
`OilRuntime` as charged oil, with original parameters/materials, retained
ACT/MODEL providers, the outer-frame process phase, ten-face projection and
retained graphics masks. `PedBloodRuntime` still maintains a separate 32-slick
pool; connecting its actual corpse actor/model remains necessary.

## Installed function and phase map

| Routine / operation                         | Installed address                     |
| ------------------------------------------- | ------------------------------------- |
| Initialize 32 spill actors/materials/models | `0x4a67b0`                            |
| Reset spill ownership/visibility/stop time  | `0x4a69f0`                            |
| QueueOilSpill2, generic authored allocator  | `0x4a6a20`                            |
| QueueOilSpill, fixed car-damage parameters  | `0x4a6b70`                            |
| ProcessOilSpills, including placement test  | `0x4a6bf0`                            |
| SetInitialOilStuff                          | `0x4a7200`                            |
| GetOilSpillCount / GetOilSpillDetails       | `0x4a7280` / `0x4a7290`               |
| Wheel friction/trail consumer               | `0x4a72d0`                            |
| PointInSpill                                | `0x4a7570`                            |
| DoSpillage, forwarding a slick spec and ACT | `0x4ec9b0`                            |
| ReadSpillData                               | `0x4ee360`                            |
| DoConnotations slick outlet                 | `0x4ed50e–0x4ed54d`                   |
| Oil command action35, PissOutOil            | `0x4dde40`, allocator call `0x4dde98` |
| Settled corpse slick allocator forwarding   | `0x4d192e`                            |

`DoConnotations` processes slicks after explosions and before variable changes
and the immediate mission-completion check. Its texturechange suppression flag
does **not** suppress slicks. The outlet tests the primary slick material for
null, passes `car=null`, the effect's target ACT, and that ACT's current model
(`ACT+0x18`) to QueueOilSpill2. It passes neither the smash contact point nor
starting velocity. There is no effect-magnitude, probability, wetness or
visibility gate in the slick outlet. The nearby visibility gate applies to the
preceding explosion outlet only.

Production `ProcessOilSpills` runs once per outer frame at `0x49373c`, after
car graphics/GROOVE/wheel damage and before delayed side effects `0x493752`,
shrapnel update `0x49375d`, final `FlushSmashQueue(0)` at `0x49378b`, and glass
update `0x493790`. Therefore a final-flush slick cannot be placed until the
following outer spill pass. A direct physics-time slick queued earlier can be
placed during the current outer pass. Replay normally omits this outer call;
the function itself also has a replay branch for other callers.

## Parsed fields and native layout

`tSlick_spec` is 48 bytes. `src/world-smash.ts` already retains the correct
structural parser data. Convert it as follows, preserving Float32 scalar stores:

| Browser field      | Native offset           | Meaning                                                |
| ------------------ | ----------------------- | ------------------------------------------------------ |
| `first[0]`         | `+0x00`, signed integer | Delay in milliseconds, truncated from the parsed float |
| `first[1..2]`      | `+0x0c/+0x10`           | Growth minimum/maximum, half-size per millisecond      |
| `second[0]`        | `+0x14`                 | Initial half-size                                      |
| `second[1..2]`     | `+0x04/+0x08`           | Full half-size minimum/maximum                         |
| `firstPair[0..1]`  | `+0x20/+0x24`           | Friction multiplier minimum/maximum                    |
| `secondPair[0..1]` | `+0x18/+0x1c`           | Wheel smear travel-distance minimum/maximum            |
| `material`         | `+0x28`                 | Slick rendering material                               |
| `secondMaterial`   | `+0x2c`                 | Material retained for oily wheel skids                 |

The optional pair/material are read only when `firstPair[1] != 0`. Installed
`0x4ee45c–0x4ee479` proves this condition; rec2 incorrectly describes stale
three-float temporaries at this point. When maximum friction is zero, the
wheel consumer skips that entire record, including its optional smear fields.
Those unavailable optional values need not be invented.

The allocator ABI is `ECX=car|null`, `EDX=ACT`, followed by model, delay,
full-size pair, growth pair, initial half-size, friction pair, smear-distance
pair, slick material, smear material. The connotation outlet forwards all of
these fields directly.

## Pool ownership, replacement and random order

The installed array begins at `0x68f320`, has 32 records with stride `0x54`:

| Offset            | Retained value                                                       |
| ----------------- | -------------------------------------------------------------------- |
| `+0/+4/+8/+c`     | Spill rendering ACT / source ACT / source model / optional car       |
| `+10/+14`         | Spill timestamp / stop timestamp                                     |
| `+18/+1c/+20/+24` | Full half-size / current half-size / initial half-size / growth rate |
| `+28/+34`         | Original owner position / projected floor position, vectors          |
| `+40/+44`         | Wheel smear-distance pair                                            |
| `+48/+4c/+50`     | Wheel friction pair / smear material pointer                         |

QueueOilSpill2 samples `GetTotalTime` twice. With a nonnull car only, it first
scans every record for equal **source ACT**, rejecting if unsigned
`now < uint32(record.spillTime + 5000)`. World slicks and action35 pass a null
car, so repeated invocations from the same ACT are allowed. Allocation scans
increasing slot order and chooses the first source-ACT-null slot. If none is
free, it chooses the earliest spill timestamp strictly below the second sampled
time; strict comparisons retain the first tie, with slot0 the initial choice.
Future delayed timestamps therefore have their native unsigned ordering.

An accepted allocation swaps the preallocated actor's rendering material,
retains source ACT/model/car and authored wheel values, writes
`spillTime=uint32(now+delay)`, and hides the spill actor. It consumes exactly
two CRT draws in this order: full half-size, then growth rate. Both go through
`0x513000`, with `low + rand15/32768 * (high-low)`, and store Float32. Equal
range endpoints still consume their draw. Allocation does not draw yaw, clear
the old actor matrix, clear the old projected position, or reset stop time.
Successful later placement resets stop time to zero.

No fade, lifetime, periodic freeing or actor resource disposal occurs. A spill
persists until overwritten, invalidated during placement, or race-reset. Reset
hides the actors and clears source ACT, car and stop timestamp; it does not
clear every numerical record field. Invalid placement clears source ACT/car.
`GetOilSpillDetails` tests source ACT (`+4`), **not** car (`+c`), at
`0x4a729d–0x4a72be`; consequently world and corpse slicks are visible to the
car broadphase despite null car attribution. This differs from rec2's body.

## Placement and growth

Placement waits for unsigned `now >= spillTime`. A nonnull car must have each
absolute raw velocity component strictly below Float32 `1/(6.9*100)`
(`0x589450`). World/ped null-car spills bypass that velocity gate. Outside
replay, a car with driver>=7, engine<99 and transmission<99 fails placement
before the yaw draw. Thus normal living car damage oil has a separate
eligibility gate which must not be applied to world effects.

The remaining non-replay placement attempt consumes inclusive integer
`IRandomBetween(0,65535)` for yaw before collecting floor faces. It constructs
an ACT-local box:

```
min = (-fullSize, sourceModel.bounds.min.y - double(1/6.9), -fullSize)
max = (+fullSize, sourceModel.bounds.max.y, +fullSize)
```

The box uses the retained source ACT's **live** matrix and FindFacesInBox with
capacity10, flags0. Its origin/ray use that ACT's translation, with
Float32 `.2` added to Y. Direction is normalized `(0,minY-maxY,0)` when its
length is greater than Float32 `2*epsilon = 2.384185791015625e-7`; otherwise it
is `(1,0,0)` (`0x4a6d41–0x4a6dc7`). rec2's positive-Y ray reconstruction is
not the installed direction. The first collected face yielding
`CheckSingleFace` distance `<100` wins; it is not a nearest-of-all-faces search.

The accepted normal must have Y >= Float32 `.97`. The basis before yaw is
`[(normal.y,-normal.x,0), normal, (0,-normal.z,normal.y)]`; native does not
normalize those basis rows independently. The projected point is retained
separately from the actor translation. Every collected face is checked against
the accepted normal: reject if `dot < f32(.98)` and either `dot > f32(.8)` or
the spill actor translation is on the wrong side of that face plane. The
preexisting actor translation is used by this last side test before the final
height-copy phase; replacing it with the projected point is a behavior change.
These details require an ordered, finite ten-face box provider, rather than a
single unrestricted downward ray alone.

On success, spillTime becomes current gameplay time, original position is
copied from car.pos when a car exists or source ACT translation otherwise,
stopTime clears, and the quad is made visible at initial half-size. The final
per-slot height-copy writes the projected position to the spill actor. Replay
SetInitialOilStuff skips yaw/projection and uses retained replay geometry.

Later visible passes compute
`size = initial + int32(uint32(now-spillTime))*growth`, then store current size
and quad vertices as Float32. A size below initial hides the actor; otherwise
it is capped at full half-size. For a nonnull car, displacement squared greater
than Float32 `.2` stamps stopTime and skips that growth pass. A nonzero stop
timestamp with unsigned `now >= stopTime` stops subsequent growth. World
null-car spills have no source-motion stop gate. Stop does not free or hide an
already visible spill.

## Wheel friction and authored smear materials

`MungeCarGraphics` at `0x41ea20–0x41eae2` clears/builds the retained 32-bit car
field `+0x1594`, named `shadow_intersection_flags` by rec2. This is a spill-slot
mask, not a grounded-wheel mask. Eligible visible cars with driver>5 test every
active source-ACT slot. The bound comes from the first/head physics shape,
not the union of attached shapes; it remains in native world units. Radius is
`shape.common.bb.max.z * f32(1/6.9) * f32(1.5)`; strict X/Z rectangle overlap
uses the car ACT translation and spill ACT translation/full half-size. The
installed x87 product remains unrounded for the first X-side comparison,
then a Float32 store supplies the other three comparisons. This
graphics phase runs before ProcessOilSpills, so the next physics phase uses a
retained broadphase mask, not a newly recomputed wheel mask.

The physics consumer at `0x41a514` calls `0x4a72d0`. It first initializes four
output factors to1, then, for driver>5, visits slots0..31 whose retained mask
bit is set and maximum friction is nonzero. Within every eligible slot it
tests wheel indices **2,3,0,1**. Each hit draws friction first, then smear
travel distance, retains the slot's smear material per wheel, and overwrites
that wheel's previous values. Every overlapping slot therefore consumes its
own draws; selecting only a final matching spill before sampling is wrong.

PointInSpill converts metric wheel coordinates with Float32 `1/6.9` and tests:

```
dx*dx < currentSize*currentSize*f32(.8)
dz*dz < currentSize*currentSize*f32(.8)
abs(dy) < f32(.1)
```

The tests are strict, separate X/Z comparisons; neither rotated-quad bounds
nor radial distance is used. There is no visibility/pending/source-owner test
inside PointInSpill or the masked friction loop. A queued reused record can
therefore retain its old actor translation and participate through the prior
mask before placement. Stored friction continues to affect wheels while
remaining smear distance is nonzero, even after leaving the spill. SkidMark
`0x4ea490` uses per-wheel material `+0x16fc`, falling back to OILSMEAR only
when null, and subtracts accepted model-space skid travel from oil_remaining.

## Assets and implementation path

ReadSpillData resolves an already registered BRender material with
BrMaterialFind `0x51e4e0`; missing materials are fatal in the installed reader.
Both materials are added to the temporary material adaptation list, capacity200.
A filename must not silently become the default OIL texture. The browser
adapter should bind the parsed identifier to its loaded material registry and
diagnose unavailable identifiers. Global native oil rendering is a procedural
material backed by `data/PIXELMAP/PIX8/OIL.PIX` or renderer-appropriate PIX16;
`data/MATERIAL/OILSMEAR.MAT` supplies its trail texture. Stock/Advanced mirror
these paths. `GIBSLICK` is a native procedural registered material created by
ReadPedGiblets, backed by `PEDS/GIBLETS/PIX8/GIBSLICK.PIX` (or PIX16), not a
missing GIBSLICK.MAT file. Its authored secondary material is
`MATERIAL/GIBSMEAR.MAT`; PEDSMEAR is a separate sliding-body smear outlet.

An asset-store read-only inventory during this audit consumed51 Stock and73
Advanced race TXT files, yielding662 connotation payloads per data tree and
**zero authored world slicks** in each. The existing WAM inventory likewise
reports no slicks. Both original PEDS/settings.txt files contain GIBSLICK:
delay300ms, growth `.00001.. .00007`, initial `.001`, full `.05.. .15`,
friction `.2..1`, smear distance1..1, GIBSMEAR.MAT. This is an original asset
case for shared-pool/friction/material validation; authored synthetic world
connotations are needed to exercise the absent world payload.

The smallest source-correct integration is:

1. Extend the existing OilRuntime's **same32 slots** with an explicit authored
   spill configuration and source ACT/model-bounds/matrix provider. Keep car
   attribution nullable and independent from source ACT identity. Route world
   slicks from dispatchSmashConnotations immediately after explosions and
   before variables, regardless of texturechange suppression.
2. Run shared spill processing once at the native outer gameplay-clock phase,
   before delayed effects/final flush. Supply the ten-face oriented ACT-local
   box collector and live source ACT translation/model bounds. Do not replace
   source translation with the contact point or source model bounds with a car
   hull/whole scene bounding box.
3. Retain the graphics-produced spill mask and implement slot-major,
   wheel2/3/0/1 friction sampling with shared CRT draws. Expose the retained
   smear material to main's skidmark callback instead of its current hardcoded
   OILSMEAR.MAT. Keep accepted-skid distance consumption intact.
4. Route settled pedestrian blood into the same allocator with its original
   corpse ACT/model provider and existing source eligibility/chance gate;
   do not preserve an independent32 blood-slick capacity. Its ordinary
   PEDSMEAR trail needs the already shared100 skid allocation separately.

The authored allocator and production charged command now draw full size then
growth at allocation, and draw yaw only at a permitted placement attempt.
Charged growth uses the installed literal Float32 values `.00009.. .0003`.
Production spill processing is once after graphics and GROOVE, before delayed
effects/final flush. Slot-major wheel2/3/0/1 sampling consumes each overlapping
slot's friction/smear draws and retains its actual smear material. Standalone
legacy `queueSpill` remains a compatibility adapter; real command35 uses
`queueChargedSpill` and the native authored lifecycle.

`projectNativeOil` consumes a finite ten-face ACT-local box and first-hit
segment. Installed `CheckSingleFace45f1c0` divides the second barycentric
numerator by the **negated** determinant at45f504–45f54c. rec2 misses that sign
and incorrectly rejects ordinary triangle interiors; the browser uses the
installed sign. Numerical checks cover nonnegative plane distances, endpoint
tolerance, finite triangles, source box bounds, capacity and retained spill
position. Graphics retains the native strict X/Z slot mask for the next physics
phase; the wheel consumer does not reinterpret it as a grounded-wheel mask.

Charged oil retains the **master car ACT**, with its graphics-phase matrix,
and separately reads the principal car ACT's live MODEL bounds
(`4dde57–4dde96`). Rebuilding the source matrix from the current physics state
or using the principal child's translation would shift placement relative to
the visible car.

Source MODEL bounds now retain unused original vertices and observe live
deformation of face-backed vertices. Crush itself does not yet mutate unused
MODEL vertices. The source MODEL pointer remains captured when queued.

Production Chromium verifies normal action35 grants and F/W driving in both
Stock and Advanced, with visible original OIL.PIX and reduced wheel grip. An
explicit synthetic connotation attached to an original retained NONCARS ACT
passes normal destruction dispatch, native placement and growth with the
original PETPUMP material. Installed world/WAM configurations contain no authored
slicks. A retained original tank-pump ACT fails the native placement gate;
the test preserves that rejection rather than altering its pose or projector.
The report/screenshots are ignored artifacts from `npm run test:world-slicks`.

Remaining providers are original ACT-local identity after static world batching,
exact packed model/column ordering for the finite ten-face collection, complete
unused-vertex crush, and original hierarchical corpse
ACT/model ownership. Corpse blood still has its separate legacy pool. These
remain explicit compatibility gaps.
