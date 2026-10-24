---
id: TASK-90
title: '[P5] UI-01: Show individual damage components and active powerup durations'
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-24 19:40'
labels:
  - priority-5
  - UI-01
  - ui
dependencies: []
references:
  - src/main.ts
  - src/physics/simulation.ts
priority: low
ordinal: 5089
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **UI-01**
Numeric priority: **5** (1 is highest)
Original status: **Partial**
Category: **UI and Controls**

## Scope and evidence

Show twelve damage components and active powerups with remaining time. Currently `ARMOUR` shows an overall value derived from the highest component value; effects appear mainly as brief text messages.

## Source references

[main.ts](../../src/main.ts), [simulation.ts](../../src/physics/simulation.ts)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Selected after offline-suitable higher-priority fixes: expose twelve existing native damage components and active effect deadlines without changing mechanics. Use authored powerup names, timed/whole-race semantics and player/recipient ownership; normal/debug grant, cancellation, pause, timer-freeze, expiry and repair must agree with live state. Validate numerical snapshots and bounded headless DOM checks; keep the presentation compact and English.

Implemented read-only twelve-component damage view (native raw 0–99, full accessible names in menu) and authored active powerup names with game-time remaining or Race. Existing powerup owner exposes copied recipient-filtered snapshots; display does not advance clocks or change mechanics. Cached DOM updates and bounded six-effect HUD retain every effect in menu. Eight new unit tests and 27 focused checks pass. Production build and original Newcity/Eagle headless Chromium integration pass: explicit 12-value fixture, normal Full repair, renewal, conflict cancellation, pause, timer-freeze-independent expiry, whole-race persistence and fresh-load reset. SwiftShader WebGL2 1280×800; no console, failed-request or GL errors. Screenshot reviewed locally; proprietary screenshot remains ignored. Native icon/fizzle presentation remains PUP-16.
<!-- SECTION:NOTES:END -->
