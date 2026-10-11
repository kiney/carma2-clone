---
id: TASK-29
title: '[P2] PUP-07: Implement opponent and cop speed-changing powerups'
status: done
assignee: []
created_date: '2026-10-11 15:13'
labels:
  - priority-2
  - PUP-07
  - powerups
  - legacy-done
dependencies: []
references:
  - docs/c2-opponent-powerups-re.md
  - src/powerups.ts
  - src/physics/opponent-speed.ts
priority: high
ordinal: 2027
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PUP-07**
Numeric priority: **2** (1 is highest)
Original status: **Done**
Category: **Powerups**

## Scope and evidence

Actions14/15 retain original timed opponent/cop factors, renewal, expiry and resets. Native direct-force speed controller, damage capacity, frozen15×mass braking and driver6 drivetrain/curvature guards are integrated with numerical tests. First catalog-opponent29 also receives authored Hot rod5 settings. Production Chromium verifies original Stock/Advanced grants, first-match Hot rod/reset, freeze braking, renewal/cancellation, natural expiry while race time is frozen, and independent player driving with five/ten loaded rivals. Native Float32 force/history/damage constants and the corrected 0.5/s curvature slew have numerical fixtures. Route/objective targets remain separate AI-01/AI-02 gaps. Installed C2 police loader is a verified no-op; the browser does not invent police populations.

## Source references

[Opponent powerup evidence](../../docs/c2-opponent-powerups-re.md), [powerups.ts](../../src/powerups.ts), [opponent-speed.ts](../../src/physics/opponent-speed.ts)
<!-- SECTION:DESCRIPTION:END -->
