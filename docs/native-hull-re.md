# Stored-coordinate hull repair precision (PHY-11)

## Executive Summary

The existing collinear-boundary retry could reject a point set solely because
its JavaScript coordinates retained sub-Float32 differences. Primary hull
construction already rounds those coordinates to the original stored Float32
geometry; the retry instead tested raw doubles for exact collinearity. A
synthetic input with exactly the same native Float32 coordinates as an accepted
box therefore threw `Degenerate collision hull horizon`.

The retry now classifies that same stored geometry. Authored coordinates and
IDs, feature ordering, the containing-halfspace validation and the native-order
primary path remain intact. No epsilon, force, deformation or collision-response
coefficient changed. This fixes a deterministic precision defect; the historical
intermittent Porker2 failure remains open because its failing point array has
not been captured or reproduced.

## Evidence and native boundary

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

## Deterministic reproduction and correction

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

## Original Porker2 bounded audit

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

## Validation and remaining acceptance

Focused checks pass: two new precision tests, 36 geometry tests including the
59 original stock polyhedra and directly measured bent Eagle topology, and eight
noncar-hull tests including monorails. The original-data audit above passes.
TypeScript, formatting and changed-file whitespace checks also pass.

The existing bounded `browser-phy17-split.mjs` fixture passes against an isolated
source copy: original Porker2 grounded, airborne and new-wall cases, at most
three physics ticks per case, with actual attachment transfer, mass/moments and
repair checks. The headless Chromium run requests SwiftShader and records zero
browser/asset errors and GL error0 in all three cases. Its copied ignored report
is `artifacts/phy11-porker-browser.json`. This is a controlled split mechanism
regression, not the historical repeated-contact hull failure. An initial pass
used the repository cwd because the fixture's child server inherits cwd; the
explicit isolated-workdir replay also passed and is the retained report.

The historical PHY-11 task is **not complete**. Its unavailable severe-contact
Porker2 point array and native behavior on that exact array remain necessary
before claiming its reported failure is fixed. The generic crash-matrix failure
artifact currently records a different PHY-17 split-secondary movement failure;
it is not evidence of a captured hull horizon. Later crash and split passes
also do not retrospectively identify that older point set. Keep PHY-11 open
with this precision fix recorded separately from the historical symptom.
