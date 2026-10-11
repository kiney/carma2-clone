# C2 pedestrian quieting and retained water-plane state

## Evidence and ownership

Verified against installed HW SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
The small instruction ranges in `/tmp/c2-hw-current-disassembly.asm` establish
the behavior below. rec2 `common/spark.c` identifies the replay splash pool;
its global addresses differ from this installed image. No reference code or
original asset data is copied into the implementation.

Accepted dead halt `4d185e–4d188b` changes the current animation rate through
`SetCharacterMoveAR4d1a20(-1, rate, 0, 0, now)`: rate is zero for zero mutant
speed and negative mutant speed otherwise. It does not select a different BON.
The ordinary corpse slick chance and effects precede the accepted masks/pose
tail at `4d1933–4d19c8`. `ChangedObjectsCallbacks4b6980` then changes the existing
PHIL header from active2 to passive1 after callback return1. This is quieting,
not body/header/ACT destruction or resource-pool release.

The accepted tail calls `4fec00`. It compares Object+250 with Float32 `10000`
(bits `461c4000`) and returns immediately when already equal. Otherwise it
stores that sentinel. It does **not** clear selected volume+258, automatic
candidate+25c, immersion depth+254 or plane normal+244. The browser's retained
`BodyVolumeState` object and those fields must therefore survive acceptance.
`resetNativePedWaterPlane` changes only its `waterDistance`; an absent browser
cache already denotes the default sentinel and is not allocated by this reset.
Both the gameplay `clear-volume` event and final `acceptNativePedHalt` use this
narrow helper. The historical event/provider name is retained for compatibility.

The optional `4fec23–4fecba` tail is **replay recording**, not sound or smoke
removal. Property6 nonzero selects Object identity; zero selects a type1 ACT or
type2–4 owner when present. It scans the ten active replay-splash records
(installed pool `6a8a18`, stride `30`, mask `6a8c04`). A matching identity emits
pipe chunk `3b` through `4c6f10`, which writes water distance, normal and bounds
to the pipe. No new runtime sound/smoke provider is required. Replay pipe
ownership remains outside this ordinary nonreplay adapter.

Borrowed pedestrian ground faces are released separately by positive move
completion `CBMoveCompleted4cbf90–4cbfaf` and process-cache ownership/eviction.
The accepted dead-halt tail has no cache+ b0 owner clear. Quieting therefore
must not release the ground cache merely because a corpse became passive.

## Integration and remaining seam

`NativePedGameplayOptions.preflightRecoveryEffects(ctx,state,input,decision)`
runs after the pure halt decision and before any mutation or CRT draw. It
returns actual missing provider diagnostics; rejection leaves masks, animation
rate, water-plane state and the RNG untouched. Actual owner effects still run
through `onRecoveryEffect` in installed order.

Outer Munge chronology also has a separate passive Stillify check after
animation (`4d4bbd–4d4bc9`). With active bit4 clear and an allocated simple slot,
it first copies character world V into Object+68. For signed HP<=0, action6 and
move !=113, it adjusts rate when mutant speed is nonzero with animation-period
WORD zero, or mutant speed is zero with period WORD nonzero (`4d4c0f–4d4c90`).
Character+1e is the signed16 animation period; the collision impact serial is a
different field. These outer passive synchronization/Stillify operations are
distinct from accepted halt. The subsequent independent implementation is
documented in [the passive Stillify evidence](c2-ped-passive-stillify-re.md).
