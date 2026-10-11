# C2 connotation ghost and noncar debris

Evidence: read-only installed `carma2_HW.exe`, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`,
PE32 image base `0x400000`, entry `0x577eb0`. Rec2 is a symbol/structure map;
its runtime shrapnel and pull functions are incomplete. No reference code or
original asset payload is reproduced here. Installed addresses below take
precedence over shifted addresses in rec2 comments.

## Resources and template identity

`ReadShrapnelSpec` resolves ACT files relative to the current race directory,
processes their materials, selects named noncar actors recursively, and registers
their authored mechanics filenames. Recursive lookup includes the root and
compares identifiers case-sensitively. It rewrites selected template identifiers
using `&%c%c!bbbb.ACT` (`0x65ebd8`), with the first two mechanics filename bytes.
Keep the original name separately if runtime lookup occurs after this rewrite.

Read-only installed asset-index checks found these dependencies:

| Race ACT basename              | NONCARS mechanics basename | Free/attached mass | Shape               |
| ------------------------------ | -------------------------- | ------------------ | ------------------- |
| Carrier `&50gun01_DEBRIS1.act` | `50gun01_DEBRIS1.txt`      | 21.239775          | 8-point polyhedron  |
| Carrier `&51gun01_DEBRIS2.act` | `51gun01_DEBRIS2.txt`      | 8.295681           | 8-point polyhedron  |
| Carrier `&52TGUN_DEBRIS1.act`  | `52TGUN_DEBRIS1.txt`       | 7.638896           | 8-point polyhedron  |
| Carrier `&53TGUN_DEBRIS2.act`  | `53TGUN_DEBRIS2.txt`       | 15.882541          | 8-point polyhedron  |
| City `&petpump.act`            | `99petpump.txt`            | 0.166343           | 12-point polyhedron |

Each ACT has a sibling DAT and MAT. The DAT model identifiers end in `.ACT`,
not `.DAT`; resolve the actual model identifier. Carrier templates occur in
Carrier1/2/mission/NET and corresponding Advanced races. Pump templates occur
in newcity and timber variants. `petpump.txt` is a different prop definition;
the connotation explicitly uses `99petpump.txt`. Replacement `petpump_smsh.act`
and its `petpump_broke` model are separate from launched `&petpump.act`.

All five selected actors are single model roots with identity bases. Carrier
template translations are nonzero; preserve them before composing the smash
frame. All five mechanics have zero snap angle, no world joint or SPARKY flag,
and their own `M14.MAT` shrapnel palette. The pump COM is `(0, .175, 0)`.
Do not inherit the impacting car's palette or collision shape.

Current `content.ts` preloads sibling DAT/MAT resources but instantiates only
the requested main ACT. A scene `getObjectByName` therefore cannot replace
explicit loading of missing debris ACTs. Build them against the existing model
and material maps, retaining the original ACT/model identifiers and transforms.

For nonpositive ghost actor counts, the reader loads one container and selects
its **direct children**, not all descendants. Native ACT child insertion
(`BrActorAdd 0x51d620`, list-head insertion `0x529090`) reverses successive
ACT child chunks. `BrActorEnum 0x51d510` walks that linked-list order. Current
`parseAct` appends child chunks; native container template order is consequently
the reverse of its `children` array. Named noncar template order remains the
authored selection order.

## Dispatch, placement and common movement

`DoConnotations` invokes `DoShrapnel 0x4eb660` at `0x4ed376`, after the powerup
outlet and before authored awards. Texture-change suppression does not suppress
this shrapnel outlet. The installed branch table dispatches ghosts at
`0x4eb7ba` and noncars at `0x4eba86`.

Negative minimum amount emits each template once in order; the maximum is
ignored. Otherwise draw the count inclusively, then draw each template index
inclusively from `0..count-1`. The audited Stock/Advanced ghost and noncar records
all use actor-based placement; their negative amounts select ordered templates.

Actor-based `0x4eb238–0x4eb297` copies the chosen template's full matrix, then
postmultiplies the captured matrix when supplied, otherwise the source actor's
matrix. Its size factor is 1 and it consumes no placement RNG. Do not replace
this with random placement around the contact or lose the template translation.
Box/sphere placement has separate equations/RNG and is not implied by this path.

Both branches call `ApplyInitialMovement 0x4eaef0` with the **zero normal** at
`0x6aa088`, captured metric starting velocity, and source-point/piece-position
endpoints for authored towards speed. The zero normal still enters the native
normalization fallback and consumes its three draws. The verified independent
kernel is `src/shrapnel-movement.ts`: 13 unconditional draws and three additional
towards draws only when both pointers and both speed bounds are nonzero.
Do not pass the contact normal or multiply starting velocity by 6.9 twice.

## Ghost pool, visibility, lifetime and RNG

Ghosts and glass shards share 200 records at `0x6b5a80`, stride `0x38`.
`GetNextShrapnel 0x4eade0` scans upward from slot 0. It takes the first record
with expiry `+8 == 0`; when full it retains the first strictly lowest priority
and replaces only if that priority is strictly below the requested priority.
Ghost priority is 4, shards 3. No cursor or equal-priority replacement exists.
The selected model is assigned to the slot actor; ghost production does not
clone an entire template hierarchy or assign the attacker's palette.

The ghost branch tests source visibility through `0x4e5aa0` before count/RNG
unless replay is active. The noncar branch has no equivalent visibility gate.
Ghost container bounds can scale a captured face basis; either source face edge
shorter than double `.001` aborts the ghost branch **only when both container
X and Y dimensions are nonzero**. This requires retained face vertices, not
only a center and normal.

Ghost RNG saves a **rand output**, then seeds the shared CRT from the retained
event seed (`0x4eb7f4–0x4eb804`). Each piece has maximum expiry, start time,
last movement time, and an independently drawn inclusive visible lifetime.
Normal completion/pool exhaustion reseeds with the saved rand output at
`0x4eba74–0x4eba79`; the tiny-face abort bypasses that restoration. This is
neither saving the full PRNG state nor using an isolated stream.

`0x4efed0` visits records upward. Its first invocation with no previous time
only initializes the previous timestamp. An expired group dispatches its callback
then scans all 200 upward, removes every live actor of that group, and clears
their expiry. Force-cleanup and replay timing have additional gates; ordinary
expiry must retain unsigned comparison and grouped release rather than deleting
only the triggering slot.

## Noncar pull, body capacity and wake

Each attempt draws its seed **before** checking render ACT capacity at
`0x4ebae4–0x4ebafc`. Capacity is the compacted original world ACT count plus
250 (`0x40ce30–0x40ced2`), separate from the shrapnel pool and physics capacity.
Clone `0x5154e0` copies type/type-data, borrows model/material pointers, duplicates
identifier, copies the full transform and recursively clones children. Clone
names preserve the first four bytes and format `%04d.ACT` at identifier+4
(`0x4ebb76–0x4ebb9b`), using the global ACT index before increment. Four digits
are a minimum width, not truncation.

`DoPullActorFromWorld 0x41ff40` rejects nonnull actor type-data. The two index
digits address the loaded mechanics map. It first uses that type's dedicated
body; if already driver 4, it takes the first driver-0 body among **40 extra
slots**. A saturated type thus does not have a private 40-slot pool. Extra reuse
copies `0x4d8` physics bytes and `0x104` noncar bytes while retaining the extra
slot's allocated physics pointer. Shape/material pointers are shared resources.
Missing mechanics or capacity failure marks the actor's index byte `x` and
returns null; the caller removes/frees the new clone and decrements ACT count.

Pull reparents to the universe, binds type-data and actor, registers active
physics lists, captures the actor frame, and clears velocity/spin/auxiliary
velocity. Since the loader's template name has `!` at byte 3, connotation clones
take the **free** branch: no break joint/callback, free mass, movable flag,
inertia = authored per-mass inertia times free mass. Final setup calls
`0x4ff2c0`, restores the matrix and calls `0x4b6080` before returning.

Only then does the caller draw its saved movement rand, compute movement,
write Float32 raw velocity = metric velocity / double 6.9 and body omega = spin
times double 2π (`0x4ebc3a–0x4ebc98`), and wake physics byte `+0xec = 0` at
`0x4ebc9e`. Current `releaseNonCar` and `finalizeNonCarRelease` both clear
velocity; they must not run after launch. Finish creation/setup first, initialize
the already-free body without the snap-release path, then write launch fields.

## Fire draws and prepared geometry

After launch, seed shared CRT with the attempt seed (`0x4ebca5`). Chance 0
consumes no draw; any nonzero chance consumes a 15-bit draw and tests
`floor(100 * rand15 / 32768) < chance`, including chance 100. On success, each
authored column draws a vertex **inclusively** from `0..firstGroup.nvertices`,
then draws smokiness inclusively. `CreateSmokeColumn2 0x4fb3c0` receives mode 2,
clone actor, pulled noncar owner, zero alternate physics pointer, colour,
vertex index, and lifetime **10,000,000 ms**. Production has no water/gravity
gate here; the constructor has the smoke-quality enable gate. Finally reseed
with the saved movement rand (`0x4ebda2`), not the old complete RNG state.

Mode 2 sampling `0x4fbf46–0x4fbfac` reads XYZ from
`actor.model.prepared.groups[0].vertices + 32*index`. It then applies the full
live clone matrix and subtracts Float32 `.03` from world Y
(`0x4fc039–0x4fc066`). Use a contiguous prepared-vertex provider; deduplicating
the first render group by raw vertex ID changes both count and RNG range.
The inclusive endpoint may reference the next contiguous group, or invalid
native memory when it is the final group; bounds-safe failure is an explicit
deviation, not evidence for clamping to the previous vertex.

Installed preparation selects DONT_WELD comparator `0x520030` when model flags
bit 1 is set, otherwise welding comparator `0x51ff20`. Welding sorts resolved
material pointer, XYZ/UV when source IDs differ, then unnormalized normal sums.
Original gun50/gun53 flags are 0; gun51/gun52/pump flags are 21. The car-only
DONT_WELD provider is consequently insufficient for gun50/gun53. Gun53 has
one NULL-material face and pump four, making their first material group known
(NULL). Gun50/51/52 have no NULL faces; positive material pointer order remains
unrecoverable from DAT ordinal, MAT filename or browser allocation order.

## Integration boundary and remaining gaps

Preload authored ACT/mechanics dependencies before gameplay; retain ACT source
order and immutable model/material resources. Resolve templates by their original
names, rewrite only cloned native identifiers, compose the captured smash frame,
reserve ACT/body capacity, complete free-body setup, then assign launch V/omega
and wake. Bind mode-2 fire to the same live actor/body and its prepared sampler.
Keep shared CRT seed/draw/reseed order outside the common movement kernel.

Exact positive material pointer ordering, generic welding preparation, unsafe
one-past-final-group reads, noncar reclaim timing, and unsupported box/sphere
placement remain separate fidelity gaps. A generic 30-fragment lifetime or an
immediate radial blast does not substitute for these original rigid bodies.

## Captured texture/decal quad and independent frame kernel

`src/ghost-frame.ts` independently implements the source-backed capture/frame
equations; `tests/ghost-frame.test.mjs` checks model-coordinate retention,
bent pairs, nearest-UV selection/extrapolation, strict thresholds, shear and
seed conversion. It consumes no RNG and never composes an actor matrix.

Capture the original contact triangle and its longest-edge partner **before**
UV clipping, material-tier commit or authored UV flip/rotation. Inputs contain
the original model positions and UVs after the source material mapping matrix.
`0x4f3460` chooses the triangle by squared UV distance to its unique vertex;
equal distances choose the first triangle. It does not test whether the requested
UV is inside either triangle. Lift the four final rectangle corners in order
`(u0,v0), (u1,v0), (u0,v1), (u1,v1)`; extrapolation is intentional.

Both triangle mappings share the **first original model-face plane**.
`0x4f1f9d–0x4f201e` copies that face equation to context normal `+0xc` and
constant `+0x18`; `0x4f3594–0x4f35b3` reconstructs the omitted XYZ coordinate
from this common plane after solving the other two. A bent pair therefore does
not independently retain all three coordinates of the second triangle. The
dominant-axis choice instead uses the separately captured face-list normal:
omit X only when `abs(nx)` strictly exceeds both others, otherwise omit Y only
when `abs(ny)` strictly exceeds both, otherwise omit Z. Ties select Z.

The raw and prepared branches read model vertices (`0x4f1892–0x4f18cf` and
`0x4f1b7f` onward). The lift and `0x4f26ed–0x4f272c` copy four **model-space**
XYZs directly to `0x6b5a40`, without an ACT transformation. Queue capture at
`0x4ee149–0x4ee163` retains these twelve floats and flush restores them at
`0x4ecd5f–0x4ecd6e`. The normal is a separate face-list field `+0x34`;
`ModelPickBox` (installed `0x460490`, shifted rec2 symbol `0x45ff90`) applies
the direct actor upper 3-by-3 vector transform, rather than inverse transpose.
The helper accepts this normal explicitly and does not replace it with a cross
product of transformed points.

Native baked static-world models make that mixed provider convention usable.
Browser static batching generally bakes geometry into an identity scene frame,
but an arbitrary original nonidentity ACT remains an adapter fidelity gap.
Do not silently apply `matrixWorld` to captured XYZs. If the captured normal
chooses a zero denominator in the original model plane, the bounds-safe helper
fails explicitly instead of manufacturing an alternate coordinate convention.
The helper derives the primary plane from the supplied model triangle; it does
not reproduce every prepared-plane coefficient or live x87 rounding bit.

Frame construction at `0x4ebec3–0x4ec0c1` independently normalizes
`P1-P0`, `P2-P0` and the captured normal. Each length must be strictly greater
than Float32 `2^-22`; otherwise that axis becomes positive X. Keep all nine
basis values: the axes need not be orthogonal. The translation is **P1**, not
P0, the quad center or the contact point. Actor-based placement uses this
optional matrix directly (`0x4eb243–0x4eb255`), without composing the source
ACT frame a second time.

For a supplied container with both `dx != 0` and `dy != 0`, scaling is
`X = storedLength(P1-P0)/dx`, `Y = storedLength(P2-P0)/dy`, `Z = 1`.
`0x4eb88a–0x4eb8dc` spills some squared-length components; the first `.001`
comparison uses a live length, the second reloads its Float32 store. Both
comparisons are strict against the double constant. The kernel retains those
Float32 stores and spills, while JavaScript double intermediates are not a claim
of complete x87 equivalence. If either size is zero, neither scaling nor this
tiny-face test occurs. A null quad alone selects the fallback matrix. A tiny
captured quad returns its explicit abort flag, never the fallback frame.

The caller must process this abort at its native point: after the branch's saved
rand, event reseed and count selection. The abort bypasses reseeding with the
saved rand, while ordinary completion and pool exhaustion restore it.

## Event seed, group identity and movement clock

Direct `SmashEnvironment` (`0x4f0ef6–0x4f0f56`) and `SmashObject`
(`0x4f4c49–0x4f4c69`) truncate the three **effect-force** components with
`__ftol 0x575190` and XOR their low DWORDs. They do not use contact position.
Inputs are Float32; conversion truncates to signed 64-bit, including values
outside signed 32-bit. The invalid signed-64 FISTP result has zero low DWORD.
`nativeDirectSmashSeed` retains that behavior for finite providers and rejects
nonfinite inputs explicitly.

The WAM/shared-queue seed is the original authored spec pointer XOR the sampled
`GetTotalTime` at `0x4ecdf8–0x4ecdfa`. That heap pointer cannot be recovered from
a browser object identity. A stable scene identity is an explicitly different
seed provider, not a proven equivalent. The shrapnel group identifier is a
separate global at `0x6a692c`; it is not this pointer/time XOR.

`GetTotalTime 0x514610` is a game clock: replay uses `0x79c474`, ordinary
offline uses `0x79c470 + 0x74b584 - 0x6aa094`, and network uses the first two
terms. It is distinct from the PD performance/wall clock. Updater `0x4efed0`
holds its previous time globally (`0x6a6650`); its zero sentinel skips the whole
initial pass. Subsequent dt is stored Float32 milliseconds times stored `.001`.
Each newly created fragment also suppresses one eligible movement-and-spin
pass with `+0x34`; a zero-dt pass still clears that flag. The common dt is not
derived separately from each fragment's birth time.

`0x4efcb0` advances position by `(Vx*dt, Vy*dt-4.9*g*dt^2, Vz*dt)/6.9`
and stores `Vy -= 9.8*g*dt`; no drag or collision is present here. Spin rotates
only when `abs(length(omega)*dt) >= double .0001`. The signed angle is truncated
after multiplying by the literal double `10430.378350470453`, then only its
low 16 bits enter the rotation constructor. Replacing that literal with a
reassociated `65536/(2*pi)` expression can alter conversion boundaries.

Native postrotation `0x5333c0` is a row-matrix postmultiply, corresponding to
Three.js **premultiplication** of the 3-by-3 basis. Translation is temporarily
zeroed and restored. Retain scale/shear; quaternion decomposition discards native
state. The movement timestamp `+0x14` is rewritten after each valid visit; it
does not determine dt. Expiry/group callback processing remains upward slot
order, allowing an earlier valid slot to advance before a later sibling expires
and removes their group. Group callbacks are replay/session serialization
(`0x4c8620`, `0x4c8a90`, `0x4c8af0`), not gameplay followup-smash execution.
