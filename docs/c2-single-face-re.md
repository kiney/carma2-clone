# Cached finite single-face queries

## Executive Summary

`src/physics/single-face.ts` independently implements installed
`CheckSingleFace 45f1c0` as the finite provider for native pedestrian grounding.
It consumes the actual cached vertices, normal and material state. It preserves
the material-side gate, strict denominator minimum, signed origin-side test,
double endpoint/barycentric constants and distinct Float32 stores. It neither
recomputes normals nor shares the wheel MultiRay penetration allowance.

An isolated read-only original-function capture compared 4,014 invented cases:
2,008 accepted hits, zero hit/miss differences, and identical Float32 hit
parameters, points and normals. This establishes those captured mathematical
paths; general bit-for-bit equivalence for every finite input is not claimed.
Actual cache construction, ACT traversal, registration and outer-frame effect
application remain host responsibilities.

## Identity and source map

Installed HW executable SHA256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`,
PE32 image base400000, entry RVA177eb0, timestamp1998-10-18 20:13:36 UTC.
`madebr/rec2 common/finteray.c::CheckSingleFace` provides the function/layout
map. Equations below were reconstructed from the installed instructions rather
than copied from its implementation. rec2's second barycentric sign differs
from the installed path, as already identified by the oil-placement audit.

| Installed address | Role                                                       |
| ----------------- | ---------------------------------------------------------- |
| 45f1c0            | CheckSingleFace, rejection output rt100                    |
| 45f1d8..45f1f9    | Packed normal dot segment; Float32 denominator             |
| 45f1fd..45f23c    | Material side and conditional identifier-prefix filters    |
| 45f242..45f298    | Denominator minimum, live vertex-relative numerator        |
| 45f29e..45f2b9    | Inline Float32 quotient-range check                        |
| 45f2bf..45f34d    | Origin side, double endpoint allowance, fraction clamp     |
| 45f355..45f392    | Separate scale and accumulate Float32 point stores         |
| 45f395..45f403    | Largest packed-normal axis selection                       |
| 45f419..45f570    | Partial Float32 projected barycentric tests                |
| 45f572..45f5b2    | Accepted fraction and copied/oriented packed normal        |
| 422610            | Ordered face wrapper; raw80 skip, strict nearest parameter |
| 461de0            | Current-root support segment with slot0-clearance retry    |

Source face stride50hex has material pointer+0, vertices+4/+10/+1c,
normal+34/+38/+3c and raw flags byte+40. The **packed plane constant is not
read** by this helper. Numerator instead uses cached vertexA and normal. The
sphere-face routine's cached-D contract is separate; do not substitute it here.

## Plane and material gate

Let `f` mean a Float32 store; source inputs are Float32. Normal remains the
actual cached normal, including its magnitude and orientation:

```text
d = f(Nx*segment.x + Nz*segment.z + Ny*segment.y)
n = f(Ny*(origin.y-A.y) + Nz*(origin.z-A.z) + Nx*(origin.x-A.x))
```

The vertex-relative differences in `n` remain live until the final store.
Native NULL material permits either direction. A present material with neither
bit800 nor1000 rejects `d>0`. When material and identifier are both present,
prefixes `!`, `>` and `?` reject only if `gEnablePlingMaterials 595220` is
nonzero. Raw face80 belongs to the caller, not this helper.

The strict denominator minimum is Float32 `2^-22` at588fe4. Equality continues.
When `abs(d)<1`, reject if `abs(n)>abs(d)*Float32Max`; this is the installed
inline `BadDiv` guard. A negative denominator requires
`0<=n<=double(.003)-d`; a positive denominator requires
`0<=-n<=d+double(.003)`. There is no negative wheel penetration allowance.

The endpoint constant is double `.003` at589040, with its double negative at 589048. `f(1.003)` lies above double1.003 and rejects for a unit segment;
the immediately lower Float32 origin can pass. Accepted `t=-n/d` is stored
Float32, clamped to1 when its live value exceeds1. Each point component is
`f(origin[i]+f(segment[i]*t))`, preserving separate source scale/accumulate
stores. A tolerated overshoot returns the actual segment endpoint; it does not
project that endpoint back onto the plane.

## Finite projected barycentric gate

Drop the largest absolute packed-normal component: X wins X/Y equality; Z
replaces the current winner only when strictly greater. Remaining axes are
Y/Z, X/Z or X/Y in that order. No regenerated normal or area epsilon is used.

Using projected components and live subtraction where indicated:

```text
bu=f(Bu-Au), bv=Bv-Av, cu=f(Cu-Au), cv=Cv-Av
pu=f(Pu-Au), pv=Pv-Av
bc=f(bv*cu), cb=f(cv*bu)
D1=cv*bu-bc, A1=pv*bu-bv*pu
```

Reject if `abs(A1)>double1.0001*abs(D1)` or `f(D1)==0`. Compute live
`alpha=f(A1)/f(D1)`, reject if `alpha<double(-.0001)`, and retain `f(alpha)`.
The second determinant is separately rounded and negated:

```text
D2=bc-cb
A2=cu*f(pv)-pu*f(cv)
beta=f(A2)/f(D2)
```

Reject if `abs(A2)>double1.0001*abs(D2)`, `f(D2)==0`,
`beta<double(-.0001)` or `f(alpha)+beta>double1.0001`. That final expression
uses stored alpha and live beta. These are asymmetric spill boundaries, not
one generic barycentric-vector epsilon. Constants589030/589038 are doubles
−.0001/1.0001. Accepted normal is copied from the cache and negated for `d>0`.
NaN intermediate outcomes are rejected as the installed unordered x87 tests do;
invalid nonfinite input fields fail explicitly before querying.

## Host API and validation

`nativeCheckSingleFace(face, query)` returns `{parameter,point,normal}` or
NULL for the native rejection marker100. `face` supplies native tuples
`a/b/c/normal`, optional retained `constant`, `materialFlags` and identifier;
undefined materialFlags denotes NULL, while0 denotes an actual one-sided
material. `query` supplies current origin, finite displacement and actual
material-filter switch. Ground faces can extend `NativePedGroundFace` with
these fields and install the function directly as its `queryFace` provider.

The helper does not traverse the scene, filter raw80, select the nearest face,
invent a ray length or emit partial rejected-point state. Those belong to its
caller. Existing `geometry.recoveryRay` and wheel/camera helpers are not changed
by this independent provider; their integration remains separately owned.

The Linux32 capture harness maps the original image into private process
memory, invokes only the mathematical helper, and writes synthetic records
under `/tmp`. Inputs include finite endpoints, rejected penetration, all source
material states/prefixes, denominator thresholds and 4,000 deterministic
invented tilted triangle/ray cases. Hit/miss matched all4,014 and all2,008 hit
parameters/points/normals matched exactly with a53-bit x87 precision setting.
No original geometry or executable bytes are committed. Focused tests retain
one invented tilted capture to distinguish source Float32 scale/accumulate
from a combined expression, plus a real grounding-provider composition check.
