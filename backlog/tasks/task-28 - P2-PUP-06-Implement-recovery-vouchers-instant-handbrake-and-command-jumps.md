---
id: TASK-28
title: '[P2] PUP-06: Implement recovery vouchers, instant handbrake, and command jumps'
status: done
assignee: []
created_date: '2026-10-11 15:13'
labels:
  - priority-2
  - PUP-06
  - powerups
  - legacy-done
dependencies: []
references:
  - docs/c2-command-powerups-re.md
  - tests/command-powerups.test.mjs
  - tests/browser-command-powerups.mjs
priority: high
ordinal: 2026
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PUP-06**
Numeric priority: **2** (1 is highest)
Original status: **Done**
Category: **Powerups**

## Scope and evidence

Actions 26/28/36 implement cumulative recovery vouchers spent only on successful recovery, timed instant handbrake that bypasses normal braking, and charged additive world-Y command jumps. Original parameters, guards, expiry, airborne behavior, repeated charges and jump sound are verified numerically and through the visible debug UI in Chromium. Existing approximate recovery pricing and unsupported Pratcam/force feedback are documented separately.

## Source references

[command powerup RE](../../docs/c2-command-powerups-re.md), [tests](../../tests/command-powerups.test.mjs), [Chromium](../../tests/browser-command-powerups.mjs)
<!-- SECTION:DESCRIPTION:END -->
