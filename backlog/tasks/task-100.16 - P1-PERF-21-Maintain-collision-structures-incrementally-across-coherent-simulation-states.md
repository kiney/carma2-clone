---
id: TASK-100.16
title: >-
  [P1] PERF-21: Maintain collision structures incrementally across coherent
  simulation states
status: done
assignee: []
created_date: '2026-10-15 22:15'
updated_date: '2026-10-15 23:23'
labels:
  - priority-1
  - PERF-21
  - performance
  - physics
dependencies:
  - TASK-100.15
references:
  - docs/physics-algorithm-comparison.md
  - docs/perf13-integration-check.md
parent_task_id: TASK-100
priority: high
ordinal: 1280
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Own physics-algorithm-comparison rows3-5 infrastructure lifetime: incrementally maintain collision search structures, pair/feature identities and validity information instead of rebuilding unchanged data during local responses and across coherent ticks. Existing BVH, immutable hull snapshots and exact phase caches are already present; do not merely add another overlapping cache. Evaluate a dynamic/refitted AABB hierarchy, persistent pair metadata and explicit pose/shape/attachment/roster generations.

Select implementation from PERF-13/20 counters and real mutation ownership. Preserve conservative coverage and required source ordering. Movement, crush, repair, split, detachment, wake, scenery activation/removal and scope changes must update affected records. Do not persist contact impulses or introduce warm starting by accident. This provides reusable data ownership; PERF-22 owns scheduling/contact rediscovery changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Document current structure lifetimes and implement evidence-selected incremental ownership with mutation-aware invalidation and bounded retention.
- [x] #2 Validate newly reached contacts and movement/crush/repair/split/detachment/wake/removal, with no stale pairs, missed geometry or source-order regressions.
- [x] #3 Demonstrate reduced builds/full-input scans and measured whole-tick behavior on serial original-data damaged scenarios; retain dense-overlap/adverse cases.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented persistent moving/fixed median BVH topology with exact slot validation, dirty ancestor refits and quality-triggered rebuilds. One weak endpoint geometry owner now supplies broadphase bounds and lazily completed contact planes without duplicate vertex transforms; redundant dormant geometry ownership was removed. Exact response-input certificates persist weakly; contact/world outputs retain their tick scope. Numerical/original-data suite: 3013 passed, 5 optional capture skips subsequently covered by 17+6 focused tests with no skips. Stock/Advanced four-car Chromium core crash/repair and captured loose-part forward/reverse/removal/repair regressions pass. Controlled damaged 4-tick fixture preserves every intermediate state hash and final contacts/damage; moving builds fall 30 to 1. Measurements are mixed: final headless median 8.28 to 13.97 ms (slower), fixed-initial-scene hardware instrumented FPS 4.48 to 20.27, bare FPS 17.85 to 15.96. No overall FPS gain established; adverse samples retained. See docs/perf21-persistent-collision-data.md. PERF-22 retains rediscovery scheduling and PERF-13 retains overall stalls.
<!-- SECTION:NOTES:END -->
