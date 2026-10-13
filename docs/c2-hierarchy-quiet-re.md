# C2 hierarchy quiet and car support wake

## Evidence and scope

Verified by bounded static instruction inspection of the read-only installed
`carma2_HW.exe`, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
PE32 i386, image base `0x400000`, entry `0x577eb0`, timestamp
1998-10-18 18:13:36 UTC (raw PE timestamp decoded as UTC). Addresses below belong to this installation.
`madebr/rec2` supplies structure and function names for a different revision;
its `physics.c` maps physics object `+54` to an unnamed three-component vector.
Installed instructions establish the consumers and writes below. No proprietary
code or binary dumps are reproduced.

This note supplements the [generic leaf equations](c2-ped-physics-lifecycle-re.md),
[geometry wake and ACT pull](c2-noncar-wake-pull-re.md), and
[retained-joint address correction](c2-ped-bone-runtime-re.md).
It is not an elapsed-time or small-speed sleep policy.

## Car preparation continues while ec is set

The generic PHIL gravity/drag loop requires active header state2 and `ec=0`
at `0x4b6538–0x4b6558`. That gate does **not** apply to the preceding custom
car force callback: the pre-collision callback is called at `0x4b6528` before
the generic loop. The car pre-collision path refreshes retained faces and calls
CalcForce `0x4168e0` at `0x415a36` without a general ec exclusion. A separate
frozen-local-player condition exists at `0x4159c6–0x4159e1`; it is not ordinary
sleep permission.

For ordinary, unsplit cars, CalcForce calls human Controls `0x415320`, then
WheelForces `0x418870` at `0x416c26/0x416c2e`. Drivers below7 skip the human
Controls branch but still call WheelForces at `0x416fde`. The split branch
at `0x416980–0x4169c5` has its own ec-gated free-gravity path.

WheelForces gathers wheel hits and spring/support information **before** testing
its own ec at `0x419551–0x419575`:

| Condition                    | Installed behavior                                                      |
| ---------------------------- | ----------------------------------------------------------------------- |
| Awake                        | Continue to gravity and tyre processing.                                |
| Asleep, zero grounded wheels | Jump to `0x4196c4`; omit both gravity branches and gravity-hint writes. |
| Asleep, any grounded wheels  | Call `0x4b9be0` with requested ec0, then continue normally.             |

The no-support branch does not return from WheelForces. Grounded count0 skips
tyre allocation through `0x41988d→0x41b908`, stops tyre effects, then still
reaches the accumulated force/torque application at `0x41b93a–0x41ba28`.
There is no second ec gate around that application. Without spring/tyre hits,
the force accumulator initialized at `0x418898–0x4188a6` receives no gravity.
Drivetrain, steering, drag and the existing stationary-settling tail remain live.
Skipping the complete browser car force function would change these consumers.

The separate wheel-reaction branch clears the opposite physics body's ec
at `0x4192e8`. Its preceding exception preserves an asleep ordinary noncar
translation lift (`0x4192ac–0x4192d3`). Four-support driven-on motor activation
is another path at `0x419500–0x41954b`; do not replace it with generic ec wake.

## The quiet gravity vector is not net acceleration

Ordinary gravity at `0x41bca1–0x41bd0d` writes physics object fields:

```text
+54 = 0
+58 = f32(-10 * effectiveVolumeGravity * globalGravity * dt / 6.9)
+5c = 0
```

The volume branch uses depth mixing and the underwater-ability factor before
global gravity. Independently, `0x41bd10–0x41bd38` adds gravity's force to the
car-local accumulator already containing wheel loads. Quiet evaluation reads
exactly `+54/+58/+5c` at `0x4ba916–0x4ba950`. Tyre reactions, downforce, drag
and the final velocity difference cannot substitute for this packet.

Wall-climb with a nonzero raw support-normal sum takes `0x41958a–0x4196c0`:
it adds support-directed `-mass*10` to the force accumulator but **does not write
the gravity packet**. A zero support sum falls back to ordinary gravity. The
sleep/no-support branch also leaves the prior packet untouched. A host must
retain the last written packet, rather than inventing a zero vector or treating
the wall-climb force as a new quiet gravity direction.

In `motion.ts`, the ordinary gravity addition is the appropriate reporting
point. An optional `MotionDebug.gravityIncrement` can identify a real packet
write; an omitted value means retain the previous packet. A support callback
between wheel collection and gravity can wake the owning ring/hierarchy and
return whether gravity runs. Its absent-provider default must preserve existing
awake behavior. These are integration recommendations, not claims of completed
PERF-17 behavior.

## Hierarchy and contact-ring ownership

Installed `0x4b9be0` sets ec on the requested body, its circular contact ring
(`+1d8`), and every member's physical children (`+224/+220`), clearing quiet
byte `+1df` throughout. `0x4b9c90` applies the corresponding body-and-children
operation without traversing the ring. Geometry wake `0x4bde80` has separate
ancestor/cascade and face-cache invalidation semantics; see the wake note.

`foldNativeQuietHierarchy` and `canSleepNativeQuietGroup` already express the
source bit folds. The host must supply the full physical tree independently of
its awake-only solver-joint list. Setting `properties.immovable` on a child
currently excludes its joint from `VehicleSimulation.allJoints`; that filtered
list cannot reconstruct a sleeping hierarchy or reliably wake it with a moving
parent. PHIL registration, rigid ec, immutable world anchors, motor sleep and
renderer visibility are separate ownership decisions.

The final leaf gate at `0x4bab37–0x4bab5a` checks that pointer `+18c` is nonnull,
collision flags are0, and the **body transform** component `+9c` exceeds .999.
The pointer is distinct from ordinary joint `+188`. The Y test is not a scalar
inside the joint-info allocation; in the stored body matrix it is Ryy. Presence
of a browser `RigidJoint` alone does not prove that retained native pointer.

Sleeping registered bodies must remain discoverable as opposite geometry
candidates. Skip their independent primary collection and force/integration
work, while retaining static poses in broadphase. Geometry wake precedes lambda
application and must refresh candidates without applying another force pass.
An unknown car/part/joint/mixed-ring provider must keep the whole group awake.
Only actual physical descendants belong in the hierarchy fold; an independent
fixed world anchor must not turn every body into one world-wide quiet ring.

The existing simulation quiet adapters recompute local velocity from committed
world motion. The exact source criterion consumes mutable solver-local `+1a8`
after normal/friction work, and its collision flags reflect the finite friction
queue. A common owner should retain that cache and queue chronology rather than
derive new quiet inputs from final display poses or independently rebuild flags
for each body family.

The older lifecycle note describes `0x4c1680` after quiet as integration. The
severed-bone audit corrects that address to angular constraint limiting; it is a
no-op when both joint pointers are NULL. That older phrase does not establish
another position advance or justify changing the guarded normal-pose commit.

## Implemented providers (PERF-17)

`NativeHierarchyQuiet` owns car, ordinary attached/free part, split-secondary and
supported jointed NONCAR snapshots, ec and own/descendant bits. The production
`nativeQuietRingState`/`nativeQuietRingSleep` providers combine them with existing
pedestrian/free-prop owners. Physical ancestry survives the solver's dormant
joint filter. Geometry contacts join the complete ring before lambda; all
participating roots and descendants must qualify before sleep is applied.
Unknown eligibility blocks sleep, **not** source wake of known descendants.
Sleeping bodies retain PHIL, ACT/rendering and opposite-body discovery; only
independent forces, primary response and nonconstant prediction are omitted.
Driver2/3 vehicle pieces have no TTL and never enter driver4 scenery reclaim.

Wheel support follows the exact ec/support gate above. Grounded postprocessing
clears car/descendant quiet; independent released pieces can remain dormant.
Wake preserves V/omega, and contact wake preserves retained quiet bytes; forced
support/reset/repair wake clears them. Translation motor expiry/trigger is
separate from ec. Release, repair, inactive ownership and split replacement
release old providers. Physical inertia replacement first restores outstanding
solver scaling, preventing a new partition from being divided by50.

The supported current/OLD input bridge retains the preparation orientation,
gravity-only packet and pre-response velocities. Actual deferred-friction
`solverLocalVelocities` and `collisionFlagsMap` feed quiet consumers, including
queue capacity, live-body filtering and source14's A-only flag. The existing
positive-normal enqueue policy is unchanged; additional native suppression
bits and complete signed-row compatibility remain separate solver limitations.
Unqueued bodies use their current world V in the retained preparation basis.
This is numerical/ownership reconstruction, not bitwise x87 equivalence.

### Verified creation packets and explicit split startup correction

- `DoPullActorFromWorld` `0x420254–0x4202d9` seeds NONCAR `+54/+58/+5c`
  with `(0, bits 0xbd6d7304, 0)` before PHIL preparation.
- Ordinary `SetUpDetachedBitObject` `0x433640`, writes at
  `0x433a0c–0x433a30`, uses the same `f32(-0.4/6.9)` packet, **not** the
  parent's packet. The browser now reproduces this initialization.
- Preparation does not clear the packet. Sleeping free props retain it across
  contact wake instead of acquiring an accidental zero-gravity candidate.
- Split-secondary pool setup `0x42a027–0x42a0b9` allocates three zero-filled
  records (`0x526c00`); allocation `0x42f0c0` and split `0x42e230` do not
  initialize secondary `+54`. Fresh native slots start with zero; reused slots
  retain their earlier force packet. Parent `+54` copied to `+524/+528/+52c`
  at `0x42e7f8–0x42e80d` is a **repair backup**, restored at
  `0x43ba86–0x43ba9e`, not secondary initialization.
- Mid-physics insertion `0x4b5c1d → 0x4b9510 → 0x4b9780` prepares without
  another force pass. Native zero-G unordered acceptance is retained in the
  shared kernel.

**Deliberate browser deviation:** private newly allocated secondary identities
would recreate the fresh-pool zero-G loophole on every near-rest split. A
controlled original Porker2/Eagle split then qualified immediately in midair,
zeroed inherited Vy of0 or−.005 and never received its first gravity force.
The browser seeds only that creation phase's _quiet hint_ from the parent's
actual packet. It applies no velocity impulse or extra force; the first real
free-force step replaces it with the secondary's own packet. Ordinary part
initialization stays exact. This prevents a reproducible startup freeze without
altering the shared quiet thresholds or claiming native pool-memory parity.

Tumble-specific postprocessing and unknown custom/affine hierarchy ownership
are not certified quiet providers and cannot authorize automatic sleep/reclaim.
Existing hierarchy movement limitations remain documented separately. Native
physical pool-memory aliasing is not implemented.

See [runtime validation and measured work](hierarchy-quiet-performance.md).
