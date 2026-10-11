---
id: TASK-45
title: >-
  [P3] PHY-06: Integrate wire collision shapes into custom-car simulation and
  damage
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-11 16:03'
labels:
  - priority-3
  - PHY-06
  - physics
  - legacy-partial
dependencies: []
references:
  - src/mechanics.ts
  - src/physics/simulation.ts
priority: medium
ordinal: 3005
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PHY-06**
Numeric priority: **3** (1 is highest)
Original status: **Partial**
Category: **Physics and world**

## Scope and evidence

Native wire points/edges are simulated for world objects through world/pair CCD, without inventing volume. Integration for custom cars' main shapes and their crush/split paths remains open; no checked stock car requires them.

## Source references

[mechanics.ts](../../src/mechanics.ts), [simulation.ts](../../src/physics/simulation.ts)
<!-- SECTION:DESCRIPTION:END -->
