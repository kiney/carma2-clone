---
id: TASK-4
title: >-
  [P1] PHY-04: Match native physics timing, solver iterations, and rotation
  behavior
status: done
assignee: []
created_date: '2026-10-11 15:13'
updated_date: '2026-10-11 15:15'
labels:
  - priority-1
  - PHY-04
  - physics
  - legacy-done
dependencies: []
references:
  - src/physics/simulation.ts
  - docs/c2-physics-re.md
priority: high
ordinal: 1003
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PHY-04**
Numeric priority: **1** (1 is highest)
Original status: **Done**
Category: **Physics and world**

## Scope and evidence

HW/SW tick, solver and rotation paths compared: 40 ms, five catch-up steps, 30 iterations per contact group, three reported impulse solutions. The browser guard remains an intentional extension; crash, joint and impact-chain tests check finite surfaces and fresh trajectories.

## Source references

[simulation.ts](../../src/physics/simulation.ts), [RE notes](../../docs/c2-physics-re.md)

## Previously completed baseline

Imported from the former TODO.md completed checklist (item 4). Preserve this completed scope when considering remaining subsystem work.

Reproducible crash-related falling through the ground: recheck of the changed impulse/rotation path and joint projection. Further original comparison/robustness checks are tracked under PHY-04 and DMG-04.
<!-- SECTION:DESCRIPTION:END -->
