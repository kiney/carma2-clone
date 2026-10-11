---
id: TASK-65
title: >-
  [P3] ANI-05: Interpolate wheel suspension and steering animation between
  physics ticks
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-11 16:03'
labels:
  - priority-3
  - ANI-05
  - animation
  - legacy-partial
dependencies: []
references:
  - src/main.ts
  - src/render-pose.ts
priority: medium
ordinal: 3064
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **ANI-05**
Numeric priority: **3** (1 is highest)
Original status: **Partial**
Category: **Animation, Rendering, and Audio**

## Scope and evidence

Interpolate wheel suspension and steering pose as needed as well. Body/part poses are smoothed, but `wheelLengths` and `curvature` still come directly from the physics tick for animation.

## Source references

[main.ts](../../src/main.ts), [render-pose.ts](../../src/render-pose.ts)
<!-- SECTION:DESCRIPTION:END -->
