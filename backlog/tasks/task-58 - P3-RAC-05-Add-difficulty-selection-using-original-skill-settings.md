---
id: TASK-58
title: '[P3] RAC-05: Add difficulty selection using original skill settings'
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-24 17:53'
labels:
  - priority-3
  - RAC-05
  - races
  - legacy-partial
dependencies: []
references:
  - src/main.ts
  - src/physics/upgrades.ts
priority: medium
ordinal: 3054
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **RAC-05**
Numeric priority: **3** (1 is highest)
Original status: **Partial**
Category: **Races, Campaign, and Game State**

## Scope and evidence

Integrate difficulty selection and its original values. The underlying tables are read, but the interface currently always uses Skill 0/Easy.

## Source references

[main.ts](../../src/main.ts), [upgrades.ts](../../src/physics/upgrades.ts)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Offline implementation selected: expose original three-skill choice and propagate it to existing parsed skill-table consumers (upgrades/prices, simulation damage/softness, AI, race/crash/ped/stunt awards). Preserve default skill0 and distinguish unused campaign/network tables; verify normal menu path and actual runtime values in headless Chromium.

Implemented persisted Easy/Medium/Hard original skill indices0/1/2 and per-load snapshot published with the new vehicle. All audited existing skill consumers wired: upgrades/money, simulation damage/softness and AI, repair/pickup prices, race/crash/ped/stunt rewards. Pure tests3pass, upgrade10/raceaward8/stunt11pass including original tables. Expanded headless Chromium check verifies actual Medium/Hard starting levels/potential/money against parsed tables, persisted choice, live skill unchanged on menu edit and rejected Nuke preflight, next valid load usesHard, clean context defaultsEasy, no fatal console/request errors. Physical-display handling comparison unavailable. Unused campaign/network/rolling/recovery paths remain out of scope, documented in docs/c2-difficulty-re.md.
<!-- SECTION:NOTES:END -->
