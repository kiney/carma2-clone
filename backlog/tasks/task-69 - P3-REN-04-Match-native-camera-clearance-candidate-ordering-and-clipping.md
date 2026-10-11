---
id: TASK-69
title: '[P3] REN-04: Match native camera-clearance candidate ordering and clipping'
status: wip
assignee: []
created_date: '2026-10-11 15:14'
labels:
  - priority-3
  - REN-04
  - rendering
  - legacy-partial
dependencies: []
references:
  - docs/c2-camera-re.md
  - src/camera/world-queries.ts
priority: medium
ordinal: 3068
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **REN-04**
Numeric priority: **3** (1 is highest)
Original status: **Partial**
Category: **Animation, Rendering, and Audio**

## Scope and evidence

Camera clearance now uses actual 3D triangle rays, six-plane nearby clipping, original prefix/two-sided rules, flagged noncars and own head shape. Native actor/material-group ordering before the six-face cap remains unproven: browser cell order is deterministic but can select different crowded-corner candidates. Native uninitialized noncar inside-hit placement is intentionally avoided while preserving its collision flag.

## Source references

[Camera evidence](../../docs/c2-camera-re.md), [world-queries.ts](../../src/camera/world-queries.ts)
<!-- SECTION:DESCRIPTION:END -->
