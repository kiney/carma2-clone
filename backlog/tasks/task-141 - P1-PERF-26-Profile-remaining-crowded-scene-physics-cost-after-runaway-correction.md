---
id: TASK-141
title: >-
  [P1] PERF-26: Profile remaining crowded-scene physics cost after runaway
  correction
status: next
assignee: []
created_date: '2026-10-30 22:00'
labels:
  - priority-1
  - PERF-26
  - topic-performance
  - topic-physics
dependencies: []
priority: high
ordinal: 1004
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After PED-14 prevents the reproduced shallow-seam energy explosion and repairs only the previously corrupted pedestrian motion in the preserved TIMBER scene, no fast pedestrian bodies or multi-second queries remain, but ordinary crowded-scene frame times are still high. Short hardware capture:25frames/1.928s, median50.8ms/p95209.8ms; simulation.updateFrame56.6ms average, step32.2ms average, renderer2.19ms per pass and GPU~2.03ms. A subsequent uninstrumented1.273s continuation produced19gameframes, median66.6ms/p95100.1ms, with55physics bodies and no peds above10native units/sec. These observations follow an in-place mixed-module live patch and changing scene population, not a controlled full-build A/B or a general FPS guarantee. First reproduce/profile on a complete current production build to separate live-patch/JIT overhead from normal dense contact/trajectory/solver costs. Identify the dominant steady-state algorithm before implementation; preserve crash/damage/repair behavior and use short serial captures on the shared workstation. Do not confuse this remaining throughput issue with the exact first-energy-injection fixed by PED-14.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reproduce remaining cost on a complete production build and attribute CPU/time by actual scene state; distinguish mixed-module/JIT and sampling overhead.
- [ ] #2 Implement the justified dominant algorithmic improvement with meaningful collision regressions and no hidden simulation disabling.
- [ ] #3 Brief hardware before/after validation preserves crash behavior and reports frame distribution, active bodies, GPU backend and limitations.
<!-- AC:END -->
