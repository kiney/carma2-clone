---
id: TASK-36
title: '[P2] RAC-01: Implement authored Smash and Smash-and-Ped mission objectives'
status: done
assignee: []
created_date: '2026-10-11 15:14'
labels:
  - priority-2
  - RAC-01
  - races
  - legacy-done
dependencies: []
references:
  - docs/c2-race-rules-re.md
  - src/mission-variables.ts
  - tests/smash-missions.test.mjs
priority: high
ordinal: 2050
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **RAC-01**
Numeric priority: **2** (1 is highest)
Original status: **Done**
Category: **Races, Campaign, and Game State**

## Scope and evidence

Authored Smash/Smash-and-Ped variable IDs, signed-byte mutations, selected-group kills and immediate once-only reason3 completion are integrated. Chromium verifies Eye of the Beaver and all eighteen Hard Core ACT targets plus the actual group56 ADMIRAL death in both final-event orders, starting at zero without a counter seed. The previously reported 18/19 result was an ACT-only test omitting the authored pedestrian target; installed initialization clears all1000 variables and does not preload progress. Repeated sweeps do not add a second death. Stock/Advanced Carrier, Desert and Silo follow-up cases remain checked; full side-effect/finite-collector fidelity is tracked separately under WLD-05 and native articulated pedestrian contact fidelity under PED-03.

## Source references

[race rules RE](../../docs/c2-race-rules-re.md), [mission variables](../../src/mission-variables.ts), [mission tests](../../tests/smash-missions.test.mjs)
<!-- SECTION:DESCRIPTION:END -->
