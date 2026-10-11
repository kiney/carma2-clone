---
id: TASK-12
title: >-
  [P1] PUP-01: Implement charged mines and mortars with native damage and
  lifecycle
status: done
assignee: []
created_date: '2026-10-11 15:13'
labels:
  - priority-1
  - PUP-01
  - powerups
  - legacy-done
dependencies: []
references:
  - src/powerups.ts
  - src/physics/mines.ts
priority: high
ordinal: 1021
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PUP-01**
Numeric priority: **1** (1 is highest)
Original status: **Done**
Category: **Powerups**

## Scope and evidence

Actions 30/34, the charge inventory, physical mines/mortars, contacts, damage, crush/detachment, and timed explosion are integrated. Chromium checks the original mine, charge consumption, crash, and repair. Analytical sphere contact remains PHY-05.

## Source references

[powerups.ts](../../src/powerups.ts), [mines.ts](../../src/physics/mines.ts)
<!-- SECTION:DESCRIPTION:END -->
