# PED-09 native blood fragment consumers

`ped-giblet-source.ts` and the native methods in `PedBloodRuntime` independently
implement the fragment consumers for source impact/scrape giblets and stump
spurts. They use the existing `ShardRuntime` 200-record pool. The legacy `hit`
method remains available for compatibility and does not implement this native
phase or its shared allocation/RNG ownership.

## Evidence

The source audit verified installed HW SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`, PE32
base400000, entry577eb0. rec2 `common/pedestrn.c` provides the reader/layout map;
no reference implementation was copied. Relevant installed paths include:

- Impact model lookup `4cb0bf`, scaling `4cb108`; spurt lookup `4cb32e`,
  scaling `4cb35d`; component-wise `ScaleModel4042f0`.
- Sphere placement `4eb339` and its first random rotation `4eb410`.
- Initialization/lifetime `4eae90`, existing initial movement `4eaef0`, and
  shared native allocation `GetNextShrapnel4eade0`.
- Cloud allocation `4eaa70` uses the actual ROOT ACT, local personality bounds,
  and Object+14 local centre of mass. World-transforming the bounds first would
  apply the actor transform twice and is incorrect.

These are verified instruction/data interpretations. New numerical tests are
source-equation/RNG integration tests, not new original-function execution
captures or exhaustive x87 emulation claims.

## Settings and MODEL preparation

The reader now retains impact scrape-start index, placement, all speed fields,
size flags, indexed/RGB colours, lifetimes, and every spurt field: lumps per
emission, signed period, stump count, placement, speed, life and MODEL.
Both original Stock and Advanced use sphere-clumped impact-centred placement.
Other parsed placement forms remain explicit native-provider requirements.

Native preparation follows MODEL identity and reader order. Original `chunk05`
is referenced first by impact size4 with scale1.4\*3/4, then by the spurt model
with scale1.4. Both references mutate the same MODEL: each current vertex
component is multiplied and stored Float32 at each reader call. The resulting
MODEL is approximately1.47 times the original for both producers. Multiplying
one actor scale by a combined factor would miss the intermediate stores.
The consumer keeps this derived geometry separate from legacy geometry and
retains the later aliased material colour/index. No original asset is modified.

The optional final `PedBloodRuntime.create(..., surfaceAt, dataRoot)` argument
prefers the selected Stock/Advanced GIBLETS PIX/DAT directory, with actual Stock
shared files as fallback. Existing callers default to Stock.

## Source ordering and shared fragments

Impact and spurt factories capture one shared CRT rand output, seed with the
source packet seed, emit, and finally call srand with the captured **output**.
They do not restore the former internal CRT state. This also occurs with zero
pieces or a start-size index beyond the table. Impact MODEL choice happens
before reservation, including a single-model size. A full pool skips the rest
of that size but still visits subsequent sizes. Spurt allocation failure ends
the entire batch without MODEL-choice or placement draws.

After real admission, each piece consumes ten placement draws: six for the
source rotation basis, three for offset direction, one for radius. Source
rotation degeneracy uses its identity fallback. Offset-direction degeneracy is
explicitly rejected instead of supplying a guessed direction. The existing
`nativeShrapnelMovement` consumes thirteen base draws, including zero ranges;
impact passes the actual source zero normal and spurt passes its transformed
look direction. Packets already contain metric velocity; consumers never
multiply it by6.9 again. One lifetime draw follows movement.

Impact priority2 and spurt priority1 compete with existing WAM shards and
priority4 ghosts in the same 200 records. Placement/movement RNG runs only
inside an admitted shared-fragment producer. Each factory packet shares one
expiry group and authored maximum expiry; individual source random durations
control visibility. Existing shared gravity, spin, first-update and clock
semantics remain the rendering owner. Blood reset/disposal clears only its
fragments before disposing borrowed native geometry/materials.

## Public ownership boundary

`nativeHit(packet, shards)` receives source point, metric velocity, force,
start-size, seed, clock, explicit gore, actual native12 ROOT ACT, local bounds
and local COM. `readBodyPose` may retain that ACT identity for live cloud
positioning. The impact point controls chunks; cloud offsets are sampled from
local bounds, add local COM/spec offset, and use the live ACT transform.
Cloud draws precede the factory's captured rand. DoGiblets gates the whole
operation on gore>0; both gore1 and2 emit its configured chunks/clouds.
`nativeSpurt(packet, shards)` receives source point/look/metric velocity,
clock/seed and explicit gore. Its source caller owns the gore gate.

`nativeRequirements(packet, shards)` runs the same complete preflight before
MakeEmBleed changes timers/stump counters/RNG. It may prepare private MODEL
clones, but changes no source geometry, cloud, fragment pool, counters or CRT.
Actual methods repeat these checks. Missing MODEL/PIX, source pose/bounds/COM,
settings or shared runtime remain named diagnostics. No render bounding box,
world-Y floor, name-derived pointer seed or private native fragment pool is
substituted. Root integration owns source packet construction and actual
WebAssembly record-address seeds.

`nativeStats` exposes created/impact/spurt/full-pool counters and live owned
fragments. Legacy blood statistics retain their shape; their giblet count
includes live native fragments. Shared shard `stats`/`snapshot()` expose real
pool occupancy and priority/order evidence.

## Validation

Focused tests cover numerical basis/offset and metric movement, full-pool RNG
short circuits, captured-output restore, source maximum/visibility lifetime,
shared priority contention and owner-only reset, preflight atomicity/resource
failure cleanup, and local-COM/live-ACT cloud ordering. Read-only Stock/Advanced
tests verify all parsed spurt fields, selected-tree loading and actual MODEL
component scaling; they skip without the installation. Existing blood and
shared-shard regressions remain applicable. Production contact/bleeding browser
validation belongs to the root integration and its dedicated harness.
