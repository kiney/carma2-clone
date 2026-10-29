# Pedestrian scale and prepared MODEL consumers

## Evidence and result

The render-effects owner supplies actual personality MODEL geometry to the
existing native flat bone actors. Body/head effects change owned MODEL vertices
and joint anchors, rather than introducing an actor scale around the pedestrian.
One private personality copy is shared across its instances; original loaded
assets and original living/dead templates remain unchanged.

Evidence is the read-only installed `carma2_HW.exe`, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`, PE32 image
base `400000`, entry `577eb0`. Hash and executable metadata were checked during
this audit. `madebr/rec2` supplies function names and structure locations; its
powerup and personality scaling functions remain stubs. Addresses below were
checked directly in the installed binary. No original code/assets are copied.

## Powerup parameters and scale ownership

| Installed address                | Verified operation                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| `4dc550–4dc571`                  | Action2 copies three float parameters without conversion and calls body setter `4d6780`. |
| `4dc5a0–4dc5ac`                  | Action32 passes the first float unchanged to head setter `4d6880`.                       |
| `4deac0–4dead1`                  | Action33 copies the first float DWORD directly into mutant speed `742944`.               |
| `4dc7e0–4dc807`                  | Body reset requests `(1,1,1)`.                                                           |
| `4dc810–4dc81a`                  | Head reset requests `1`.                                                                 |
| `4deaf0–4deafa`                  | Mutant reset writes zero.                                                                |
| `4dc8c0–4dc8e6`, `4de400–4de40a` | Underwater action10/reset sets/clears car+`1b0`; neither changes pedestrian rendering.   |

The source setters have no positivity/finite checks. Browser positive-finite
validation is an explicit host bound, not a recovered source condition. Authored
parameters supply the actual sizes; no personality is specially hard-coded.
Mutant angle gates and replay behavior belong to the separate animation owner.

Body setter `4d6780–4d687f` computes Float32 `requested/current` for each axis.
It skips the operation when all three ratios equal1. Otherwise it invokes
`40c420` with bone selector−1 and whole-personality flag1, stores the three new
global scales at `742960`, and stores their Float32 average at `69a2b4`.
The average coefficient at `589bc0` is Float32 `1/3`.

Head setter `4d6880–4d6909` computes one Float32 ratio, repeats it across all
three axes, calls `40c420` with selector−2 and whole-personality flag0, and stores
new head scale `7429a0`. Unlike the body setter it still calls with ratio1.
Selector−2 resolves signed FORM+`4d`. A negative head index selects all bones;
it does not mean that the effect is unavailable for that FORM.

`40bb20–40bedd` scales one personality. For every selected FORM bone:

1. Map the ratio through that bone's **powerup** remap, independently of its
   general model-coordinate remap. Each input component is assigned to output
   component `code % 3`. Installed negative codes subsequently negate the current
   loop component; the implementation preserves this ordering. Actual shipped
   MAN/DOG samples use positive codes. Nonuniform DOG remaps demonstrate why a
   single actor/world XYZ scale is insufficient.
2. Visit both MODEL sets and contiguous pose0..3, stopping each set at its first
   NULL. Multiply all raw vertex positions, including unused vertices, and call
   `BrModelUpdate` with `VERTEX_POSITIONS` (`40bbe8–40bc5e`). The source pivot,
   UVs, faces, material pointers, current pose/model identities and ACT matrices
   retain their separate owners.
3. Scale this bone's child-coordinate anchor. For all-bone selection, scale its
   parent-coordinate anchor through its parent's remap. For single-bone
   selection, scale every direct child's parent-coordinate anchor through the
   selected parent's remap. This preserves authored joint coincidence after
   native bone posing, including enlarged heads that have children.

The whole-personality flag also scales all move grounding offsets by ratioX
(`40be57–40be78`), personality bounds/COM by the unremapped ratio, mass by the
three-axis product, and radius by the average ratio (`40be7a–40bed3`, coefficient
`5883b0`). Move translation scale is unchanged. Head effects never change those
whole-personality fields, even when the FORM's negative head selects all bones.

`NativePedRenderEffects` exposes a copied `.template` and `.modelSet1`. Construct
the original `prepareNativePedDeadModels` first, pass it to the owner, and create
presenters from the owner's copied resources. Bind/unbind instances and dispose
the effect owner after presenters release their ACTs. Dispose original dead
models/material registry and original assets afterwards. Shared materials/textures
remain borrowed; only new owned dead-material arena handles are freed here.

This owner integrates rendering and personality data. It does not claim source
`ScaleForm`'s complete live PHIL body/joint resizing, mass/inertia propagation or
action-replay re-pose dispatch. Its copied hull inertia is recalculated with the
existing independent box formula, not captured original `ScaleForm` output.

`NativePedPresentation.refreshScaledPose` supplies the render ACT-origin part of
ScaleForm40c3a0..40c408. For each occupied bone ACT it requests support through
the existing host ground query (up to eleven trials, Float32 +.2 in Y):

```text
if supportY > -100:
    ACT.y = f32((old ACT.y - supportY) * unremappedRatioX + supportY)
```

This correction is enabled only for whole-personality body scaling. Head scaling
keeps ACT origins. The host reposes retained distant actors from their already
sampled angles once, without clock advance or extra CRT draws, so the extended
visibility system does not expose stale attachment origins. The complete native
support/collision owner remains PED-07; this does not claim body/joint resize.

## Prepared vertices are MODEL resources

The installed napalm branch `4ceaa0–4cead7`, mapped by rec2 `MungeNapalm`, obtains the current
character ACT, current MODEL's `prepared.groups[0].nvertices`, and draws an
**inclusive** `IRandomBetween(0,nvertices)` for its mode2 smoke column. The old
browser render-group unique-source-index list and its last-vertex clamp do not
reproduce this contract.

`prepareNativePedVertexSampler` uses the existing independently reconstructed
`prepareNativeModelVertexOrder` implementation. Preparation consumes original
raw faces, UVs, MODEL flags and actual material pointer identities. It covers
both source set0 `DONT_WELD` and newly allocated set1 flags`80` welded models.
The dead clones must not borrow set0's prepared vertex table. MAT keys are taken
from actual owned `Assets` arena allocations captured during each MODEL-load
episode. Owned cloned dead material identities receive real arena allocations;
render group order or alphabetical names never substitute for pointer order.
Host allocator addresses do not claim Windows heap allocation order.

The sampler retains the initial prepared permutation across POSITION updates,
as updateable native MODEL preparation retains `vertex_user` membership. Each
sample reads current geometry positions through that exact face-corner crosswalk
and subtracts MODEL pivot with Float32 stores. The returned point is MODEL-local;
the smoke owner applies the stable bone ACT world transform. Resolve the ACT's
**current** MODEL for every smoke update so head/pose/dead-model changes and
scaling remain visible. Cache by current geometry, not by a pedestrian's initial
model or an arbitrary descendant mesh.

Prepared groups occupy a contiguous vertex allocation. The inclusive group0
upper bound can reach the first vertex of the next group. A final-allocation
overrun returns failure rather than reading outside memory or clamping to another
vertex. Missing positive-material ordering throws explicitly. Raw unused vertices
contribute to native MODEL bounds, but do not become prepared effect vertices.

## Validation

`tests/ped-render-effects.test.mjs` passes 12 tests including six original
Stock/Advanced Blokebl, Bandsman and twolf cases; original cases skip without a
local installation. Checks cover inverse powerup-axis assignment, living/dead
welding differences, actual MAT pointer ordering, pivot subtraction, contiguous
inclusive indexing and final-overrun rejection, live vertex playback, shared
private geometry across instances, head/child anchor selection, body profile
scaling, negative head-index all-bone selection, unchanged source assets and
actual dead-material arena resource cleanup. Original test resources are read
through the existing asset store and are never committed as fixtures.

Application-level integration and Chromium evidence are recorded by the ANI-01
integration owner. These kernel tests alone do not establish gameplay powerup
delivery, complete live physical resizing or the remaining animation acceptance
criteria.
