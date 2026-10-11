---
id: TASK-9
title: '[P1] PHY-10: Resolve remaining cases of vehicles getting stuck on barriers'
status: wip
assignee: []
created_date: '2026-10-11 15:13'
labels:
  - priority-1
  - PHY-10
  - physics
  - legacy-partial
dependencies: []
references:
  - docs/c2-physics-re.md
  - tests/barrier-release.test.mjs
priority: high
ordinal: 1014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PHY-10**
Numeric priority: **1** (1 is highest)
Original status: **Partial**
Category: **Physics and world**

## Scope and evidence

Renewed report of getting stuck on barriers: an additional browser block with shallow pre-existing overlap against two-sided faces is fixed without changing impulses/friction/drivetrain; exit motion, deepening and independent wall contacts are checked. The original SNOW barrier is one-sided: a reproduced body-support case unloads both driven rear wheels and remains physically stuck identically before/after the fix. This specific screenshot case is not claimed fixed; R recovery remains available. Other configurations and original-runtime comparison remain open.

## Source references

[RE notes](../../docs/c2-physics-re.md), [Tests](../../tests/barrier-release.test.mjs)
<!-- SECTION:DESCRIPTION:END -->
