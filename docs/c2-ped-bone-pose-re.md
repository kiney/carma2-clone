# C2 pedestrian bone pose and model alignment

## Result and evidence

Ordinary intact pedestrian rendering can use one model actor per FORM bone,
with independently computed world matrices. The native child **rotation is not
relative to its parent**. Only its joint position depends on the parent's
matrix. Loading an ACT hierarchy under a yaw-only, Y-up walking wrapper cannot
produce the root matrix used by the authored simple collision body.

Evidence is the read-only installed `carma2_HW.exe`, SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`, PE32
base400000, entry RVA177eb0, linker5.10, timestamp1998-10-18 20:13:36.
`madebr/rec2` supplies names and structure locations; the equations and branch
conditions below were checked against the installed binary. No reference code
or original asset contents are copied into the implementation or this note.
The original inventory examples are small read-only measurements, not fixtures.

| Installed address                | Evidence                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `403f20–403f56`                  | Build 256-entry Float32 sine/cosine tables                                             |
| `404ad4`, `40628d`               | Duplicate/inlined ReadMove paths call LP normalise5325a0 after export flip             |
| `4062a0–406389`                  | Root basis/delta storage and child XYZ_S high-byte angles                              |
| `4070e1–4071e2`                  | Read child attachment through child remap, then parent attachment through parent remap |
| `407b20–407e59`                  | SetCharacterBonePositions; rec2 annotation407b30 differs                               |
| `407e60–4080ca`                  | SetBoner; rec2 annotation407e70 differs                                                |
| `4080d0–4081f7`                  | Quantized XYZ_S angles to matrix                                                       |
| `408200–408399`                  | MakeCharacterRenderable2: restore stored poses and assign models                       |
| `4085f0`                         | Physics body setup copies selected actor matrix and current model bounds               |
| `40949c–4094d9`, `40b7c9–40b813` | Physics halt/moved wrapper derives orientation and poses children                      |
| `40b420–40b568`                  | Per-bone/all-bone pose/model-set selection                                             |
| `4cba10–4cba3a`                  | Add actor to universe when unparented and root or missing bone                         |
| `531710–531954`                  | Matrix to BRender Euler angles                                                         |
| `532d70–532d97`                  | Post-multiply matrix through Mul531c60                                                 |
| `575190–5751b6`                  | Floating integer conversion explicitly truncates toward zero                           |

See also [root pose](c2-ped-root-pose-re.md),
[simple body](c2-ped-simple-body-re.md),
[lifecycle](c2-ped-physics-lifecycle-re.md), and
[sever contact](c2-ped-sever-contact-re.md).

## Matrix and attachment convention

Matrices are native twelve scalars: basis rows0,1,2, then translation row3.
For row vector `v`, `applyV(v,M)=sum(v[i]*M.row[i])`; `applyP(v,M)` also adds
`M.row3`. `A*B` applies A first, then B. A Three.js Matrix4 conversion must
preserve that point equation; its column-major element array is not a native
12-scalar array.

Personality bone records are matched by exact FORM bone name. Each record has
up to four comma-separated model pose identifiers. For a nonroot bone the next
**first vector is the attachment expressed in the child model's coordinates**
(personality bone+20); the **second vector is expressed in the parent's model
coordinates** (+2c). They are not local actor translations. Loading remaps the
first vector through this bone's general remap and the second through the
FORM parent's general remap. These same vectors are copied into real joint
records when the FORM supplies a joint. FALSE-joint BIPED1 still uses them for
animation positioning.

For general choices codes0..5 = +X,+Y,+Z,-X,-Y,-Z, output component i copies
input component `choice[i]%3`, negating when choice>=3. This is separate from
the powerup remap. General remap applies to model vertices and attachments;
**do not also apply it to the already exported/normalized animation matrix**.

Original bone2 examples, rounded here to their authored decimal precision:

| Personality | Raw child / raw parent        | Child general map | Parent0 map | Native child / native parent      |
| ----------- | ----------------------------- | ----------------- | ----------- | --------------------------------- |
| Blokebl     | (.014,.007,0) / (.014,.007,0) | (-Y,-X,-Z)        | (+Y,+X,-Z)  | (-.007,-.014,-0) / (.007,.014,-0) |
| Bandsman    | (.012,.009,0) / (.012,.009,0) | (-Y,-X,-Z)        | (+Y,+X,-Z)  | (-.009,-.012,-0) / (.009,.012,-0) |

Bone3 has parent2. Blokebl's raw two vectors are both(.018,-.071,.009), remapped
to(.071,-.018,-.009). Bandsman's are both(.016,-.067,.009), remapped to
(.067,-.016,-.009). Even identical raw vectors can become different native
vectors when child and parent remaps differ, as bone2 demonstrates.

`parsePedPersonalitySimpleBody` now retains these independently remapped vectors
in `attachmentsByBone`, keyed by the exact FORM bone name. Original human and
quadruped profiles verify that every nonroot attachment is retained. A production
bone-pose provider must join those names to FORM indices.

## ReadMove: exporter conversion and quantization

BON/SKL matrices are frame-major then animation-bone-major, twelve little-endian
Float32 values. Match animation names to FORM names; ignore unmatched animation
bones. Their exporter child lists do not replace FORM parent relationships.
Installed comparisons`0x4049b6–df/0x40612a–153` are exact byte comparisons,
without aliases, punctuation normalization or O/0 substitution. The angle arrays
are allocated at`0x404943–954` through BrMemAllocate`0x526c00`, which zero-fills
all requested bytes before returning. Unmatched FORM bones therefore retain
angle bytes(0,0,0). Generic `buildNativePedBoneMotion` remains strict by default;
native instance preparation opts into `missingBones:"native-zero"`.
Original DOG91/94 omit exact `Bone_N02` through authored `Bone_NO2`, while93
also omits root`Bone_01` through `Bone01`. Native zero storage is preserved,
without renaming borrowed motion records or inventing a missing bone transform.
After matching, Flip3DStoBRaxes changes a vector(x,y,z) to(x,z,-y), changes basis
coordinates by the corresponding conjugation, and converts translation too.
Then LP normalise5325a0 normalizes row2, normalizes row1 cross row2 into row0,
and replaces row1 with row2 cross row0. The vector fallback threshold is2^-22.

For each matched root, native code retains its **full normalized nine-scalar
basis**. Root translation becomes frame deltas, with the looping reset behavior
already documented and implemented in the root helpers. The child translation
from the BON/SKL is not used by SetBoner: authored personality attachments place
children instead.

All matched bones also get XYZ_S Euler order0, with axis triplet stored as three
unsigned bytes. For normalized row matrix m:

```text
cy = sqrt(m00*m00 + m01*m01)
if cy > 1.9073486328125e-6:                 # strict >, installed58a8c0 = 2^-19
    a = atan2(m12,m22)
    b = atan2(-m02,cy)
    c = atan2(m01,m00)
else:
    a = atan2(-m21,m11)
    b = atan2(-m02,cy)
    c = 0
angle16(theta) = truncTowardZero(theta * 10430.378350470453) modulo65536
angleByte(theta) = angle16(theta) >>> 8
```

The multiplier is the installed **double** at58a8c8. The conversion575190
explicitly sets x87 rounding to truncate before storing the integer; it is not
round-to-nearest, `floor(theta*256/(2*pi))`, or rounding directly to one byte.
Negative angles wrap at16 bits before the high-byte extraction. In the inlined
path, ToEuler is531710 at40635b and high-byte stores are406370/40637c/406389.

The runtime tables at675bc8(sine) and6756d0(cosine) contain Float32 spills of
`sin/cos((q*256)*9.587379924285257e-5)` for q0..255; the installed multiplier is
double588350. JS arithmetic cannot guarantee every x87 intermediate's exact
last-bit result, but should preserve these storage boundaries and quantization.
Do not quantize the root's retained full basis.

For BIPED1 move30 `walk_normal_male.SKL` frame0, FORM root/head angles
are(127,0,63), left upper leg(128,5,192), lower leg(128,27,192). The normalized
root first row is approximately(.0142760,.9998592,-.0088171): its remapped local
long X axis points almost along world Y. A yaw-only root does not do that.
DOG1 move30 `DogWalk.BON` frame0 root is approximately identity, with angle
bytes(0,0,0), neck/head(7,0,0), tail(0,0,232). The human and dog cannot share an
invented upright-axis correction.

Missing FORM animation names leave native allocated angle storage without a
verified initialized value. A safe provider should diagnose missing required
bones, rather than fabricate zero angles or infer them from ACT transforms.

## Exact ordinary child pose

At4080d0, for angle bytes x,y,z, let sx/cx,sy/cy,sz/cz be the corresponding
Float32 table values. The native row basis E is:

```text
[ cy*cz,                 cy*sz,                 -sy   ]
[ sx*sy*cz-cx*sz,        sx*sy*sz+cx*cz,         sx*cy ]
[ cx*sy*cz+sx*sz,        cx*sy*sz-sx*cz,         cx*cy ]
```

E's translation is zero. SetBoner407e60 first fills translation with
`-applyV(childAttachment,E)`. With the ordinary nonnull character orientation
O at+8c it then post-multiplies by O (407f42), and finally adds the parent's
world joint position (407f52–407fc0). The equivalent equations, with ordinary
O translation zero, are:

```text
childBasis  = E * O.basis
parentJoint = parent.origin + applyV(parentAttachment,parent.basis)
childOrigin = parentJoint - applyV(childAttachment,childBasis)
```

Thus `applyP(childAttachment,childWorld)` and
`applyP(parentAttachment,parentWorld)` coincide. The parent supplies position
and its attachment rotation, **not** the child's orientation. Composing child
E with parentWorld would double-rotate animated limbs. There is no child bone
size multiplier in this ordinary helper.

For the helper's null-orientation alternate branch, child basis remains E and
translation is parentJoint minus childAttachment\*E (407fc7–4080c6). Production
ordinary SetCharacterBonePositions always passes the character O pointer.
A nonzero mutant-speed742944 first calls4d69e0 to perturb the angle bytes;
that branch consumes three shared RNG draws for dead characters in action6
when guard69a370 is zero. At4d3562 the pedestrian outer update sets this guard
when its current time equals the prior time stamp (6927c0), suppressing repeated
angle perturbation at an unchanged time. This guard is not the action-replay flag.
It needs an explicit powerup provider and is outside this ordinary algorithm.

## Root, frozen bones, temporary matrices and update modes

SetCharacterBonePositions407b20 returns without changing poses when selected
move+7 is negative. It also returns when physics-active bit4 and boned bit2
are both set and temporaryMatrices+e8 is null. Otherwise it clears byte9 bit0 (mask1).
A nonnull morph+bc delegates the entire operation to4097b0; do not substitute the
ordinary algorithm during a source morph transition.

Bones are visited in **ascending FORM index**. For a child, it skips posing
when its own missing bit or its parent's missing bit is set in character+0c.
It also skips children for mode1 or2, or absent render slot. Unchanged matrices
are retained; detached bodies own the removed actors' future movement.
Vanished mask+10 is not consulted by this pose loop.

Root processing ignores the missing mask and occurs unless mode3 or character
active bit4. It uses character+2c when the render slot is negative, otherwise
root temporary matrix+e8 when present, otherwise actorSet[slot].actors[0].mat.
Child matrices and parent matrices use the temporary array when present,
otherwise their corresponding indexed render actors. Mode2 preserves root
basis; every other root-enabled mode writes frameRoot\*O. The old root origin
is always saved first. If movement argument=0 or global overallMovementDisabled
is set, restore it. Otherwise:

```text
worldDelta = applyV(frame.rootDelta * personalityMove.scale, character.movement)
rootOrigin = savedOrigin + worldDelta
# negative-rate action replay uses savedOrigin - worldDelta
```

The personality move scale multiplies translation only. It does not scale model
vertices, child attachments or animation rotation. The race baseline ped scale,
average scale and head scale are1. Nonbaseline scale/render callbacks require a
separate verified provider; adding a generic actor scale here would alter the
physics convention.

| Mode argument | Root basis              | Root translation when enabled | Children               |
| ------------- | ----------------------- | ----------------------------- | ---------------------- |
| 0             | frame\*O, unless active | apply delta, unless active    | pose eligible children |
| 1             | frame\*O, unless active | apply delta, unless active    | retain                 |
| 2             | retain                  | apply delta, unless active    | retain                 |
| 3             | retain                  | retain                        | pose eligible children |

Physics moved wrapper40b770 derives `O = inverseLP(frameRoot) * currentPhysicalRoot`,
zeros O translation, then calls407b20(mode3,movement0) at40b813. Halt wrapper409400
does the same before mode3 at4094d9. Therefore active simple-body visuals keep
the actual solver root and re-pose eligible children around it; they must not
write the former walking pose back to the physics root. Physics-active boned
characters without temporary matrices follow the earlier complete-return gate.

## Model selection, visibility and collision synchronization

ReadPersonality finds each model by its personality identifier, applies the
bone's general remap to **vertices**, then updates the BRender model with ALL.
It does not load another ACT when a model identifier ends in `.ACT`.
Model normals/bounds must be recomputed from remapped positions, with face order,
UVs and materials retained. Do not apply exporter flip to model vertices too.
The source clones each contiguous nonnull pose into model set1. Model sets0/1
and pose indices0..3 are distinct axes; the head alternatives are not extra
FORM bones. Native current actor model selects the collision bounds when that
bone is registered as a detached body.

The FORM render pool allocates an indexed actor per bone, not a nested FORM
hierarchy. Native root custom rendering/actor ownership callbacks handle intact
parts; a Three.js host can use flat world-space siblings and explicitly retain
which renderer owns each removed actor. A scene wrapper must be identity, or
the host must convert these world matrices through its inverse. Never append
an ACT parent transform or yaw after applying the native world matrix.

MakeCharacterRenderable2 copies saved root pose to the new render root. For
missing bones it restores indexed matrices from storedMatrices+28 when present;
without those stored matrices it sets vanished mask+10 equal to missing+0c.
It assigns pose0 in the selected model set to each actor, setting actor type1
for a nonnull model,0 for null. It invokes the add-actor callback unless a bone
is both missing and vanished, then runs ordinary posing with movement0.
The add callback4cba10 adds an unparented actor only when index0 or its missing
bit is set. A missing bone can therefore remain visible as a detached actor;
blindly hiding every missing bit loses real detached parts. Conversely vanished
bits must not create another detached clone. Detailed root custom-render
visibility callbacks remain separate host ownership, not a pose-kernel branch.

SetCharacterBoneModel40b420 validates index/pose/render slot, updates the global
model-set byte+0a, and selects `models[pose][set]`. For pose<0 it detects the old
pose by current model identity (fallback0) before switching sets. With an explicit
pose whose target model is null it returns0 **after changing the set byte**, and
leaves the actor model unchanged. The setter changes the pointer only: it does
not rebuild physics geometry. Simple body bounds/COM remain personality data,
independent of displayed head pose. Detached body registration4085f0 reads the
selected actor's **current remapped model bounds**, copies its native matrix,
and rebuilds its authored shape geometry at that registration boundary.
Do not resize the intact body from the union of the posed mesh bounds.

## Original inventory and implementation provider

| FORM   | Bones / moves | Total kg | Head index | Parents                              |
| ------ | ------------- | -------- | ---------- | ------------------------------------ |
| BIPED1 | 10 /51        | 68       | 1          | -1,0,0,2,0,4,0,6,0,8                 |
| BIPEDF | 10 /51        | 68       | 1          | same; real articulated joints        |
| DOG1   | 16 /15        | 47       | 2          | -1,0,1,0,0,4,5,0,7,8,0,10,11,0,13,14 |

Blokebl/Bandsman native simple bounds are(-.15,-.065,-.03)..(.135,.065,.03),
COM(.04,0,0). Twolf uses DOG1 with(-.028,-.114,-.085)..(.028,.09,.085),
COM(0,0,.01), identity general remap. Human mass is Float32
.06800000369548798 tonnes; dog .04699999839067459. These authored simple bounds
are not root mesh bounds.

Small current-model measurements after general remap:

| Personality / FORM index | Pose0 model | Vertices / faces | Native min .. max, rounded                              |
| ------------------------ | ----------- | ---------------- | ------------------------------------------------------- |
| Blokebl /0               | MANBBL.ACT  | 12 /12           | (.000008,-.036297,-.015171)..(.096703,.036744,.016410)  |
| Blokebl /1               | CHEBL.DAT   | 26 /22           | (.089753,-.016443,-.019866)..(.128643,.016534,.015497)  |
| Blokebl /2               | LTOPLBL.DAT | 13 /8            | (-.010651,-.026254,-.012754)..(.066683,.000115,.013989) |
| Bandsman /1              | HEDC.DAT    | 57 /42           | (.096295,-.017641,-.035405)..(.138019,.017739,.016627)  |
| Twolf /0                 | TWOLF.DAT   | 42 /40           | (-.033718,-.047507,-.086952)..(.032709,.025866,.077096) |
| Twolf /2                 | TGHEAD1.DAT | 61 /34           | (-.018515,.037107,.043576)..(.016868,.089273,.117580)   |

Blokebl head alternatives CHEBLA/CHEBLB and Bandsman HEDCA/HEDCB occupy pose1/2
of FORM bone1. Twolf neck is index1(TGNECK), head2(TGHEAD1), tail3(TGTAIL).
Human move30 has30 frames and25 animation bones; dog move30 has32 frames and39
animation bones. Name matching is essential. BIPED1 and BIPEDF share FORM bone
names/model mapping, but BIPEDF move30 uses `walk_normal_female.SKL` and its
physics joints require articulated support. Female frame0's first four angle
triples are(127,0,62), (127,0,63), (127,4,190), (127,28,189).

A production provider needs immutable FORM parent/remap records; retained
personality attachments/model pose tables; per-frame full root basis/deltas
plus matched quantized angle triplets; mutable indexed world matrices; source
character orientation/movement; current model set/pose; missing and vanished
masks; render/temporary/stored matrix ownership; and source update mode gates.

```text
loadModels: copy source model vertices, bake each bone general remap once;
            recompute normals/bounds; retain pose/set identity
loadMoves: match FORM names, exporter flip, LP normalise;
           retain full root basis/deltas; quantize XYZ_S child angle triplets
poseOrdinary(mode, movementEnabled):
    enforce move/active-boned/temp/morph gates
    for index in ascending FORM order:
        if root: execute root mode gates using existing root helpers
        else if eligible child:
            E = anglesToNativeMatrix(frame.angles[index])
            C = E * character.orientation
            C.origin = applyP(parentAttachment[index], parentWorld)
                       - applyV(childAttachment[index], C)
            write indexed childWorld = C
render: apply these exact world matrices and selected remapped models;
        removed actors stay with detached-body ownership; vanished stay absent
physicsMoved: derive O from physical root and inverse frame basis;
              poseOrdinary(3,false); retain solver root and missing matrices
```

The ordinary equations, quantization, mode gates and measured inventory are
verified. Morph interpolation4097b0, altered scale/head-scale rendering,
mutant-corpse RNG, articulated joint movement and custom-render allocation/
recycling remain explicit providers. This task makes no runtime source edits.
Validation used a symbolic x87 arithmetic trace of4080d0 (100 sampled angle
triplets had determinant1 and orthogonality residual at most4.5e-16 before
Float32 storage), static call/field inspection, PE constant reads, and bounded read-only parsing of the three
original personalities/forms/moves. No production build or generated asset
writes were performed.
