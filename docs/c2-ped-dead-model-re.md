# Pedestrian dead MODEL set and blood ACT provider

## Evidence and scope

This note independently describes the installed `carma2_HW.exe` personality
MODEL cloning and corpse selection paths. The executable is read-only, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`, PE32 image
base `0x400000`, entry `0x577eb0`. `madebr/rec2` is the symbol map; its clone
material loop conflicts with the installed instructions as described below.
No original source or asset contents are reproduced here.

The available original Stock and Advanced Blokebl, Bandsman and twolf resources
were read through the existing asset store and `loadNativePedAssets`. This audit
does not establish articulated death dynamics or every personality's material
requirements. See [bone pose](c2-ped-bone-pose-re.md),
[sever contact](c2-ped-sever-contact-re.md) and
[shared slicks](c2-world-slick-re.md) for their separate ownership contracts.

## Creation: one shared dead set per personality

`ReadPersonality` starts at installed `406ab0`. The personality owns a bone table
with stride `0x3c`. Each bone has four pose entries, each containing two MODEL
pointers: `models[pose][set]`, stride eight. Set0 is the authored model; set1 is
a newly allocated clone. These axes are independent of FORM bone indices.

Creation follows this order:

1. Load personality resources into the pedestrian storage library with duplicate
   registration disallowed during the directory load. Find each authored MODEL
   by identifier. A personality token ending in `.ACT` can be a MODEL identifier;
   this does not request another ACT hierarchy.
2. Apply that FORM bone's general remap to each raw MODEL vertex position, then
   update the MODEL with `BR_MODU_ALL`. Installed `406d9f–406e33` iterates raw
   vertices with stride40, selecting an original component and optionally
   negating it. It does not apply an extra actor transform to those vertices.
3. Starting at pose0, clone contiguous nonnull poses, stopping at the first NULL
   or after four entries (`406e61–4070bc`). A later nonnull entry beyond a NULL
   does not receive an automatically invented set1 clone.
4. Mark the original set0 MODEL updateable and update it with ALL after its
   clone has been added (`407071–407097`).

The clone operation is inlined in this installed loader:

| Installed range | Verified operation                                                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `406e98–406ef8` | Strip the first extension from the original MODEL identifier, append `1.DAT`, allocate an equal-count MODEL.                                                                                  |
| `406eff–406f44` | Copy all raw vertex and face records, both stride40. Position, UV, face order, vertex indices, smoothing and face fields are retained.                                                        |
| `406f46–406fb8` | Derive the material name from the **first face's material identifier**, strip its extension, append `1.MAT`, find it in the material registry.                                                |
| `406fba–406ff8` | If absent and fewer than50 cloned materials exist, clone/register the original first-face material, assign the derived name, update ALL, and retain it in the global50-entry ownership table. |
| `406ffd–40702f` | Write the clone's face material pointers. Faces using the first original material get its derived material; every other face retains its original material pointer.                           |
| `407031–40703b` | Set clone MODEL flags `0x80` (`UPDATEABLE`), then add/register the clone.                                                                                                                     |
| `407040–407068` | Store the clone in the personality bone's set1 pointer.                                                                                                                                       |

`BrModelAllocate` (`520e30–520ea3`) allocates a new92-byte MODEL resource,
separate vertex and face arrays attached to it, and its identifier resource.
It does **not** copy the source MODEL header. In particular, source flags,
pivot, custom callback and custom bounds are not inherited by a whole-header
copy. The newly allocated MODEL is initially zeroed by the resource allocator;
the loader adds `UPDATEABLE`. `DONT_WELD` is mask `0x1`: original flags3/21 are
not the clone's flags. Generic preparation of a clone therefore cannot simply
reuse a source prepared vertex table that assumed `DONT_WELD`.

MODEL registration prepares its bounds from the copied remapped raw vertices.
The BRender bounds path scans all raw vertices, including unused ones; it does
not union posed bones, apply a personality ACT child transform, or use the
simple physical body's box. Fresh set0/set1 copies have the same positional
bounds. This path provides no evidence for a procedural flattened corpse mesh
or per-instance vertex deformation at death.

**rec2 discrepancy:** `BonerCloneModel` currently assigns a replacement material
to `pModel->faces[i]`. Installed `407008–407020` instead writes the clone's face
array obtained from `EBP+0x0c`, while reading source faces through `EBX+0x0c`.
Do not mutate the shared alive faces to reproduce that stale reconstruction.

Raw face material slot0 is a NULL MODEL material pointer, independently of a
renderer's resolved ACT inherited material. At `406f49–406f4f` the loader
dereferences the first face's MAT identifier without a NULL check. A NULL first
face therefore has no defined native clone path; the preparation module rejects
it explicitly, including when an inherited render material is available.
Nonfirst NULL face pointers survive the copy/substitution loop and require the
actual ACT inherited/default material provider for rendering.
Original Bandsman and twolf have nonfirst NULL faces in both data trees; this
provider is needed for those real personalities, not just material-cap overflow.
The existing loader has already resolved that inheritance for rendering. Supply
its rawslot0 group's render material explicitly, while retaining a NULL MODEL
face pointer in set1. Do not classify that resolved material as a cloned MAT.

`DRMaterialClone` at `515160–51523f` copies render flags, colour, lighting,
index/shade/blend references, colour-map reference and map transform, then
registers the new material. It shares referenced maps/tables; it does not
duplicate or recolour texture pixels. If the global clone table is full and
the derived material was not found, the installed loop can write a NULL
replacement material. A host should expose that resource condition, not silently
manufacture another material or dispose borrowed texture maps.

## Blood texture assignment and instance ownership

During `BuildPedestrian`, installed `4d2e2d–4d2e52` visits all four root-bone
poses in both sets, marks each existing MODEL `CUSTOM` (`0x20`), and assigns
callback `4d32b0`. This applies to the root bone only. The callback records
the ACT in an increasing list capped at30, then invokes ordinary MODEL
rendering (`4d32b0–4d32ef`). Later `4d343a–4d349f` recovers the owning character
from root ACT+`0x5c`, finds its indexed FORM actor set and handles eligible
unremoved child actors. This is render/visibility ownership; it does not
allocate a separate dead MODEL per instance.

The build path finds texture `<personality>B`, finds material
`<personality>1.MAT`, and, if the material exists, assigns that texture as its
colour map and updates `COLOURMAP` (`4d2e54–4d2f08`). Missing blood texture is a
native load error. The source does not assign every material named in every
MODEL to a generic red material.

The personality/model library is shared between character instances.
`BuildCharacterInstance` finds or opens a cached personality and starts its
model-set byte at0. Each rendered character receives an indexed FORM actor
set with independent actor matrices and character ownership; selected ACT
MODEL pointers refer to the shared personality tables. The existing browser
instance's independent actors and shared template geometry/materials can
represent this distinction. A material or geometry should not be disposed
when one pedestrian dies or loses a render slot.

### Production inheritance correction (2026-10-29)

The earlier adapter's choice of a personality package ACT for inherited rendering
is superseded by the installed FORM allocation audit. Fresh FORM ACTs have NULL
material and identity matrices; the personality binds exact MODEL resources,
not an authored package ACT graph. Production now supplies the BRender
context/default material while retaining raw NULL face pointers separately.
See [asset-selection evidence](c2-ped-asset-selection-re.md). The dead-MAT
construction and pointer-eligibility equations above are unchanged.

## Death selection and detached bodies

The installed consumer is `KillPedestrian` at `4ccc20`, not a generic visual
swap on every damage call. Its physical-body special-volume gravity test skips
the gore/model branch when the supplied volume's raw gravity is below1
(`4ccc74–4ccc8b`); count/scoring still continue. Positive gore level is another
gate (`4ccc91–4ccc98`).

For a character with an actual render slot, the branch changes every bone to
pose0/set1 (`4ccca8–4cccc8`). It then reads the signed FORM head index. For a
nonnegative head it selects that bone's pose2/set1 (`4ccd11–4ccd38`). Negative
head takes the source all-bones pose2 branch; it must not be replaced by a
guessed humanoid head index. These calls preserve replay/model-change outlets.
Head-sequence cache+`0x1c` is cleared afterwards (`4ccd44`).

`SetCharacterBoneModel` (`40b420–40b4f6`) validates bone, pose and render slot.
An explicit pose writes the character's global set byte before checking whether
the target MODEL is NULL. NULL therefore returns0 and leaves the actor's current
MODEL unchanged. For a negative pose it searches the current model identity in
the old set, falling back to pose0, then switches to the corresponding new set.
The setter changes the ACT MODEL pointer only; it does not resize an already
registered physical body. Detached type5 setup must read the actor's actual
currently selected MODEL and its bounds at its existing registration phase.
An already detached head uses this same model selection; no new severed-head
asset or replacement generic limb is required.

After model changes, Kill performs its existing blood/giblet outlet, once-only
count handling and ordinary death/score tail. Preserve those source phases and
their shared CRT consumption when connecting a real set1 provider.

## Settled blood and shared oil source pointer

Installed `4d18af–4d1933` is the settled-body slick outlet:

- Skip a supplied special volume with raw gravity below1.
- Skip action replay before the percentage draw.
- Draw `PercentageChance(75)` (`4d18fa–4d1906`), then inspect pedestrian flag
  `0x10`, then require positive gore. Thus a repeated once-flag attempt still
  consumes its chance draw when earlier gates allow it.
- Set flag `0x10` before allocation. Get the actual current root render ACT via
  `407b00`, then call `DoSpillage(0x6928c8, ACT)` at `4d192e`.
- `DoSpillage4ec9b0` forwards the ACT's current MODEL pointer at ACT+`0x18`, the
  authored slick data and a NULL car to the shared32-slot oil allocator. It
  does not use the contacted car's ACT or an arbitrary death impact point.

`407b00` resolves actor0 from the character's current FORM render slot. It
returns NULL for no render slot. A host must retain a real source ACT identity,
live native bone/root matrix and selected MODEL bounds across the pending300ms
placement delay. The existing live actor follower API is suitable once it is
fed the actual native corpse actor/model; a box around the intact displayed
pedestrian or a fabricated dead MODEL does not establish that contract.

GIBSLICK uses the authored original settings: delay300ms, initial half-size
`.001`, full `.05.. .15`, growth `.00001.. .00007`, friction `.2..1`, smear
distance1..1, and `GIBSMEAR.MAT`. The material is procedurally registered from
the original GIBSLICK pixelmap. Sliding-body PEDSMEAR is a distinct outlet.

## Original data and smallest host integration

Both Stock and Advanced inventories give the same relevant cases:

| Personality | FORM bones / existing poses | Root MODEL                         | Head / death pose2                    | Loaded blood-map key |
| ----------- | --------------------------- | ---------------------------------- | ------------------------------------- | -------------------- |
| Blokebl     | 10 /12                      | `MANBBL.ACT`,12 vertices /12 faces | index1, `CHEBLB.DAT`,26 /22           | `blokeblb`           |
| Bandsman    | 10 /12                      | `MANBDC.ACT`,12 /12                | index1, `HEDCB.DAT`,57 /42            | `bandsmanb`          |
| twolf       | 16 /16                      | `TWOLF.DAT`,42 /40                 | DOG1 index2, only pose0 `TGHEAD1.DAT` | `twolfb`             |

The blood maps are entries inside `PIXIES.P16`/P08, not missing standalone
`*B.PIX` files. These three archives each provide one original material and
no authored set1 `.MAT` or dead-clone `.DAT` resources. Native creation supplies
them. For twolf, the explicit head pose2 target is NULL: after the all-bones
pose0/set1 switch, its head remains the actual pose0 dead clone. Do not invent a
dog pose2 or additional authored head mesh.

The existing `NativePedInstanceCreateOptions.modelSet1` is the concrete adapter
point. Add a personality-owned table of cloned **remapped DatModel data**, with
new model/material identities and source flags as above. Build its render
geometry through the ordinary model path; preserve raw source positions, UVs,
face indices/flags and the bounds of all remapped raw vertices. Pass that table
to instance creation, which already clones actor containers and shares their
geometry/materials. Supply the selected model's identity/bounds to detached-body
and oil followers. Existing current-model accessors must distinguish set1 names
from the authored set0 token, even though their initial bounds are identical.

This establishes real model selection and blood texture rendering. It does
not complete articulated corpse constraints, source root custom-render30
visibility scheduling, FORM render-slot lifetime or sliding corpse smears.
Those remain explicit providers and must not be concealed by generic corpses.

`src/ped-dead-models.ts` now implements that preparation boundary independently.
`prepareNativePedDeadModels(personalityName, nativeAssets, options)` returns an
instance-compatible `modelSet1` and explicit MODEL descriptors. Raw remapped
positions/UVs and source face indices/smoothing/flags are copied; the existing
DatModel/render representation is used rather than proprietary40-byte record
copies. It keeps the source clone flags80, material pointer equivalence and
contiguous-NULL termination. Root custom rendering remains a host outlet.
The assets loader must separately mark set0 flags `|0x80` and update it, matching
`407071–407097`; this helper deliberately does not mutate the borrowed living
MODEL/geometry. Supplying set1 alone does not establish that loader-owned step.
Bounds and raw MODEL metadata live on the shared geometry, so the instance's
Group clone does not JSON-convert typed arrays or Box3 metadata.

The host should share `NativePedDeadMaterialRegistry` across all personalities
in a race. Its50-clone cap is distinct from MODEL geometry ownership. A cap
overflow retains NULL face pointers and requires an explicit actual ACT
fallback material callback; without that provider the module throws a clear
error. Its diagnostic does not silently increase the native capacity. Result
`dispose()` releases owned geometry after its instances are released; registry
`dispose()` releases cloned materials at global teardown. Neither disposes
borrowed alive materials or shared texture maps.

The focused15-test suite passes, including all six original Stock/Advanced
Blokebl/Bandsman/twolf cases, first-material-only substitution, independent raw
arrays, unused-vertex bounds, native50 overflow and stable ACT identity through
dead-head model selection. TypeScript passes. No production build or runtime
integration was performed by this worker. Actual positive material allocation
addresses/prepared group order remain the existing renderer preparation gap;
this does not alter the verified raw MODEL bounds supplied to blood placement.

## Disposal

Installed personality disposal `4077f0–4078ed` invokes the personality callback,
frees its movement data, then walks bones and contiguous existing poses. It
removes/frees the **set1** MODEL for each pose (`407851–407888`), frees bone
hinges, bone table and personality. Set0 resources remain under loaded storage
ownership. The global teardown separately removes/frees retained cloned
materials in increasing order (`40b3d1–40b406`) and resets their count.
Referenced texture maps remain library-owned. This is personality/race teardown,
not per-death cleanup or one dead instance's resource disposal.
