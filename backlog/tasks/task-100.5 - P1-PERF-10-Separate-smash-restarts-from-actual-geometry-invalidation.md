---
id: TASK-100.5
title: '[P1] PERF-10: Separate smash restarts from actual geometry invalidation'
status: next
assignee: []
created_date: '2026-10-12 07:36'
labels:
  - priority-1
  - PERF-10
  - performance
  - physics
dependencies:
  - TASK-100.3
  - TASK-100.4
references:
  - docs/timber-performance-findings.md
  - src/world-destruction.ts
  - src/physics/simulation.ts
  - src/world.ts
  - docs/c2-world-smash-queue-re.md
parent_task_id: TASK-100
priority: high
ordinal: 1150
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Repeated below-threshold contact with an already prepared original TEZFEN patch leaves mesh identity, position-buffer version and damage tier unchanged, but increments geometryRevision and requests full-world rebuilding. Measured redundant invalidation costs 15.8/24.0 ms per repeat. Genuine local changes likewise invalidate every static face and dynamic prop.

Separate the binary-verified native restart notification from actual topology/material/collision-mode dirtiness. Preserve restart decisions, queue ordering/caps, callbacks and immediate preparation; invalidate/rebuild only collision owners that actually changed using PERF-08/PERF-09 validity. Do not simply suppress changed/restart: installed HW writes the output flag even when enqueue returns null. The independent 4-FPS heavy capture had zero world rebuilds; do not attribute that capture to this defect.

This is selected P1 implementation work extracted from PERF-01 / TASK-100 after the Timber investigation. Use short serial captures on the shared workstation. Preserve original C2 assets, numerical decisions, contact/callback order, native clocks, wake-up, crush, damage, detachment, repair and anti-tunneling/interlock safeguards. Keep Web Workers deferred. No reduction in required simulation work, activation distances or guard limits qualifies as this optimization.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Existing non-final same-tier/below-threshold or rejected requests retain native notification/cap/queue behavior while stable geometry does not trigger a global rebuild.
- [ ] #2 New tiles and accepted tiers correctly invalidate affected topology/material/facing/eligibility; unchanged owners retain valid data and snapshots. Replacement, pull/stop and finite face-cache chronology remain correct.
- [ ] #3 Meaningful tests cover first preparation versus reuse, equal/higher/rejected queued requests, collision-mode changes, wheel/body callers, solver restarts and model replacement.
- [ ] #4 Original-material and Chromium smash/crash tests preserve destruction, effects, repair and numerical behavior; short captures prove lower rebuild/regeneration scope and cost without fatal errors.
<!-- AC:END -->
