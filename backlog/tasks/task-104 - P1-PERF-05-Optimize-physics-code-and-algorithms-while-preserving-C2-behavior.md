---
id: TASK-104
title: >-
  [P1] PERF-05: Optimize physics code and algorithms while preserving C2
  behavior
status: next
assignee: []
created_date: '2026-10-11 22:36'
labels:
  - priority-1
  - PERF-05
  - performance
  - physics
dependencies: []
references:
  - docs/performance-investigation.md
  - src/physics/simulation.ts
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
- [ ] #1 Use measured hot paths and static algorithm review to select code/algorithm optimizations in the existing main-thread physics; document the evidence and expected complexity or work reduction.
- [ ] #2 Add or extend meaningful deterministic numerical regressions comparing collision decisions and physical/damage results across car-car, car-world, off-center and repeated impacts, including tunneling/interlock safeguards and materially different cars.
- [ ] #3 Demonstrate reduced physics tick cost and improved frame-time behavior with short matched hardware Chromium captures; record backend, active population, buffer dimensions, profiling overhead and shared-host limitations.
- [ ] #4 Validate driving, collisions, persistent crush, damage, detachable parts, repair and existing gameplay in Chromium without fatal console/WebGL errors; do not obtain gains by disabling safeguards or changing C2 semantics.
- [ ] #5 Keep Web Workers deferred as a last resort. If substantial measured bottlenecks remain after code/algorithm improvements, record residual costs and justify a separately scoped threading follow-up instead of silently expanding this ticket.
<!-- AC:END -->
