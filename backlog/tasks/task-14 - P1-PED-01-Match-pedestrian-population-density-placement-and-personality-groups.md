---
id: TASK-14
title: >-
  [P1] PED-01: Match pedestrian population density, placement, and personality
  groups
status: done
assignee: []
created_date: '2026-10-11 15:13'
updated_date: '2026-10-11 15:15'
labels:
  - priority-1
  - PED-01
  - pedestrians
  - legacy-done
dependencies: []
references:
  - src/pedestrians.ts
  - docs/c2-pedestrians-re.md
priority: high
ordinal: 1044
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PED-01**
Numeric priority: **1** (1 is highest)
Original status: **Done**
Category: **Opponents and Pedestrians**

## Scope and evidence

Replaced the 80-person limit and starting-area bias with the original area/density formula, remainder transfer per spawn specification, slope limit, personality groups, and native limit of 2000. Complete stock populations: New City1 791, Airport1 573, Carrier1 249, with no missing profiles. Camera processing/popup hysteresis and win conditions count the full population.

## Source references

[pedestrians.ts](../../src/pedestrians.ts), [RE notes](../../docs/c2-pedestrians-re.md)

## Previously completed baseline

Imported from the former TODO.md completed checklist (item 8). Preserve this completed scope when considering remaining subsystem work.

Original pedestrian density, data-driven reactions/avoidance, and original blood clouds/giblets/ground trails; hit/bone physics remains separately open.
<!-- SECTION:DESCRIPTION:END -->
