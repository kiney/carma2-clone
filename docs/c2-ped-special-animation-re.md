# C2 pedestrian morph and mutant angle kernels

## Evidence and confidence

`src/ped-animation-special.ts` independently expresses the arithmetic verified
from the installed read-only HW executable. SHA256 is
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`;
PE identity and the ordinary root/bone conventions are recorded in
[c2-ped-root-pose-re.md](c2-ped-root-pose-re.md) and
[c2-ped-bone-pose-re.md](c2-ped-bone-pose-re.md). This change adds no original
binary bytes, extracted fixtures or copied reference implementation.

`madebr/rec2` was consulted first for names, structures and address mapping.
Its `MorphCharacterBonePositions`, `StopCharacterMorphing` and
`MungeCharacterAnimation` bodies are stubs. Its reconstructed `SetCharacterMove`
is useful as a map but has two material discrepancies: root delta bytes are
**target minus start**, and the angular sum is **divided by** three times bone
count in the morph-rate denominator. The installed instructions settle both.

Confidence is high for signed-byte interpolation, velocity blending, clock
handoff, retain-root behavior and mutant RNG ordering. Float32 storage and
explicit native conversion points are represented. JavaScript double arithmetic
does not promise bit-identical x87 extended results at rounding boundaries.

## Morph preparation

Installed `SetCharacterMove40a050` captures the previous authored move's current
frame before reset. It then releases an existing morph (`40a27e–40a285`) and
selects one of twenty pool records, stride `0x15c`, whose rate at+4 is zero
(`40a29b–40a2d4`). Pool allocation requires nonzero arg4, an old move, and
nonzero arg6/time. Exhaustion falls back to ordinary move selection. The module
provides arithmetic; instance ownership supplies allocation/admission.

An interrupted morph therefore starts from the previous selected move's
**authored current frame**, not the currently interpolated actor pose. Both
old and new root matrices are converted to XYZ_S order0 Euler high bytes
(`40a424–40a4b2`). Child triplets come from the corresponding authored angle
records (`40a4dd–40a565`). New targets use frame0. Every target-start subtraction
wraps to one byte and is subsequently interpreted as signed8.

The independently named record fields are:

| Native offset | Module field         | Meaning                                                     |
| ------------- | -------------------- | ----------------------------------------------------------- |
| +0            | `progress`           | Float32 interpolation progress                              |
| +4            | `rate`               | Float32 progress per millisecond; zero means pool slot free |
| +8            | `oldVelocity`        | Old move+40 divided by old frame count and signed period    |
| +14           | `newVelocity`        | New move+34 divided by new frame count and signed period    |
| +20           | `oldSourceDirection` | Copied old move+40; direction blend input                   |
| +2c           | `retainRoot`         | Arg4 bit0x40000000                                          |
| +2d+6\*bone   | `startAngles`        | Three signed start bytes                                    |
| +30+6\*bone   | `deltaAngles`        | Three signed wrapped delta bytes                            |

Velocity calculation is at `40a312–40a421`. Zero period or move+2a nonzero
produces zero velocity. `nativePedMorphVelocity` accepts the authored vector
and signed16 period; callers must preserve the old+40/new+34 distinction.
The saved+20 vector is a source direction, not a grounding offset.

Let `S` be the sum of absolute signed delta components for **children1..N-1**;
root is excluded from the sum but included in `N`. With
`A = arg4 & ~0x40000000`, `40a56f–40a620` computes:

```text
rate = Float32(1 / ((S / (3*N)) * A /64))
progress = 0
character.timestamp = 0
```

Constants at5883a0,5883a8,588370 are respectively double3,1/64,1. Arg4 is an
angular-speed scale; calling it a fixed number of milliseconds misstates the
native contract. `prepareNativePedMorph` rejects malformed angle shapes and
zero scale instead of inventing a duration.

If `S=0`, the installed rate becomes Infinity. A positive elapsed time completes
that transition. Zero elapsed gives Infinity\*0, so the installed progress
becomes NaN and its subsequent pose can become nonfinite. The module reports
`native-ped-degenerate-morph-numerics-provider` for that exact case and retains
the previous finite progress. It neither substitutes a guessed duration nor
allows nonfinite world matrices.
The instance checks this before committing selection, because selection itself
immediately calls the source morph routine with elapsed0. Such a transition
returns that explicit numerical provider and leaves the old move intact.

## Morph clock, poses and release

`MungeCharacterAnimation409ca0` applies ordinary invalid-move and active-boned
without-temp-matrix early returns before dispatching morph. At409cdf–409ce8,
elapsed is unsigned32 `now-character.timestamp`. `MorphCharacterBonePositions`
converts that unsigned elapsed to Float32 at4097c1–4097ce and stores:

```text
progress = Float32(progress + rate * Float32(elapsed))
```

While progress<1, each angle is
`lowByte(trunc(signedStart + signedDelta*progress))`
(`409995–4099fd` children, `409a63–409ae8` root). Signed **start** matters:
byte255 is -1, so `255 + delta2 *0.25` becomes byte0 after truncating -0.5.
`sampleNativePedMorphAngles` implements this directly. The caller poses eligible
children in ascending FORM order with the existing native attachment helper;
the ordinary missing-self/missing-parent and render-availability gates apply.
The morph routine does not honor the ordinary mode1/2 child-retention gates.

For root0, physics-active flag4 or retained-root+2c suppresses all root writes
(`409a1d–409a32`). Otherwise its basis is
`nativePedAnglesToMatrix(rootTriplet) * characterOrientation`, with the old
origin saved before the basis replacement (`409a74–409b0b`). Root matrix frame
translation is not interpolated into that basis. The new origin adds:

```text
oldWeight = Float32(1-progress)
local = Float32((oldVelocity*oldWeight + newVelocity*progress) * Float32(elapsed))
delta = applyV(local, character.movement)
origin = Float32(oldOrigin + delta)
```

The velocity blend uses the **new** progress, not its previous value or an
integrated midpoint. `sampleNativePedMorphRootDelta` implements the displacement
at409b19–409bc1; the movement matrix's translation is ignored. This routine
does not test ordinary movement-enable arguments or the global overall-movement
disabled flag. It contains no ground query; selection's later ordinary ground
adjustment still occurs at40a6cd–40a70b.

On an active morph, the outer clock stores timestamp=now and returns immediately
(`409cef–409cfb`), leaving ordinary frames untouched. On completion, the morph
record rate becomes zero, ownership is cleared and ordinary mode0/movement0
target posing runs (`4097fe–40989b`). If retain-root was enabled, orientation
first becomes `inverse(targetCurrentFrame) * currentRoot` with translation
cleared (`40980e–409885`). Back in the clock, timestamp is set to
unsigned32 `now-signed16Period` (`409cfe–409d06`), then ordinary animation advances
in the same call. Completion neither clamps the stored morph progress nor
returns before that ordinary clock pass.

Explicit `StopCharacterMorphing4096f0` has the same release, retained-root
orientation adjustment and final ordinary mode0/movement0 pose, without clock
advancement. `advanceNativePedMorph` reports active/completed state; the instance
owns these final pose and timestamp effects.

## Direction changes during morph

`SetCharacterDirection40a730` blends its selected move+40 with saved morph+20
at40aa14–40aae1 before constructing orientation and movement:

```text
sourceDirection = normalize(oldSourceDirection*(1-progress) + newSourceDirection*progress)
```

The small-length fallback is `(1,0,0)` when length<=2^-22. This direction blend
is independent of the velocity blend; it is not an extra displacement.
`sampleNativePedMorphSourceDirection` supplies this input to the existing
orientation kernel.

## Mutant perturbation and shared RNG

`SetBoner407e60` checks nonzero Float32 `gMutant_speed742944` before calling
`4d69e0` on each eligible child angle triplet. The helper returns unchanged
unless all of the following hold:

- Gameplay pedestrian health byte+4, interpreted signed8, is<=0.
- Gameplay action DWORD+10 equals6.
- Global same-time guard69a370 equals0.

The guard is set by the pedestrian outer update at4d3562 when its time equals
the prior update timestamp. It is not the action replay flag.
No bone eligibility decision or shared random draw should precede the native
pose gates. Root0 does not use SetBoner and consumes no mutant draw.

For each eligible child the helper draws three successive shared CRT rand
integers, XYZ order (`4d69fc–4d6a32`). `IRandomPosNeg512f60(30)` maps each actual
sample `r` in0..32767 to:

```text
delta = floor(r *61 /32768) -30
angle = (angle +delta) &255
```

Both -30 and+30 are possible. A zero result still consumes a draw. The helper
does not scale the perturbation by mutant speed; that value only gates entry.
`perturbNativePedMutantAngles` requires the actual shared `nextCrtInteger`
outlet only when mutation is eligible and returns the exact draw count. It
retains the authored triplet and requests the RNG provider if that owner is
absent. Healthy characters, other actions, zero/Float32-underflow speed and
the same-time guard do not require or consume RNG.

## Validation

`tests/ped-animation-special.test.mjs` contains ten conformance cases covering
the corrected angular rate, root exclusion, signed start/delta wrapping and
zero-crossing truncation, Float32/unsigned clock conversion, native degenerate
rate, signed-period velocity, transformed root drift, source-direction blend,
mutant endpoints/draw order and all RNG gates. The focused suite and TypeScript
check pass.

`src/ped-native-instance.ts` integrates the kernels with a twenty-record live
morph capacity, old-morph release/interruption, target clock handoff, retained
root selection and source orientation adjustment. `morphArgument` names arg4;
the previous `morphDurationMs` option remains an alias for that same angular
scale. Physics-active move transition ownership remains explicit.

Instance state includes the host-owned shared CRT outlet, signed mutant health,
action and outer same-time guard. `poseNativePedBones` samples only eligible
children and returns actual sampled angle bytes; it never changes cached BON
data. `poseNativePedFrame(instance,mode,{reuseLastAngles:true})` reanchors those
last actual angles without consuming a second mutant draw. The retained cached
triplets are updated only for bones actually posed.

The instance suite passes25 cases, including clock handoff, authored-frame
interruption, retained-root transitions, exact mutant draw/cache behavior, native
twenty-slot fallback/reuse and safe zero-angle refusal. The bone-pose suite
passes18 cases, including mutant ascending-index/immediate-parent gates. Related
rewind16, active-move9, recovery-move9 and set-position6 cases also pass. Actual
browser validation belongs to ANI-01's presentation owner; these numerical
checks do not claim to substitute for runtime rendering validation.
