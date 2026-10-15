# PERF-19: ordinary world-contact spikes

## Evidence

The 2026-10-15 post-PHY-16 recording is from **Stock desert2**, Eagle3, engine
`5fcbec0`, AMD/radeonsi through ANGLE, buffer 2612 × 1805. It is not a Timber
capture. The private reports remain in ignored `artifacts/phy16-live-recording*.json`.

An individual tick at simulation time 81.28 seconds takes 420 ms. Its
`worldContacts` calls total 292 ms over 108 invocations; world trajectory guards
take 51.2 ms, final pair guarding 24.6 ms and pair collection 16.6 ms. Timings
are inclusive wall durations, not exclusive CPU samples. The enclosing update
contains only one tick and lasts 431.4 ms. A 450-ms RAF interval spans it.
Subsequent four/five-tick catch-up updates take 104–169 ms: catch-up amplifies
the initial stall but does not cause that first expensive tick.

The common active window is about 11.23 seconds, containing 399 complete frame
intervals: median 16.7 ms, p95 66.6 ms, p99 150.1 ms, maximum 450 ms. Average
render CPU is 3.0 ms. Exclude 113 final frames with frozen simulation time;
the three 512-row rings cover different time windows. No GPU timing or CPU
sampling profile exists. GC, scheduling, per-body attribution and the exact
expensive subphase are unresolved. The previously reported 9-FPS episode was
before recorder installation and must not be conflated with this capture.

## Structural findings

1. **Locality coverage gap.** `VehicleSimulation.worldContacts` uses
   `facesNearBody`, then sweeps every eligible face for every authored hull.
   PERF-11's `queryLocalSurfaces` acceleration is used by the extra trajectory
   guard, not this ordinary emitter. Plane rejection alone does not cheaply
   reject every distant triangle on a nearby plane.
2. **Feature work multiplies.** Surviving hull/triangle pairs test hull vertices,
   world vertices against hull planes, and triangle edges against hull edges.
   Rough work scales with `H × F × (V + 3P + 3E)`; recovery adds about `2E × F`
   ray tests. This is structural complexity, not a measured operation count.
3. **Collection is not a pure spatial query.** The native 300-face ring can
   refresh and wrap, repeating actor synchronization and face construction.
   Collection also owns water-plane selection, ACT pulls and GROOVE callbacks.
   It cannot simply be replaced by an unordered BVH result.
4. **Repeated preparation and allocation.** OLD/NEXT hull transforms,
   static/moving partitions, recovery adapters and temporary contact records
   are rebuilt. Some data is common to all shapes or unchanged retry inputs.
   Allocation cost/GC dominance is not yet measured; `sweepMovingEdges` already
   has scalar rejection optimizations, so do not assume it needs rewriting.
5. **Separate guard amplification.** Angular samples and up to eight final
   prefix refinements repeat shape/face work. Also, any nonempty `movingWorld`
   roster disables static world-guard result reuse globally in
   `advanceWorldContacts`; this recording has 21 moving-world bodies. That is
   a candidate for more local validity tracking, not evidence that all 21 move
   or invalidate every query. It does not explain the separately timed 292 ms
   ordinary-contact cost by itself.

## Recommended implementation sequence

First add a bounded, opt-in outlier capture: body/part identity, hull/feature and
raw/eligible face counts, collection count/time, total call duration and retry
context. Combine with a short serial CPU profile during a real playtest. Keep
only a small ring or worst calls; do not time every primitive or wrap certified
world-query providers. Never run an ongoing autonomous stress simulation.

Choose the main change from the resulting attribution:

| Dominant work                      | Preferred direction                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary feature sweeps/recovery   | Preserve collection and its order; reject impossible per-hull/per-feature candidates before expensive emission. Investigate existing conservative sweep envelopes and shared recovery-ray acceleration. |
| Native refresh/traversal           | Investigate refresh/wrap frequency, selected-root synchronization and repeated source/owner resolution. Reuse revision-owned preparation while preserving observable callbacks.                         |
| Repeated preparation/reintegration | Share pure OLD geometry, partitions and prepared features within valid pose/shape/face generations. Separate live collection from reusable geometric work.                                              |
| Allocation/GC                      | Reduce allocations in the profiled rejection/preparation/contact paths; use scoped workspaces with explicit result ownership.                                                                           |
| Extra trajectory guard             | Share trajectory candidates/preparation and evaluate a justified interval-processing redesign; avoid merely reducing sample caps. Consider local rather than global moving-world invalidation.          |

The likely first substantial optimization is **ordered candidate reduction
after native collection**, followed by shared pure preparation. This remains a
recommendation, not an implementation decision before the subphase is measured.
Lowering resolution, adding workers, arbitrarily reducing retries or removing
contacts does not address the currently identified main path.

## Behavior and acceptance

Keep finite emission, water/pull/GROOVE side effects, source feature ordering,
Float32 ties, source edge selection, per-shape reduction and final four-row
selection. Plain endpoint AABBs are insufficient for inverse-frame world-vertex
sweeps; reuse proven envelopes or a documented conservative fallback. Moving
faces retain their collected owner poses. Damage, repair, splits, transforms,
smashes and material/provider changes must invalidate affected prepared data.

Measure structural work and outlier timings before/after on the same captured
workload, with short serial hardware captures and adverse samples retained.
Validate walls, ground support, corners, moving surfaces, recovery, damaged
bodywork and repair across original cars; include PHY-16 regressions. No claim
that reducing one isolated kernel resolves all frame spikes.

References: `src/physics/simulation.ts`, `src/physics/geometry.ts`,
`src/physics/world-face-cache.ts`, `src/world.ts`,
[native face-cache evidence](c2-world-face-cache-re.md),
[PERF-11 envelopes](world-face-performance.md),
[local response orchestration](local-response-performance.md).
