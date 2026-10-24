# Wheel suspension and steering presentation

ANI-05 adds browser presentation interpolation for the existing four suspension
lengths and steering curvature. Body/part pose interpolation already uses the
last two physics ticks; wheel controls now sample the same render fraction.
This is a presentation adapter, not a change to native physics or an assertion
that C2 used this browser interpolation algorithm.

## Existing source equations and data

Original mechanics supplies wheel positions, axle ordering and steering limits.
The existing native-informed control and tyre paths are installed HW
`0x415320` and `0x418870`; wheel damage tilt is mapped at `0x440240`, with
tables at `0x58ef50/70`. See [physics evidence](c2-physics-re.md). This change
introduces no new binary interpretation, coefficients, motion modes or original
asset modifications.

The original car's GROOVE records still determine control references, axis,
parent-space suspension direction, sign and pivot. The same shared matrix
evaluator serves ordinary animation and temporary presentation:

```text
length[i] = previousLength[i] + alpha * (currentLength[i] - previousLength[i])
curvature = previousCurvature + alpha * (currentCurvature - previousCurvature)
steeringAngle = atan((rearWheelZ - frontWheelZ) * curvature)
forceWheel = authoredSuspensionWheel XOR 2
displacement = (rayHeight[forceWheel] - length[forceWheel]) / 6.9 * authoredSign
```

Interpolate curvature before evaluating the steering angle. Existing spin,
damage tilt, complete authored local matrix and structural-bend path offset
remain in their existing operation order. Original geometry/ray heights and
current component damage are live inputs, rather than separately interpolated
damage or geometry caches. Other GROOVE/FUNK compatibility gaps remain ANI-02
and ANI-03 work.

## History and render ownership

`RenderWheelControls.capture(cars)` belongs beside `RenderPoses.capture`, before
each actual physics tick. Snapshots contain scalar copies of wheel lengths and
curvature, with pose epoch and repair revision metadata. Removed car identities
are pruned; `clear()` supports race teardown. Sampling returns independently
owned controls, optionally into a caller-owned reusable target. It never changes
physics arrays or car state.

`sample(body, alpha)` clamps the render fraction to `[0,1]`. Missing history,
a changed pose epoch or `DamageSystem.repairRevision` uses current controls.
Thus recovery/rematerialization and progressive/full repair cannot blend from
stale pre-reset geometry. Paused/inactive cars use alpha 1, matching body pose
selection. Callers continue to use the native mechanics wheelbase when building
the steering angle.

`CarAnimation.applyPresentation(input)` accepts only suspension lengths, ray
heights, steering angle and component damage. It evaluates temporary matrices
using the already committed spin angles and animation clock. It does not call
ordinary `update(0)`, advance animation time/spin, mutate inputs, or write
`wheelDamageOffsets`. Those persistent offsets remain owned by ordinary
gameplay animation and continue to feed the tyre solver unchanged.

Apply player and rival presentation every displayed frame, including alpha 1:
rivals' ordinary animation update can precede their latest physics tick, so
current sampled controls can differ from their last animated matrices. Restore
with `restorePresentation()` in the render `finally` block before body pose
restoration. An ordinary update/reset also first restores a pending temporary
pose. The exact committed local matrix, position, quaternion, scale and
matrix-auto-update policy are preserved. Final scene preparation owns world
matrix traversal; this adapter marks changed matrices dirty.

Detached actors are skipped. If an actor leaves the car or changes parent after
application, restoration leaves its new owner's pose alone. Multiple bindings
for the same actor save one original pose. Saved matrix/PQS objects are reused
through a WeakMap; the per-render active list clears after restoration and does
not keep released car actors alive.

## Numerical checks and limits

`tests/render-wheel-controls.test.mjs` covers copied histories, all four lengths,
curvature, intermediate/clamped fractions, catch-up ticks, pose/repair
invalidation, alpha 1, removed identities and teardown.

`tests/wheel-presentation.test.mjs` checks independent expected local/world
matrices under transformed/scaled parents, all four suspension mappings and a
negative-sign reference. It verifies exact restoration, repeated application,
reset, duplicate bindings, detachment before/during drawing, reusable snapshot
storage, and unchanged spin, clock, damage offsets and physics state. Additional
render calls cannot change the next ordinary animation update.

Optional original Eagle and Buggy cases read local assets without copying them
into fixtures and skip when absent. Both retain four wheel/two steering
bindings. Buggy's four existing `BBSUSRL/RR/FL/FR.DAT` shear-link warnings remain
explicit ANI-02 limitations; this change interpolates admitted controls without
silently claiming those unsupported modes work.

A private comparison against the pre-change implementation exercised 80 ordinary
updates across both original cars, including reverse/neutral/driven spin,
handbrake, steering and damaged wheels. All 480 binding matrices, spin angles,
elapsed values and tyre damage offsets matched exactly; reset output matched
too. Its small summary is `/tmp/ani05-baseline-comparison.json`. These are
numerical and preservation checks; application render-loop integration is
validated separately by `npm run test:wheel-presentation`. The bounded original
New City/Eagle Chromium capture observed 114 presentation calls, 684 exact local
transform restorations, temporary matrices at draw, and real keyboard movement
of 0.84 scene units. Pausing left physics time and game-frame count unchanged.
It reported no page, console, request or WebGL errors. The backend was WebGL2
on ANGLE/Vulkan SwiftShader at 1024×720; this proves render-loop state ownership,
not physical-display smoothness. The complete original-installation test suite
also passed 3,246 checks. No newly supported GROOVE mode is claimed.
