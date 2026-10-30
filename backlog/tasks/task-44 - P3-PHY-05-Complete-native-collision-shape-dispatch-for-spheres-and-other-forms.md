---
id: TASK-44
title: >-
  [P3] PHY-05: Complete native collision-shape dispatch for spheres and other
  forms
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-30 15:11'
labels:
  - priority-3
  - PHY-05
  - physics
  - legacy-partial
  - topic-physics
dependencies: []
references:
  - src/mechanics.ts
  - src/physics/simulation.ts
priority: medium
ordinal: 3004
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PHY-05**
Numeric priority: **3** (1 is highest)
Original status: **Partial**
Category: **Physics and world**

## Scope and evidence

Analytical original SPHERE kernels now handle finite world faces/edges and BOX/POLY/WIRE/sphere pairs, with 1,800 installed-executable comparisons. Detached type5 SPHERE bodies use these paths in the actual solver, bounds queries and final trajectory guards; their masses/moments come from original MODEL/FORM data. Generic car/noncar authored spheres still use the earlier sampled hull, so general shape dispatch remains incomplete. None of the checked stock cars' main shapes requires that remaining path.

## Source references

[mechanics.ts](../../src/mechanics.ts), [simulation.ts](../../src/physics/simulation.ts)
<!-- SECTION:DESCRIPTION:END -->
