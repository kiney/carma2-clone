# PED-06 ordinary object scan

## Evidence and scope

`src/ped-ordinary-object-scan.ts` independently implements the installed
`PedScanForObjects` core. rec2 `common/pedestrn.c` identifies its function but
still supplies a stub (`004cef80` in its target revision). Installed HW starts
at `004ced30`; SW starts at `004cac50`. Their executable instruction structure
agrees through the scanner's final return, before its embedded jump table.
The following addresses are HW. Original executables were read only; their
hashes/PE metadata are retained in the existing subsystem evidence. No reference
implementation or proprietary fixture was copied.

| Range              | Verified behavior                                                          |
| ------------------ | -------------------------------------------------------------------------- |
| `4ced3b..4ced79`   | Require process, clear object flag4, `srand(pedPointer)`, sample lookahead |
| `4ced7d`, `4cf0d7` | Actual PHIL head/next traversal                                            |
| `4ced84..4cee0e`   | Player override bit08000000 and strict5-unit cube                          |
| `4cee1d..4cee44`   | Skip owned source types2..5                                                |
| `4ceeb5..4cef53`   | Suicidal full3D nearest candidate, electric check before nearest store     |
| `4cef58..4cf0cd`   | Normal XZ line corridor, electric check, closest-time gate                 |
| `4cf0eb`, `4cf218` | Electric4cde00 continuation; skip ordinary reseed                          |
| `4cf261..4cf299`   | Time-XOR-pointer reseed and no-candidate branch                            |
| `4cf29f..4cf33a`   | Blind/valium, wall shielding and suicidal direction/rescan                 |
| `4cf342..4cf44d`   | Cache objectV/position/normalized-away stores and unused rotation draw     |
| `4cf453..4cf589`   | Full velocity-squared gate and initial fear                                |
| `4cf597..4cf730`   | Repeated fear, head before move/direction, selected vocal group            |
| `4cf730..4cf7bf`   | Initial-fear fallback for nonreaction action; threat timestamp             |

The function ends at `4cf7bf`. `4cf7c0..4cf7db` is its switch table;
`4cf7e0..4cf853` is a separate MODEL/AR helper, not more scanner geometry.
The type10h call at `4cf25c` targets `452bb0`, an installed immediate `RET`.
It consumes no RNG and mutates no state in this installation.

## Real record and object owners

The CRT seed is the **pedestrian-array record pointer**, not its character
pointer, ACT, browser object identity, source personality number or a population
index. rec2's `tPedestrian` size54h and installed `FinishUpLoadingPeds`
`4d331f..4d3365` agree: allocate `count*84` bytes with `BrMemAllocate526c00`,
categoryc1h; copy existing records; free the initial array; repair each
character's backpointer. Loading initially allocates2000 records.

| Record offset | Field                                              |
| ------------- | -------------------------------------------------- |
| `00`          | Character pointer                                  |
| `04`          | Signed HP byte                                     |
| `08`          | Pedestrian flags WORD                              |
| `0c`          | Process pointer                                    |
| `10`          | Signed action enum                                 |
| `14`, `18`    | Movement/exclusion pointers                        |
| `1c..24`      | Stored pedestrian position, threeFloat32           |
| `28`          | Last qualifying fear/threat timestamp              |
| `2c`          | Initial-fear epoch, retained by repeated reactions |
| `4c`          | Speed factorFloat32                                |
| `50`          | In-sight next pointer                              |

The module receives the actual live address and84-byte record view separately
from actual object/process providers. It never synthesizes pointer fields from
names or IDs. Host linear-memory allocation can supply a real owned record
address with an explicitly documented allocator policy; it does not reproduce
Windows heap addresses or guarantee the same random choices as a historical
Windows run. BrMem categoryc1h is not evidence for a BrRes classc1h descriptor.

`PHILGetFirstObject4b5d70` reads list head748790 when enabled; next4b5d90
reads Object+220. `NativePhilRegistry.registeredBodies` already traverses that
same host head/next order. Pass that roster, including supported props, cars,
parts and other PHIL objects. Concatenating the cars/noncars arrays changes
selection order and omits admitted objects. Owned types2..5 are skipped;
unowned types are not excluded by that test. This scanner does **not** exclude
car drivers2..5. The older pedestrian note's blanket driver exclusion does not
match these installed instructions. Driver>5 gates the electric effect only.

Object inputs use current actor translation (actor+50), Object+68 worldV,
Object+140 radius-squared, actual type/owner and actual driver/ray range.
Neither an extrapolated center nor a fixed radius replaces these fields.
Missing electric driver/range ownership is reported, rather than guessed.

## Geometry and CRT chronology

With an actual process, clear only cache+18 bit4, then seed the shared CRT with
the pedestrian pointer. Draw once through `SRandomBetween(.8f,1.2f)` and store
Float32 of seven times the result. All candidates require strict absolute XYZ
separation below5. Owned types2..5 are rejected before this cube.

Normal scanning uses relative XZ velocity `v=objectV-characterV`, offset
`d=objectACT-ped.pos`, and line distance
`q=(vz*dx-vx*dz)^2/(vx^2+vz^2)`, storedFloat32. Exactly zero planar relative
velocity uses `q=dx²+dz²` for the electric test. An ordinary candidate requires
`q<2*radiusSquared` and `0<=-(vx*dx+vz*dz)/(vx²+vz²)<lookahead`.
The **first** qualifying PHIL object wins; normal selection is not nearest.
Zero relative velocity cannot pass its ordinary closest-time condition.

Suicidal mode instead selects the strict nearest fullXYZ squared distance
inside the cube; ties retain the preceding object. Electric eligibility is
checked before recording a suicidal nearest candidate. Nonimmortal, owned
type1 objects with driver>5 invoke the actual4cde00 effect if `q` is strictly
below the authored car ray range. No LOS ray is inserted.

Normal found/no-found outcomes reseed with `uint32(now XOR pedPointer)` before
later callbacks/draws. Electric early exits retain entry seed/draw and any
actual effect draws, then can run the source calm gate; they do not reseed.
A player inside the cube with75a41c bit08000000 selects that player atq0
before PHIL traversal and likewise skips the second seed. The override also
bypasses blind/valium rejection and that selected player's speed gate.

After selection, blind or nonzero valium rejects ordinary threats unless the
override bit is set. Existing wall flag2 shields a threat unless
`q/cache[bc]<.25`, strictly. No-threat/rejection can select calm only when alive,
actionRUN1, cache+18 exactly0, at least10000ms after ped+28, no removed bones,
and signed cache+98<=0. Its inclusive authored movement-spec period draw
precedes move30/action0/completion1, then calm head65d054.

## Canonical300-byte process and reactions

A surviving threat sets cache+18 bit4. Suicidal behavior then sets direction
toward the **un-normalized** object-minus-ped displacement, distance0, and
rescans proximity; it returns without ordinary contact-vector/fear stores.

Normal behavior stores ObjectV at+30/+34/+38 and current actor position
at+3c/+40/+44. Normalize `ped.pos-objectPos` with the installed epsilon
`2^-22` and +X coincident fallback. The code draws an inclusive integer
`[-2aa8h,+2aa8h]` and builds a Y-axis rotation matrix, but never applies that
matrix to this vector. HW and SW both store the original normalized vector
at+a4/+a8/+ac. Retain the draw without inventing a randomized direction.

The full object velocity squared must exceed1 before ordinary fear. A slow
object still commits the preceding cache fields and rotation draw, then
returns without updating pedestrian timestamps.

Walking action0 faces `-away` through the actual direction setter and rescans.
If the resulting action is outsideRUN1/PANIC2/GETUP4, it draws the initial
`[2,2,2,2,2,2,3,4]` table, sets that move with period-1/completion1/action2,
plays noise group6 and starts **finite** head65d048. Then it stores both
ped+28 and ped+2c to now.

Other actions run repeated fear once `uint32(now-ped[2c])>=10000` and signed
cache+98<=0. If alive, start infinite scare65d050 **before** the move draw.
The repeated table is `[2,2,2,10,11,13,-41,-41,-41]`; negative selectsRUN1,
nonnegative selectsPANIC2. Face/rescan unless selected move is13/40/41.
Then select the actual move with period-1/completion1. Move2 plays group6;
10/11 group8;13 group10 with its force argument1. Other selections do not
play an extra noise. If the resulting action is outside1/2/4, execute the
initial-fear fallback. Finally update ped+28 only; the original epoch+2c stays.

Three head tables exist in this installation:

- `65d048`: finite count4, poses1/2/1/99, used by initial object fear.
- `65d050`: count3, poses1/2/1, used by repeated fear and other scare callers.
- `65d054`: finite count2, poses0/99, used by calm.

The head module, process pointer accessor and gameplay mapping now recognize
65d048 without changing the existing infinite scare table. MODEL/AR callbacks
remain actual host outlets. Scanner head stores precede its first-model call;
noise and animation callbacks can consume their own shared CRT draws.

## Integration and validation

Call `scanNativeOrdinaryPedObjects` at the existing ordinary steering boundary,
after smooth-turn/rescan or wander and before conditional avoidance. Pass the
current canonical process and84-byte pedestrian view. Its callbacks must
synchronize actual HP/action changes into that same record before returning,
so source continuation gates read current state. Direction/rescan must use
the same live floor/process owner. The module does not supply grounding,
solver activation, electric death effects, guessed move assets or a second
movement integrator. Missing required continuations return explicit diagnostics
after retaining already ordered source stores/draws; no transactional rollback
is claimed.

`tests/ped-ordinary-object-scan.test.mjs` covers first PHIL candidate versus
suicidal nearest, owned-type skipping and actual driver distinction, strict
cube/corridor/time/velocity/wall gates, canonical vectors/timestamp order,
all reseed paths, electric early return, player override, reversed authored
period bounds, repeated/initial fear, missing providers and finite-head expiry.
The numerical fixtures use invented geometry and actual owned host allocation
addresses. JavaScript arithmetic/Math.hypot replaces x87 intermediate precision;
all-angle or boundary bitwise x87 parity is not claimed. Production/browser
coverage depends on the root adapter and is not established by these tests.
