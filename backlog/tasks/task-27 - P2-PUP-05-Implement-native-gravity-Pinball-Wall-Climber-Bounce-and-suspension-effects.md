---
id: TASK-27
title: >-
  [P2] PUP-05: Implement native gravity, Pinball, Wall Climber, Bounce, and
  suspension effects
status: done
assignee: []
created_date: '2026-10-11 15:13'
labels:
  - priority-2
  - PUP-05
  - powerups
  - legacy-done
dependencies: []
references:
  - docs/c2-motion-powerups-re.md
  - src/powerups.ts
priority: high
ordinal: 2025
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PUP-05**
Numeric priority: **2** (1 is highest)
Original status: **Done**
Category: **Powerups**

## Scope and evidence

Original Gravity, Pinball, Wall Climber, Bounce and soft/hard suspension (actions 16–20) use installed native setters and consumers: authored GENERAL default/reset, car/generic-body gravity and raw-volume noncar exception, ordered world-contact Pinball impulses, wheel-normal gravity/tyre response, timing/contact gates, renewal and removal. Numerical tests and production Chromium cover Eagle/Buggy suspension, actual wall contacts, car/mine gravity, world versus car-car Pinball, expiry and existing water/lift regressions. Spatial effect audio and the game clock remain AUD-03/PHY-07.

## Source references

[Motion powerup evidence](../../docs/c2-motion-powerups-re.md), [powerups.ts](../../src/powerups.ts)
<!-- SECTION:DESCRIPTION:END -->
