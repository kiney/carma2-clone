---
id: TASK-54
title: >-
  [P3] PUP-18: Match overlapping powerup fields, expiry, renewal, and reset
  behavior
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-24 17:28'
labels:
  - priority-3
  - PUP-18
  - powerups
  - legacy-needs-validation
dependencies: []
references:
  - tests/powerups.test.mjs
  - src/physics/upgrades.ts
priority: medium
ordinal: 3038
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PUP-18**
Numeric priority: **3** (1 is highest)
Original status: **Needs validation**
Category: **Powerups**

## Scope and evidence

Compare the overlap of different effects, shared engine/grip/suspension fields, expiry, and reset with the original. Renewal of the same effect has already been fixed.

## Source references

[powerups.test.mjs](../../tests/powerups.test.mjs), [upgrades.ts](../../src/physics/upgrades.ts)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Selected after installed-binary audit found a concrete offline-verifiable discrepancy: native GotPowerupX cancels other active definition indices with overlapping uint16 group masks before applying the incoming handler, while current browser timers are keyed by action and ignore groupInclusion. Implement source-derived lifecycle and original-car numerical tests; preserve normal debug/pickup path.

Implemented verified HW GotPowerupX group cancellation before incoming handlers, per-definition renewal/deadlines, uint16 masks and catalog-ordered expiry/reset. Original Stock/Advanced tables and Eagle3/Buggy suspension/scalar conformance pass. Headless Chromium SwiftShader normal debug-grant sequences check actual engine/grip/spring/damper/travel fields on both cars; existing drive/bounce/wall-climb/gravity/pinball browser checks pass, WebGL0 and no fatal console/network errors. Desktop locked: no physical-display claim. Full evidence and unsupported-handler/inventory/network boundaries are in docs/c2-powerup-overlap-re.md.
<!-- SECTION:NOTES:END -->
