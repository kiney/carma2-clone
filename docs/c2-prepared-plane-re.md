# Installed prepared face planes

`src/physics/prepared-plane.ts` independently implements full model preparation's
plane equation and later normal clamps. `prepareNativeModelFacePlane(a,b,c)` takes
original model-local indexed vertices and returns `{normal,d,degenerate}`.
It does not generate render normals, apply actor transforms, subtract a pivot,
sort faces, or emit a world cache record.

`captureWorldSource(root,{modelPreparation:"track"})` now retains this immutable
source-local equation per mapped original DAT face, alongside the effective
track loader flags. Main captures these values before render batching. Unknown
loader provenance or absent original indexed data remains explicitly NULL;
generic render geometry is not labeled as an original prepared model.

Installed `ReadTrack` invokes `LoadTrackModels` (`4f62b0`, call `505036`), whose
callback reaches `AddSmoothModels` (`4f6310`). Stores at `4f637e`/`4f6384` give
effective flags `(DATflags | 0x80) & 0xfdfe` before `BrModelAdd`. Thus ordinary
track models are updateable even when raw DAT flags lack `0x80`, and cached
faces retain the complete original face byte. The source snapshot preserves raw
DAT flags separately; it does not rewrite render metadata or claim to establish
prepared face order. Original Stock/Advanced Newcity checks cover every mapped
triangle; a synthetic downward plane verifies lower-clamped normal and unchanged
pre-clamp D. Actor transforms, null-transform emission and material-pointer
ordering remain the cache collector's responsibilities.

## Evidence

Original HW SHA-256:
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`;
PE base `0x400000`, entry `0x577eb0`, timestamp
1998-10-18 20:13:36 UTC. The installation remained read-only. `madebr/rec2`
supplies names; installed instructions and numerical probes establish arithmetic.

| Installed address | Role                                                                               |
| ----------------- | ---------------------------------------------------------------------------------- |
| `51ef90`          | `BrModelUpdate`                                                                    |
| `51f331..51f35c`  | Full preparation passes original indexed positions to `BrPlaneEquation(5365f0)`    |
| `5365f0..536747`  | Plane arithmetic, Float32 spills, fallback and output                              |
| `53eb20..53eb26`  | Load stored Float32 squared length; live x87 square root                           |
| `51f361..51f40c`  | Clamp stored normal components into original `br_face`                             |
| `51f40f..51f415`  | Copy pre-clamp D unchanged into original `br_face`                                 |
| `5202a0..5202e8`  | `CopyVertex`: prepared position is stored original position minus model pivot      |
| `52041d..520441`  | `CopyFace`: copy Float32 normal/D to prepared equation, without quantization       |
| `460d6e..460d9d`  | World emission transforms the existing normal with `532b60`, without renormalizing |

The prepared equation contains Float32 components, not signed-short normal
quantization. The term “packed normal” elsewhere describes this retained
prepared/cache record. Smoothing changes vertex render normals; it does not
substitute those normals for the face equation.

## Exact independently reconstructed arithmetic

Let `f` mean a Float32 store. Vertices below already contain Float32 coordinates.
Capital variables marked `Live` retain double arithmetic until the indicated store:

```text
ax = f(b.x-a.x); ay = f(b.y-a.y); az = f(b.z-a.z)
bxLive = c.x-a.x; byLive = c.y-a.y; bzLive = c.z-a.z
bx = f(bxLive); by = f(byLive)
nx = f(bzLive*ay - byLive*az)
nyLive = bxLive*az - bzLive*ax; ny = f(nyLive)
nzLive = by*ax - bx*ay; nz = f(nzLive)
lengthSquared = f((nx*nx + nyLive*ny) + nzLive*nz)
length = sqrt(lengthSquared)  // live double; no Float32 length store
```

If `length == 0` or unordered, use live normal `(0,0,1)` and mark `degenerate`.
Otherwise use live `(nx,ny,nz) * (1/length)`. Store D as
`f((liveNormal.z*a.z + liveNormal.y*a.y) + liveNormal.x*a.x)`, and store each
normal component as Float32. D therefore uses live normalized components,
before their output stores or the following clamps.

The installed fallback test is zero/unordered at `5366ad..5366bb`; rec2's
`isnan(length)` reconstruction omits the zero case. The actual function returns
1 for the fallback and 0 for the ordinary case; this return is ignored by full
model preparation. A repeated triangle at `(2,3,4)` yields normal `(0,0,1)` and
D = 4, and remains a prepared face.

Full preparation then clamps every stored component:

```text
if storedComponent <= -1: use -0.9999998807907104
else if storedComponent >= 1: use 1
else: retain storedComponent
```

Constants are `58a798=-1`, `58a79c=-0.9999998807907104`, and `58a7a0=1`.
Installed lower equality is stronger evidence than rec2's strict `< -1`.
The clamp does not enforce that all retained negative values are above its
replacement constant: `-0.9999999403953552` is retained because it is greater
than -1. D is copied unchanged after these clamps; never recompute it from the
clamped normal or renormalize the resulting normal.

The source CRT initializes round-to-nearest 53-bit precision through `5798e0`;
an installed capture confirms control word `0x027f`. The equations deliberately
preserve source association and mixed spill precision. A generic Three
`cross().normalize()` or uniformly rounding every intermediate differs.

## Pivot and update boundaries

Full plane generation uses original model-local positions. Separately, native
`CopyVertex` subtracts `model.pivot` into each prepared vertex as Float32.
`CopyFace` still copies the original pre-clamp D; this helper must not silently
adjust D or generate the plane from already pivot-subtracted vertices.

The current DAT parser discards optional pivot chunks, while render geometry
retains `sourcePositions`, `sourceFaces`, `sourceVertexIndices` and `modelFlags`.
Those fields are sufficient to compute a full-preparation plane for unchanged
indexed geometry. A nonzero original pivot still requires an explicit parser/
host metadata provider before claiming exact prepared vertex placement.

`BrModelUpdate` also has already-prepared copy/update paths; this module implements
full preparation only. Recovered prepared mappings and the actual update flags
must determine when to use it. Live deformation must not continue reading an
old immutable source position snapshot as if it were the current native model.

Input coordinates must be finite representable Float32 values. Nonfinite result
arithmetic is reported explicitly; no invented normal or epsilon fallback is
substituted beyond the verified native zero/unordered fallback.

## Validation and production handoff

Six focused tests pass, including the exact negative-axis clamp and pre-clamp D,
two installed synthetic numerical fixtures, degenerate fallback, Float32 input
storage, invalid-input errors and read-only Stock/Advanced Eagle/Newcity indexed
geometry. Original-installation tests skip when the installation is absent.
TypeScript and formatting checks pass.

A private 32-bit harness called installed `5365f0` with 3,003 synthetic triangles
covering degenerate, small, ordinary and large translated inputs. All 12,012
normal/D component values matched the independent reconstruction exactly.
The TypeScript implementation also matched all post-clamp values derived from
those source outputs. Probe code and binary captures stay under `/tmp`.
Safe committed fixtures are synthetic numeric inputs, not original assets.

For a world cached-face bridge, recover the original face index from snapshot
metadata; obtain its indexed positions; prepare this plane; independently
prepare pivot-subtracted vertices if needed; then apply the verified original
actor transform to emitted vertices and normal. Normal transformation and D
emission rules are recorded in `c2-model-pick-box-re.md`. Exact prepared face
order and native material-pointer ranks remain separate from plane fidelity.
