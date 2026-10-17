---
id: TASK-100.18
title: >-
  [P1] PERF-23: Reduce adverse extended-view render submission and
  material-state overhead
status: next
assignee: []
created_date: '2026-10-17 19:31'
updated_date: '2026-10-17 19:32'
labels:
  - priority-1
  - PERF-23
  - performance
  - rendering
  - regression
dependencies: []
references:
  - docs/perf04-live-timber-drop.md
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
- [ ] #1 Retain a bounded reproduction of the adverse Timber view and distinguish draw submission, material/program work, hierarchy cost and any GPU bottleneck.
- [ ] #2 Implement a measured reduction of extended-view rendering CPU cost without silently reducing visual ranges or expanding native simulation activation; verify sky/material/fog/animation correctness.
- [ ] #3 Compare before/after in short serial headed hardware Chromium captures at the actual drawing-buffer size, including the adverse view, representative ordinary views and an active driving/crash check.
- [ ] #4 Keep original live-stall attribution separate; inspect the rolling active-frame recorder if the user reproduces it and preserve useful game state.
<!-- AC:END -->
