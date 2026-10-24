---
id: TASK-55
title: '[P3] PUP-19: Implement authored-duration pedestrian map display'
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-24 17:39'
labels:
  - priority-3
  - PUP-19
  - powerups
  - legacy-missing
dependencies: []
references:
  - src/powerups.ts
  - src/main.ts
priority: medium
ordinal: 3039
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PUP-19**
Numeric priority: **3** (1 is highest)
Original status: **Missing**
Category: **Powerups**

## Scope and evidence

Implement the pedestrian display on the map as a time-limited original effect. Action `29`.

## Source references

[powerups.ts](../../src/powerups.ts), [main.ts](../../src/main.ts)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Selected for offline implementation after installed-binary audit: action29 original Stock/Advanced index24 duration0 is whole-race/cancellable, not an invented temporary timeout. Implement local-human effect lifecycle and eligible alive/processed pedestrian dots using existing minimap, plus native pedestrian-mission selected-group policy. Verify via numerical tests and headless Canvas2D/runtime state; no physical display required.

Implemented action29 ordinary lifecycle and verified local-human set/reset guards; original index24 duration0 lasts for the race. Lightweight alive/processed/group-aware map iterator avoids diagnostic cloning. Native palette52 one-pixel markers and pedestrian-mission selected-group policy integrated. Eight numerical tests pass (no-install7pass1skip), original Stock/Advanced definitions checked. Actual NewCity headless Chromium normal debug grant24 shows7matching palette52pixels; default/cancel/reload clear, whole-race persistence and mission-context policy pass. No console/page/network errors. SwiftShader1024x768; physical display unavailable. Evidence docs/c2-ped-map-re.md; replay/network/original map texture remain separate.
<!-- SECTION:NOTES:END -->
