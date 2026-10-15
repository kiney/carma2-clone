---
id: TASK-100.16
title: >-
  [P1] PERF-21: Maintain collision structures incrementally across coherent
  simulation states
status: next
assignee: []
created_date: '2026-10-15 22:15'
updated_date: '2026-10-15 22:16'
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
- [ ] #1 Document current structure lifetimes and implement evidence-selected incremental ownership with mutation-aware invalidation and bounded retention.
- [ ] #2 Validate newly reached contacts and movement/crush/repair/split/detachment/wake/removal, with no stale pairs, missed geometry or source-order regressions.
- [ ] #3 Demonstrate reduced builds/full-input scans and measured whole-tick behavior on serial original-data damaged scenarios; retain dense-overlap/adverse cases.
<!-- AC:END -->
