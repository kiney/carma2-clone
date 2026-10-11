---
id: TASK-16
title: >-
  [P1] PED-05: Match original pedestrian blood clouds, giblets, and ground
  trails
status: done
assignee: []
created_date: '2026-10-11 15:13'
labels:
  - priority-1
  - PED-05
  - pedestrians
  - legacy-done
dependencies: []
references:
  - src/ped-blood.ts
  - docs/c2-pedestrians-re.md
priority: high
ordinal: 1048
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PED-05**
Numeric priority: **1** (1 is highest)
Original status: **Done**
Category: **Opponents and Pedestrians**

## Scope and evidence

Original BIGBL clouds, CHUNK giblets, GIBSLICK, and PEDSMEAR are integrated. Evidenced force thresholds, quantities, sizes, lifetimes, pool limits, 75% spill chance, and growth control visible blood; trails follow floor normals and the original slick-area check. Original data/timing tests and Chromium check hits, particles, and persistent trails. Hit-force/corpse-contact input remains explicitly part of PED-03; special powerups are PUP-08 through PUP-10.

## Source references

[ped-blood.ts](../../src/ped-blood.ts), [RE notes](../../docs/c2-pedestrians-re.md)
<!-- SECTION:DESCRIPTION:END -->
