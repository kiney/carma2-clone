---
id: TASK-100.8
title: >-
  [P1] PERF-13: Resolve full-scene correction amplification in user-reproduced
  Timber stalls
status: next
assignee: []
created_date: '2026-10-13 01:22'
updated_date: '2026-10-13 01:25'
labels:
  - priority-1
  - PERF-13
  - performance
  - physics
dependencies: []
references:
  - docs/live-timber-drop.md
  - src/physics/simulation.ts
parent_task_id: TASK-100
priority: high
ordinal: 1180
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User-driven hardware Chromium capture after PERF-12 records physics updateFrame up to 263.1 ms with five ticks, versus typical render CPU of 4-9 ms. Most heavy ticks perform eight global correction rounds, 4,347 world-guard calls across 483 bodies, and nine pair collections. Nonempty cached/resting contacts retain global solver and callback rounds; raw-contact caching alone does not remove this amplification.

Investigate and resolve the remaining repeated scene-wide work while retaining C2 motion, momentum, damage/crush/repair, callbacks, restart ordering and final guards. Implementation choices remain open. Lowering correction/angular/catch-up caps, skipping nonzero impulses or freezing parts is not an acceptable fix.

The reported 180-degree direction correlation remains unisolated. Preserve bounded hardware baselines and instrumentation-overhead limits. This is a new solver/correction-ownership scope beyond completed PERF-12 raw discovery reuse. No implementation has started.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Identify persistent correction rows and exact motion/geometry/attachment changes per pass in the saved user scene; distinguish useful response from redundant scene-wide work.
- [ ] #2 Reduce measured whole-tick and updateFrame CPU in bounded serial hardware captures without simply lowering native time or guard iteration limits; retain adverse samples and instrumentation overhead.
- [ ] #3 Prove contact, momentum, damage/restart ordering, activation and final body/world safeguards remain valid across original Stock/Advanced multi-car debris/crush/repair scenarios.
- [ ] #4 Validate running Chromium frames and regressions with clean console/WebGL; distinguish exact directional attribution from hypotheses and keep original data unmodified/unbundled.
<!-- AC:END -->
