---
id: TASK-100.6
title: '[P1] PERF-11: Localize world-face candidates for collision and camera queries'
status: next
assignee: []
created_date: '2026-10-12 07:36'
labels:
  - priority-1
  - PERF-11
  - performance
  - physics
dependencies:
  - TASK-100.3
  - TASK-100.4
  - TASK-100.5
references:
  - docs/timber-performance-findings.md
  - src/world.ts
  - src/physics/simulation.ts
  - src/camera/world-queries.ts
  - src/physics/geometry.ts
parent_task_id: TASK-100
priority: high
ordinal: 1160
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The four-unit XZ grid filters Y but admits cell-wide triangle candidates without per-face XZ bounds rejection. A small diagnostic at node 4 yields 203 candidates versus four tighter XZ AABB candidates; quarry node 178 yields 104 versus four. Repeated angular sweeps and camera rays can multiply this feature work.

Implement conservative spatial face discovery with stable face identity/order, retained plane/bounds data and local mutation updates. Choose the structure after measuring query density and updates; the diagnostic tighter-box counts are not an already-proven safe rejection rule. Preserve recovery-ray reach, sweep slack, finite triangle tests and callbacks. The independent trajectory guard must not inherit the native 300-face emission cap. This owns world faces, not body-pair indexing (PERF-06).

This is selected P1 implementation work extracted from PERF-01 / TASK-100 after the Timber investigation. Use short serial captures on the shared workstation. Preserve original C2 assets, numerical decisions, contact/callback order, native clocks, wake-up, crush, damage, detachment, repair and anti-tunneling/interlock safeguards. Keep Web Workers deferred. No reduction in required simulation work, activation distances or guard limits qualifies as this optimization.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Candidate/reference/feature-test counts fall on Timber bridge/quarry/canyon queries and Snow transitions, without excluding valid endpoint, arc, edge, vertex or recovery contacts.
- [ ] #2 Face and tie ordering, source identity, moving-owner snapshots, native capacity/ring/pull/stop semantics and localized mutation validity remain correct.
- [ ] #3 Numerical comparisons cover rays/camera clearance, wheel support, finite-face sweeps, shallow/deep recovery, rotating bodies and changed/removed scenery; multiple Stock/Advanced tracks remain compatible.
- [ ] #4 Build/regressions and short Chromium driving/crash/camera captures pass; report work/timing changes and unfavorable cases without fatal errors.
<!-- AC:END -->
