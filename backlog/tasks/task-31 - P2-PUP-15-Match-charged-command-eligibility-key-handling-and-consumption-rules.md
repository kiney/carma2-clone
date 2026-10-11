---
id: TASK-31
title: >-
  [P2] PUP-15: Match charged-command eligibility, key handling, and consumption
  rules
status: done
assignee: []
created_date: '2026-10-11 15:14'
labels:
  - priority-2
  - PUP-15
  - powerups
  - legacy-done
dependencies: []
references:
  - docs/c2-command-powerups-re.md
  - src/powerups.ts
  - tests/browser-command-powerups.mjs
priority: high
ordinal: 2035
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PUP-15**
Numeric priority: **2** (1 is highest)
Original status: **Done**
Category: **Powerups**

## Scope and evidence

Native charged-command eligibility and consumption are verified: repeated grants accumulate, key edges activate without elapsed cooldown, finished/knackered/invalid inventory is rejected, and negative got-handler results preserve charges and selection. Native mine/oil allocator refusal still consumes because their handlers return success. Stock/Advanced commands have fizzle type−1 and no group mask; fizzle is icon presentation rather than an activation chance or cooldown (metadata/artwork remains PUP-16/UI-01). Numerical tests and production Chromium command/debug checks pass.

## Source references

[Command evidence](../../docs/c2-command-powerups-re.md), [powerups.ts](../../src/powerups.ts), [Chromium test](../../tests/browser-command-powerups.mjs)
<!-- SECTION:DESCRIPTION:END -->
