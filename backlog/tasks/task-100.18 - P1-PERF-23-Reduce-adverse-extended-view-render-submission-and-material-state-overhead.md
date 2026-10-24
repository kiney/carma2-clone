---
id: TASK-100.18
title: >-
  [P1] PERF-23: Reduce adverse extended-view render submission and
  material-state overhead
status: done
assignee: []
created_date: '2026-10-17 19:31'
updated_date: '2026-10-24 13:37'
labels:
  - priority-1
  - PERF-23
  - performance
  - rendering
  - regression
dependencies: []
references:
  - docs/perf04-live-timber-drop.md
  - docs/perf23-render-state.md
parent_task_id: TASK-100
priority: high
ordinal: 1265
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After PERF-04, the user reproduced a severe live Timber drop. Its exact active-play cause remains unknown because the new browser had no pre-pause recorder; retain that attribution under PERF-01.

A separate paused-view rendering regression is verified: extended visual ranges produce 2,576 main-pass calls / 42,276 triangles and approximately 46-47 FPS, versus 756 calls / 22,295 triangles and approximately 59 FPS with temporary native render ranges. Hardware: AMD ANGLE, 2832x1672. The bounded serial comparison restores all render state and leaves native processing unchanged. Of the extended-view submissions, 964 are pedestrians, 1,354 scenery/effects and 258 cars.

A byte-verified paused CPU profile shows substantial Three program-selection and parameter work. Stable material versions but advancing light-state versions warrant investigation. Distinguish program selection from fresh shader compilation, and this steady rendering regression from the earlier capped 1,000 ms active game period.

Optimize the adverse-view drawing and material workload while preserving selected extended visibility and native gameplay. Leave the exact implementation open.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Retain a bounded reproduction of the adverse Timber view and distinguish draw submission, material/program work, hierarchy cost and any GPU bottleneck.
- [x] #2 Implement a measured reduction of extended-view rendering CPU cost without silently reducing visual ranges or expanding native simulation activation; verify sky/material/fog/animation correctness.
- [x] #3 Compare before/after in short serial headed hardware Chromium captures at the actual drawing-buffer size, including the adverse view, representative ordinary views and an active driving/crash check.
- [x] #4 Keep original live-stall attribution separate; inspect the rolling active-frame recorder if the user reproduces it and preserve useful game state.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-24: User selected PERF-23 followed by PHY-17 for implementation. Re-audit the current code and captured evidence; use isolated builds and short serial hardware captures. Keep general active stalls distinct from the confirmed adverse-view render overhead.

2026-10-24 implemented and verified: existing sun now belongs to both sky/main camera layers, avoiding shared Three render-state directional-count alternation and per-frame Lambert parameter/program reselection. Native main lighting, Basic sky output, far ranges, geometry/populations and simulation activation unchanged. MCP headed AMD Chromium same-pose serial AB at 2835x1674: adverse Timber 50.1 -> 59.5 FPS, mean render CPU 15.1 -> 7.6 ms, program selections 685 -> 14 per frame with identical 2174 calls/41139 triangles/85 visible pedestrians. Ordinary Snow stays about60 FPS, CPU 6.43 -> 4.68 ms; real-W drive no skipped time. Stock/Advanced software Chromium regression proves byte-identical sky/main pixels, stable light versions and lower selections (Timber1144->56, Carrier1176->80 over four frames). Build passes. Full evidence and limitations: docs/perf23-render-state.md. Earlier two-live-tab measurement excluded; original severe active stall remains distinct under PERF-01.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed redundant sky/main material-program selection without reducing visibility or changing pixels/gameplay. Verified on headed AMD Chromium and byte-identical Stock/Advanced render regressions. Residual drawing and general active-play stalls remain outside this targeted fix.
<!-- SECTION:FINAL_SUMMARY:END -->
