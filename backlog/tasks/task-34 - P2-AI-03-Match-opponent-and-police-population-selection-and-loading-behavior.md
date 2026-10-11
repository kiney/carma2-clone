---
id: TASK-34
title: >-
  [P2] AI-03: Match opponent and police population selection and loading
  behavior
status: done
assignee: []
created_date: '2026-10-11 15:14'
labels:
  - priority-2
  - AI-03
  - opponents
  - legacy-done
dependencies: []
references:
  - docs/c2-opponent-powerups-re.md
  - src/main.ts
priority: high
ordinal: 2042
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **AI-03**
Numeric priority: **2** (1 is highest)
Original status: **Done**
Category: **Opponents and Pedestrians**

## Scope and evidence

Native authored/interpolated opponent populations and strength selection are implemented and verified under RAC-02, including duplicate instances and twelve-car missions. The installed police loader at0x4a93a0 only clears the police count and returns; all checked Stock/Advanced tracks have zero police starts. No invented police population is added. Original opponent objectives remain AI-01.

## Source references

[Population evidence](../../docs/c2-opponent-powerups-re.md), [main.ts](../../src/main.ts)
<!-- SECTION:DESCRIPTION:END -->
