---
id: TASK-7
title: '[P1] WLD-02: Implement original world-object smashing and delayed activation'
status: done
assignee: []
created_date: '2026-10-11 15:13'
labels:
  - priority-1
  - WLD-02
  - world
  - legacy-done
dependencies: []
references:
  - src/world-destruction.ts
  - src/config.ts
priority: high
ordinal: 1009
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **WLD-02**
Numeric priority: **1** (1 is highest)
Original status: **Done**
Category: **Physics and world**

## Scope and evidence

Native smash thresholds per contact row, local UV texture changes, collision modes, removal/replacement and delayed world-object activation are integrated. Chromium checks the Airport door; old contacts are invalidated before solving again. Further effect connotations are covered by WLD-05.

## Source references

[world-destruction.ts](../../src/world-destruction.ts), [config.ts](../../src/config.ts)
<!-- SECTION:DESCRIPTION:END -->
