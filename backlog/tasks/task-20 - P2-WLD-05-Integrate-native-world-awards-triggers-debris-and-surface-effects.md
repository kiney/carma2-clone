---
id: TASK-20
title: >-
  [P2] WLD-05: Integrate native world awards, triggers, debris, and surface
  effects
status: backlog
assignee: []
created_date: '2026-10-11 15:13'
updated_date: '2026-10-11 16:03'
labels:
  - priority-2
  - WLD-05
  - world
  - legacy-partial
dependencies: []
references:
  - src/main.ts
  - src/world-smash.ts
priority: high
ordinal: 2012
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **WLD-05**
Numeric priority: **2** (1 is highest)
Original status: **Partial**
Category: **Physics and world**

## Scope and evidence

Authored awards and nearby human-car powerup triggers dispatch through native final-flush ordering. Follow-up cuboids share delayed slots and preserve source/target context. Abstract shrapnel, ghostparts and physical noncar debris consume original resources, with Stock/Advanced Chromium checks and explicit prepared-material-order gaps. World/WAM slicks now dispatch to the same 32-slot pool as charged oil, retaining source ACT/MODEL, original materials, delayed placement, outer-frame processing and graphics-produced wheel masks. Installed Stock/Advanced world/WAM payloads contain no slicks; original pedestrian slick settings and explicit connotation fixtures exercise the outlet. Native corpse recovery now queues original GIBSLICK/GIBSMEAR resources into the shared pool with verified CRT, latch, delayed ACT/MODEL and resource-reuse semantics; Stock/Advanced native-wrapper Chromium checks cover actual contact and recovery. The normal legacy population still uses its separate blood outlet. Production population integration, complete race MAT/fog adaptation, exact packed face ordering at saturation, parallel followups and fancy headups remain open.

## Source references

[main.ts](../../src/main.ts), [world-smash.ts](../../src/world-smash.ts)
<!-- SECTION:DESCRIPTION:END -->
