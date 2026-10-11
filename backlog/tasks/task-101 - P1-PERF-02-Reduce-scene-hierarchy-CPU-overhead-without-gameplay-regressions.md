---
id: TASK-101
title: '[P1] PERF-02: Reduce scene-hierarchy CPU overhead without gameplay regressions'
status: next
assignee: []
created_date: '2026-10-11 21:48'
labels:
  - priority-1
  - PERF-02
  - performance
  - rendering
dependencies: []
references:
  - docs/performance-investigation.md
priority: high
ordinal: 1101
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The hardware Snow Way Out analysis found approximately 16 ms per paused frame in repeated full scene matrix traversal. A scene census contains 15,262 nodes, with hidden pedestrian hierarchies accounting for approximately 89% of them. This is a substantial independent CPU bottleneck even when simulation is paused. Selected as high-priority upcoming work by the user; complete this scope before the higher-visibility task.

Explicitly leave the solution open: this ticket specifies the problem, outcome and validation, not an algorithm, scene structure or implementation plan. Diagnostic matrix freezing is evidence only, not a production solution. Preserve live vehicle/crush/detached-part transforms, pedestrians, scenery animation, materials and collision/source ownership. PERF-01 retains collision/simulation profiling and the unresolved tunnel-exit investigation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Choose an implementation only after inspecting scene/transform ownership; record the rationale and remaining risks without treating the existing diagnostic as the chosen solution.
- [ ] #2 Demonstrate lower scene-hierarchy CPU cost and improved frame times with short matched hardware Chromium captures, including paused and moving scenes; record the GPU backend and shared-host limitations.
- [ ] #3 Validate live transforms, animation, deformation/detachment, opponents, pedestrians and existing gameplay using automated checks and Chromium; no fatal console or WebGL errors.
- [ ] #4 Provide a stable measured baseline for the subsequent higher-visibility task; no visibility or resolution policy is prescribed by this ticket.
<!-- AC:END -->
