---
id: TASK-39
title: >-
  [P2] RAC-04: Match race credits, time bonuses, payouts, stunt rewards, and
  attribution
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-11 16:03'
labels:
  - priority-2
  - RAC-04
  - races
  - legacy-partial
dependencies: []
references:
  - docs/c2-race-rules-re.md
  - src/race-awards.ts
  - src/race-payout.ts
priority: high
ordinal: 2053
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **RAC-04**
Numeric priority: **2** (1 is highest)
Original status: **Partial**
Category: **Races, Campaign, and Game State**

## Scope and evidence

Native checkpoint credits from GENERAL (no gate time and no finishing-gate credits), completion reason/skill rows and rest-time bonus, six-state delayed payout/Enter skip, PEDS points/time and capped 1-second combos, softness-scaled waste rewards and immediate finished guards are integrated. Only player-attributed rival wrecks pay; nullable attacker state supports the verified strict-5-second static-world continuation. Original outer-frame damage/speed/contact snapshots, native sector/control attacker selection, accepted-pair cleanup, raw platform history time, greedy four-row normal grouping and the strict Float32 .02 gate are integrated. Native sticky ownership for free parts, splits and world props is connected, including noncar/noncar ownership and driver1 exclusion. Numerical original-Eagle tests cover raw-clock wrap, callback ordering, immunity, first-owner continuation and thresholds. Native per-role component redistribution, outer-frame/intra-frame baselines, persistent wasting, body-local spin/head-on multipliers and authored damage-credit/time equations are now integrated. Numerical tests and W-driven original green Eagle/Diablo head-on/oblique Chromium crashes verify real damage awards and reverse escape. The loaded rolling award tables have no native consumers in the checked executable. Native pedestrian cause writers and articulated contact inputs still need PED-03. Regular AI crash reactions now bind to the live fleet before accumulator cleanup; broader native reaction coverage remains under AI-01. Ordered native pedestrian cause/geometry classes, local-killer eligibility, persistent napalm flags, current/starting velocity and fixed time bonuses now feed the shared signed EarnCredits outlet. Drink Driving action48/index90 applies authored 3x earnings and native projection/audio; source wild/landing cunning stunts are integrated with distinct raw PD timestamps and recovery cancellation. Native articulated pedestrian contacts, indirect/tail cause writers and exact x87 boundary behavior remain separate gaps; final payout stays unmultiplied.

## Source references

[race rules RE](../../docs/c2-race-rules-re.md), [race awards](../../src/race-awards.ts), [payout](../../src/race-payout.ts)
<!-- SECTION:DESCRIPTION:END -->
