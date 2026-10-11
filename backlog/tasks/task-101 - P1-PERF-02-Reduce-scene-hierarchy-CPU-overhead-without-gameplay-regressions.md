---
id: TASK-101
title: '[P1] PERF-02: Reduce scene-hierarchy CPU overhead without gameplay regressions'
status: done
assignee: []
created_date: '2026-10-11 21:48'
updated_date: '2026-10-11 23:58'
labels:
  - priority-1
  - PERF-02
  - performance
  - rendering
dependencies: []
references:
  - docs/performance-investigation.md
  - docs/render-hierarchy-performance.md
  - src/render-matrices.ts
  - tests/render-matrices.test.mjs
  - tests/browser-render-matrices.mjs
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
- [x] #1 Choose an implementation only after inspecting scene/transform ownership; record the rationale and remaining risks without treating the existing diagnostic as the chosen solution.
- [x] #2 Demonstrate lower scene-hierarchy CPU cost and improved frame times with short matched hardware Chromium captures, including paused and moving scenes; record the GPU backend and shared-host limitations.
- [x] #3 Validate live transforms, animation, deformation/detachment, opponents, pedestrians and existing gameplay using automated checks and Chromium; no fatal console or WebGL errors.
- [x] #4 Provide a stable measured baseline for the subsequent higher-visibility task; no visibility or resolution policy is prescribed by this ticket.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Prepare matrices once immediately before both render passes. Retain native traversal for ordinary branches and prune descendants only for registered invisible pedestrian roots; keep root matrices current and restore renderer/scene flags before restoring physical poses. Preserve native matrix APIs and actor/physics ownership. Select this approach from the source audit rather than adopting diagnostic global freezing.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented src/render-matrices.ts and direct pedestrian render-identity registry with disposal cleanup; main prepares once for sky/main and restores flags on failures. Independent Sol ownership review found no implementation blockers; strengthened two numerical assertions after review. Nine focused transform tests pass; full suite passes 2550 tests; production build passes. Focused Stock Snow/Eagle3 and Advanced Carrier/69mach1 Chromium test verifies real dormant/reactivated limbs, explicit native hidden updates, visible matrix parity (zero difference), two-pass flags, population cleanup and zero console/request/WebGL errors. Hardware MCP AMD/ANGLE same-pose diagnostic: 16.8 -> 1.6 ms matrix CPU/frame, 37.6 -> 59.5 paused FPS. Moving same-frame paired preparation: 15.52 -> 1.225 ms mean across 20 W-input frames. Hardware pixel readback after impact/repair: 12,294,280 bytes identical. Controlled physical Eagle3/Skyline W-input collision retained deformation, component damage, detached SKARSE part and full repair/component reset. Independent reload drive FPS did not improve (15.1 -> 14.1) because physics paths/cost differed; no end-to-end driving FPS improvement claimed. Physics remains PERF-05. Stable unchanged-distance/buffer baseline and precise caveats documented in docs/render-hierarchy-performance.md. No assets modified, no resolution/visibility policy selected.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed duplicate render traversal and dormant pedestrian descendant work without changing physical matrix semantics or scene ownership. Hardware paused/moving comparisons show roughly 90% lower hierarchy CPU cost; Stock/Advanced, numerical, pixel parity and live crash/repair checks pass. PERF-04 can use the retained baseline. Remaining driving stalls belong to physics/spike investigation, not hidden by this completion.
<!-- SECTION:FINAL_SUMMARY:END -->
