# Analytic spheres against cached moving-world triangles

## Evidence boundary

`sphere-moving-world.ts` preserves the existing engine's moving-world rigid
partner extension while replacing sampled sphere geometry with the installed
analytic sphere primitives. It does **not** claim that C2's world-face emitter
had a moving rigid body B: `422f30` stores row B as NULL at `4231f5`. The B
feature/torque adapter is independently derived from the verified source
coordinate operations and finite feature equations. It adds no impulse, bounce,
friction coefficient, lifetime or registry.

The installed executable identity and primitive audit are recorded in
[c2-sphere-contact-re.md](c2-sphere-contact-re.md). This note reuses that HW
disassembly and reads original files only. `madebr/rec2` is a symbol/structure
map, not copied implementation code.

| Installed evidence                | Consequence                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `460452`, then `460475..46047e`   | ActorBoxPick invokes ModelPickBox before callback `world_callbacks+14` (StopGroovidelic). Cached geometry survives a later actor rollback. |
| `tFace_ref`, 80-byte cache record | Material+0; vertices+4/+10/+1c; normal+34; flags+40; plane D+44; ACT+48; group/face+4c/+4e. Actor metadata is not a PHIL body B.           |
| `422b0e..422b48`                  | Sphere MODEL center is separately transformed through old solver matrix and candidate ACT matrix.                                          |
| `422ca7..422d6a`                  | Strictly earliest accepted finite face; equal times retain source face order.                                                              |
| `422d85..422e23`                  | Type3 sphere surface point uses the old solver inverse normal and authored center/radius.                                                  |
| `423b50`, `423c30`                | Ordered enabled world edges, type4; old/candidate inverse normal blend for the sphere torque point.                                        |
| `45ed50`                          | Packed cached normal/D determine signed distances and TOI; finite triangle projection uses vertex0 and the returned side normal.           |
| `45de20` / `45e3a0` / `45e520`    | Analytic moving/resting edge and endpoint points, including source shell and flag behavior.                                                |
| `532ae0`, `532b60`, `532cd0`      | Point apply, basis vector apply and transpose-basis vector apply; separate Float32 coordinate spills.                                      |

Reconstructed rec2 `ModelPickBox` transforms prepared face normals directly,
without deriving a replacement normal from the transformed triangle. With a
parent matrix, it derives D from the transformed normal and vertex0; without
one, it retains the prepared face equation's D. The new adapter accepts an
explicit cached constant and never recomputes a cross-product normal. Existing
`Surface` lacks D; its compatibility default is `f32(N.dot(vertex0))`. Retaining
actual authored packed normals/D and original world cache ordering remains the
world loader/cache owner's responsibility.

## Derived moving-target coordinates

All transforms are rigid, unscaled native12 matrices. Let A0/A1 be the sphere's
old/candidate poses and B0/B1 the target's captured old/candidate poses. Cached
WORLD triangle vertices, normal and D belong to the captured candidate pose.

```text
relative A0 = inverse(B0) * A0
relative A1 = inverse(B1) * A1
target-local vertices = inverse(B1) * cached WORLD vertices
target-local N = transpose(B1.basis) * cached WORLD N
target-local D = cached WORLD D - cached WORLD N.dot(B1.translation)
```

Native sphere world primitives then operate on a fixed finite triangle in the
target's local frame. This follows `sweepHullMovingTriangle`'s existing endpoint
relative-frame policy. It is not continuous quaternion/arc CCD for a rotating
target. No quaternion interpolation, basis averaging or modern triangle solver
is added. Normal output uses B0's basis; type4's sphere local torque direction
still uses the source old/candidate relative inverse-normal blend.

The shared kernel's sphere point is transformed through B0 to recover A's old
WORLD torque point. This equals the authored sphere surface point in its A0
frame, including its source edge-normal blend, up to the documented Float32
coordinate spills.

The independent B feature is reconstructed as follows:

```text
type3:
    t, sideNormal = exact SphereFaceCollide result
    q = f32(start + f32(f32(end-start) * t))
    distance = f32((vertex0 - q).dot(sideNormal))
    localFeature = f32(q + sideNormal * distance)
type4:
    localFeature = exact SphereEdgeCollide hit.point
B old WORLD torque point = B0 * localFeature
```

The face projection intentionally uses vertex0 rather than replacing it with D.
An independently packed D can change TOI while the geometric projection stays
on the finite face's vertex plane. Resting edge contacts retain the source
nearest endpoint/segment feature. Neither A nor B point is transformed through
an interpolated target pose. The existing solver subtracts each body's own old
COM and computes point velocity; this adapter does not share A's lever with B.

## Host API and validation

`nativeSphereMovingWorldContacts(input, surfaces, options?)` consumes:

- `NativeSphereBodyPose`: source sphere center/radius/radiusSquared and A0/A1.
- Actual `Surface` objects with `owner: MovingWorldBody`, optional captured
  `collectedPose`, optional cached `constant` and optional `faceFriction`.
- Optional WORLD `placementStart` override and `edgeOnly` gate.

The surfaces are cached WORLD geometry, unlike `sweepHullMovingTriangle`'s
already local vertex input. Missing captured poses use the current owner's
old/candidate state. Hosts must attach `collectedPose` when an earlier collection
outlives StopGroovidelic/another actor query. Returned `sourceSurface` is the
actual supplied object, or its explicit `sourceSurface` when the host supplies
a pose wrapper, allowing the existing host to select its rigid partner without
losing the original face-cache identity.

Output is unreduced: one globally earliest type3 face followed by accepted
type4 edges in supplied face/edge order. Equal face fractions retain the first
face. The host performs source world reduction/finalization once per shape and
across linked shapes; this adapter introduces no pair-row sorting/deduplication.

Face flags80 and1/2/4, material prefix filtering, the narrower backface1000 gate,
the installed signed old-distance backface quotient, and source edge resting
shell come directly from the shared kernel. Flags80 suppress edges but retain
the finite face pass. Edge processing does not invent a material-prefix filter.
Disabled/passthrough surfaces and the engine's edges-only policy are retained.
Oversized caches, nonfinite scalars, invalid source radii and scaled/sheared
poses fail explicitly.

The focused tests cover target translation/rotation, independent old points,
rotating A and MODEL-center offsets, captured older poses, constant/normal
preservation, finite-edge/endpoint/resting paths, backfaces/materials, ordering,
common-frame covariance and placement override. This is an integration
prerequisite; simulation wiring and production browser verification belong to
the integration owner. No shared module or production bundle was changed.
