---
id: TASK-100.1
title: >-
  [P1] PERF-06: Discover collision pairs spatially instead of scanning all
  bodies
status: next
assignee: []
created_date: '2026-10-12 07:36'
labels:
  - priority-1
  - PERF-06
  - performance
  - physics
dependencies: []
references:
  - docs/timber-performance-findings.md
  - src/physics/simulation.ts
  - src/physics/pair-guard.ts
parent_task_id: TASK-100
priority: high
ordinal: 1110
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
At 480 bodies the heavy Timber state performs 114,960 pair opportunities per complete scan; initially 108,345 are immovable/immovable. collectBodyContacts and guardBodyTrajectories independently scan the entire list. Discover spatially relevant moving/moving and moving/resting pairs without visiting unrelated resting/resting combinations. Use tighter retained bounds for genuinely constant prop paths while preserving conservative rotation/full-turn bounds for moving or custom paths. Select the index from actual populations and mutation behavior rather than prescribing a library.

Scope: body-pair candidate discovery and bounds. Shared transformed-hull snapshots belong to PERF-07; cross-pass reuse belongs to PERF-12. Sleeping props must remain collision-addressable and wakeable. Same-attachment-root grouping must survive independently of spatial rejection.

This is selected P1 implementation work extracted from PERF-01 / TASK-100 after the Timber investigation. Use short serial captures on the shared workstation. Preserve original C2 assets, numerical decisions, contact/callback order, native clocks, wake-up, crush, damage, detachment, repair and anti-tunneling/interlock safeguards. Keep Web Workers deferred. No reduction in required simulation work, activation distances or guard limits qualifies as this optimization.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Demonstrate reduced pair enumeration on recorded Timber populations and heavy debris/opponent cases; count actual argument lengths and rejection reasons, not just allBodies census.
- [ ] #2 Preserve accepted candidate order, attachment grouping, masks, sleeping-prop wake-up and conservative bounds for rotation arcs, full turns and joint-projection/custom trajectories.
- [ ] #3 Deterministic numerical comparisons cover car/car, car/prop, repeated impacts, overlap escape, tunneling, activation and materially different original cars without changing physical/damage results.
- [ ] #4 Build and relevant regressions pass; short Chromium driving/crash captures show lower discovery/tick cost without fatal errors. Record backend, population, buffer dimensions and unfavorable samples.
<!-- AC:END -->
