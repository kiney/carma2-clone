---
id: TASK-100.2
title: '[P1] PERF-07: Share immutable body geometry snapshots across collision pairs'
status: next
assignee: []
created_date: '2026-10-12 07:36'
labels:
  - priority-1
  - PERF-07
  - performance
  - physics
dependencies: []
references:
  - docs/timber-performance-findings.md
  - src/physics/geometry.ts
  - src/physics/pair-guard.ts
  - src/physics/simulation.ts
parent_task_id: TASK-100
priority: high
ordinal: 1120
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The heavy profile spends about 374 ms in pair guarding, nested in 545 ms of body guarding. Each pair owns separate pose/hull caches, repeatedly transforming the same body at the same fraction; constant props are transformed again at different fractions. Reuse exact per-body transformed hulls, planes and bounds inside a proven immutable collision phase. Keep depth and allowed-overlap history pair-specific.

Scope: body geometry/pose snapshot ownership within one guard invocation. It must invalidate correctly for in-place crush, split, hull replacement, COM/pose and attachment changes. Persistent identity-only caching is unsafe. Cross-correction-pass lifetime is deferred to PERF-12.

This is selected P1 implementation work extracted from PERF-01 / TASK-100 after the Timber investigation. Use short serial captures on the shared workstation. Preserve original C2 assets, numerical decisions, contact/callback order, native clocks, wake-up, crush, damage, detachment, repair and anti-tunneling/interlock safeguards. Keep Web Workers deferred. No reduction in required simulation work, activation distances or guard limits qualifies as this optimization.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Counters demonstrate fewer transforms and allocations for shared bodies/fractions and constant props, with bounded phase-local cache lifetime.
- [ ] #2 Exact numerical oracle comparisons retain axis/contact ordering, signed-zero/NaN/tolerance behavior, depth allowances and safe fractions; mutation and custom-path cases cannot reuse stale data.
- [ ] #3 Validate original Eagle3, Buggy and Bigdump plus detached/split parts, activation and repair using meaningful headless and Chromium regressions.
- [ ] #4 Short serial heavy-state captures demonstrate reduced transform/guard cost; preserve all samples and record measured limitations.
<!-- AC:END -->
