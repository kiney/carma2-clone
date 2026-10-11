---
id: TASK-46
title: >-
  [P3] WLD-04: Complete safe-pose recovery, including split-car recovery
  behavior
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-11 16:03'
labels:
  - priority-3
  - WLD-04
  - world
  - legacy-partial
dependencies: []
references:
  - src/physics/recovery.ts
  - src/physics/simulation.ts
priority: medium
ordinal: 3011
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **WLD-04**
Numeric priority: **3** (1 is highest)
Original status: **Partial**
Category: **Physics and world**

## Scope and evidence

Native safe-pose history, rotation and placement checks for ordinary player recovery are integrated. Native WeldCar during recovery after splits is still missing. Further checks are needed for map boundaries, multilevel areas and safe surfaces that have since been destroyed. Falling remains physically possible outside actual surfaces.

## Source references

[recovery.ts](../../src/physics/recovery.ts), [simulation.ts](../../src/physics/simulation.ts)
<!-- SECTION:DESCRIPTION:END -->
