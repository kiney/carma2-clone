---
id: TASK-100.5
title: '[P1] PERF-10: Separate smash restarts from actual geometry invalidation'
status: done
assignee: []
created_date: '2026-10-12 07:36'
updated_date: '2026-10-12 19:18'
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
documentation:
  - docs/smash-invalidation-performance.md
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
- [x] #1 Existing non-final same-tier/below-threshold or rejected requests retain native notification/cap/queue behavior while stable geometry does not trigger a global rebuild.
- [x] #2 New tiles and accepted tiers correctly invalidate affected topology/material/facing/eligibility; unchanged owners retain valid data and snapshots. Replacement, pull/stop and finite face-cache chronology remain correct.
- [x] #3 Meaningful tests cover first preparation versus reuse, equal/higher/rejected queued requests, collision-mode changes, wheel/body callers, solver restarts and model replacement.
- [x] #4 Original-material and Chromium smash/crash tests preserve destruction, effects, repair and numerical behavior; short captures prove lower rebuild/regeneration scope and cost without fatal errors.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented separation of native notification/existing solver restart from actual collision dirtiness. Unchanged prepared tiles retain changed/callbacks/requiresRebuild, caps and queue behavior without geometryRevision increments or collision rebuild. New/accepted/replaced/disabled geometry queues unique changed actors before callbacks. Shared simulation synchronization covers body, wheel, queue barriers and followups; affected static cell owners, dynamic owners and native MODELs regenerate while unrelated snapshots/resources remain valid. Explicit RAW metadata checks and canonical cell order preserved. Genuine mutations retain global finite-ring invalidation to preserve existing callback/wrap policy. Full suite 2657 passes; production build passes; 15 original-car crash reports exactly match baseline. Serial production Chromium smash-gameplay, four noncar-debris cases, crash/repair matrix and Stock/Advanced render suites pass with no fatal errors. Original Stock/Advanced TIMBER TEZFEN capture: first tile 155 static triangles/two native MODEL checks/zero dynamic owners instead of 17707 static plus 9210 dynamic triangles/1214 records/466 forced owners. Reuse zero rebuild work, native rows/callbacks/capacity prefixes match baseline 733435c. Final CPU ABBA samples and slower cold Stock sample retained; repeat overhead 17.9-28.9 ms disappears to timer-resolution floor, no FPS claim. MCP browser target/context creation timed out; direct Chromium/CDP harness used, tool failures recorded separately. See docs/smash-invalidation-performance.md.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
PERF-10 complete: original smash notifications and existing solver decisions are preserved while unchanged reuse avoids all world geometry rebuilds and real changes update only affected collision owners. Build, 2657 tests, numerical original crashes and serial production Chromium checks pass. PERF-11/12 and independent canyon frame-time causes remain open; broader performance Goal not completed.
<!-- SECTION:FINAL_SUMMARY:END -->
