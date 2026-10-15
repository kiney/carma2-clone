---
id: TASK-100.14
title: '[P1] PERF-19: Diagnose and eliminate ordinary world-contact latency spikes'
status: wip
assignee: []
created_date: '2026-10-15 18:19'
updated_date: '2026-10-15 19:02'
labels:
  - priority-1
  - PERF-19
  - performance
  - physics
  - world-contact
dependencies: []
references:
  - docs/world-contact-spikes.md
parent_task_id: TASK-100
priority: high
ordinal: 1260
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Residual ordinary world-contact latency workstream, preceding visibility expansion. The original Stock desert2/Eagle3 user recording measured a420ms tick, including292ms in108 worldContacts calls; subsequent catch-up amplified that stall. Implementation investigation found that recorder v3 disabled response-preparation reuse and the older short probe also forced custom-transform/provider fallbacks. Those historical timings are instrumented-workload evidence, not an unbiased normal-game baseline. Corrected recording and explicit uncertainty are essential.

Implemented: reuse selected native ACT/MODEL preparation within a mutation-owned physics step, reduce temporary-array work in exact native matrix/bounds arithmetic, and avoid global moving-owner refresh after unchanged GROOVE evaluation. Native collection order/capacity/water/pull/Stop behavior, contacts and physics semantics are preserved. Deterministic original-data contact comparisons and work counters support the structural improvement. A bounded slow-contact recorder now captures body and subphase attribution while preserving fast-path identities.

Remaining: validate the difficult live latency episode with uncontaminated instrumentation; short hardware startup drives have mixed tails and cannot establish that all rare drops are fixed. AC1 remains open, ticket stays wip. PERF-01 coordinates wider performance work. Detailed historical and current evidence, validation, known unrelated split-secondary failure and playtest focus are in docs/world-contact-spikes.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Attribute a bounded real outlier to body/part, face/hull workload and contact subphase using short serial CPU profiling and low-overhead outlier counters; distinguish GC/scheduling, catch-up and GPU uncertainty.
- [x] #2 Implement the evidence-selected structural improvement and demonstrate lower work counts plus before/after tick and frame-tail measurements on comparable original-data workloads; retain adverse samples.
- [x] #3 Preserve native collection side effects and ordering, ground/wall/moving-surface contacts, damage, parts and repair; cover multiple original cars, new collisions and PHY-16 release regressions.
- [x] #4 Validate build, relevant numerical tests and hardware Chromium playtests; document deviations, measurement limits, reviewed checkpoint and focused user playtest.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented scoped ACT/MODEL preparation with mutation-owned invalidation, allocation-reduced native matrix/bounds kernels preserving Float32 order, and GROOVE no-op publication suppression. Controlled original desert2 contact hashes match all eight passes; selected MODEL checks reduce 11-16x, second cold-cache passes 7.2 to 4.3 ms and 7.1 to 3.3 ms. Fixed profiling artifacts: old wrappers disabled transform/response reuse; v4 preserves certificates and records bounded per-body slow contact subphases. Historical420ms attribution is incomplete because original recording used v3; AC1 intentionally remains open and ticket stays wip pending uncontaminated live-outlier validation. Hardware short captures retain mixed/adverse tails; no overall FPS promise. Full2959tests/build pass; focused final rollback tests and Chromium pile/crash checks covered. Extended stationary Porker secondary failure reproduces on unchanged1f33742 and is separately PHY-17/TASK-111 P1next. Detailed evidence, limitations and playtest focus: docs/world-contact-spikes.md.
<!-- SECTION:NOTES:END -->
