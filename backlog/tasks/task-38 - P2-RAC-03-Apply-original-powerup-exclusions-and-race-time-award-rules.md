---
id: TASK-38
title: '[P2] RAC-03: Apply original powerup exclusions and race time-award rules'
status: done
assignee: []
created_date: '2026-10-11 15:14'
labels:
  - priority-2
  - RAC-03
  - races
  - legacy-done
dependencies: []
references:
  - docs/c2-race-rules-re.md
  - tests/race-flags.test.mjs
  - tests/browser-race-flags.mjs
priority: high
ordinal: 2052
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **RAC-03**
Numeric priority: **2** (1 is highest)
Original status: **Done**
Category: **Races, Campaign, and Game State**

## Scope and evidence

Installed exclusion semantics and no-time flag are applied to world/random/debug grants and ordinary checkpoint/pedestrian/opponent/powerup time awards. Exclusions substitute definition 0 once without filtering actors or weighted random choices; Stock/Advanced use their own catalogs. Verified original-data tests and Chromium missions, credits, time grants and keyboard driving. Native award quantities remain RAC-04.

## Source references

[race rules RE](../../docs/c2-race-rules-re.md), [race flags tests](../../tests/race-flags.test.mjs), [Chromium](../../tests/browser-race-flags.mjs)
<!-- SECTION:DESCRIPTION:END -->
