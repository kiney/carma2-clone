---
id: TASK-18
title: '[P2] PHY-07: Match native frame timing, pause behavior, and physics cadence'
status: done
assignee: []
created_date: '2026-10-11 15:13'
updated_date: '2026-10-11 15:15'
labels:
  - priority-2
  - PHY-07
  - physics
  - legacy-done
dependencies: []
references:
  - docs/c2-timebase-re.md
  - src/game-clock.ts
  - tests/browser-timebase.mjs
priority: high
ordinal: 2006
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PHY-07**
Numeric priority: **2** (1 is highest)
Original status: **Done**
Category: **Physics and world**

## Scope and evidence

Installed native frame filtering, 10–1000 ms limits, signed prediction correction, wrapped averaging, pause-adjusted timestamps and PHIL absolute frame windows are integrated. Physics retains native 40 ms/five-step limits, resynchronization and interpolation; ordinary powerup expiry runs after physics, and timer/payout clocks remain distinct. Numerical 60/100/144/240 Hz cases and production Chromium verify real driving, a 650 ms stall, pause/resume, debug timer freezing, awards and motion-powerup regressions. The <=100 Hz gameplay gate and pause sampling-origin shift are explicit browser extensions; render FPS is independent. Resume preserves prediction error and the active cadence remainder; exact Chromium first-frame/timer/effect checks and deterministic paused/unpaused comparisons cover the corrected rebase drift.

## Source references

[Timebase evidence](../../docs/c2-timebase-re.md), [game clock](../../src/game-clock.ts), [Chromium](../../tests/browser-timebase.mjs)

## Previously completed baseline

Imported from the former TODO.md completed checklist (item 1). Preserve this completed scope when considering remaining subsystem work.

Stutter from directly rendered 40-ms physics poses: render interpolation for vehicles, camera, and physical parts.
<!-- SECTION:DESCRIPTION:END -->
