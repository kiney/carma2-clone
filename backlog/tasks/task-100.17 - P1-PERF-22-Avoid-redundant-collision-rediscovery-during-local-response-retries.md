---
id: TASK-100.17
title: >-
  [P1] PERF-22: Avoid redundant collision rediscovery during local response
  retries
status: done
assignee: []
created_date: '2026-10-15 22:15'
updated_date: '2026-10-16 00:20'
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
  - docs/perf22-contact-rediscovery.md
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
- [x] #1 Attribute repeated collection by root/ring, invalidation cause and useful response, then implement change-driven rediscovery using explicit input validity.
- [x] #2 Validate callbacks/positive stress, new third-body collisions, old-overlap escape, world activation and damage/repair/attachment mutations with original Stock/Advanced content.
- [x] #3 Demonstrate lower repeated feature-query/collection counts and improved serial damaged-scene tick/frame measurements without reducing simulated time or freezing moving objects.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented tick-local adjacency, collection-local pair exclusion, geometric feature certificates, OLD CCD/recovery geometry reuse and post-native-collection static emission reuse. Full roster validation, positive callbacks, source eligibility, live velocity/attachment selection and fresh solver rows remain active. Root/ring and invalidation diagnostics distinguish useful response from redundant work. Final captured Timber pile ABBA preserves every initial/intermediate physical-state hash and 160 ms physics in every pass: 25/42 OLD classifications reused; tick median 49.25 -> 27.45 ms, mean 70.80 -> 52.19; same 17 normal/8 joint solves. Rendered FPS and separate headless samples remain mixed, including a slower dense synthetic fixture; no general FPS percentage is claimed. PERF-13 retains whole-scene performance acceptance. Validation: 3056 tests passed, zero skips; production build and formatting pass; final Stock/Advanced Chromium four-car core crash/detachment/damage/repair and captured loose-part interlock browser checks pass without fatal console, failed request or WebGL errors. Chrome DevTools MCP unavailable; hardware Chromium accessed by Playwright CDP in isolated contexts. Numerical reports/screenshots remain ignored. See docs/perf22-contact-rediscovery.md.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Avoid redundant candidate and OLD-feature rediscovery without suppressing native response work. Deterministic captured-pile physics improves with identical states; broad FPS benefit remains unproven and tracked by PERF-13.
<!-- SECTION:FINAL_SUMMARY:END -->
