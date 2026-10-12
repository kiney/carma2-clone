---
id: TASK-100.6
title: '[P1] PERF-11: Localize world-face candidates for collision and camera queries'
status: done
assignee: []
created_date: '2026-10-12 07:36'
updated_date: '2026-10-12 21:45'
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
- [x] #1 Candidate/reference/feature-test counts fall on Timber bridge/quarry/canyon queries and Snow transitions, without excluding valid endpoint, arc, edge, vertex or recovery contacts.
- [x] #2 Face and tie ordering, source identity, moving-owner snapshots, native capacity/ring/pull/stop semantics and localized mutation validity remain correct.
- [x] #3 Numerical comparisons cover rays/camera clearance, wheel support, finite-face sweeps, shallow/deep recovery, rotating bodies and changed/removed scenery; multiple Stock/Advanced tracks remain compatible.
- [x] #4 Build/regressions and short Chromium driving/crash/camera captures pass; report work/timing changes and unfavorable cases without fatal errors.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented conservative ordered per-cell static face indexing, caller-specific certified inverse-frame sweep envelopes, exact retained feature planes and PERF-10 local invalidation integration. Native wheels, moving-owner snapshots, uncertifiable cases and native finite collector/callback semantics retain the previous path. Stock/Advanced Timber and Snow Way Out compare exactly against beb499f for camera faces/rays, ordinary guard contacts and shallow flagged/unflagged plus deep recovery; capacity-300/capacity-1 collector rows/events agree. Timber bridge candidates 203 -> 4 and guard 272 -> 16; quarry 104 -> 4 and guard 348 -> 24. All 2,677 tests, production build, 15 exact original crash reports and serial Chromium camera/spawn/crash/debris/render regressions pass. Hardware Chrome DevTools MCP production driving, contacts, deformation, screenshots, console and WebGL checks pass; earlier hot-reload diagnostic exceptions were discarded and repeated cleanly. Cold costs and adverse quarry guard samples are retained honestly; no steady-FPS or exact user route claim. Evidence/reproduction: docs/world-face-performance.md. Parent PERF-01 remains active; PERF-12 remains next.
<!-- SECTION:NOTES:END -->
