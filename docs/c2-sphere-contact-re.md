# Installed PHIL analytical sphere contacts

## Executive Summary

The installed engine dispatches SPHERE tag4 analytically. Detached human/dog
heads must retain their authored MODEL-local sphere center and mean-diameter
radius; a sampled hull or BOX changes both resting and sweep contacts.
`src/physics/sphere-contact.ts` independently implements the verified sphere,
finite-world-face, edge, point, BOX/POLY face and ordinary shape-pair paths. The
host must supply old solver and candidate ACT matrices, cached faces and ordered
authored features. Contact response, exclusion masks, face caching, registration,
COM subtraction and animation/severing remain host responsibilities.

Evidence is installed HW static analysis plus numerical execution of the original
mathematical routines with invented inputs, corroborated by rec2's function and
structure map. This is not copied rec2 implementation. Hit/miss and row counts
matched all 1,800 deterministic comparisons; general bit-for-bit x87 equivalence
is not claimed. The measured remaining Float32/retained-x87 arithmetic differences
are documented below. No source coefficient was tuned.

## Identity and map

Executable `carma2_HW.exe`, SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`.
PE32 image base400000, entry RVA177eb0, timestamp1998-10-18 20:13:36 UTC.
Original installation was opened read-only. The bounded Linux32 capture harness
mapped the PE sections into private temporary process memory, invoked mathematical
routines only and wrote invented float results under `/tmp`. Neither copied
executable bytes nor generated original-asset fixtures belong in the repository.

`madebr/rec2` `common/physics.c`, `common/finteray.c`, and the `newcommon/49-physics.c`
and `34-finteray.c` symbol ordering identify the functions/structures; several
contact functions remain unimplemented there. Installed addresses below are from
the local executable, not assumed to match every rec2 annotation.

| Installed address         | Verified role                                                              |
| ------------------------- | -------------------------------------------------------------------------- |
| 422800, tag4 branch422b0e | GetObjectWallForceInfo sphere dispatch                                     |
| 422ca7..422e2c            | Earliest finite world face, source row type3                               |
| 423b50                    | Ordered cached-face edge visits                                            |
| 423c30                    | World edge adapter, source row type4                                       |
| 422f30                    | World contact emitter: deduplication and four-row insertion                |
| 425c00                    | Object-pair dispatch and final normal prefix                               |
| 426920                    | Sphere/nonSphere vertex, face, then edge passes                            |
| 42640f..42669f            | Inline sphere/sphere adapter, source subtype7                              |
| 426800                    | Pair emitter: strict fraction insertion, four rows, no point deduplication |
| 45dae0                    | SphereSphereCollide                                                        |
| 45dd60                    | StationarySphereSphereCollide                                              |
| 45de20                    | SphereEdgeCollide                                                          |
| 45e3a0                    | StationarySphereEdgeCollide                                                |
| 45e520                    | PointSphereCollision endpoint cap                                          |
| 45e700                    | SpherePolyFaceCollide                                                      |
| 45e9e0                    | SphereBoxFaceCollide                                                       |
| 45ed50                    | SphereFaceCollide, finite cached world triangle                            |
| 4616b0 /461460            | LineSphereColl / swept line-sphere mathematical helper                     |
| 532ae0 /532b60 /532cd0    | Point apply / vector apply / transpose-basis vector apply                  |

## Shape and coordinate contract

Source shape tags are BOX0, POLY1, WIRE2, WIREPOLY3, SPHERE4. The common shape
contains bounds at+4/+10 and the next shape pointer at+34. SPHERE data starts+38:
`radius`, center at+3c/+40/+44 and `radiusSquared` at+48 (76-byte shape total).

`CreatePedestrianPhysicsObject` detached-head initializer40881e..40887f computes
center from each MODEL bound midpoint and radius as
`f32((dx+dy+dz)*f32(1/6))`. `FillInShape`4c5dc7..4c5e18 fills bounds
`f32(center±radius)` and `f32(radius*radius)`. Radius is invariant under an
orthogonal ACT basis; an offset center rotates/translates with the ACT. Inertia
is independently the MODEL **box** dimensions times bone mass timesf32(.025),
408b67..408c15, including SPHERE. BIPED1 heads are4kg; DOG1 heads2kg. The tests
read actual Blokebl, Bandsman and twolf MODEL bounds in stock and Advanced data.
No copied MODEL fixture is stored.

Native12 matrices contain three basis rows followed by translation. For local
vector `v`, world point is `translation + v.x*row0 + v.y*row1 + v.z*row2`.
Transpose-basis inversion is valid for these rigid bases. The kernel rejects
scaled/sheared/non-finite input instead of inflating radii or silently sampling.

Old geometry comes from physics object+8c; predicted geometry comes from its ACT
matrix+2c. Every returned torque point uses the appropriate **old** object matrix.
The kernel returns absolute old world points; the existing solver subtracts each
body's own old world COM. It must not replace the two points with one impact
point, move either point to the candidate pose, or replace sphere center with COM.

## Sweep and resting equations

Numbers stored to source float locals/results are rounded with `f32`. Products
retained on the x87 stack need not be rounded at every arithmetic operation.
`a<1e-6` is the motion-squared resting cutoff; normalized length<=2^-22 falls
back to vector(1,0,0). Constants are verified in installed rdata:588ff8 double1e-6,
588fe4 float2^-22,589000 double-.002,589010 float-.002,589014 float+.002,
589018 float-2. The source distinguishes the double and Float32 margin operands.

### Sphere/sphere

45dae0 expresses moving sphere B's old/predicted center in sphere A's local frame.
Let `p=oldB-centerA`, `v=newB-oldB`, `a=f32(dot(v,v))`,
`R=f32(radiusA+radiusB)`, `tc=f32(-dot(p,v)/a)`. Closest squared distance is
`f32(dot(p,p)-a*tcExtended*tc)`, preserving the pre-spill quotient in the product.
A closest distance exceeding `(R+.002double)^2` immediately rejects. A closest
distance exceeding `R^2` uses the resting fallback. Otherwise
`t=f32(tc-sqrt((R^2-closestSquared)/a))`; t outside[0,1] also uses the fallback.
The accepted normal is normalized `centerA-(oldB+t*v)`, movingB toward staticA.

45dd60 tests **END**, accepting only the strict outer shell
`R^2 < distanceSquared < (R+.002float)^2`, fraction1. Static exact touching,
deep overlap and coincidence do not produce a contact. A moving overlap is not
resolved by inventing penetration; the installed quadratic/fallback is retained.

### Edge and endpoint

45de20 projects motion and old sphere-to-edge offset perpendicular to the finite
edge, solves the perpendicular quadratic, and obtains the nearest point on the
infinite edge at t. Closest-distance rejection and the resting helper use
`radiusSquared + radius*.002float*2`, **not** `(radius+.002)^2`.
A parameter outside[0,1] tests the appropriate endpoint with45e520 unless its
flag byte has bit80. A failed/suppressed cap then enters resting fallback.
45e3a0 clamps the nearest edge point using **END** and accepts only
`radiusSquared < distanceSquared < radiusSquared+radius*.004float`.
That resting helper does not receive endpoint flags. Exact contact/deep overlap
is rejected. An edge-parallel sweep uses this resting path, even if a generic
capsule sweep would detect an endpoint crossing.

45e520 solves the full moving-sphere/static-point quadratic; it has no resting
fallback. It returns the fixed endpoint, fraction and normal sphere toward point.
Degenerate source edges are explicit errors in the independent adapter; the
native code divides by their length squared.

### Target vertices: line/sphere

461460 returns-1 when the vertex starts strictly inside the sphere;426920 stores
FF in that vertex's local flag byte. Otherwise it solves the point sweep. The
normal is accepted vertex toward sphere center. If the sweep misses,4616b0 tests
END and accepts
`radiusSquared < endDistanceSquared <= radiusSquared+radiusSquared*.004float`.
This is a third, distinct margin equation. It returns code2/fraction1 and point
`center+radius*normal`, including the source's apparent opposite-side point.
Code0 means miss,1 means swept,2 means END resting shell; none blocks host damage
or other physical work by inventing an unsupported result.

## Finite face differences

### World triangle45ed50

The cached plane is `N.dot(x)=D`; N and the triangle's three vertices are supplied
by the host in source face-cache order. Material identifiers beginning `!`, `>`
or `?` reject the finite-face test. A backface requires a non-NULL material with
bit1000. This is narrower than several non-sphere ray helpers'1800 gate.

Compute signed old distance `d0=f32(N.dot(old)-D)`. A front start requires d0>=R;
a back start requires d0<=-R and flips the result normal. Oriented end distance
d1 must be<=R+.002double. The quotient is
`f32((R-d0)/(d1-d0))`, retaining the **signed original d0 even on the backface**.
Clamp>1 to1 and negative/unordered to0. For a planeY0,R.5, oldY-2/endY2,
the installed result is fraction1/normaldown; replacing it with symmetric.375
is incorrect. Static frontY.501 and exactY.5 produce fraction0, while oldY.499
is rejected. EndY.502 fromY2 is accepted atfraction1; .503 rejects.

Project the interpolated center onto the plane. Drop the strictly greatest
absolute normal axis (ties retain the earlier axis); apply the installed2D
barycentric checks: degenerate denominator rejects, numerator magnitude limit
1.001, u/v>=-.0001 and u+v<=1.0001. This finite-face routine does not test edges.

### Target BOX45e9e0 and POLY45e700

Target inward planes use `N.dot(x)+offset>=0` for the interior. BOX tests each axis
minimum then maximum in source order. Its finite point must lie **inclusively**
inside the other two bound axes. POLY tests planes in supplied order and requires
`Nother.dot(surfacePoint)+offsetOther > 0` for every OTHER plane. Exact edge points
therefore reject in POLY even where BOX accepts.

Both inflate their crossing planes by radius and use.002 acceptance. A BOX
resting-shell face returns **END center itself** as the target point; POLY
returns END plusradius\*inwardNormal. Both quirks were captured numerically. Source
POLY uses two temporary plane-distance arrays; the adapter bounds supplied planes
to124, the safe available workspace span, rather than truncating. This is a
bounded input guard, not a claim that native loader accepts124-plane models.

## Ordinary pair wrapper426920

The implementation accepts BOX or explicitly provided ordered POLY/WIRE/WIREPOLY
vertices, edges and inward planes. BOX's source corner numbering chooses minX
forbit2, minY forbit1, minZ forbit4; otherwise max. Installed edge pairs58e7f0 are
(0,1),(2,3),(4,5),(6,7),(0,2),(1,3),(4,6),(5,7),(0,4),(1,5),(2,6),(3,7).

1. Transform each target vertex through old/candidate target and inverse
   old/candidate sphere frames. Build six outcodes where BOTH endpoints remain
   beyond the sphere's bounds inflated by.005float. A common outcode bit across
   every vertex rejects the pair.
2. Visit zero-outcode target vertices in source order using4616b0. Start-inside
   marksFF. Accepted rows use subtype5, native object order sphere/target,
   separate old points and a normalized blend of sphere old/candidate normal.
3. Visit the first accepted finite BOX/POLY face (WIRE has none). Transform its
   inward normal through target old/candidate bases, blend at t and normalize.
   Transform that world normal into sphere old/candidate bases, blend and
   normalize again. Sphere surface point is center+radius\*this local normal.
   Native emitted object order reverses to target/sphere, subtype8.
4. Visit ordered target edges unless both endpoint outcodes share a low-six bit.
   Set bit80 in BOTH endpoint bytes **before** passing them to45de20, suppressing
   their moving caps because the vertex pass already visited those features.
   Resting endpoint contacts remain possible. Accepted edge rows use the same
   normal/point adapter and reversed native object order as finite faces.

The public adapter consistently returns sphereA/targetB and normalB towardA;
`sourceObjectOrder` retains the native reversal. `sourceProjectedDrift` preserves
row+10: `(candidateSphereCenterInTarget-oldSphereCenterInTarget).dot(featureNormal)`
for finite face/edge rows, zero for vertex rows. This payload is **not** the sort
key. All rows sort by fraction in row+0.

426800 inserts only strictly earlier fractions before an existing row and retains
at most four. Equal-fraction order remains stable. There is no pair point/normal
deduplication: an exact BOX corner capture retains subtypes[5,8,8,8], allfraction.125
and identical points.425c00 then retains the prefix aligned atdot>=.707 with its
first row, accounting for emitter object reversal. Public consistent normals
allow the same check directly. Apply `selectNativeSpherePairContacts` once across
all linked shape-pair candidates, preserving their source outer loop order.

The inline sphere/sphere adapter differs: it builds Apoint=centerA-radiusA*normal,
blends the world normal through Aold/Acandidate, then inverse-transforms/blends
through Bold/Bcandidate for Bpoint=centerB+radiusB*localNormal. It does **not** add
the normalizations present in the finite-face/edge wrapper. It emits subtype7.

## World wrapper and integration

`nativeSphereWorldContacts` first picks the strictly earliest finite cached face;
an exact fraction tie retains the first face's material/surface metadata. It then
visits every cached face's enabled edges in source order. Face flag80 skips its
edges; bits1/2/4 suppress edges0/1/2. These flags do not suppress the first finite
face pass. The edge pass does not duplicate the finite-face material-prefix gate.

World finite-face local point iscenter-radius\*oldLocalOutwardNormal (type3).
World edge point uses the normalized blend of old/candidate local feature
normals, while its emitted outward normal uses the old local normal (type4).
`placementStart` explicitly supplies the world COM override677cd8; the host must
also provide the placement mode's candidate matrix equal to the solver matrix.
The actual old torque point still comes from its authored sphere surface.

Feed returned rows through existing `reduceWorldContacts` per authored shape,
then `finalizeWorldContacts` once across all linked shapes. Keep world source
friction/surface metadata. The kernel has no sampled-hull fallback and no
persistent state, PHIL allocation, rigid/contact flag mutation or damage callbacks.
The host performs exclusion checks on every pair dispatch/refinement path and
routes these rows to its existing native contact response.

Required production inputs: exact tag4 descriptor; rigid native12 old/candidate
matrices; cached world triangles with source normal/D/materialflags/faceflags;
for target shapes, exact MODEL-local bounds, ordered authored vertices/edges and
inward plane equations. Geometry reconstruction/render meshes must not invent
extra collision faces or change source feature order.

## Validation and bounded limits

Focused tests:21 passed, including native mathematical captures, independent
old-frame sphere-pair points, rotation of offset authored center, material/face
gates, placement COM override, pair duplicate order, strict/inclusive face
boundaries, both original-installation trees and human/dog radii. `tsc --noEmit`
passed. No production build or browser validation was performed by this worker;
the root owns actual simulation integration and runtime verification.

Deterministic installed captures tested300 invented Float32 trajectories each for
sphere/sphere, edge, BOX face, POLY face, world face and the complete ordinary
sphere/BOX wrapper (1,800 comparisons). All hit/miss decisions and wrapper row
counts matched. After preserving additional source retained/spilled quotient
products, the largest measured primitive normal/point difference was2.146e-6;
complete pair point/normal difference5.816e-6. Finite-world-face captures matched
exactly in these cases. These bounds describe this finite audit, not a universal
numerical guarantee. More x87 retained-operand audits are needed for global
bit-for-bit equivalence; no generic epsilon/penetration coefficient replaces
source gates to conceal that difference.

Special-volume/water/placement preparation, recovery of malformed geometry,
articulation/joints, convex-feature extraction from renderer meshes, global face
cache lifetime and PHIL state are outside this pure kernel. WIRE/WIREPOLY feature
and plane dispatch are verified statically and tested with safe authored-style
numeric inputs; no original WIRE model fixture was found in the stock car sample.
The adapter explicitly rejects non-finite radii, non-rigid poses, invalid indices,
degenerate edges, plane lists beyond its bounded workspace and feature arrays
beyond112 flag-byte workspace entries. It never silently truncates or substitutes
a BOX. Shape dispatch and the installed row response must remain explicit in the
host.
