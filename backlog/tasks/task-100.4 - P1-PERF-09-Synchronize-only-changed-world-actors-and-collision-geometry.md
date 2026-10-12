---
id: TASK-100.4
title: '[P1] PERF-09: Synchronize only changed world actors and collision geometry'
status: next
assignee: []
created_date: '2026-10-12 07:36'
labels:
  - priority-1
  - PERF-09
  - performance
  - physics
dependencies:
  - TASK-100.3
references:
  - docs/timber-performance-findings.md
  - src/world.ts
  - src/native-world-scene.ts
  - src/physics/simulation.ts
parent_task_id: TASK-100
priority: high
ordinal: 1140
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An ordinary Timber capture calls refreshDynamic 107 times in 1.25 seconds across all 466 props, costing 163 ms. Each call updates actor descendants and formats matrix strings before discovering unchanged poses. Native collection also checks 1445 actor poses and 1214 mesh geometry records. Changed owners regenerate collision triangles from render meshes.

Introduce explicit ownership/revision validity so unchanged actors and collision geometry avoid repeated hierarchy traversal and reconstruction at required physics phases. Include parent transforms, geometry/topology, smash eligibility, grooves, articulation and replacement, not only root pose. Reuse PERF-08 retained resource bounds. Actual smash restart/geometry notification semantics and incremental invalidation belong to PERF-10.

This is selected P1 implementation work extracted from PERF-01 / TASK-100 after the Timber investigation. Use short serial captures on the shared workstation. Preserve original C2 assets, numerical decisions, contact/callback order, native clocks, wake-up, crush, damage, detachment, repair and anti-tunneling/interlock safeguards. Keep Web Workers deferred. No reduction in required simulation work, activation distances or guard limits qualifies as this optimization.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Counters distinguish unchanged/changed owners, hierarchy visits and regenerated triangles; ordinary and heavy captures show reduced synchronization work.
- [ ] #2 Validity accounts for parent motion, crush/flaps with unchanged root pose, groove pull/stop callbacks, topology/replacement, activation and teardown; captured pre-callback surfaces retain their required lifetime.
- [ ] #3 Transforms and collision rows remain equivalent across static/moving scenery, Stock/Advanced tracks, car deformation/detachment/repair and pedestrian grounding.
- [ ] #4 Build, relevant numerical/original-data tests and short Chromium regressions pass without fatal errors; visual distance and simulation activation policies remain unchanged.
<!-- AC:END -->
