# Pickup ACT hits and the shared powerup queue

Verified by read-only inspection of installed HW executable SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`,
PE32 image base `0x400000`, entry `0x577eb0`. rec2 supplies names; installed
instructions determine the addresses below. Independent implementation, with
no copied reference code or proprietary fixtures.

`SmashEnvironment` at `0x4f0ec0` recognizes an ACT identifier whose byte1 is
`0xa3` (`0x4f0f6b`), then skips pickup work when render style is NONE1.
Otherwise it reads the two decimal bytes2/3 as the powerup index and calls
`HitPowerup` at `0x4f0f96`, retaining the actual ACT and incoming physics.
This path has no connotation distance gate and adds no pickup radius: upstream
face/cuboid admission already selected the ACT.

`HitPowerup 0x4f0db0` queues ordinary indexes only for physics type1, a real
car owner with driver8, and fewer than50 pending records. Index14 instead
admits car drivers greater than5; every rejection of index14 calls the separate
core reaction at `0x4d9ad0`. The network physics-type32 fallback is separate
and is not synthesized by this local-race implementation.

Grant rejection does not prevent removal. After `HitPowerup`, the dispatcher
calls `SmashObject` with GENERAL's ordinary pickup spec at `0x4f1048`, or the
mine spec at `0x4f0fe7`; that call hides the ACT and emits pickup connotations.
The ordinary audio outlet therefore runs once on actual world collection,
including a full grant queue or an ineligible incoming owner. Index14 adds its
explicit source sound5400. Already-hidden actors skip this work. The pickup
branch returns zero at `0x4f1085–0x4f10a5`, independently of grant acceptance,
and resets the incoming physics face-result fields.

The fifty-entry shared queue at `0x6a2ac0` retains `{car,index,actor}`. Final
`FlushSmashQueue(0)` calls `GotPowerup` at `0x4ecfed`, then
`MayQueuePowerupRespawn` at `0x4ecff7`, rereading the live count after each
pair. Argument-one barriers retain the queue. Respawn uses the original pickup
index and ACT, even if a random powerup chooses another definition. The respawn
routine at `0x4e0590` requires a non-NULL ACT and an enabled source-index mask,
selects the first free slot among100, and schedules current time plus minimum
delay plus truncation of half the extra delay. It consumes no RNG.

`enqueueNativePickupPowerup` independently implements local grant admission.
`PowerupSystem.hitPickupActor` additionally requires actual registered ACT
identity and a first visible collection, queues before hiding/audio, and retains
a completion reservation only for accepted grants. Its immediate mine callback
runs before hiding/audio. `completeQueuedPickup` consumes that reservation once,
uses the existing grant/effect path, then schedules the ACT's normal respawn
without replaying collection audio. Null-ACT connotation grants keep their
existing direct grant path. Normal swept collection shares the same hide/audio
operation while retaining its existing spatial-selection policy.

## Rejected index14: core impulses are distinct from action30

Pickup rejection calls `0x4d9ad0` with index14. It does not call the successful
grant's authored action30 handler at `0x4de850`. The latter uses definition
floats and adds component damage/crush; reusing it for rejection adds effects
and RNG that are absent from the core.

The core tests physics flags`+0x1a0 & 0xf0000`. For the car-class branch,
`0x4d6dc0` reads enabled global`0x65c340` (initial1); false returns before RNG.
The numerical car impulse range is `[Float32(.7),1)`, with angular magnitude
`.5`. Generic physics type`0x10` instead uses upward range`[3,4)` and angular
magnitude`1.75`; other generic types use upward range`[1,2)` and magnitude`.5`.
Three fifteen-bit draws select upward impulse, signed Z angular impulse, then
signed X angular impulse. Stored results are:

```text
velocityY = Float32(velocityY + upward / (mass * double6.9))
omegaZ    = Float32(omegaZ + signedZ * double2pi / mass)
omegaX    = Float32(omegaX + signedX * double2pi / mass)
sleep     = 0
```

The doubles at `0x589c00` and `0x589c08` are6.9 and2π. Index14 preserves
existing linear velocity. The native angular fields are body-axis values;
the simulation bridges its world angular velocity before and after this kernel.
No component/crush calls or corresponding random draws occur. The helper
`nativePickupMineKick` reproduces the numerical branches and explicit car gate.
`VehicleSimulation.hitPickupMine(actor)` resolves an active car, a registered
noncar/detached body, or existing moving scenery; it applies the appropriate
current ordinary-body branch and wakes through existing lifecycle paths.
The current host adapter does not invent a type16 owner for ordinary scenery.
Separate car feedback/network side effects in the native car branch are outside
this numerical impulse adapter.

Focused tests cover actual owner/ACT retention, queue capacity, driver/type
gates, far-away already-admitted ACTs, first-visible collection, deferred grants,
original-index respawns, repeated completion rejection, mine ordering, exact
three-draw impulses, body axes/wake, and an original Eagle with unchanged
component and crush geometry. Existing pickup, respawn and mine regressions
remain applicable. No original files are written.
