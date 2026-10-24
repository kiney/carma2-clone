---
id: TASK-88
title: '[P4] QUA-10: Calculate displayed FPS from actual rendered frame times'
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-24 17:40'
labels:
  - priority-4
  - QUA-10
  - quality
  - legacy-needs-validation
dependencies: []
references:
  - src/main.ts
priority: low
ordinal: 4084
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **QUA-10**
Numeric priority: **4** (1 is highest)
Original status: **Needs validation**
Category: **Robustness, Testing, and Maintainability**

## Scope and evidence

Calculate the FPS display from actual frame time. The current value uses dt capped at 50 ms and can show 20 FPS on a slow software GPU even when fewer frames are rendered. Hardware GPU measurement remains under QUA-05.

## Source references

[main.ts](../../src/main.ts)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current implementation already uses uncapped render timestamp deltas, correcting the original report. Extract that existing FPS sampling unchanged into a small testable module and add deterministic slow-frame/paused-clock regression; hardware measurement remains QUA05. Verify actual DOM counter in headless Chromium with controlled rAF timestamps.

Audited current code: uncapped real-render timestamp calculation was already present, so original capped-dt symptom was stale. Extracted unchanged averaging/window policy into RenderFpsSampler and added four deterministic tests. Real headless Chromium DOM regression with controlled rAF timestamps reports10FPS for100ms frames and4FPS for250ms frames, while simulation counters/time remain unchanged; WebGL0 and no errors. Long-pause contribution documented. This validates counter semantics, not achieved GPU performance; QUA05 remains open.
<!-- SECTION:NOTES:END -->
