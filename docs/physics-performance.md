# PERF-05: physics hot-path optimization

Implemented and validated on 2026-10-12. This optimizes the existing main-thread
physics; it does not replace C2 motion/contact/damage mechanics or migrate to a
worker. The specific reported Snow tunnel-exit spike remains in PERF-01.

## Changes and preserved decisions

`geometry.ts` projects each accepted SAT axis immediately, in the original
face-A, face-B, edge-A/edge-B order. Separation ends evaluation before constructing
unused crosses. Accepted-axis deduplication, normalization, thresholds and tie
selection are unchanged. World edge subtractions are reused within that call,
without substituting rotated local edges and changing rounding. A full 12x12
edge pass allocates 168 edge vectors rather than 288; early separation avoids
that pass altogether. Projection no longer allocates a fallback vertex-index
array; authored compact order and `Math.min`/`Math.max` semantics remain intact.

`pair-guard.ts` keeps bounds and lazily computed per-pair depths beside existing
pose samples. A clear endpoint's depth is reused when reducing its allowed
overlap. Swept bounds are computed once per hull/interval and cloned before
expansion. Cache lifetime is one pair invocation: in-place pedestrian hull
changes, crush, detachment and repair cannot retain stale results. An intermediate
separate Map/WeakMap implementation was replaced by the cheaper sample records.

No guard is disabled. Depth epsilon 1e-6, maximum 128 samples, angular/motion
spacing, five CCD probe deltas, 18 bisections, monotonic overlap allowance,
attachment ancestry, sphere handling and source contact order remain unchanged.
Mass, traction, suspension, steering, impulses, damage and crush formulas are
untouched. The test-local reference retains our own source at `02528bb`, not
third-party or executable code; shared sweep/sphere primitives are unchanged.

## Hardware evidence, including unsuccessful measurements

Short serial Chrome DevTools MCP captures used AMD `radeonsi gfx1150`, ANGLE
OpenGL 4.6, DPR 1.484375 and 4x MSAA. The shared workstation reports 24 logical
processors. Source baseline and final production build run in separate isolated
contexts. A test-only seeded Math.random stream gives identical valid original
car selection; normal production randomness is unchanged. Startup rendering is
suppressed while loading, and captures begin after original content is ready.

Matched Snow fixture: Eagle3 mass 1.5, Jetcar mass 1.3, identical transforms and
velocities, two active cars, seven loaded rivals, 204 noncars, 487 pedestrians
with 22 initially active. Source AI is held for these controlled crash inputs;
this is not an ordinary random race encounter. Each capture is 1.5 seconds,
W input drives through the contact, with no CPU trace enabled.

| Capture window                 | Baseline tick CPU | Final tick CPU | Baseline FPS | Final FPS |
| ------------------------------ | ----------------- | -------------- | ------------ | --------- |
| First collision/start window   | 11.38 ms          | 12.05 ms       | 48.6         | 41.1      |
| Following crash/scenery window | 21.70 ms          | 15.62 ms       | 23.9         | 33.3      |

The first window did **not** improve. The following window has about 28% lower
tick CPU, with frame p95 falling from 97.6 to 54.4 ms. Retaining both windows,
77 ticks average 16.61 ms before versus 13.81 ms after (about 17% lower CPU).
Different frame endpoints split these ticks 38+39 versus 39+38, but the final
player position and quaternion after all 77 ticks are exactly identical.
Buffers were 2101x1468 before and 2104x1472 after; the small window-size change,
host scheduling, cold JIT/uploads and short samples limit FPS generalization.

An earlier intermediate-cache run was slower in its first window (14.89 ms/tick,
34.0 FPS) and faster in its second (16.43 ms/tick, 30.9 FPS). Its unrelated render
and matrix costs also increased. All these samples are retained rather than
selecting only a favorable capture. An initial constant-random diagnostic caused
incomplete opponent loading and was discarded; it is not performance evidence.

The final same-browser ABBA diagnostic compares both functions on **identical
live original, already deformed hulls**, without stepping simulation or mutating
game state. Each result is checked with Object.is; all four timing blocks remain
in the ignored report. Calls are batched briefly to reduce timer quantization.

| Workload                   | Baseline ms/call | Final ms/call |
| -------------------------- | ---------------- | ------------- |
| Disjoint guard             | 0.025            | 0.038         |
| Near parallel guard        | 1.413            | 0.137         |
| Clear-end crossing guard   | 5.825            | 2.600         |
| Face-separated SAT         | 0.050            | 0.003         |
| Fully overlapping SAT      | 0.047            | 0.044         |
| 206-body diagnostic subset | 0.750            | 0.375         |

The body-group diagnostic uses the two live cars and 204 noncars, with
reconstructed linear 40 ms paths and fixed orientations. It excludes pedestrians,
debris and mines and does not use the simulation's native pair predicate. This
is a bounded subset comparison, not a measurement of the full tick guard.

Already-disjoint cases can pay small cache overhead; not every input gets faster.
Tiny SAT timings approach clock resolution. This diagnostic isolates saved work
and is not an FPS prediction or evidence for a universal tenfold physics gain.

## Validation

- Production build passes. Full suite: 2578 tests passed before the final cache
  layout refinement. After it, all 28 SAT/oracle, 9 pair-guard and 4 guard-pair
  tests pass, the production build passes, and crash/browser checks pass.
- Numerical oracle tests cover signed zeros/NaN, near-dedup thresholds, normal
  ties, manifold points, compact vertex storage, zero edges, tunneling, overlap
  escape/re-entry, corners/sides/rears, complete rotations, independent hull
  allowances and outcome-changing in-place mutation. Eagle3/Buggy/Bigdump use
  original local data and compare exact numbers, not visual plausibility.
- All 15 deterministic original-car crash reports equal the unmodified baseline
  exactly: velocities, angular velocities, impulses, contact points, component
  damage, deformation measurements and detached-state records. Those reports
  do not themselves test repair; repair is checked separately below.
- `node tests/browser-crash-matrix.mjs` passes real-key Stock Eagle3/Buggy/Bigdump
  and Advanced 69mach1 collisions, reverse escape, cumulative severe deformation,
  Eagle bumper joint detachment and repair, and Porker2 splitting/repair. Its
  controlled part/split fixtures remain distinguished from driving.
  Software WebGL is used for this regression, not hardware performance claims.
- Hardware MCP confirms live collision/deformation and component repair;
  before/after and severe-crash screenshots were inspected. No fatal console,
  failed local asset requests or WebGL errors in successful validation runs.

Ignored evidence: `artifacts/perf05-validation.json`,
`artifacts/perf05-crashes-before.json`, `artifacts/perf05-crashes-after.json` and
`artifacts/browser-crash-matrix.json`. Raw MCP captures/screenshots are in
`/tmp/perf05-*`. Source-only baseline build is under `/tmp/carma-perf05-baseline`;
it serves the original installation read-only, without copying assets.

The opt-in `tools/physics-performance-probe.mjs` requires an existing loopback
Vite server and a paused loaded race. Evaluate `comparePhysicsHotpaths` through
the browser diagnostic tool against that server; it caps computation at 1.5 seconds
between calls. It is not included in the production bundle.

World face/actor synchronization, broadphase/allocation costs and the unresolved
tunnel transition still deserve PERF-01 measurements. Present evidence supports
further targeted code optimization; no measured need for the larger worker
ownership redesign has been established. Web Workers remain a last resort.

## Spatial pair discovery and phase-local geometry

PERF-06 and PERF-07 additionally index resting/moving body bounds and share immutable hull snapshots within commit/projection guards. See [implementation, exact comparisons and hardware measurements](body-pair-performance.md). Correction-pass reuse and world synchronization remain separate scopes.

## Retained native MODEL bounds

PERF-08 caches exact raw bounds/radius for revision-managed MODEL resources while retaining live generic providers and callback semantics. See [ownership, mutation validity and collection measurements](model-bounds-performance.md). Actor synchronization remains PERF-09.
