# Collision-hull recovery (PHY-11)

## Executive Summary

The source-ordered builder can leave an open horizon when native Float32
side tolerances retain a coplanar branch and a later point removes one of its
incident planes. This is a valid-volume geometry failure, beyond the earlier
raw-double collinearity mismatch. A six-point independent fixture now reproduces
it deterministically.

Successful native hulls and the existing exact-collinear retry keep their feature
order. Only a failed horizon or broken face boundary uses the installed Three
QuickHull addon to reconstruct the actual stored points. The result preserves
all authored coordinate slots/IDs, merges only machine-coplanar adjacent facets,
and validates closed topology and containment. It does not substitute a box,
reset damage or change crash/traction coefficients. This is an explicit browser
robustness extension for undefined native incidence, not a reconstructed native
choice of topology on that exceptional input.

The historical Porker2 contact sequence and point array remain unavailable.
Its exact chronology was not reproduced; closure concerns the demonstrated
horizon failure class and its recovery, rather than a claim of replaying it.

## Open-horizon reproduction and correction — 2026-10-26

`tests/hull-recovery.test.mjs` contains six independently authored Float32 points.
Five are on a top plane, including nearly collinear boundary/interior points;
one is below it. True hull IDs 0, 1, 4, 5 form a tetrahedron with signed six-volume
128.00001525878906. It is not a collapsed or negligible-volume car.

Tracing the existing builder shows:

- Insertion 3 classifies the current planes as `[0, 1, 0, -1]`, retaining a
  coplanar branch edge.
- Insertion 4 classifies `[0, 1, -1, -1]`. Two new radial edges receive only one
  incident plane, and another receives the same plane twice.
- The next insertion throws `Degenerate collision hull horizon`. Removing
  exact interior segment points cannot repair this near-coplanar case; filling
  missing adjacency locally cannot recover the already damaged face boundary.

`src/physics/hull-recovery.ts` uses QuickHull from the existing MIT-licensed
Three 0.180.0 dependency; its license is already in `THIRD_PARTY_LICENSES.txt` and
the production build. No rec2 code is copied. Recovery:

1. Classifies Float32 geometry and coalesces duplicate stored points to the
   earliest original ID, while retaining every raw authored storage slot.
2. Checks three-dimensional rank before entering QuickHull.
3. Reconstructs supporting facets, then merges connected coplanar triangles at
   a scale-dependent Float64 roundoff bound. The native 1e-6 side tolerance is
   deliberately **not** a coplanarity/flattening threshold; real tiny ridges stay.
4. Removes internal triangulation diagonals from physical edges, walks each
   face cycle and verifies edge incidence, Euler characteristic, positive volume,
   finite planes and containment. Stored-point validation uses machine roundoff;
   raw-input containment separately keeps the existing 9.999999974752427e-7 bound.
5. Marks the local hull `recoveredFrom: "open-horizon"` for runtime captures.
   Full repair rebuilds the normal original shape through the existing owner.

The primary constructor also checks for an unpaired horizon after the final
insertion, where previously no subsequent iteration detected it. Nonfinite
Float32 overflow is rejected alongside ordinary malformed coordinates. Flat or
collinear inputs remain invalid; recovery does not fabricate thickness.

Tests cover the analytic volume, outward normals, closed incidence, containment,
original IDs/bounds, sub-Float32 jitter, duplicates, final-insertion failure,
wall/floor CCD, cube facet merging, a one-Float32-ULP ridge, and invalid input.
The original 59 stock polyhedra and native bent-Eagle feature assertions still
pass and explicitly require no recovery marker.

## Integration validation — 2026-10-26

`node --import tsx tools/hull-contact-report.mjs` performs 12 cumulative real
car-versus-plane impacts per original Porker2, Eagle and Buggy, three ticks per
impact and a 15-second deadline. It resets pose/velocity between hits but retains
damage, components and parts. Recovered/failed point arrays are captured only
under ignored `artifacts/phy11-hull-contacts.json`. It skips absent original data.
The first run completed 108 ticks in 1.09 seconds: all cars had real impulses,
maximum crush displacement 0.1460/0.1175/0.1143 model units, zero hull failures,
and pristine native hulls after normal full repair. No recovery, bend or split
occurred in that particular physical run; it is a regression, not reproduction.

Chrome DevTools MCP verified the six-point recovery in the actual application,
then keyboard driving and six three-tick original Porker2/rival impacts on Nice
Beaver. Damage accumulated, geometry visibly crushed, and no console/WebGL errors
occurred. Backend: AMD Radeon via ANGLE/radeonsi, buffer 2063×1426. Screenshot
inspection included the damaged car; this was a correctness check, not an FPS
benchmark. Captured results are ignored in `artifacts/phy11-mcp-report.json`.

The separate bounded `node tests/browser-phy17-split.mjs` regression also passes:
grounded/airborne/new-wall original Porker2 cases, physical attachment transfer,
split mass/moments and repair, with no browser/asset errors. That harness uses
SwiftShader for correctness, separately from the hardware MCP check above.

Build and focused geometry/recovery/noncar checks pass. The full suite's only
six failures were sandbox port-binding restrictions in server-startup tests;
all eight server-startup tests passed separately with localhost access. The
subsequently strengthened recovery tests pass 9/9.

## Earlier precision correction and native evidence

### Native boundary

The installed native hull entry is `ConvexHull3D 0x420fd0`, seed
`0x421210`, growth `0x4217b0`. The existing independent implementation retains
observable Float32/x87 plane-store boundaries, including growth stores around
`0x421940–0x421a30`. Original engine coordinates are stored single-precision
vectors. The prior original-binary probe matched all 59 stock car polyhedra's
vertex/edge order and face counts; the bent-Eagle capture additionally verifies
retained coplanar CCD branches. See [physics reconstruction](c2-physics-re.md).

Those native mappings refer to the installed HW binary, SHA-256
`698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c`,
PE32 i386, image base 0x400000, entry RVA 0x177eb0,
1998-10-18 20:13:36 UTC. Identity was rechecked earlier in this session. No new
native executable probe or proprietary fixture is added by this change.
[rec2](https://github.com/madebr/rec2) remains the initial symbol map; this
independent implementation copies no reconstruction code.

The earlier monorail repair is a **browser robustness extension**, not a claim
that the native uninitialized second-plane incidence has a defined portable
result. It removes only exact points inside boundary segments, then retries the
same incremental constructor, remaps authored IDs and checks every original
point against the resulting halfspaces. Successful primary builds never use it.

**Code-verified browser mismatch:** `buildHullIncremental` creates a stored
Float32 copy of every point before topology classification. In contrast, the
retry's segment/cross-product checks previously used unrounded input. Physical
crush writes through a Float64Array in `DamageSystem.crushShapes`, and repair
updates Vector3 coordinates directly, so raw doubles are valid runtime inputs.
They must not change whether the retry recognizes the same native point set.

### Stored-coordinate retry precision

The redistributable fixture in `tests/hull-precision.test.mjs` is a box with
16 authored boundary points, including redundant collinear edge points. It
requires the existing retry and produces six faces/twelve edges. For vertex
index `i` and coordinate index `k`, add:

```text
delta = sign * ((i+1)*(k+1))^2 * 1e-12
```

Every `Math.fround` coordinate remains bit-identical to the original fixture;
raw coordinates differ and no longer satisfy its exact segment tests. Before
this change the positive perturbation throws the horizon error, while the
unperturbed input succeeds. This is not a threshold sensitivity experiment:
the native-representable input is exactly unchanged.

The correction creates the same stored Float32 working copy for retry
classification. The eventual constructor still receives retained original
coordinates. Output vertex storage still contains every original raw point,
with the original index remapping; no arbitrary bounding box or surface is
introduced. Original raw-point halfspace validation is retained with the
existing tolerance `9.999999974752427e-7`. Flat/nonfinite inputs still reject,
and the existing 64-point retry limit is unchanged.

Tests require identical ordered vertex features, edges, stored planes and face
indices for both signs of the perturbation. They independently check raw-input
immutability, preserved authored storage and containing halfspaces, plus
rejection of a shape that becomes planar after native storage rounding.

### Earlier bounded damage-input audit

`tools/hull-precision-report.mjs` performs four controlled original-data cases:
human/NPC handling, forces 0.5/5, and constant 0.5/native-seed1 random sources.
Each has eight bounded `DamageSystem.applyImpact` calls using the established
front/rear/side/bottom fixture sequence. After every call, it compares raw-input
and stored-Float32 hull topology and finite planes, then verifies full repair.
There is no long simulation loop, direct component assignment or original-asset
mutation. The tool has an explicit 15-second wall limit.

The ignored report `artifacts/phy11-hull-precision.json` records revisions,
feature counts and precision/halfspace measurements. On failure it additionally
captures the configuration, stack and exact point arrays for deterministic
replay. Those data-derived arrays stay ignored. The tool is a bounded damage
mechanism audit, not a physical crash chronology replay.

On 2026-10-24 it completed 32 impacts across four cases in about 149 ms, with no
hull errors. Crushed shapes reached ten points; bent shapes reached eighteen.
Up to all 54 coordinates in an eighteen-point shape retained raw-double
precision, demonstrating the runtime relevance of the stored-input boundary.
Maximum observed containing-plane excess was about 1.64e-8. All raw/stored
feature comparisons and repair reconstructions passed. These cases did not
reproduce the historical horizon abort.
