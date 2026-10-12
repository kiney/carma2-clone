---
id: TASK-104
title: >-
  [P1] PERF-05: Optimize physics code and algorithms while preserving C2
  behavior
status: done
assignee: []
created_date: '2026-10-11 22:36'
updated_date: '2026-10-12 01:03'
labels:
  - priority-1
  - PERF-05
  - performance
  - physics
dependencies: []
references:
  - docs/performance-investigation.md
  - docs/physics-performance.md
  - src/physics/geometry.ts
  - src/physics/pair-guard.ts
  - tests/sat-optimization.test.mjs
  - tests/support/legacy-physics-guard.mjs
  - tools/physics-performance-probe.mjs
priority: high
ordinal: 1102
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The measured Snow Way Out start-drive capture spent 2696.1 ms of 3519.5 ms wall duration in simulation.updateFrame (76.6%, including frame-final damage/physics callbacks). A physics tick averaged 39.3 ms against the native 40 ms step. Post-solver body-pair trajectory guarding accounted for approximately 64% of sampled physics CPU, with eager SAT axis construction alone approximately 50%. These are short instrumented shared-host measurements, not universal workload percentages.

The user's explicit direction is to prioritize code optimization and algorithmic improvements in the existing main-thread implementation. Investigate the measured hot paths, redundant work, allocation and data access before choosing exact changes. Preserve C2 collision/impulse decisions, numerical tolerances, simulation/contact ordering, native clocks, anti-tunneling/interlock safeguards, crush, damage, detachment and repair. Disabling safeguards, reducing fidelity or skipping required simulation work does not satisfy this task.

Web Workers are a last resort, not the initial implementation strategy or a completion requirement. Reconsider a worker migration only if profiling after code/algorithm optimization demonstrates that the remaining bottleneck warrants the larger ownership/synchronization redesign; document that evidence before selecting such a follow-up. No threading redesign is selected or started by this ticket.

PERF-01 / TASK-100 retains cross-subsystem profiling and the unresolved tunnel-exit investigation. This ticket owns physics optimization implementation and validation. PERF-02 / TASK-101 owns scene-hierarchy work; PERF-03 / TASK-102 resolution; PERF-04 / TASK-103 visual visibility. Keep these scopes separate and use short, serial captures rather than sustained or parallel stress on the shared workstation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Use measured hot paths and static algorithm review to select code/algorithm optimizations in the existing main-thread physics; document the evidence and expected complexity or work reduction.
- [x] #2 Add or extend meaningful deterministic numerical regressions comparing collision decisions and physical/damage results across car-car, car-world, off-center and repeated impacts, including tunneling/interlock safeguards and materially different cars.
- [x] #3 Demonstrate reduced physics tick cost and improved frame-time behavior with short matched hardware Chromium captures; record backend, active population, buffer dimensions, profiling overhead and shared-host limitations.
- [x] #4 Validate driving, collisions, persistent crush, damage, detachable parts, repair and existing gameplay in Chromium without fatal console/WebGL errors; do not obtain gains by disabling safeguards or changing C2 semantics.
- [x] #5 Keep Web Workers deferred as a last resort. If substantial measured bottlenecks remain after code/algorithm improvements, record residual costs and justify a separately scoped threading follow-up instead of silently expanding this ticket.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Stream original ordered SAT axes and stop on the first separating axis; reuse world edge differences and remove projection index-array allocation. Memoize numeric depths and bounds only within each guard invocation, stored beside existing pose samples, and reuse cloned swept bounds per hull/interval. Keep all collision thresholds, feature/contact order, sampling, clamping and C2 gameplay formulas. Validate against immutable project-source oracle, original-car conformance and serial hardware/Chromium checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented lazy SAT, per-call edge reuse, compact projection iteration, and invocation-local pose-record bounds/depth/swept-bound caches. No guards disabled or physics formulas changed; no persistent geometry-identity cache. Sol reviewed exactness and mutation hazards, strengthened the baseline oracle after correcting an initial wrong threshold/weak test draft, and reviewed cache overhead. Production build passes. Full suite 2578 passes before final cache-layout refinement; final targeted 28 SAT/oracle + 9 pair-guard + 4 guard-pair tests pass. Original EAGLE3/buggy/bigdump strict Object.is parity covers manifold/tie/NaN/signed-zero/compact-order/dedup and tunneling/overlap/rotation/mutation cases. Fifteen deterministic original-car crash reports exactly equal baseline 02528bb for physical, contact, damage, deformation and detached-state results. Stock/Advanced browser-crash-matrix passes four original driving collisions, reverse escape, severe cumulative deformation, bumper joints, Porker splitting and repair; software backend is distinguished from hardware captures. Hardware MCP matched Eagle3/Jetcar Snow setup: final aggregate 77 ticks 16.61 ->13.81ms CPU/tick (~17% reduction); following crash/scenery window 21.70 ->15.62ms, 23.9 ->33.3FPS, p95 97.6 ->54.4ms. First window did not improve (11.38 ->12.05ms,48.6 ->41.1FPS), retained with host/JIT/buffer caveats. Final positions/quaternions after 77 ticks are exactly equal. Same-browser ABBA all inputs checked exact: near-parallel 1.413 ->0.137ms; crossing 5.825 ->2.600ms; 206-body diagnostic subset 0.750 ->0.375ms; The body-group diagnostic uses two cars/noncars with linear 40 ms paths and fixed orientation, no native pair predicate, and excludes pedestrians/debris/mines; it is not the full tick guard. Tiny disjoint cases have small overhead. Hardware collision/component repair and screenshots inspected; successful runs have no fatal console/asset/WebGL errors. An invalid constant-RNG diagnostic was discarded, not used as evidence. Detailed all-sample evidence and remaining world-sync/broadphase/tunnel questions: docs/physics-performance.md. Source-only baseline in /tmp; proprietary reports/screenshots ignored. No worker migration selected or started; remains last resort.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed evidence-backed main-thread code/algorithm optimization with exact baseline numerical parity and original-car/browser regression coverage. Controlled aggregate physics CPU is about 17% lower; warm crash tick CPU about 28% lower, with cold/noisy regressions explicitly retained. Original safeguards, damage/crush/detachment/repair and assets preserved. PERF-01 retains unresolved frame spikes and further profiling; Web Workers remain deferred.
<!-- SECTION:FINAL_SUMMARY:END -->
