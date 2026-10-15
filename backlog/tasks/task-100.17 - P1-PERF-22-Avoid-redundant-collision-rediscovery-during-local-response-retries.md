---
id: TASK-100.17
title: >-
  [P1] PERF-22: Avoid redundant collision rediscovery during local response
  retries
status: next
assignee: []
created_date: '2026-10-15 22:15'
updated_date: '2026-10-15 22:16'
labels:
  - priority-1
  - PERF-22
  - performance
  - physics
dependencies:
  - TASK-100.16
references:
  - docs/physics-algorithm-comparison.md
  - docs/perf13-integration-check.md
parent_task_id: TASK-100
priority: high
ordinal: 1285
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Own physics-algorithm-comparison rows3/5 consumers: use persistent collision data from PERF-21 to repeat discovery/emission only where changed inputs or newly reachable partners require it. Current damaged profile local responses account38.60% inclusive, with world collection13.03% and pair collection10.45% of total sampled time. Distinguish useful impulses/chronology and changed geometry from redundant recollection.

Evaluate dirty worklists, stable feature certificates and persistent contact identities. Preserve original C2 feature eligibility, callbacks, positive repeated stresses, activation and fresh third-body discovery. Do not remove contacts merely because the previous solve returned zero impulse. This owns orchestration and contact reuse; it does not replace normal/friction equations or duplicate the persistent-structure implementation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Attribute repeated collection by root/ring, invalidation cause and useful response, then implement change-driven rediscovery using explicit input validity.
- [ ] #2 Validate callbacks/positive stress, new third-body collisions, old-overlap escape, world activation and damage/repair/attachment mutations with original Stock/Advanced content.
- [ ] #3 Demonstrate lower repeated feature-query/collection counts and improved serial damaged-scene tick/frame measurements without reducing simulated time or freezing moving objects.
<!-- AC:END -->
