# Native mode1 pedestrian position setter

`src/ped-set-position.ts` independently implements installed
`SetCharacterPosition40b0a0` mode1 for the current native instance. It accepts
the raw finite ground hit, applies current move clearance and reset-axis phase
correction, notifies the passive physics matrix owner, then poses the current
integral frame. It does not advance BON time, set direction, alter character V,
or update the separately stored `ped.pos`.

## Evidence and exact sequence

Read-only installed HW SHA256:
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
PE32 image base400000, entry577eb0. rec2 `common/pedestrn.c` provides the symbol
but its position function remains a stub. The installed instructions establish
the following order; no reference implementation is copied.

1. `40b0ab–40b0b8`: active character bit4 returns without mutation outside
   replay. The native setter returns void; the adapter reports complete with
   `positionIgnored:true`. Replay mutation remains an explicit provider.
2. `40b0f8–40b117`: mode1 copies hit X/Z and stores
   `targetY = f32(hitY + selectedPersonalityMove.groundingOffset)`. Clearance
   is added once and is not multiplied by translation scale. The source
   `GetCharacterMatrixPtr` selection at `40b163–40b188` chooses current
   character/root ACT storage, not `ped.pos` or COM.
3. `40b1a5–40b21c`: if the selected prepared move's stationary byte+2a is zero,
   sum prepared root-frame deltas from **currentFrame down to1**, excluding0.
   X spills to Float32 after each addition (`40b1dd`). Y and Z remain live;
   Y's additional store at `40b1e7` does not replace its live value. Zero each
   component whose move reset bit+2b is absent. Prepared `ReadMove` stationary
   semantics come from `pedRootMotionDirection`; in ordinary loaded moves,
   X reset itself makes the move stationary.
4. `40b21c–40b285`: write the target origin and add retained cumulative
   components times the selected personality's Float32 translation scale:
   `origin[i] = f32(target[i] + cumulative[i] * scale)`. This correction is
   directly in **world axes**, without multiplication by character movement
   matrix+5c or orientation+8c. Personality grounding mode does not suppress
   mode1's clearance addition.
5. `40b28c–40b2ba`: when character bit1 is set and replay is absent, copy the
   complete current ACT matrix to its simple collision object+8c using
   `BrMatrix34Copy531c10`. This notification happens **before** bone posing,
   so its basis is the pre-pose root basis and its translation is corrected.
6. `40b2bd–40b2c3`: call `SetCharacterBonePositions407b20` with mode0 and
   translation argument0. Root basis becomes current prepared frame basis
   times unchanged character orientation; the saved corrected origin is
   restored (`407d10–407d19`, `407d21–407d27`, `407df7–407e09`). Children use
   existing quantized angles and remapped attachment anchors. No additional
   authored displacement is applied here. Inactive boned/no-temporary-matrix
   characters still pose and clear callback halted bit1; the early return at
   `407b38–407b4b` requires active4 as well as boned2.

The setter never writes frame+1c, period+1e, fraction+18, last timestamp+24,
character V+d8, direction/up anchors, character orientation+8c or movement+5c.
Calling `advanceNativePedPose` merely to render this change would introduce
clock/velocity side effects that are absent from the installed setter.

## Outer owner and integration

Supported grounding at `4d3fbb–4d3ff0` passes the raw selected hit to mode1.
It then reads before/after actual root origins and pipes the source position
notification at `4d3ffb–4d4013`. The core does not dereference character+e4 to
write `ped.pos`; the outer animation/update tail owns that later copy. Smooth
turn stopping/direction application follows at `4d4018–4d403a`, separately.

The API is `setNativePedPosition({instance,groundPoint,physicsFlags,
callbackState?,writePassiveMatrix?,replayMode?})`. `physicsFlags` is actual
character+14, not pedestrian eligibility flags or PHIL header policy. Bit1
requires an actual passive matrix writer; no fake registered object is created.
The instance retains its borrowed stable ACT ownership and model selection.
Detached actors are excluded from render writes; removal freezes only the
native own/immediate-parent conditions inherited from the bone kernel.

The grounding kernel's returned `set-position` effect already includes current
clearance. A mode1 adapter must use `result.hit.point` as `groundPoint`, **not**
add clearance to `effect.position` again. The runtime's existing `setRootPose`
method advances animation; it is not this provider. The host should supply its
passive matrix writer, commit returned root mirrors, apply later direction/AI
effects, then advance BON once at the ordinary prephysics phase. The position
helper deliberately leaves `ped.pos` and these outer transitions to that owner.

## Validation and boundaries

An isolated 32-bit mapper reads the original PE unchanged and mutates only its
private process image. Forty-eight synthetic probes cover all eight reset masks,
three integral frames and unregistered/passive notification states. Another
72 calls use prepared Stock/Advanced Blokebl, Bandsman and DOG1/twolf30/40/93/94
roots at frame1, midpoint and final frame. All **1,728** root12/passive-matrix12
output components from those original-input cases match the new implementation
exactly. Source capture uses single root storage with no child rendering;
child math is covered by the previously verified bone-pose kernel. Harnesses,
asset-derived inputs and outputs remain under `/tmp/c2-set-position-*`.

Six focused tests pass, including all reset masks, source callback ordering,
nonidentity orientation/movement separation, inactive-boned posing, removed
parts, ownership/provider failures and 72 actual nonzero original-frame cases.
Original reads skip cleanly when the installation is absent. TypeScript and
formatting pass. No shared runtime edit or production build is included.

Mode0's vertical query, mode−1 direct positioning, negative/unselected frames,
morphing, reverse/replay mutation and mutant-angle RNG are not implemented by
this mode1 adapter; missing dependencies are explicit. The pure setter cannot
prove the host's supplied character flags or passive matrix writer ownership.
It reports those contracts rather than creating physics state or a ground ray.
