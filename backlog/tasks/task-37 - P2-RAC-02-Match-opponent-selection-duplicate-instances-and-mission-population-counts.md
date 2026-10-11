---
id: TASK-37
title: >-
  [P2] RAC-02: Match opponent selection, duplicate instances, and mission
  population counts
status: done
assignee: []
created_date: '2026-10-11 15:14'
labels:
  - priority-2
  - RAC-02
  - races
  - legacy-done
dependencies: []
references:
  - docs/c2-race-rules-re.md
  - src/opponent-selection.ts
  - tests/browser-populations.mjs
priority: high
ordinal: 2051
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **RAC-02**
Numeric priority: **2** (1 is highest)
Original status: **Done**
Category: **Races, Campaign, and Game State**

## Scope and evidence

Original catalog interpolation and tier-based opponent selection replace the four-car cap; explicit IDs and duplicate instances are preserved, random fillers exclude the player and previously picked IDs. Missing assets/navigation/placement fail population loading instead of silently shrinking goals. Selected-car missions count surviving instances; selected pedestrians use aggregate union counts, with loading/zero-population guards. Numerical tests and Chromium verify Nice Beaver five opponents, Trucking Hell one ID38 and Bruise Brothers twelve ID51 instances, including Bugga as player.

## Source references

[race rules RE](../../docs/c2-race-rules-re.md), [selection](../../src/opponent-selection.ts), [Chromium populations](../../tests/browser-populations.mjs)
<!-- SECTION:DESCRIPTION:END -->
