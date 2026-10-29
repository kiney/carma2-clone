---
id: TASK-49
title: >-
  [P3] PUP-10: Implement altered heads, corpses, dismemberment, and pedestrian
  states
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-29 10:30'
labels:
  - priority-3
  - PUP-10
  - powerups
  - legacy-partial
dependencies: []
references:
  - src/powerups.ts
  - src/pedestrians.ts
priority: medium
ordinal: 3030
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PUP-10**
Numeric priority: **3** (1 is highest)
Original status: **Missing**
Category: **Powerups**

## Scope and evidence

Implement altered heads/corpses, Dismemberfest, and ethereal/dancing/panicking/helium-filled/drunk pedestrians. Actions `32`, `33`, `39`–`44`.

## Source references

[powerups.ts](../../src/powerups.ts), [pedestrians.ts](../../src/pedestrians.ts)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
ANI-01 now supplies normal action32/33 grants/expiry/cancellation, actual head MODEL/sequence rendering, blood set1/head2, guarded shared-CRT mutant corpse BON and exact prepared fire vertices. Existing source arrays are immutable and shared private resources reset correctly. Remaining actions39-44, Dismemberfest, physical severity/sever topology and other altered pedestrian gameplay states stay open; this ticket is not closed by the rendering completion. See docs/c2-ped-presentation-re.md.
<!-- SECTION:NOTES:END -->
