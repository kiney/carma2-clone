# PED-11 alternate sever selection evidence

## Evidence and scope

Verified by read-only static inspection of the installed executables after
recording their hashes and PE metadata. No reference implementation was copied.
rec2 `src/carma2/common/pedestrn.c` and `include/rec2_types.h` supplied the
structure and function map; the relevant gameplay helpers remain stubs there.

| Binary | SHA256                                                             | PE32 image base / entry RVA / timestamp |
| ------ | ------------------------------------------------------------------ | --------------------------------------- |
| HW     | `698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c` | `400000 / 177eb0 / 1998-10-18 20:13:36` |
| SW     | `15d08246a43446364e7e8308a434da1821e5aef224b3692f14dadd312949611d` | `400000 / 172ef0 / 1998-10-18 21:16:25` |

Both report linker5.10. HW sever is `40b860`; the matching entry and initial
missing-mask/slot instruction layout starts at SW `40b850`, with data addresses relocated.
Addresses below refer to HW. This note supplements
[ordinary severing](c2-ped-sever-contact-re.md) and
[bone initialization](c2-ped-bone-body-re.md).

## Exploding wrapper

The common loop `4cd4bc–4cd4d8` bypasses the percentage call whenever exploding
or brittle is active, including severChance0. Brittle still changes the budget
threshold to5; exploding alone retains the configured sever threshold.

`4cd790` visits unremoved FORM children in ascending index order before the
selected node. At every visitor it stores the stump counter, then executes
`4cd81e–4cd8b0` when exploding:

1. Draw X with symmetric3, Y with range0..3, Z with symmetric3, spilling each
   component to Float32. The shared CRT returns integer r in0..32767. These are
   `f32(-3+6*r/32768)`, `f32(3*r/32768)`,
   `f32(-3+6*r/32768)`.
2. Add the then-current character world V at `character+d8/dc/e0`, spilling
   each sum to Float32 (`4cd84a–4cd875`). This occurs before the angular draws
   and low-level setup. Do not substitute car velocity, solver contact force,
   or a later post-registration character velocity.
3. Draw three symmetric20 BODY angular components, each
   `f32(-20+40*r/32768)` (`4cd879–4cd8a2`).
4. Pass both supplied vectors to `40b860`. Its missing-mask and boned-slot
   checks therefore occur after these six wrapper draws. Missing selected nodes
   and pool-full failures still consume all six; already missing descendants
   skipped by the recursion consume none. Supplied omega suppresses the three
   ordinary symmetric1 draws at `40b8b7–40b8ff`.

The wrapper runs even for an inactive character. Only the later active tail
copies the supplied launch into the body. Registration failure retains its
existing reservation and draws; the missing mask changes only on success.
There is no additional force impulse or retained-body mass subtraction.

The implementation now executes this wrapper in `ped-sever.ts`, using the
existing live `state.characterVelocity` and shared `nextCrtInteger` provider.
The `exploding-launch` diagnostic effect records the supplied vectors before
the low-level operation. Ordinary spin and failure chronology remain unchanged.

## Nonhumanoid and articulated boundaries

There is no separate nonhumanoid selection algorithm in `4cd480–4cd4fc`,
`4cd790–4cd99d` or `40b860–40ba6e`. The form flag is tested before the loop
to impose minimum normalized damage100 for brittle/exploding (`4cd429–4cd456`)
and in the common HP tail: any removed bit makes a living nonhumanoid HP0 and
effective damage0 (`4cd53f–4cd551`). The retained normalized damage remains the
original integer. DOG1 uses the same random1..N-1 and descendant-first recursion.

Likewise, low-level sever does not choose a different RNG or impulse for an
already articulated character. It uses the retained per-bone resource/actor,
initializes/registers it, sets the missing bit, then at `40b961–40b97d`:

- If parent+228 exists, clear that parent's child+224, then clear own parent+228.
- Clear own child+224 and joint1+188.
- Preserve joint2+18c and next/prev sibling fields.

When character bit4 is set, use the supplied V or the live character V, the
supplied/random BODY omega, then the existing PHIL activation/property tail.
The recursive V and omega setters are `409300` and `40ba80`; this sever path
has already cleared its own child pointer before reaching their call sites.
These stores do not add a joint-separation impulse. Preparation does not erase
retained joint2. Surviving joint2 remains relevant to generic angular limiting
`4c18a1–4c195c` and quiet handling; it is an actual host responsibility.

`NativePedSeverProviders.preflightBones` is now called for articulated as well
as simple inputs. For `input.articulated=true`, this callback is mandatory and
must validate actual retained links, source unlink operations, PHIL registration
ownership and surviving joint2 support before draws/mutations. Absence retains
`source-articulated-joint-sever-provider`. Returning an empty list asserts that
those resources are supported; it must not be inferred from FORM joint names.
The existing `registerBone` and `commitBone` providers continue to own setup,
mask-following unlink/activation, replay and source actor ownership. The kernel
does not implement intact articulation or a joint solver.

## Stock inventory versus optional custom shapes

Read-only parsing found nine FORM files in each of stock `data` and Advanced
`adv_data`, all with positive per-bone masses and exclusively BOX/SPHERE shapes.
BIPED1 has10 bones and FALSE joints; BIPEDF has10 bones, five BALLNSOCKET and
four HINGE templates; DOG1 has16 bones and FALSE joints. Each has one SPHERE
head. DOG1 head index is2; BIPED1/BIPEDF head index is1. BIPEDF templates do not
by themselves prove that a character currently has physical articulated links.

LINE is therefore optional custom-form support for this installed inventory.
The installed FORM allocation jump table `4067b8` maps tag0 BOX to405a40,
tag2 LINE to405a4f, tag4 SPHERE to405a78, and tags1 POLYHEDRON,3 POLYGON and8
NONE to405a87, which explicitly stores NULL shape. The rec2 fallthrough from
NULL shape into LINE allocation does not match the original. Empty tags5–7
jump to405a8e, skipping the allocation switch. Do not reinterpret unsupported
tags or NULL source shapes as LINE or a generic box. Supporting source NULL
resources needs an explicit accepted-null host contract; it is not required by
the installed stock forms and is not implemented by these changes.

## Validation

Five new fixed-expectation sever tests failed before the kernel changes and
passed afterward. The focused sever/contact run passes41 tests, including the
unchanged ordinary chronology, chance0 exploding launch endpoints, repeats and
pool exhaustion, source-V sampling, articulated resource preflight, nonhumanoid
fatal HP continuation and read-only DOG1/BIPEDF tests in both installations.
No proprietary fixtures were created. No browser, runtime integration or full
suite result is claimed here.

## Retained joint2 friction and quiet orientation

The new independent `src/physics/ped-retained-joint.ts` implements the actual
leaf branch HW `4c18a1–4c195c`. SW `4bd7f1–4bd8ac` has the same instructions
and field offsets, using relocated constants0 at584760 and .04f at5847f0.
Installed HW constants are0 at589788 and Float32 .04
(`0x3d23d70a`, exactly0.03999999910593033) at589818.
CRT initialization `5798e0–5798ea` calls the control-word setter with
precision mask30000 and new10000; the established runtime control word is027f
(nearest rounding,53-bit precision). JavaScript binary64 preserves these live
arithmetic operations; explicit source Float32 stores remain separate.

Actual source layout, with rec2 names retained where known:

| Source storage  | Meaning in this branch                                                 |
| --------------- | ---------------------------------------------------------------------- |
| Object+08/0c/10 | Diagonal BODY inertia                                                  |
| Object+74/78/7c | BODY omega                                                             |
| Object+188      | `physics_joint1`, already cleared by successful sever                  |
| Object+18c      | `physics_joint2`, retained by sever                                    |
| Joint+00        | `tPhysics_joint_type type`; not tested by the retained friction branch |
| Joint+04        | `br_scalar friction`, the only joint member read here                  |
| Joint+08/+14    | Existing joint vectors; not consumed by this friction branch           |

For a nonnull joint2 with friction not equal to0:

```text
limitSquared = (friction * Float32(.04))²  // live53-bit, no Float32 spill
normSquared = 0
for i in X,Y,Z:
    liveMomentum = BODYomega[i] * inertia[i]
    normSquared += liveMomentum²          // uses unspilled product
    storedMomentum[i] = Float32(liveMomentum)
if normSquared > limitSquared:           // strictly greater
    scale = sqrt(limitSquared / normSquared)
    for i in X,Y,Z:
        storedMomentum[i] = Float32(storedMomentum[i] * scale)
for i in X,Y,Z:
    BODYomega[i] = Float32(BODYomega[i] - storedMomentum[i] / inertia[i])
```

There is no supplied dt, positive-friction test, positive-inertia test or RNG.
Negative friction has the same squared cap as positive friction. Signed
nonzero inertia follows the same equations. Below the cap, the separate
momentum spill can leave a small cancellation residual; forcing omega directly
to zero would change source behavior. At friction25, live limitSquared is
0.99999995529651686, so BODYomega(1,0,0)/inertia(1,1,1) enters the clamp branch;
rounding the limit to Float32 first would choose the wrong branch.

NULL joint2 or friction equal to positive/negative0 returns before inertia
divisions. Active zero inertia produces native nonfinite divisions, even with
zero omega. Nonfinite input or overflow in stored momentum also has no useful
finite source interpretation. The helper reports named bounded-provider
diagnostics for these cases and leaves output omega unchanged; it does not
invent a substitute inertia or partially commit another axis. This is a safe
boundary, not a claim that the original has those guards.

API: `NativePedRetainedJoint` contains actual source `friction`.
`evaluateNativePedRetainedJoint({joint,inertia,localOmega})` returns status,
requiredProviders, BODY localOmega, applied and clamped. The host owns awake
eligibility, hierarchy traversal, world-angular conversion and committing the
result. It must clear joint1 through the sever owner before treating this as
the complete retained-joint branch.

Quiet has a distinct orientation input. At HW `4bab37–4bab5a`, the code only
checks that Object+18c is nonnull, then (with no collision flags) compares
Object+9c with double5897e0. Object+9c is the middle diagonal element of the
native matrix at+8c: native flat matrix index4. It is not read from the joint.
The historical `nativeJoint2.quietOrientationY` field must therefore represent
current body matrix state rather than immutable joint metadata. Its presence
and source friction are separate pieces of state.

Six focused tests initially failed because the new helper was absent; all now
pass. Fixed Float32 bit expectations were independently evaluated from this
instruction order in a temporary C/x87 oracle configured with CW027f. They
cover isotropic/anisotropic/signed inertia, negative friction, zero/NULL
early exits, unspilled threshold selection, cancellation residuals and bounded
nonfinite cases. For example friction25, omega(3,4,0), inertia(2,1,.5) produces
Float32 output bits40255fd8,405c7fcb,0; the unclamped decimal input
omega(.1,.2,.3), inertia(.3,.7,1.1) produces30cccccd,b0af8af9,31df6b0e.
The oracle did not execute the original function; binary verification here is
static, and the numerical oracle independently checks its reconstructed order.

## Nonhumanoid root-stump look reads beyond the authored array

The installed `MakeEmBleed` root-parent outlet is not gated by HUMANOID, and
the source does not limit the look lookup to its nine authored vectors.
`4d4f5d` initializes a pointer toHW65d064 for bone1. The loop increments that
pointer by12 bytes for every FORM bone at `4d5125–4d5137`. For a parent index0,
`4d50f4–4d5104` applies that indexed triple through the root matrix, then
`DoSpurt4d55f0` transforms the resulting look again. For a nonzero parent, the
source instead uses that parent's current first basis row. Do not replace the
root lookup with an attachment vector or a normalized generic direction.

rec2 correctly declares `gPed_bone_look_vecs[9]`, but that array declaration
does not bound the installed unchecked read. After the array, the audited
initialized-data layout contains `gForm_non_humanoid_names[0]`, padding, an
identity3x4 matrix, and burning-pixelmap-name pointers. A read for bone10
therefore interprets the NONHUMANOID string pointer bits as Float32 X, followed
by0 and1. This produces a small positive subnormal component, not zero. The
same logical read has different bits in the two executables:

| Revision | Lookup base | Bone10 first component bits | Bone13 triple |
| -------- | ----------- | --------------------------- | ------------- |
| HW       | `65d064`    | `0065d170`                  | `(0,1,0)`     |
| SW       | `6579ac`    | `00657ab8`                  | `(0,1,0)`     |

The source binary has a fixed image base and these are its actual native
pointer values. A browser object address or hard-coded HW scalar would not
preserve the selected executable's read. No direct write cross-reference to
this bounded initialized-data window was identified in the audit. That is not
a license to treat arbitrary following memory as an authored direction table.

Stock and Advanced DOG1 have root children1,3,4,7,10,13. Other installed
nonhumanoid forms also use root child10 or11; bone11's adjacent triple is zero.
The maximum installed FORM count is16. The new bounded PE reader
`readNativePedBloodRootLooks(bytes)` locates the unique nine-vector signature
inside a complete initialized, non-executable x86 PE32 section, validates the
next pointer's bounded NONHUMANOID string target, and returns the15 raw triples
for bone indices1..15 with source address/file offset. It reads the user's
configured local image as data; no original payload is embedded or generated
into source. Both component bits and the original absence of normalization are
preserved.

The bleeding host's `readRootLook(index)` provides these actual raw words for
indices beyond9. Missing words report `native-blood-root-look-<index>` before
cache, RNG or packet mutation. The PE adapter deliberately stops at15; custom
forms reaching later root indices need an explicit provider rather than a
fabricated32-vector extension. The existing original nine-entry humanoid path
retains its behavior and requires no extra provider.

Four new regression tests failed at the missing-reader export before the fix;
the focused blood-phase run now passes22 tests. Coverage includes actual HW
and SW provenance/pointer bits, DOG1 bone10 packet direction after both matrix
transforms, high-index root child13, malformed/truncated PE rejection and an
explicit missing custom bone31 lookup with unchanged cache. Browser validation
belongs to the integrating runtime owner.
