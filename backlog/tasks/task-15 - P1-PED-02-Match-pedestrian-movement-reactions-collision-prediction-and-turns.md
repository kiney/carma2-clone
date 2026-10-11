---
id: TASK-15
title: >-
  [P1] PED-02: Match pedestrian movement, reactions, collision prediction, and
  turns
status: done
assignee: []
created_date: '2026-10-11 15:13'
labels:
  - priority-1
  - PED-02
  - pedestrians
  - legacy-done
dependencies: []
references:
  - src/pedestrians.ts
  - src/ped-proximity.ts
  - docs/c2-pedestrians-re.md
priority: high
ordinal: 1045
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PED-02**
Numeric priority: **1** (1 is highest)
Original status: **Done**
Category: **Opponents and Pedestrians**

## Scope and evidence

Original movement periods/root translation, running/panic states, callback/reaction tables, ten-second gates, opponent-/object-related collision-course prediction, and smooth turns are integrated. Native finite-surface projection, body width, exclusions/byte flags, exceptions, and tangent comparison control wall/floor avoidance; smashes invalidate the face cache. Numerical actor tests and Chromium check actual reactions. The pointer-/time-dependent RNG stream still differs due to browser behavior; see PED-03/ANI-01 for bones/hit physics.

## Source references

[pedestrians.ts](../../src/pedestrians.ts), [ped-proximity.ts](../../src/ped-proximity.ts), [RE notes](../../docs/c2-pedestrians-re.md)
<!-- SECTION:DESCRIPTION:END -->
