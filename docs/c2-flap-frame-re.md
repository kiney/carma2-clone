# C2 attached flap outer-frame sampling

## Evidence and scope

Verified against the locally installed `carma2_HW.exe`, image base `0x400000`,
SHA-256 `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
The original installation remains read-only. madebr/rec2 supplies symbol and
structure hints; this adapter is independently written, without reference code
reuse. Its rec2 addresses differ from this installed revision.

`VehicleSimulation` invokes `NativeFlapFrame` after ordinary shape commitment
and before detachments/bending, once per outer frame for every active WAM car.
It changes neither the detached body/joint integrator nor `stepFlapAngle`.

## Installed phase and state

`CrushBendFlapRend` at `0x4360c0` completes ordinary crush and candidate shape
swapping, calls `DoFlapping` at `0x438100` from `0x4362ff`, then processes
scheduled/full detachment and marked structural bending. Attached flap motion
therefore runs once per outer frame, after all its physics steps and ordinary
crush callbacks. An outer frame without physics steps still reaches the pass.

After toggled-door processing, the pass visits active-car list `0x74a960`, count
`0x74ab8c`, in list order. It requires a non-null car, driver greater than 5
(`0x4382a9`), and non-null crush spec. Spec byte `+0x134` gates active flap force
calculation/enumeration. It does not gate saved velocity or clock capture.

Each eligible car copies current collision-info velocity at `+0x68/+0x6c/+0x70`
to crush-spec `+0x138/+0x13c/+0x140` at `0x4383be–0x4383dc`. The caller must invoke
the adapter even when no attached flap is active and may ignore the returned
force in that case.

The previous tick is a single global `0x67a728`, initially PE zero-fill. Complete
installed disassembly references it only at load `0x438294` and store
`0x4383ea`: no zero sentinel, repair, race-entry or cleanup reset is present.
The current tick is PHIL physics tick `0x74878c`, not pause-adjusted game time.
`sharedNativeFlapFrame` consequently has process lifetime and no reset API.

The global timestamp is overwritten **inside every eligible car iteration**.
At `0x4383e2–0x4383ea`, the registers are reloaded with the current tick. Later
eligible cars in the same pass therefore calculate zero elapsed time, including
when the preceding car has no active flaps. This is verified installed behavior
and agrees with rec2's per-car static-clock update. Per-car previous timestamps
would change that behavior.

## Force and numerical stores

The elapsed subtraction at `0x4382d2` wraps through uint32; its result is widened
with zero high word and converted using QWORD `FILD`. The period is multiplied
by FLOAT `0.0010000000474974513` at `0x588b34`, then stored as F32 at `0x43831f`:

```text
seconds = F32(uint32(physicsTick - previousGlobalTick) * FLOAT(.001))
worldForce = (currentRawVelocity - savedRawVelocity) / seconds + BattyGravity
carForce = transpose(currentActorRotation) * worldForce
```

Velocity is raw model units per second; no metric `6.9` conversion occurs.
X/Y velocity differences are F32-stored at `0x4382ef/0x438306` before division;
Z remains in the x87 register until its acceleration store. Each acceleration
is F32-stored at `0x43835a/0x438366/0x438370`. Gravity addition then stores each
force component as F32 at `0x43837c/0x438380/0x438386`.

Batty gravity is world vector `0x67a718/+4/+8`. The GENERAL loader writes only Y
at `0x429c0f`; X/Z begin and remain zero. Stock GENERAL supplies Y `1.44` and
flap inertia factor `.02`. This pass does not multiply gravity by physics,
powerup or special-volume gravity settings.

`BrMatrix34TApplyV` at `0x532cd0`, called at `0x43838c`, adds each dot product's
Z/Y products before X and stores output F32. The adapter reconstructs the actor
rotation from the supplied current quaternion, rounds its entries to F32, and
applies this transpose dot-product order. Browser quaternion reconstruction and
JavaScript double arithmetic cannot reproduce every original x87 extended
precision intermediate or all native actor matrix history; explicit F32 stores
and operation order are preserved.

`FlapBit` at `0x438410` calculates the angle increment using current geometry,
force, part mass and authored inertia factor. At `0x438641–0x438651` it computes
`trunc(atan2(torque * FLOAT(inertiaFactor), partMass) * DOUBLE(angleScale))`.
There is **no extra timestep multiplier**. A frame containing three 40 ms steps
gets one outer velocity-difference force and one attached angular increment,
not three increments from successive step differences.

## Explicit browser guards

Native has no zero-period division guard. Its IEEE infinities/NaNs may proceed
through rotation, torque and fixed-angle conversion. The adapter still captures
velocity/global tick but returns `undefined` for zero seconds, preventing those
temporaries from reaching persistent browser actor transforms. It also returns
`undefined` if finite inputs overflow F32 force calculation. These are deliberate
robustness deviations, not reconstructed native branches. Neither guard replaces
the shared clock with a per-car timestamp.

The adapter rejects malformed tick, velocity, quaternion and gravity inputs
before mutating retained state. Newly seen identities bootstrap saved velocity
to zero. The installed crush loader initializes flap-active byte `+0x134` to zero
at `0x42a323` but has no verified explicit saved-velocity initialization. Normal
inactive eligible passes prime native saved velocity; callers should preserve
that sequence rather than assume an immediately active new car has a verified
native zero velocity reference.

## Plastic-panel seed eligibility

Ordinary model callback `0x431d70` calls plastic helper `0x432120` only when flap
data exists, KEV-flap byte `+0x20` is zero and the computed strongest displacement
is strictly positive (`0x43205a–0x432077`). It passes event field `+0x50` directly
as the retained physics tick (`0x432080/0x432087`), without adding decimal 50.

The helper additionally requires actor user data, original model, model detail
metadata/vertex flags, crush/flap pointers and plastic-enable byte `+0x14`
(`0x432138–0x432186`). After geometry/reference setup it requires direction dot
inward strictly greater than FLOAT `.20000000298023224` (`0x432574–0x43257f`),
positive lever (`0x4325e8–0x4325f3`) and positive displacement again
(`0x4325f9–0x43260b`). Only then does it compute the offset and call `srand` at
`0x43263e` with the event tick.

Inverse-buckle chance follows the seed, before plastic-limit state mutation.
Stock chance zero consumes no chance draw but still performs the seed. Random
taper between authored FLOAT `.3` and `.7` follows at `0x4326bb`. When the
cumulative offset exceeds the limit, positive offsets subtract the excess at
`0x4326a5`; negative offsets add it at `0x432abb`, then jump back to taper
setup at `0x4326b1`. Both branches still consume the taper draw. Ordinary
callbacks that fail any prerequisite must not seed RNG.

## Validation

Focused tests cover the stored 120 ms force, second-car zero-period capture,
inactive priming, unsigned clock regression, gravity/rotation, initial zero tick
and malformed input rejection. No original assets or executable excerpts are
embedded in fixtures.
