---
id: TASK-6
title: >-
  [P1] WLD-01: Simulate movable world objects with original mass and collision
  behavior
status: done
assignee: []
created_date: '2026-10-11 15:13'
labels:
  - priority-1
  - WLD-01
  - world
  - legacy-done
dependencies: []
references:
  - src/physics/noncar-body.ts
  - src/physics/simulation.ts
priority: high
ordinal: 1008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **WLD-01**
Numeric priority: **1** (1 is highest)
Original status: **Done**
Category: **Physics and world**

## Scope and evidence

Original mass, COM, inertia, forces, collision, activation and detachment of movable world objects are integrated. All 212 valid stock definitions build complete bodies; wire shapes and monorail edges retain their original geometry. Actual browser crashes activate props and lifts.

## Source references

[noncar-body.ts](../../src/physics/noncar-body.ts), [simulation.ts](../../src/physics/simulation.ts)
<!-- SECTION:DESCRIPTION:END -->
