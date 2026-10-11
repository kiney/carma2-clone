# C2 pedestrian root direction, animation and grounding

## Scope and evidence

The independently implemented helpers in `src/ped-form.ts` provide the intact
character's native root actor pose. They complement the root-remapped simple
body data in [c2-ped-simple-body-re.md](c2-ped-simple-body-re.md). They do not
derive a collision box from rendered geometry or a procedural walking sweep.

Evidence is the read-only installed `carma2_HW.exe`, SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`, mapped
using `madebr/rec2`. Addresses below refer to that installed executable, not
necessarily rec2's annotations. Source algorithms were independently expressed;
no reference implementation or proprietary fixtures were copied.

Confidence is high for ordinary, non-morph root movement, direction matrices,
grounding offsets and the frame clock. Arithmetic uses checked finite inputs
and float32 storage. JavaScript does not reproduce every x87 extended-precision
intermediate, so results are numerically conformant rather than guaranteed
bit-identical at rounding boundaries. Morph blending, retained-root move
transitions, terrain cache selection and animation completion dispatch remain
separate providers.

## Direction and slope matrices

`SetCharacterDirection` is installed at `0x40a730`. Character fields are:

| Field        | Meaning                           |
| ------------ | --------------------------------- |
| `+0x5c`      | Root movement rotation matrix     |
| `+0x8c`      | Character orientation matrix      |
| `+0xc0`      | Stored direction vector           |
| `+0xcc`      | Stored up vector                  |
| move `+0x34` | Normalized net movement direction |
| move `+0x40` | Selected source direction         |

The operation returns for an invalid selected move, and for active characters
(flag4) outside action replay. A null new direction retains the stored direction
and up vector. A supplied direction replaces and normalizes the stored direction;
the supplied up vector is retained before constructing its normalized working
copy. An absent up vector uses world `(0,1,0)`.

For normalized target direction `d`, normalized up `u`, and selected source
direction `s`, the normal path constructs the following row-vector matrices:

```text
p = normalize(d - dot(u,d)*u)
q = normalize(s - dot(u,s)*u)
Y = RotateCos(normalize(OrthogonalVector(q,p)), dot(p,q))
T = RotateCos(normalize((u.z,0,-u.x)), u.y)
O = T * Y
P = RotateCos(normalize(SafeCross(p,d)), dot(p,d))
movement = O * P
```

`buildPedOrientation` returns `O`, `movement`, normalized direction and up.
The tilt axis `(u.z,0,-u.x)` is verified at `0x40acc1–0x40ad1a`. It differs
from rec2's reconstructed component order. The installed call to
`BrMatrix34Pre` at `0x40ad58` makes the tilt a left multiplication. Movement
pitch is separate from the root orientation; do not substitute one for the
other when advancing root translation.

`DRMatrix34RotateCos 0x40aed0` clamps cosine to `[-1,+1]` and uses the positive
square-root sine in a Rodrigues row matrix. `OrthogonalVector 0x404150` first
uses `q × p`. If all three absolute components are below
`2.384185791015625e-6`, it uses `q × X` when `abs(q.x)<=abs(q.z)`, otherwise
`q × Z`. `DRVector3SafeCross 0x403f90` uses the same three-component test,
then crosses its first argument with the axis corresponding to its smallest
absolute component (ties favor X, then Y). Both installed checks differ from
rec2's duplicated-component tests. Vector normalization's small-length threshold
is `2^-22`, with fallback `(1,0,0)`.

Before changing direction, native code removes the old orientation from the
current root basis and then appends the new orientation. It retains the world
origin and applies `BrMatrix34LPNormalise`. `reorientPedRootPose` implements
this as `LP(currentBasis * inverse(oldO) * newO)`. This preserves the current
animation's root roll/lean; rebuilding from a bare heading loses it.

## Full animation basis and root delta

`ReadMove` matches the FORM root's exact bone name against BON/SKL names,
applies `Flip3DStoBRaxes`, and normalizes each root basis. `buildPedRootMotion`
preserves that full nine-component basis, with per-frame translation deltas in
the last three components. Subsequent frame deltas are current minus previous
root position. Frame0 is the negative accumulated delta for reset axes, the
first subsequent delta for non-reset axes, or zero for a one-frame sequence.

`pedRootMotionDirection` reproduces the net movement/source-direction selection:
sum later-frame deltas before frame0; clear reset-axis sums; a nonzero net sum
is moving only when X is not reset. The movement direction is the normalized
sum for moving sequences. Source direction is normalized authored direction
when nonzero, otherwise movement direction when moving, otherwise `(0,0,1)`.
The selected source direction is a movement-vector convention, not the root
actor's local long axis.

`SetCharacterBonePositions 0x407b20` applies each scaled root delta through character
`+0x5c`, and builds the full root basis from the selected animation frame and
character `+0x8c`. `stepPedRootPose` applies:

```text
nextOrigin = oldOrigin + (frameDelta * personalityMove.scale) * movement
nextBasis = frameBasis * orientation
```

`composePedRootPose` sets an explicit world origin without treating the frame
delta as an absolute position. Native ordinary playback accumulates every
processed frame's translation, while intermediate steps may defer updating
the root basis until the last step. Composing each intermediate basis produces
the same final root pose provided direction/move-transition callbacks do not
intervene; callers must dispatch those callbacks in source order.
The root update is suppressed for active characters and when its argument2
is3; translation is suppressed for argument3=0 or the global movement-disabled
setting. These are caller-owned state gates, not decisions made by the pure
pose helper. Negative replay reverses the root translation direction.

Original humanoid walking demonstrates why a visual yaw quaternion is
insufficient: the BIPED1 move30 root basis rotates the remapped long local X
axis into world up. Its selected source direction is approximately
`(0.001240854268,0,0.999999225140)`. The tests construct a root pose facing
world X and verify the long local X axis still maps almost exactly to world Y.
Use the source frame basis and remapped local bounds together.

## Native clock and activation velocity

`MungeCharacterAnimation 0x409ca0` has a distinct non-morph path. Frame index
is signed16 at character `+0x1c`, period signed16 at `+0x1e`, fractional frame
float32 at `+0x18`, and last time unsigned32 at `+0x24`. `advancePedAnimationClock`
provides the bounded arithmetic for this path:

```text
delta = signed32(unsigned32(now-lastTime))
target = (clamp(delta/period, -10, +10) + oldFraction) + oldFrame
advance = floor(target)-oldFrame
fraction = f32(target-floor(target))
```

A zero period performs no frame advancement. A zero last time initializes the
current pose with no translation before recording the current time. Ordinary
animation uses integral frame bases; the retained fractional clock is not a
basis interpolation factor. The clock helper does not choose frame-loop policy. The ordinary native
instance now implements positive and negative traversal; queued and morph
transitions remain separate providers.

The target spills to double at installed `409ddc`; the remainder spills to
Float32 at `409df6`. That remainder can round up to exactly1, which the original
stores and reads unchanged on the next call (`409dd1`). It must not be rejected
or carried into the frame early. Actual Stock/Advanced browser contacts exposed
this bug in the previous validator. Installed probes confirm frame4/fraction
`.95f`/period20/elapsed61 produces frame7/fraction1, then elapsed1 produces
frame8/fraction`.05f`; the corresponding period33 case retains1 too. Even a
repeat at the same timestamp consumes the retained1 on the next ordinary call.
Independent numerical regressions preserve that source callback chronology.
An additional2,004 installed calls matched the corrected arithmetic exactly,
including462 stored remainders equal to1. Twenty differed from the former
association even when both outputs remained valid. Installed CRT initialization
`5798e0..8ea` selects nearest-rounded53-bit x87 precision (`CW027f`), so the
double intermediate is deliberate rather than a generic JS approximation.

### Signed frame traversal and physical callbacks

Verified from the installed binary using48 reverse probes (24 original
Stock/Advanced BIPED/DOG move30/94 cases) and eight positive/completion probes.
`advanceNativePedPose` implements this path independently.

Negative advancement at `409f08–409f6a` is ordinary behavior, with no replay
gate. Each iteration poses the **current** frame before decrementing. Mode2
preserves root basis/children while more iterations remain; the final iteration
uses mode0. Underflow wraps to the last frame unless authored move flag1 is set,
which clamps frame0, calls mode3 and stops. That extra call must not replace a
basis retained by an intermediate mode2 step. There is no final pose using the
decremented frame, completion callback or completion-bit clear. Ordinary negative
clock steps still **add** authored displacement; subtraction applies only during
action replay with negative replay rate (`407d91–407dcf`).

Positive ordinary traversal ignores authored flag1. Replay clamps/stops at the
last frame when it is set. A requested completion clears bit2, exposes the last
frame and updated fraction to the callback, then resets frame0 when no new move
was selected. Installed `CBMoveCompleted` returns literal1 at `4cbfb4`, stopping
remaining traversal even if the callback retains the move. The final pose has
movement disabled. The raw timestamp is stored after callback/traversal, so a
callback observes the old timestamp. Ordinary passive zero-advance calls do not
pose; active/replay zero-advance calls do. Period0 skips pose and clears V.

The non-morph tail `409fa1–40a01a` stores:

```text
V = f32(f32(newOrigin - oldOrigin)
        / (originalSignedAdvance * currentSignedPeriodMs * double(.001)))
```

The denominator includes steps skipped by a callback and reads any period
changed by that callback. Signed zeros are preserved. A callback-created zero
period can produce native infinity; the browser reports
`native-nonfinite-animation-velocity` and retains the previous finite V instead
of admitting infinity into PHIL. This is an explicit robustness deviation. With
zero advance V remains unchanged unless the input period is0.

Animation retains character orientation O. Active root ownership suppresses root
delta writes, so nonzero advancement computes zero character V while leaving
physical body V unchanged. The separate moved `40b770` and halt `409400` callbacks
do **not** consume animation time, frame or fraction: they obtain O from
`inverseLP(currentFrame) * actualPhysicalRoot`, clear O translation and call
mode3 without movement. Installed `BrMatrix34LPInverse 5324f0` transposes the LP
basis. The installed `531c60` basis sums use entry-specific association: rows
`[(2+1)+0,(0+1)+2,(0+1)+2]`, `[(0+1)+2,(0+2)+1,(0+1)+2]`,
`[(0+2)+1,(1+0)+2,(1+0)+2]`, with one final Float32 store. A captured
cancellation fixture distinguishes this from a uniform dot-product association.
The physical-pose helper implements those orders. Moved handles only simple
resource bit1; boned callbacks require their actual source dispatch/storage.
Moved copies body V before its gameplay callback. Halt copies final body V
only after acceptance; a rejected halt retains previous character V. The browser
uses `synchronizeNativePedPhysicalPose` for this separate phase.

An installed Stock Blokebl30 capture uses explicit identity O/movement, frame0,
period33, fraction0, origin `(10,20,30)`, clock331→315:

```text
stored frame29; fraction .5151515007019043
origin (10.000452995300293,19.998130798339844,30.010194778442383)
V (-.013727130368351936,.05664247274398804,-.30893269181251526)
```

The applied basis is frame0 despite the stored frame29. Read-only original asset
tests preserve this numeric anchor; synthetic tests cover callback ordering,
underflow, repeat impacts' animation clocks and physical ownership.

## Grounding and runtime contract

`SetCharacterPosition 0x40b0a0` uses mode-1 for the supplied position directly.
Mode1 takes its X/Z and sets root Y to supplied ground Y plus selected
personality move's grounding offset. Mode0 obtains ground Y via
`FindYVerticallyBelow2 0x4e43c0`, then adds the same offset.
`groundPedRootOrigin` implements that final addition. The offset is not
multiplied by the movement scale and is not a visual foot correction.

`SetCharacterMove 0x40a050` calls the grounding helper on a non-morph move
change when its personality grounding mode is GROUND(0), unless retained-root
mode takes its separate orientation path. Native grounding is not a request
to reproject the box onto arbitrary ground every fractional animation tick.
The passive walking path also obtains a source face/contact ground point via
`RecacheAndSetFace 0x4d1b30`. Its support gate includes cached validity, height
minus move-slot0 clearance no greater than jump height plus float32
`0.4347826`, and face-normal Y greater than the configured maximum-slope
cosine. Failure enters the active fall path. The face-selection/cache and
fall-transition provider is not implemented by these root helpers.

Production must retain FORM and remap identity, profile's remapped bounds/COM,
all required root frames, selected move **slot and ID**, period/fraction,
source direction, actual world direction/up, source ground point and native
character velocity. Construct the root actor pose from the chosen frame and
orientation, then attach the remapped local simple box. Preserve the root
world origin separately from COM-based solver state. An original ACT hierarchy
may be rendered independently, but its procedural outer group quaternion is
not an authoritative native body pose.

The per-form simple pool scans for the first free slot, has capacity
`form.maxSimple`, returns21 when full and23 for an already suitable mode; it
does not overwrite a ring slot. `MakeCharacterCollideworthy2 0x408c30` and
initializer `0x4085f0` copy root actor pose and initialize type2, zero world
linear velocity/local omega, and state bytes `ec=ed=1`. Activation
`0x40b620` copies native character velocity, clears `ec`, keeps `ed=1`,
preserves current omega and sets active character flag4 before the passive
damage callback. Fresh bodies consequently begin activation with zero omega.
Further pool and callback detail is in the simple-body/contact notes.

## Installed data coverage and validation

The audit used the existing read-only asset store and original race spawn
specifications. Stock46 and Advanced68 race TXT configurations request the
same136 case-insensitive personality names. Of these,129 have ACT packages
matching the current loader's filename filter. All129 personality, default
movement, FORM and root-remap simple-body parses succeed:

| Form          | Personalities |  Native summed mass | Simple pool |
| ------------- | ------------: | ------------------: | ----------: |
| BIPED1        |           122 | 0.06800000369548798 |          30 |
| DOG1          |             2 | 0.04699999839067459 |          15 |
| COW_FORM      |             1 | 0.12300000339746475 |          15 |
| DEER_FORM     |             1 | 0.12300000339746475 |          15 |
| ELEPHANT_FORM |             1 |   4.409999370574951 |          15 |
| PENGUIN_FORM  |             1 | 0.03799999877810478 |          15 |
| SHEEP_FORM    |             1 | 0.05499999597668648 |          15 |

BIPEDF is separately parsed/tested with native mass68kg; no requested stock
or Advanced personality references it. Seven referenced names have no matching
ACT package: army1, clean01, clean02, cop2, doctor3, doctor4, smart4. This audit
establishes package/data coverage, not successful rendering of every scene.

All136 distinct form/move motion files parse, and135 match their exact FORM
root name. DOG1 move93 `DogPunted.BON` contains `Bone01` instead of FORM root
`Bone_01`. The installed exact-name loader leaves the root in its **zero-filled
allocation**: BrMemAllocate`0x526c00` calls BrMemSet(pointer,0,size) at
`0x526c1a–23`. It does not leave uninitialized data or alias the exporter name.
Strict generic root preparation rejects a missing root by default; native
instances opt into `missingRoot:"native-zero"`, retaining zero basis/deltas and
the ordinary signed−0 XYZ frame0 translation reset. There is no bone0 or
identity substitution. This affects OSCAR and TWOLF move93 in this audit.
DOG91/94 also have `Bone_NO2` instead of FORM `Bone_N02`; their unmatched angle
triplets similarly remain zero. See [active move](c2-ped-active-move-re.md).

`tests/ped-form.test.mjs` verifies numerical cardinal/opposite/slope matrices,
separate pitch, animation-basis preservation, unscaled grounding offset,
signed/wrapped/clamped animation clocks, source direction/reset handling,
original mass/inertia/body data and every installed spawnable package/form
root sequence. Installation-dependent checks skip when originals are absent.
No original asset data is committed. Runtime collision integration, source
ground caching, morphing and articulated bone playback remain outside this
module's acceptance scope.

Validation at handoff: all18 tests passed against the installed originals,
TypeScript `--noEmit` passed, and both authored code/test files passed Prettier.
