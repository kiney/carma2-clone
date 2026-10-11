# C2 outer passive pedestrian V and Stillify

Verified from installed HW SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
rec2 `common/pedestrn.c` maps `MungePedestrians`, `StillifyCorpse` and
`SetCharacterMoveAR`; the installed instruction ranges establish the behavior.
No original source or asset fixture is copied into this implementation.

## Exact outer order

`4d4bbd–4d4bc9` advances BON through `MungeCharacterAnimation409ca0` first.
`4d4bcc–4d4be8` skips the next work when character active bit4 is set or the
FORM simple slot has no object. Otherwise `4d4bee–4d4c0c` copies all three raw
Float32 world velocity words from character+d8/dc/e0 to simple Object+68/6c/70.
There is no scale, physical launch, omega store or PHIL activation here.
Runtime now copies the actual animation velocity into `body.state.velocity`
before the `afterPose` hook, retaining its existing `characterVelocity` mirror.

`4d4c0f–4d4c2f` requires signed pedestrian HP<=0, action6 and selected FORM
move ID!=113. Character+1e is the **signed16 animation period**, not the
collision impact counter. The next branch is exactly:

```text
(Float32 mutantSpeed != 0 && periodWORD == 0)
    || (Float32 mutantSpeed == 0 && periodWORD != 0)
```

At `4d4c65–4d4c90` it calls `SetCharacterMoveAR4d1a20` with move−1, rate0 when
mutant speed is zero, otherwise its Float32 negation; arg4=0, completion=0 and
the current outer uint32 timestamp. The source never calls `SetPedMove` here.
The gameplay adapter therefore invokes its existing direct recovery-move
owner, bypassing authored FSM substitutions and additional speed factors.
Nonnegative rate is an absolute period; negative rate multiplies the current
authored FORM period. The existing setter performs signed16 period storage.

For move−1, `40a050` changes the current period without selecting another move:
frame, fraction, last timestamp, completion bit, queued move, O, root pose,
MODEL/ACT identities, physical V and omega remain owned by their preceding
phases. In particular the current visit's animation V survives freezing;
the following zero-period BON visit produces zero character V, which the
passive copy then places into Object+68.

The source next copies ped.pos (`4d4c95–4d4ca8`) and enters ordinary head
animation at `4d4cab` and following. Gameplay executes Stillify through
`beforeSaveRoot`, after the passive V copy while the preceding ped.pos is still
visible to the actual rate-setter owner. Runtime then stores the current root
and ped.pos, followed by `afterPose` head advancement. Neither hook advances BON
again or consumes RNG. A missing before-save owner reports its own phase result
and retains completed BON/passive V; root/position and head stores await that
owner. Same-clock recovery does not replay the completed BON step. A callback
that releases or replaces its ACT/body skips all subsequent stale-owner stores.

## Signed rate and floating-point precision

Installed `40a190–40a1b3` loads the authored period DWORD through a zero-extended
QWORD, computes its product with the Float32 rate, truncates through signed64
`__ftol575190`, and stores only AX. It has no negative-period rejection or
signed32 overflow gate. A current-move rate change returns1 even for a negative
stored WORD. `setNativePedRecoveryMove` uses the shared `nativeIntegerLow32`
conversion and signed16 storage; invalid signed64 conversions yield lowDWORD0.
`409d96–409d9d` divides elapsed time by the sign-extended period. The existing
animation clock accepts the full signed16 range, and ordinary negative steps
pose the current frame before decrementing while **adding** the root delta.

The actual startup chain verifies PC53, rather than merely assuming a controlled
probe precision: entry `577eb0` calls `577ac0` at `577f61`; the original fp-init
pointer at `671fc0` is `575110`, which calls `5798e0` at `57511f`.
`5798e0` calls `_controlfp582d30(10000,30000)`; translator `582e87–582e99`
maps this to x87 PC bits `0200`. A private read-only original-function probe
starting from CW037f called that actual initializer and measured CW027f.

Nine independent synthetic rate captures preserve frame2, fraction.75,
timestamp1234 and callback byte1, with core return1 throughout. Examples:
authored125/rate−400 stores−15536; rate−262.136f stores32766;
rate−262.144f stores−32768; authoredUINT_MAX/rate−1 stores−1;
absolute32768 stores−32768. The precision-discriminating input
`UINT_MAX * Float32(16777218)` stores0 under the source-initialized PC53;
intentionally injected PC64 stores−2. This establishes JavaScript double
multiplication for this path. Probe code/results remain private under `/tmp`;
committed tests retain only these synthetic inputs and numerical outcomes.

## Supported boundaries and gaps

Tests cover negative and zero signed HP, move113, action and active gates,
independent impact counters, negative period WORD values, Float32 underflow
of mutant speed, negative mutant values, current-clock retention at uint32
wrap, full runtime order, and original Stock/Advanced human/DOG resources.

The ordinary nonreplay path is implemented. `4d1a20–4d1a41` has an additional
replay permission global and `4d1ac6–4d1add` records a rate pipe event. A
triggered replay call reports `source-replay-Stillify-move-owner`; it does not
invent that permission or mutate the rate silently.
