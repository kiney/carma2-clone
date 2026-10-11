# C2 pedestrian simple collision body

## Evidence and scope

Read-only installed `carma2_HW.exe`, SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
PE32 base `0x400000`, entry RVA `0x177eb0`, linker5.10, timestamp
1998-10-18 20:13:36. Addresses below refer to this installed executable;
some rec2 annotations differ. madebr/rec2 was used as a symbol/data-format
map, independently checked against installed instructions where stated.
No reference implementation or proprietary asset contents are copied here.
This note defines the intact simple body, not articulated dismemberment or
the complete animation/get-up machine. Contact damage is covered in
[c2-ped-contact-re.md](c2-ped-contact-re.md).

## Authored inputs and construction

**Verified installed construction; reconstructed input grammar.** A personality
opens `PEDS/PEEPS/<name>/<name>.TXT`, including virtual files inside its TWT.
Its first records select the form and default movement table. A form begins
with maximum simple bodies, maximum articulated bodies, maximum render sets,
maximum stored dismembered characters, and a remap filename (`NONE` permitted).
The following bone sections contain the name and mass in kilograms. Nonzero
mass bones additionally describe collision type, parent/joint and limits.

Installed `0x4052fa–0x40531e` reads each mass, multiplies by **double0.001**
(`0x588378`), stores the result as Float32, adds it to a Float32 accumulator
and stores that accumulator. It does not select masses by collision-type
keyword. Installed `0x405bb1–0x405bf3` allocates every simple slot a `0x4d8`
byte rigid body, copies the accumulated mass to rigid `+4`, allocates a
**box** shape with `0x4c5bb0`, and initializes its occupied byte to zero.
The personality mass `+0x4c` copies simple-slot0 rigid `+4`
(`0x407258–0x40726a`). There is no separate personality mass or pedestrian
weight override in these records.

After the personality's final `END OF MOVES`, three vector records provide
bounding-box minimum, maximum, and centre of mass. Each is remapped with
**form bone0's general remap**, then min/max are independently sorted on
each axis (`0x407547` onwards; COM `0x40765b–0x4076bb`). They remain in native
model length units; the kg conversion is not a length conversion. The radius
`+0x60` is the greatest absolute component among all six sorted bounds,
not a Euclidean corner radius (`0x4076bf–0x407759`).

Remap files `PEDS/REMAPS/<filename>` associate bone names with three general
axis choices and three powerup axes. General choices are `+X,+Y,+Z,-X,-Y,-Z`
(codes0..5). For each destination component `i`, copy original component
`choice[i]%3`, negating when `choice[i]>=3`. Read from a saved original vector,
not a partially remapped vector. Powerup axes are separate metadata.
The same general remap is applied to each associated model's vertices and to
child/parent joint attachment vectors in their respective bone spaces.

**Original-data check.** BIPED1 uses MAN.TXT. Its root `Bip01 Spine` general
map is `(+Y,+X,-Z)`. Stock Blokebl's resulting body bounds are
`(-.15,-.065,-.03)..(.135,.065,.03)`, and COM is `(.04,0,0)`.
Thus the long body axis is **native local X**, not local Y. These are metadata
examples inspected from the local installation, not distributable fixtures.

## Allocator, shape, inertia and ownership

**Verified installed.** `MakeCharacterCollideworthy2 0x408c30` uses mode0 for
simple collision and nonzero mode for articulated collision. It first ensures
a render set. For simple allocation `0x408eb2–0x408f38`, a negative explicit
slot index scans the form's simple pool in increasing order for the first
occupied byte equal to zero. Pool stride is8; rigid pointer is `+4`;
capacity is form byte `+0x2b`. A full render/simple pool returns21 (`0x15`),
not an overwrite. An already appropriate collision mode returns23 (`0x17`).
Success sets character flags `+0x14=1`, character slot byte `+5`, and slot
occupied byte to1. A body belongs to its form pool and to one character;
it is not an individually spawned unbounded rigid body.

Initializer `0x4085f0` takes owner character in ECX and rigid in EDX. The
simple caller passes the native render-set **actor0**, personality bounds
`+0x34`, authored COM `+0x54`, type subindex0, registration flag, and no line
endpoints. It copies actor matrix `+0x2c` to rigid pose `+0x8c`, stores actor
pointer `+0` and owner `+0x23c`, sets rigid type `+0x238=2`, zeros world linear
velocity `+0x68..70`, local angular velocity `+0x74..7c`, and auxiliary
acceleration vectors. Initial state bytes `+0xec/+0xed` are both1.

Shape initializer `0x4087b0` dispatches shape tag0 to the box branch
`0x408b1b`, copying the authored six bounds into shape `+4`.
`0x4c5cd0` updates shape-derived geometry; `0x4c5e50` updates rigid bounds.
Let `dx,dy,dz=f32(max-min)`. Installed `0x408b67–0x408bdc` computes:

```text
Ix = f32(M * (dy² + dz²) * f32(0.025))
Iy = f32(M * (dx² + dz²) * f32(0.025))
Iz = f32(M * (dx² + dy²) * f32(0.025))
```

The instruction order retains some intermediate x87 values and spills
selected squared terms to Float32. The native coefficient at `0x588390` is
`0.02500000037252903`, **not 1/12**. These moments depend on box extents; the
authored COM then overrides rigid `+0x14..1c` without a parallel-axis correction
in this initializer. A solver using metres must transform inertia consistently
with its own length convention; do not change the native coefficient.

Registration goes through `PHILAddObject 0x4b6050` and property setter
`0x4b6150`. The simple passive initializer sets properties0=1, 3=1, 4=1,
5=1, 7=1, 8=`global0x74299c`. Properties3/4/5 correspond to rigid flag bits
`0x40/0x8/0x10`; property7 sets queued owner flag8 and `water_d=10000`.
The names of the latter two owner scalars are not resolved here.
Callback `CBFillInObject 0x4cc860` initializes type2 collision fields
`+0x1a0=0x10000`, `+0x1a4=0x50000`; type5 instead uses `0x40000/0x50000`.
Do not replace these with an unconditional car-only collision mask.

## Native root pose provider

**Reconstructed and installed call path checked.** Native rendering allocates
one BRender model actor per form bone (`0x405c25–0x405c53`), not a personality
ACT scene. `MakeCharacterRenderable2 0x408200` selects the personality model
variant table into each actor and calls `SetCharacterBonePositions 0x407b20`.
Personality entries that happen to end in `.ACT` are model identifiers passed
to `BrModelFind`; they are not instructions to use that ACT file's hierarchy.
The native simple-body actor0 consequently has a pose produced by the BON/SKL
movement data and character orientation.

For the intact root, `SetCharacterBonePositions` multiplies the normalized
movement root-frame matrix by character orientation matrix `+0x8c`, preserving
the root's old position when translation is disabled. When enabled, root-frame
translation delta is multiplied by the personality move scale and transformed
as a vector by character movement matrix `+0x5c`, then added to the previous
world position (`0x407d10–0x407df2`). `ReadMove` first applies `Flip3DStoBRaxes`
to every authored 4x3 matrix and low-precision normalizes its basis. The flip
maps vector `(x,y,z)` to `(x,z,-y)` and conjugates rotation into that convention.
For the root, successive frame translations become deltas; looping reset axes
and frame0 handling are taken from the form's movement record. Root orientation
is the full frame basis, not a direction reconstructed from average stride.

`SetCharacterDirection 0x40a730` uses the move's source direction, requested
direction and up vector to construct character `+0x8c/+0x5c`, preserving the
current root animation basis. Grounding also uses the selected personality
move's **grounding mode and offset**. Root actor origin and body COM world
position are different points: `COMworld = actorPose * authoredCOM`.
The passive animation path must produce the native root actor pose before
using its oriented box in collision.

## Activation and contact solver phase

**Verified installed.** Passive activation chain:

```text
PHIL activation 0x4b6f50 -> APTCPassiveActivated 0x4162d0
  -> character activation 0x40b620 -> CBPassiveCollision 0x4cd9b0
```

When not already active, `0x40b691–0x40b6d9` copies character world velocity
`+0xd8..e0` to rigid `+0x68..70`, recursively to attached child bodies, clears
state byte `+0xec`, and calls `PHILMakeObjectActive 0x4b5e30` with null velocity,
null omega and argument1. **Null arguments preserve those current vectors.**
Consequently a freshly constructed simple body's omega remains zero; activation
does not manufacture a random spin or upward launch. It sets `+0xed=1`,
properties0=1 and3/4/5=0, sets character active flag4, then calls the passive
callback. Already-active characters skip initialization and pass a null selected
rigid to that callback.

Character velocity is the original movement velocity, not car velocity.
`MungeCharacterAnimation 0x409ca0`, normal non-morph tail
`0x409fa1–0x40a01a`, stores `f32(newRootPosition-oldRootPosition)` and divides
each component by `processedAnimationFrames * signedFramePeriodMs * double.001`.
If zero frames are processed it preserves velocity unless frame period is0,
which zeros it. Morph animation is a separate provider not decoded in this note.

The callback performs damage/state transitions; it does not directly apply a
launch impulse. The common collision solver activates passive bodies before
applying collision impulses. Active grouped contact callback `0x4d20e0` is
called from `ProcessForcesCallback 0x41c1d0` at `0x41d991/0x41da16`, after
normal multipliers are solved and before they are applied. Its lambda is the
first grouped row's solved lambda; its force is the grouped normal-weighted
force transformed to the pedestrian's world basis, without the spark 6.9 scale.
Halted/moved callbacks run once at the outer-frame changed-object dispatch,
not once per collision row. See the contact note for eligibility and HP formulas.

## Production integration contract and current reusable data

An intact body provider should expose: form identity and bounded simple/render
pool capacities; f32 summed native mass; root-remapped ordered bounds and COM;
native inertia triple above; the selected move slot/frame/period and grounding
metadata; source root actor world matrix; native character world velocity;
rigid type2, owner/HP/flags, passive/active state and source collision masks.
Keep geometry local to the root actor; the solver may maintain COM position
internally only if it converts back to actor pose when synchronizing rendering.

At the pre-contact barrier, preserve other-body mass/velocity and the character
velocity before impulse application, activate the body exactly once, evaluate
the passive damage kernel, then solve contacts with the body's actual mass,
inertia and point offsets. Dispatch active damage kernels from the solved-row
barrier and synchronize the resulting pose through the outer-frame callbacks.
Persisting an existing active body's omega is part of reactivation semantics.

Current reusable browser data: `Assets.scene` returns parsed DAT models and
ACT hierarchy; `parsePedMotion` retains all raw frame-major 4x3 BON/SKL matrices
and bone names; `loadPedProfile` reads form/default/personality movement
metadata, mass and bounds. Missing from its retained profile are the general
remap, COM, form capacities, full normalized/flipped root frame bases, movement
reset/direction/grounding-mode metadata and the native pose state. Its mass scan
currently recognizes only BOX/SPHERE/POLYHEDRON keywords rather than parsing
each form bone section and accumulating f32 masses. Its bounds remain unremapped.

The largest-ACT visual selection, procedural rig/limbs and geometric foot offset
in `src/pedestrians.ts` are not source providers for native simple collision.
Physics can use an independent movement/root-pose provider while preserving
the current renderer, but correct source-to-visual bind transforms must be kept
explicit; using the wrapper yaw with remapped bounds would rotate the stock
humanoid's long axis incorrectly. Full articulated joints, morphology/animation
blending, special-volume property semantics, post-contact fall/get-up selection
and source low-precision matrix-normalization rounding remain outside this
bounded contract. These limits prevent claiming complete PED-03 fidelity.

## Independent parser and math implementation

`src/ped-form.ts` now provides bounded `parsePedForm`, `parsePedRemap`,
`parsePedPersonalitySimpleBody` and `parsePedPersonalityMoves`. The profile
optionally merges the default movement text before personality overrides;
missing movement records remain absent. Bone model records are matched by
name, allowing a personality order different from the form. Form joint limit
records are retained as bounded text, not implemented articulated physics.
Zero-mass personality attachment semantics are explicitly unresolved and
rejected by the simple profile provider.

`buildPedRootMotion` consumes the existing `parsePedMotion` shape without a
runtime dependency, providing flipped/normalized root bases and authored
per-frame deltas with reset handling. `composePedRootPose` composes the full
source basis with a supplied native character orientation and explicit root
world origin; it does not invent the orientation, grounding or animation clock.
`transformPedPoint` maps COM to world space. Output matrices are native
row-major 4x3 Float32Arrays, not Three.js Matrix4 element arrays.

Additional installed evidence: `ReadMove` calls `BrMatrix34LPNormalise` at
`0x404ad4`, target **`0x5325a0`** (rec2 annotation `0x532f60` is different).
It normalizes row2, normalizes row1×row2 into row0, then sets row1=row2×row0.
The fallback normalization threshold is `2^-22` at `0x58a8e0`; a vector at
or below that threshold becomes `(1,0,0)`. The independent helper uses this
ordering and Float32 stored components. Exact extended-x87 intermediate
rounding may differ at Float32 boundaries; arbitrary-precision x87 emulation
is not provided.

`ReadRemap`'s count pass recognizes `NEXT BONE`, but its read pass consumes
the final separator without checking its spelling. The installed DOG.TXT
contains a malformed final non-command separator; the parser preserves this
verified quirk while rejecting an incomplete extra `NEXT BONE` record.

Validation: eleven numerical/malformed-input/source tests in
`tests/ped-form.test.mjs` pass, including optional original BIPED1/BIPEDF/DOG1,
Blokebl/Bandsman/twolf personalities and a stock root BON movement. Source
checks skip cleanly when the installation is absent. No proprietary fixture
is stored. TypeScript checking passes. Runtime body integration is separate.
