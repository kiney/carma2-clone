# C2 pedestrian physics lifecycle and settling

## Evidence and scope

**Verified installed instructions unless explicitly marked unresolved.**
Read-only `carma2_orig/carma2_HW.exe`, SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
PE32 base `0x400000`, entry RVA `0x177eb0`, linker5.10, timestamp
1998-10-18 20:13:36. madebr/rec2 supplies symbol/structure names;
its addresses can differ and its callbacks remain stubs. No reference code
or proprietary fixtures are included. Shape, mass and actor-root providers
are documented in [c2-ped-simple-body-re.md](c2-ped-simple-body-re.md) and
[c2-ped-root-pose-re.md](c2-ped-root-pose-re.md). Damage equations are in
[c2-ped-contact-re.md](c2-ped-contact-re.md).

This contract covers intact simple pedestrians, PHIL state, activation,
callback ownership and the independently implemented `0x417fd0` angular
settling helper. It does not claim the complete severing/get-up machine.

## Allocation and independent states

`MakeCharacterCollideworthy2 0x408c30`, simple path `0x408eb2–0x408f38`,
uses a per-form pool: byte capacity `form+0x2b`, slot stride8, occupied byte0,
rigid pointer4. Negative requested index finds the first free increasing
index. Full render/body pool returns21; an appropriate existing collision
mode returns23. Success sets character flags literally1, saves slot byte5
and marks the slot occupied. `0x4085f0` initializes that pool body from the
prepared native actor0, personality bounds/COM, type2 and character owner.
Allocation `0x526c00` zeroes storage, so object friction `rigid+0x64` is0;
initializer explicitly sets world friction `+0x60=1`.

These states are distinct:

| Field                       | Meaning                                               |
| --------------------------- | ----------------------------------------------------- |
| character `+0x14` bit1/2/4  | simple / articulated / physically active              |
| PHIL header `+8` =1/2       | registered passive / active                           |
| rigid `+0xec`               | solver do-nothing/sleep, independent of header state  |
| rigid `+0xed`               | persistent world overlap recovery; not a passive flag |
| rigid `+0xf0` =2            | collision-phase marker requiring passive activation   |
| rigid `+0x1dd`              | collision flag consumed by settling helper            |
| rigid flag `+0x19c` bit0x20 | PHIL passive registration                             |

`PHILAddObject 0x4b6050` uses the first free normal100-entry header pool,
returns2 for duplicate and1 for full, clears the header and sets state1,
rigid bit0x20, queued indicator `+0x239=1`. During object munging it can defer
registration through a25-entry queue; host mutation must preserve phase
ordering. The character pool remains the body owner regardless of PHIL
registration. Releasing a character is not allocating a new independent body.

Property setter `0x4b6150` stores gravity(property0)=1 and initially
properties3/4/5=1, property7=1 and property8=`global0x74299c`.
Properties3/4/5 map to rigid bits0x40/0x8/0x10. Their verified consumers are
world face suppression (`0x4c1e24` sets faceStart=faceEnd), omission of the
object-self sentinel in candidate construction (`0x4bd6d0`), and suppression
of joint-constraint generation (`0x4bae8d`), respectively. Bit0x10 is not
an angular-velocity lock. Property7 enables volume handling in header bit8.
Header drag `+0xc` stays0; gravity `+0x10` is1; level-out scalar is `+0x14`.

## Masks, real contacts and activation phase

`CBFillInObject 0x4cc860` assigns intact type2 masks
`filterA=0x10000`, `filterB=0x50000` at rigid `+0x1a0/+0x1a4`.
Type5 fragments initialize `0x40000/0x50000`. These are **exclusion masks**:
`0x4ba290` and pair loop `0x4bd918` reject a pair if
`(A.filterA & B.filterB)!=0` or `(B.filterA & A.filterB)!=0`, or either
rigid flag0x4 is set. Pair loop also skips self, immediate parent/child,
and ordered duplicates in the same collision group. After a damaging passive
hit, intact masks become `0x20000/0x40000`; struck type5 uses
`0x40000/0x40000`. Restore the original masks on accepted halt.

Native world contact emitter `0x422800` and body narrow phase `0x425c00`
produce actual shape contacts. A positive world-contact count for `f0=2`
ascends the physical hierarchy, clears its marker recursively (`0x4bd750`),
then calls passive activation at `0x4bd89d`. A successful body pair at
`0x4bd965` activates A then B as required, each with the other body pointer.
Activation happens **before** contact lambda solving/application. It does
not use an actor-distance or visual sweep proxy and does not manufacture V
from car speed.

`PHILActivatePassive 0x4b6f50` calls the generic/registered passive callback
only for header state1. Physics callback `0x4162d0` forwards owned type2
characters to `0x40b620`. Fresh activation selects the existing simple/root
body, clears `ec`, copies **character world V `+0xd8..e0`** to the body and
children, calls `PHILMakeActive 0x4b5e30` with null V/omega pointers and halt
callbacks enabled, sets `ed=1`, sets gravity1, clears properties3/4/5, and
sets character bit4. Null pointers preserve the already initialized vectors.
No random angular velocity or additional factor6.9 is introduced here.

Only after this does the character call `CBPassiveCollision 0x4cd9b0`.
Its early `ped+8` bit0x40 gate returns0 without damage when absent. This
gate cannot be interpreted as permission to skip the preceding activation.
The visible pedestrian outer loop arms bit0x20 first, bit0x40 next, giving
newly visible pedestrians two outer iterations before damage eligibility.

`SetCharacterPhysicsLevel 0x409570` is installed cdecl with character,
level and registration-extra arguments. Level0 releases collision bodies;
level1 selects passive simple; level5 selects active simple. Other bit2
combinations select articulated state. Lowering an active level invokes
halt before release/reselection. Active level copies character V and
enables the same properties as the contact activation path. Walking roots
keep native prepared actor poses and current root-motion V available to
physics even though `ec=1`; passive V must not be integrated as active motion.

## Forces and post-physics ownership

The PHIL40ms loop applies forces only with header state2 and `ec=0`
(`0x4b6538–0x4b6558`). `ProcessGravity 0x4b6c60` normal branch writes
`gravityY=f32(-0.05681159420289855 * headerGravity * globalGravity)`
per40ms, in native world velocity units. Volume handling additionally uses
volume gravity `+0x88` and body depth `+0x254`. The viscosity/level-out branch
uses `f32(((1-volumeGravity)*depth*headerLevelOut -
headerGravity*globalGravity*1.4202898550724639)*0.04)` when its source gate
holds. Full volume levelling is a separate provider (`0x4b6d50`).
Do not apply an extra length/velocity factor6.9 inside this native contract.

The drag gate `0x4b65d5–0x4b6629` skips air drag when header drag is0;
volume handling with header flag8 may enable a drag pass with fallback1.
The project's existing unconditional `applyGenericVolumeForces` air drag
therefore needs the header gate before reuse for simple pedestrians.

`ChangedObjectsCallbacks 0x4b6980` runs once after the frame's40ms physics
iterations/interpolation, using the outer frame period, for active PHIL
headers. With `ec=0`, moved callback `0x416320→0x40b770→0x4d26f0` derives
character orientation from the physical root actor and inverse current
root-animation basis, copies body V to character V, and updates pedestrian
position from actor translation. It calls settling with V, gain1.39, min.1.

With `ec=1`, header callback bit2 enables halt
`0x416290→0x40b760→0x409400→0x4d0de0→0x4d0df0`.
The wrapper derives the same character orientation and clears character
active bit4 **before** the pedestrian callback. Callback0 restores bit4,
retains active PHIL state and allows continued settling; callback1 keeps
`ec=1`, copies final body V to character V, restores properties3/4/5, and
allows PHIL to become passive (header1, rigid bit0x20). An animation get-up
must begin from this accepted physical orientation, not the old walking pose.

The verified halt retry branch chooses the highest positive-Y cached face
normal, tests upright character `orientation[1][1]>.93`, otherwise chooses
the strict greatest-inertia axis (ties fall to Z) with the negative actor
axis direction. With nonzero normalY and `abs(axisDotNormal)<.706`, it can
retry when a pedestrian cache exists and its retry count is below3 alive
or2 dead. It calls settling with the selected negative actor axis times a signed global
scalar, gain1.39/min0, increments the retry count, clears `ec`, synchronizes
the root and returns0. Source moves90–113 require animation/head-model state;
additional severing/powerup branches require their own limb providers. Ordinary lying branches
select move80/81 and form lying axes; accepted tail `0x4d1933` copies actor
pose to rigid pose, sets flag0x100, restores masks and clears volume state.
Default get-up completion resumes running41; blind/valium select walking30.
See [the exact halt/recovery contract](c2-ped-halt-re.md). This evidence does
not justify a fixed timer for falling/get-up.

## Verified quiet-state and sleep request

`src/physics/quiet-state.ts` independently implements the leaf evaluator
`0x4ba7a0`, hierarchy fold `0x4babcf–0x4bac06`, contact-ring eligibility
`0x4ba6cc–0x4ba6ff`, and the friction-row collision-flag queue gates.
This is generic body physics shared with cars/parts/props, not a pedestrian
settling timer. No elapsed-time field or timestamp occurs in this criterion.

`DoCollisions 0x4ba450` calls `InternalPrepareObject 0x4b9780` after the
step's forces but before contacts. Preparation copies world V to immutable
`+0x1b4..1bc`, local omega to `+0x1cc..1d4`, and transforms world V to the
solver's mutable local-V cache `+0x1a8..1b0`. Normal and friction impulses
update the latter cache as well as world V. Preparation clears collision
byte `+0x1dd` (`0x4b97ed`) and initializes the collision ring `+0x1d8` to
self. Retained quiet state `+0x1df` can temporarily multiply inertia by50
for an awake body (`0x4b9885–0x4b98c3`); the evaluator restores moments using
stored scale `+0x21c` before testing them (`0x4ba7bb–0x4ba7e8`). The kernel
accepts restored moments, not the temporary solver-scaled moments.

After normal/friction processing, an awake singleton clears its incoming
quiet state; connected rings can retain it. The two primary strict gates are:

```text
linearSquared = |V_after|²
angularEnergy = Σ Ii*(omega_before_i + omega_after_i)²/M
linearSquared < double(.001)
angularEnergy < double(.00009)
```

The angular expression stores X/Z sums to Float32 before multiplying them
by their still-live sums; Y stays live. If incoming quiet state is nonzero
and collision flags are zero, the linear test substitutes0. Nonzero incoming
state bypasses the following fresh-candidate tests, but not angular energy.

Fresh candidates normalize the actual gravity increment, with its magnitude
and normalized components stored Float32, then require:

```text
upNew = f32(-dot(V_after, gravityNormal))
upOld = f32(-dot(V_before, gravityNormal))
upNew < f32(.012)
upNew - upOld > f32(.9)*f32(|gravityIncrement|)
```

**Zero gravity is verified, not approximated:** division0/0 produces NaN;
`fcom` sets status AH=0x45. Both gravity branches test AH bit1, which is set
for unordered comparisons, so both gravity tests pass. The corner and
joint-info tests still run. The host helper represents this explicitly with
`gravityComparisonUnordered=true` without exporting NaN.

For each of eight native local bbox corners, test the source expression
`u=solverLocalV_after + omega_after×COM + omega_after×corner` against
`|u|²<=f32(.0004)`. The **plus COM** sign is verified from instructions.
The COM/base vector spills Float32, X squared stays live and Y/Z multiply
live components by their Float32 spills. Corner order starts max/max/max;
X-min uses index bit2, Y-min bit1, Z-min bit4. The additional joint-info
gate rejects a body with nonnull `+0x18c`, collision flags0 and native
pose component `+0x9c<=double(.999)`. Intact simple pedestrians have no
joint-info pointer, so this gate does not constrain them.

A qualifying body zeros world V, local omega and auxiliary local omega
`+0x1c0..1c8`, but does not clear the mutable local-V cache. Its own state
is1; the leaf fold multiplies by3, giving state3. Parents combine their
own eligibility with all children's bit2. Sleep application
`0x4ba6be–0x4ba764` requires bit2 on every circular-ring member, sets `ec=1`
on the whole ring/hierarchy, and clears their quiet states. Remaining awake
bodies then integrate through `0x4c1680`. The independently exposed leaf
result proposes velocity zeroing and quiet eligibility; it does not mutate
`ec` or arbitrarily sleep a partial group. Already-do-nothing bodies skip
evaluation but retain the source hierarchy/leaf byte fold.

Friction queue `0x4bbc58–0x4bbcf7` requires nonzero lambda and excludes
row types9/11, then copies at most50 records in source order. The later
callback `0x4c0870` sets pair bit2 on both bodies if B exists and type is
not14; otherwise it sets world bit1 on A. Flags are set before callback
slip/friction gates. `collectNativeCollisionFlags` requires accepted rows
and freshly cleared input flags, matching this preparation phase. Zero
lambda rows do not set flags. With multiple40ms steps in one outer frame,
the moved/halt callback sees the final step's flags, not a frame-wide OR.
Recovery byte `ed` initially1 is overwritten with overlap detection by
`0x422e92`; no-face/capacity early returns preserve its previous value.

Boundary tests cover both sides of .001/.00009/.012/.9/.0004, retained
versus singleton state, plus-COM corners, zero gravity's unordered branch,
hierarchy/group folds, signed lambda/type14 and queue capacity50. Source
Float32 stores are explicit; live x87 operations retain the same existing
limitation of JS double rather than the80-bit x87 mantissa.

## Settling helper implemented independently

`src/physics/ped-settling.ts` implements installed `0x417fd0–0x41824b`.
Explicit inputs are the body world vector, **first** cached world-face
normal, native actor basis, native mass/moments/local bounds/local omega,
collision flag and `ec`. The function changes only local omega and consumes
no RNG. A missing face produces a host diagnostic rather than an invented
ground normal; malformed/non-finite input throws.

1. Return unless collision flag or `ec` is nonzero. Return for speed² less
   than min²; equality runs. Spill speed² to Float32 for the later square root.
2. Compute `DRVector3SafeCross 0x403f90(normal, vector)`. When all cross
   components have absolute value strictly below `2.384185791015625e-6`, use
   normal crossed with the unit axis of the smallest absolute normal
   component (ties X then Y then Z). Normalize above threshold `2^-22`,
   otherwise use X. Transform world axis with actor transpose
   `BrMatrix34ApplyTV 0x532cd0` to obtain local axis.
3. Return if `dot(localAxis,localOmega)>1.5`; equality and negative large
   projections run. Compute dimensions `di=f32(maxi-mini)` and
   `ti=f32(localAxis_i*Ii/(f32(.5)*di))`.
4. Set `liveOmega_i=old_i+ti*(gain*f32(.1)*(sqrt(f32(speed²))-min)*M)`.
   Native live x87 arithmetic becomes JS double; explicit Float32 stores
   are retained. No dt or generic-friction coefficient is added.
5. Compute the source mixed norm `sum(liveOmega_i*f32(liveOmega_i))`.
   If greater than400, scale by `sqrt(400/f32(norm))`; X/Y use live values,
   Z uses its Float32 spill, then all components store Float32. Otherwise
   store the components directly. Maximum angular magnitude is approximately20.

Tests include gates/equality, signed projection, actor transpose, degenerate
cross/ties, cap, bounds/non-finite rejection and four original FORM/profile
mass/moment vectors (human, dog, cow, elephant; optional installed assets).
Those tests use independent fixed expected values and read originals only.
Precision limitation: JavaScript double does not retain x87's80-bit mantissa.

## Production integration and remaining source providers

Existing `Simulation.allBodies()` currently contains cars, detached parts,
props and mines. An intact pedestrian must enter that same shape-contact/
solver path through a bounded per-form slot, with two exclusion masks,
PHIL state/sleep/recovery kept separate, authored inertia/COM/root pose,
world V from native root movement and local omega preserved. On a real
passive contact activate once before solving, then apply source passive
damage. Active contact damage receives the existing solver impulse/force
packet, not a second fabricated car kick. Run moved/halt callbacks after
the outer physics frame; write physical root pose back before pedestrian
rendering/animation. Release removes PHIL registration and frees the same
form slot. Root animation resumes only when source halt is accepted.

The runtime container needs header registration state1/2, halt-callback bit2,
gravity1/drag0/volume-enabled bit8/level-out; independent rigid `ec`, `ed`,
phase marker `f0`, passive flag0x20, quiet state, collision flags, pre-contact
world V/local omega, mutable solver local V, auxiliary local omega, physical
root pose and first cached world face. Resolve phase-marker/passive flag
effects before invoking the leaf kernel. Clear/snapshot every40ms after
forces and before normal application; commit normal poses, flush deferred friction,
queue collision flags and evaluate quiet,
fold whole contact groups without another pose integration. Outer-frame
callbacks still decide whether pedestrian sleep is accepted or rejected.

Remaining essential providers are complete halt/get-up/severing move branches and
movement-completed transition; articulated hierarchy contacts/joints;
volume-level-out and low-gravity outlets. `CBMovedByPhysics` separately
consumes shared CRT RNG for moves93/94/97 animation period
`clamp(trunc(FRand(.6,1.4)*25/speed),20,150)` (multiply1.5 and truncate in
low gravity). Alive low-gravity bodies with angular magnitude<1 receive
three `SFRand(5)` angular additions; with depth<1 and VY>-.02 receive
`FRand(0,-.3)` vertical addition. These are explicit pending lifecycle
providers, not hidden draws inside the implemented helper.
