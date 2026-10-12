# World face locality (PERF-11)

## Implementation and evidence

PERF-11 narrows static world-face candidates while preserving the existing
four-unit XZ cell traversal, per-cell row order, Y/material eligibility checks,
dynamic-owner snapshots, and native face collector. The comparison baseline is
source revision `beb499f`, archived locally under ignored
`artifacts/perf11-reference/`.

Each ordered static cell array has a lazily built median-split BVH when it holds
at least 16 faces; smaller cells use linear face-bound checks. Query results are
sorted by original row index, so filtering does not reorder candidates. Bounds
cover both the captured double vertices and their `Math.fround` values. Per-axis
padding is `2e-4 × span + 32 × Number.EPSILON × max(1, maxAbs)`; invalid or
overflowing bounds become unbounded and cannot reject a face. Cell-array caches
are discarded when membership changes, alongside PERF-10's owner-local
invalidation.

The body trajectory guard uses a conservative inverse-frame envelope only when
its certificate is finite and valid. It accounts for endpoint slack, float
fraction rounding, rotation conditioning, and a cached certificate for the
local hull's plane volume. If the envelope cannot be certified, it falls back to
the legacy broad query. Wheel queries, moving-owner snapshots, and the native
finite face collector retain their previous broad or capped paths. Triangle
sweeps cache the exact plane computed by their existing double-precision
cross-product arithmetic for an unchanged source Surface; they do not substitute
an authored or f32 plane. Recovery takes a normal copy before reversing it;
coordinate checks protect retained planes against in-place edits.

A plain union of start/end hull AABBs would be unsafe. The existing world-vertex
feature clips the line between two inverse-transformed points against the local
plane volume. That line can enter the volume even when the world vertex lies
outside both endpoint hull bounds. For relative angle `theta`, the certified
envelope therefore also encloses the origin segment expanded by
`r / cos(theta / 2) + |translation| / 2 * tan(theta / 2)`, with outward rounding
and numerical allowances. Here `r` bounds the tolerated local plane volume,
not merely the displayed vertex radius. Nonnegative dual plane combinations
certify that radius; their residuals are independently checked with directed
rounding. Plane edits invalidate the certificate. Singular/near-pi rotations,
non-unit orientations and uncertifiable volumes use the legacy broad candidates.
Regression tests include a thin rotated hull whose accepted world vertex is
outside the endpoint AABBs, long-face barycentric slack and a camera clipping
case where f32 bounds touch while the original double bounds do not.

This is an optimization of the browser's existing guard, not a newly recovered
C2 collision rule. Native wheels can accept negative ray fractions; near-grazing
faces make a nominal backward interval insufficient. Their candidate selection
is deliberately unchanged. Moving scenery also keeps its full owner snapshots
and relative motion path. Unknown consumers retain `querySurfaces`; ordinary
rays, camera clearance and already-bounded placement queries opt into locality.

## Frozen-scene comparison

The browser probe compared Stock and Advanced versions of Timber and Snow Way
Out at the listed authored path nodes. Candidate counts are legacy query results
versus local query results. Guard counts are legacy returned surfaces versus
the local guard's emitted face references over four sweep samples. These are
work counts, not contacts. Candidate order and final behavior were checked
separately.

| Track / node        | Query candidates | Guard face work |
| ------------------- | ---------------: | --------------: |
| Timber 0            |           12 → 4 |         48 → 16 |
| Timber 4 (bridge)   |          203 → 4 |        272 → 16 |
| Timber 178 (quarry) |          104 → 4 |        348 → 24 |
| Timber 192          |          22 → 15 |         72 → 51 |
| Snow Way Out 0      |           22 → 2 |         66 → 10 |
| Snow Way Out 4      |           14 → 5 |         53 → 24 |
| Snow Way Out 86     |           46 → 8 |        122 → 24 |
| Snow Way Out 172    |           55 → 8 |        159 → 32 |

Stock and Advanced counts matched at all sampled nodes. The current results were
an ordered subset of the baseline candidates. Camera ray hits and camera box
faces matched exactly. Normal, shallow-recovery and deep-recovery trajectory
guard fractions, crossing fractions, contact points, normals and source faces
matched exactly. Native collector rows and callbacks matched at capacities 300
and 1. The probes reported no WebGL errors, page errors, or failed requests.
Shallow fixtures start with 0.002 supporting-floor penetration and test both
flagged and unflagged recovery; deep fixtures lower the body by 0.2 from its
initial 0.03-clearance pose. Finite sloping terrain can differ from that central
floor sample, so the report retains each case's actual contacts and fractions.

The serial SwiftShader runs used a 1280×800 buffer at DPR 1. Warm query ABBA
samples were timer-resolution limited (0–0.04 ms for both variants on
Timber; 0–0.02 ms on Snow Way Out). Guard samples were noisy: Timber ranged
0.10–1.10 ms baseline and 0.10–4.15 ms local; Snow Way Out ranged 0.15–0.80 ms
baseline and 0.05–0.45 ms local. Stock Timber node 178 had adverse local guard
samples of 4.15 and 3.60 ms versus 0.65 and 1.10 ms baseline, despite reducing
face work from 348 to 24. The bounded capture does not isolate the cause of those
timing spikes. Small queries also sometimes cost more. Cold construction cost
is visible: Timber local queries ranged 0.2–2.4 ms versus 0–0.4 ms baseline, and
Snow Way Out ranged 0.1–0.3 ms versus 0–0.1 ms. Timber node 4's local first
query took 2.4 ms despite shrinking 203 candidates to four. Do not
interpret these short, quantized timings as an FPS estimate.

Static review confirms that the local plane-volume certificate retains the
original hull identity and is warmed before timing. Its cubic certificate search
does not repeat on unchanged hulls. The warm envelope still adds linear
vertex/edge/plane scans and temporary allocation. These costs and the adverse
quarry samples remain profiling concerns under PERF-01; the capture does not
prove whether scheduling, GC/JIT or a workload-specific slowdown caused them.

A separate hardware-MCP Stock Timber capture is in ignored
`artifacts/perf11-hardware-timber.json`. It used an AMD Radeon Graphics
(`radeonsi gfx1150`) backend, 2095×1462 buffer and DPR 1.484375. Exact query,
camera, guard, recovery and collector comparisons passed. Its timing samples
also had isolated outliers and do not establish stable FPS.

The sampled Snow Way Out path nodes do not identify or reproduce the user's
specific tunnel exit route. This work does not establish a cure for that route
or for the reported Timber canyon FPS loss.

## Reproduction

From the repository root, create the ignored source-only baseline and start the
local app server:

```sh
mkdir -p artifacts/perf11-reference
git archive beb499f | tar -x -C artifacts/perf11-reference
npm run dev
```

In another terminal, run the serial Chromium capture:

```sh
node tools/profile-world-faces.mjs http://127.0.0.1:5173
```

The runner uses explicit SwiftShader, pauses each race, disables drawing during
measurement, and writes its JSON report and screenshots under ignored
`artifacts/`.

## Validation status

All 2,677 headless tests and the production build pass (the existing bundle-size
warning remains). The 20 new targeted tests cover conservative discovery,
ordering, F32 boundaries, long-face slack, uncertifiable sweep fallback,
negative-fraction wheel support, moving-owner snapshots, local mutations and
retained exact planes. Fifteen original Eagle/Buggy/Bigdump crash reports match
the accepted numerical baseline exactly.

Serial production Chromium camera, spawn/pair, crash-matrix, noncar-debris and
render-matrix suites pass. They cover keyboard motion/release, slopes, oblique
impacts, damage/detachment/splitting/repair and Stock/Advanced rendering. Their
isolated browsers use SwiftShader; they are regressions, not GPU FPS benchmarks.
The camera harness now tests actual COM-relative orbit displacement rather than
the transient native mode-1 yaw field, which is restored after its displacement
is consumed. No camera control behavior was changed to satisfy the test.

Chrome DevTools MCP also verified hardware Chromium loading, brief keyboard
driving, contact attribution and permanent crash deformation, inspected
screenshots and found no fatal console or WebGL errors in the final production
repeat. An earlier manual development-page diagnostic lost its saved renderer
function across hot reload and caused instrumentation exceptions; that was
discarded as a rendering smoke check and repeated without render overrides on
the production server. The isolated automated captures were unaffected.
Owned browsers/servers are closed after validation. Original
assets and generated reports remain excluded from source and the build.
