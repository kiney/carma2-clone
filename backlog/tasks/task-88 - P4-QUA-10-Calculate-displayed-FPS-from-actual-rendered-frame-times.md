---
id: TASK-88
title: '[P4] QUA-10: Calculate displayed FPS from actual rendered frame times'
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
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
