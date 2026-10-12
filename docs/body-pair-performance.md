# Spatial body pairs and phase-local geometry

PERF-06 / TASK-100.1 and PERF-07 / TASK-100.2, 2026-10-12.
Comparison engine: `59e6d8f`. These are behavior-preserving optimizations;
C2 impulse, crush, repair, clocks and correction limits are unchanged.

## Executive Summary

Spatial indexing removes the global body-pair scan; phase-local geometry sharing
reduces repeated transformations without changing collision decisions. Original
crash outputs match exactly, and headless/build/Chromium validation passes.
Measured CPU work falls substantially, but adverse samples and whole-frame stalls
remain. Further world synchronization and correction-pass work stay separate.

## Implementation

`BodyBroadphase` indexes resting and moving AABBs in balanced trees. The resting
tree survives calls, checking every body's identity, index and six bound
components before reuse. Wake-up, removal, reorder and in-place bound changes
invalidate it. Moving bounds are rebuilt per phase. Returned pairs retain the
original `i < j` order; filters and narrow-phase contact emission retain their
relative order. Nonfinite and inverted bounds use an exact conservative fallback.
No resting/resting scan is needed. Body roster validation remains linear;
construction uses median sorting, O(K log² K). Dense intersecting populations
can still have quadratic output.

Both contact recollection and the independent commit/projection guard use this
index. Attachment-root unions are separately enumerated inside ancestry groups,
merged in original order and filtered before union. Static props never join
otherwise unrelated vehicle trajectories.

Each `BodyTrajectoryGuard.run` owns a new working set keyed by body, path and
fraction. Certified stable paths share transformed vertices, planes and bounds
across pairs. Explicit constant-pose certificates collapse their geometry samples
to one. Depths, initial overlap and escape allowances remain pair-specific.
No geometry survives correction, crush, split, repair or projection phases.
Only the spatial index survives; disposal releases it.

Simulation callsites certify captured, pure integration/projection paths.
Uncertified custom paths retain conservative rotation-arc bounds and private
samples; immovability alone cannot certify a constant path. Constant immovable
convex props use tighter actual transformed bounds. If **any analytic sphere**
participates, all bodies retain the previous conservative envelope: native
Float32/tolerance contacts can extend beyond tight model bounds.

## Measured work and timings

Short serial Chrome DevTools MCP captures used original Stock Timber/Eagle assets,
six normal rivals, 466 noncars and 584 pedestrians. Hardware backend: AMD Radeon
Graphics, ANGLE/radeonsi OpenGL 4.6; viewport 1414×987, DPR 1.484375, drawing buffer
2098×1465, four-sample MSAA. The installation was served read-only.

A separate unchanged source checkout supplied the baseline collector and guard.
Frozen working-set comparisons use identical live hulls, masks and cached native
40 ms paths, and assert exact ordered contact data and every guard fraction.
Serialization is included in the timings. Every ABBA sample is retained below.

| Frozen workload / path                               | Baseline ABBA samples (ms) | Optimized ABBA samples (ms) |
| ---------------------------------------------------- | -------------------------- | --------------------------- |
| Start, 473 bodies / collector                        | 1.5, 1.2                   | 0.6, 0.4                    |
| Start / guard                                        | 6.1, 6.2                   | 1.4, 0.8                    |
| Damaged, two jointed bumpers, 475 bodies / collector | 15.1, 6.4                  | 1.3, 0.5                    |
| Same / guard                                         | 13.4, 10.7                 | 2.6, 3.2                    |
| Prepared seven-part workload, 480 bodies / collector | 4.6, 4.2                   | 1.1, 1.0                    |
| Same / guard, first capture                          | 11.7, 11.9                 | 4.9, **30.7**               |
| Same / collector, second capture                     | 2.7, 3.1                   | 0.8, 0.4                    |
| Same / guard, second capture                         | 12.8, 15.8                 | 4.6, 3.6                    |

The 30.7 ms optimized sample is retained, not discarded. These short shared-host
samples establish work reduction, not steady-state FPS or a universal speedup.
The prepared seven-part workload explicitly queues seven authored Eagle bodywork
records through the native detach constructor, then places their physical bodies
near a lightly crushed Eagle at the Timber fence. It is **not** a reproduction of
a natural seven-part crash or the user's exact canyon route.

For its actual 480-body collector arguments, 114,960 old pair opportunities become
38 leaf bounds tests plus 292 tree-node tests, selecting four pairs and emitting
five identical contact rows. The guard performs 64 leaf tests plus 302 node tests,
selecting 32 pairs. It transforms 1,879 hulls versus 2,027 baseline transforms,
with 818 shared-snapshot hits. Transform instrumentation counts source face-array
maps outside timed samples and restores their property descriptors afterward.

The deterministic sparse480 test reduces actual filter calls from 114,961 to two
(including the narrow guard's repeated predicate), with three bounds tests and
16 node tests. A shared-12-partner test reduces source-point clone calls from
13,856 to 4,224, with 1,216 shared-snapshot hits. Clone counts also include source
feature work; they are not mislabeled as hull transform counts.

A bounded 16-native-tick ABBA run on the evolving prepared state had four-tick
mean CPU times **77.88 / 30.05 / 27.78 / 54.78 ms** (baseline/optimized/optimized/
baseline). Collector calls were 9/8/8/8, each with the actual 480-body argument;
collector totals were 73.9/5.3/2.8/34.3 ms. No state reset occurs between batches,
and AI does not advance between direct diagnostic ticks. This supports lower
pair cost, but is not an identical-state whole-tick benchmark.

Normal keyboard driving was also inspected in the hardware browser. The later
prepared-state app capture, with draw submission suppressed but normal AI/HUD/
scene work retained, ran 18 ticks averaging 32.74 ms (max 64.6 ms), and 122 contact
collections averaging 0.47 ms. It displayed 36.16 FPS with frame max 105.2 ms.
A normal rendered start drive displayed 26.39 FPS. Earlier mixed-method half-second
captures on a different, heavily damaged two-part state include clock catch-up:
first two batches ran no ticks; later batches averaged 227/266 ms. They remain
in the raw evidence and are not paired throughput measurements. Stalls remain.

## Validation and limits

- Exact full numerical output equality for 15 original Eagle3, Buggy and Bigdump
  crash scenarios: motion, angular response, deformation, component damage and
  detached parts.
- Ordered-pair oracle covers randomized rosters, exceptional bounds, touching,
  activation, mutations, reorder and duplicate identities.
- Guard oracle covers shared/disconnected groups, arbitrary masks, multihull
  overlap escape, tunneling, full turns, custom paths, original cars, hull/COM/
  pose changes, repair and the Float32 sphere tolerance regression.
- Full headless suite: **2,600 passed**, no failures/skips. Production build passes. Production Chromium crash matrix
  passes Stock Eagle/Buggy/Bigdump and Advanced Mach1 driving/impacts, reverse
  escape, Eagle bumper joints/repair and Porker split/repair, with no application
  errors, failed requests or WebGL errors. Hardware MCP driving, damaged-body
  captures and screenshots also pass; baseline diagnostic imports alone produce
  Three.js's multiple-instance warning.

Tight static geometry preparation still transforms all certified static hulls
once per phase. Reuse across correction passes belongs to PERF-12; world
synchronization, invalidation and local face discovery belong to PERF-08–11.
This work does not claim the entire Timber performance problem is solved.

Opt-in `simulation.bodyPairDiagnostics` reports actual call population, index
rebuilds, tree/leaf work, masks, joints, rows and guard snapshots. It is unset in
normal gameplay. `/tools/body-pair-performance-probe.mjs` provides the bounded
comparison when served by a local source server with a separate baseline source
server. It is not imported by the app or bundled into production.

Raw reports are ignored under `artifacts/perf-06-07-*.json`; original assets and
asset-derived fixtures are never committed.
