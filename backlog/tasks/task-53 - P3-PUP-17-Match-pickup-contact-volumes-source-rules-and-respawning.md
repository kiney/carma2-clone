---
id: TASK-53
title: '[P3] PUP-17: Match pickup contact volumes, source rules, and respawning'
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
labels:
  - priority-3
  - PUP-17
  - powerups
  - legacy-needs-validation
dependencies: []
references:
  - src/powerups.ts
priority: medium
ordinal: 3037
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PUP-17**
Numeric priority: **3** (1 is highest)
Original status: **Needs validation**
Category: **Powerups**

## Scope and evidence

Validate pickup volume and source rules: currently a fixed 0.7 world units around the vehicle position is used instead of the original vehicle/pickup-dependent contact logic; respawning is not implemented.

## Source references

[powerups.ts](../../src/powerups.ts)
<!-- SECTION:DESCRIPTION:END -->
