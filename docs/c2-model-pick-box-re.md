# Native finite ModelPickBox clipping

Implemented independently in `src/physics/model-pick-box.ts`. This is the exact
six-plane clipping predicate after the model-space early gates and query-box
transpose transform. It is suitable for camera/world finite-face admission;
it does not recover prepared face order, packed plane generation, actor traversal
or cache allocation.

## Installed evidence

The original HW executable is read-only. SHA-256:
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
PE image base `0x400000`, entry `0x577eb0`, timestamp
1998-10-18 20:13:36 UTC. `madebr/rec2`'s `finteray.c` names ModelPickBox at
`0x45ff90`; in this installed executable the matching function starts at
`0x460490`. The installed address takes precedence.

| Installed addresses          | Verified operation                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `460532..460567`             | Packed prepared plane normal against vertex 0 minus box centre; strict plane-radius rejection. |
| `460584..46070d`             | Six strict all-three-vertex model-space AABB rejection tests.                                  |
| `460715..4607dc`             | Each vertex minus query matrix translation, storing each coordinate as Float32.                |
| `4607e3`, `4607fe`, `460819` | `BrMatrix34TApplyV(532cd0)` stores three box-local coordinates per vertex.                     |
| `46083c..460a7e`             | Minimum-plane crossing and inclusive retention, then reject if fewer than three vertices.      |
| `460a87..460cbd`             | Maximum-plane crossing and inclusive retention, then reject if fewer than three vertices.      |
| `460cbf..460cd9`             | Advance axis X, Y, Z, processing minimum then maximum on each axis.                            |
| `460ce3..460ce8`             | Accept only if the final stored vertex count is at least three.                                |
| `460d29..460e83`             | Emit original prepared triangle vertices and prepared normal, optionally transformed.          |
| `460e88..460edb`             | Resolve prepared group material or inherited material, and store cached plane D.               |
| `460ee1..460fc9`             | Updateable-model raw face flags versus generated edge flags.                                   |
| `461023..461043`             | Consume one cache capacity unit only after accepted emission.                                  |

## Clipping arithmetic and boundary behavior

Input coordinates and limits are stored Float32. Each plane walks the polygon
in original array order, beginning with the edge from its last vertex to vertex 0.
Both minimum and maximum passes test a crossing using the same strict expression:

```text
(previous[axis] > limit) != (current[axis] > limit)
```

If it crosses, emit the intersection first. Its clipped coordinate is exactly
the stored limit. Other coordinates use live double arithmetic followed by one
Float32 store:

```text
f32((current[k] - previous[k]) * (limit - previous[axis])
    / (current[axis] - previous[axis]) + previous[k])
```

Then emit the current vertex if `current[axis] >= minimum`, or
`current[axis] <= maximum`, respectively. No intermediate arithmetic Float32
spills occur in `460908..460943` or `460b4d..460b88`. Copied coordinates retain
their stored bits, including signed zero. Source CRT default precision is
round-to-nearest 53-bit (`5798e0` invokes the precision-control function;
an installed probe produces control word `0x027f`).

Immediately after each pass, fewer than three vertices rejects the face.
Do not deduplicate vertices, require positive polygon area, insert an epsilon,
or use inclusive membership to decide whether an edge crosses. The temporary
source arrays each have capacity 12; the implementation reports an explicit
error if that bound is exceeded rather than silently truncating.

The boundary asymmetry is observable. At minimum X = 0, triangle
`[(-1,0,0),(0,0,0),(0,1,0)]` produces two vertices and is rejected.
At maximum X = 0, its reflected triangle
`[(1,0,0),(0,0,0),(0,1,0)]` produces four vertices, including boundary
duplicates, and is accepted. The previous camera helper's inclusive crossing
test incorrectly accepted the minimum-plane example.

`clipNativeModelPickFaceToBox` exposes the temporary acceptance polygon.
This is not the emitted cached triangle: source emission preserves all three
original prepared vertices even when they protrude far beyond the query box.

## Required earlier gates and cached-record providers

`nativeModelPickFaceInBox(vertices,min,max)` requires prepared box-local vertices.
It deliberately does not manufacture a face normal. A complete ModelPickBox
caller must supply these additional source values:

1. Prepared model-local triangle, prepared normal and prepared D, actual
   model-space box centre/radius and `real_bounds`.
2. Reject if
   `abs(((v0.z-centre.z)*n.z + (v0.y-centre.y)*n.y) + (v0.x-centre.x)*n.x) > radius`.
   The differences and dot products remain live until comparison. There is no
   intermediate Float32 `a` spill despite the reconstructed C local variable.
3. In X, Y, Z order, reject when every vertex is strictly below the box minimum
   or strictly above its maximum. Equality passes these AABB gates.
4. Store `delta = f32(vertex - queryMatrix.translation)` per coordinate, then
   apply the transpose basis. For box-local axis `i`, `532cd0` stores
   `f32((delta.z*M[i][2] + delta.y*M[i][1]) + delta.x*M[i][0])`.
   This is a transpose transform using the actual native matrix; it is not an
   arbitrary general inverse or a Three matrix storage assumption.
5. On acceptance, copy the original prepared triangle. With a non-null `pMat`,
   transform those vertices by `532ae0`, transform the existing normal by
   `532b60` without renormalizing, and store their dot-derived D as Float32.
   With null `pMat`, copy the prepared normal and D unchanged.
6. Source material comes from the prepared group when non-null, otherwise from
   the inherited model material. Preserve actual null identity; a render fallback
   material does not establish native material presence.
7. If model flags contain `0x80`, map through `face_user[f]`, set group `-1`,
   copy the original face's raw byte flags and original vertex map references.
   Otherwise retain prepared group/face indices, generate only bits 1/2/4 for
   prepared edge indices equal to zero, and reference prepared vertex maps.
   Non-updateable records therefore cannot inherit original raw bit `0x80`.

These providers must execute before any capacity cutoff. Prepared group/face
order and material pointer ordering remain the separate evidence gap documented
in `c2-prepared-face-order-re.md`; the finite primitive does not resolve them.

## Validation

Seven headless tests cover all three axis boundaries, source minimum/maximum
asymmetry, exact oblique intersection coordinates and order, AABB-only false
positives, degenerate triangles, Float32 equality, signed zero, stable Three
inputs and explicit invalid-input errors. TypeScript and formatting checks pass.

A private 32-bit harness called installed `460490` with a synthetic one-face
prepared model: 3,000 seeded integer, oblique and exact-boundary cases had zero
acceptance mismatches. A second private harness tapped the existing post-clipping
boundary, without changing clipping arithmetic: all 2,775 cases reaching that
boundary matched temporary polygon counts and component values exactly. The
safe oblique fixture in the test is numerical synthetic data, not an original
asset dump. Probes and binary outputs remain under `/tmp`; no original file or
shared module was modified.
