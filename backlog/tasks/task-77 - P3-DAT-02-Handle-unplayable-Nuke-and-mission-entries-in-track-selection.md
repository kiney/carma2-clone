---
id: TASK-77
title: '[P3] DAT-02: Handle unplayable Nuke and mission entries in track selection'
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-24 17:15'
labels:
  - priority-3
  - DAT-02
  - assets
  - legacy-data-issue
dependencies: []
references:
  - docs/compatibility.md
  - src/race-availability.ts
  - tests/browser-race-availability.mjs
priority: medium
ordinal: 3086
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **DAT-02**
Numeric priority: **3** (1 is highest)
Original status: **Data issue**
Category: **Original Data and Asset Compatibility**

## Scope and evidence

Handle Nuke configurations without a player start or expected ACT, as well as mission/arena entries without usable gates; clearly show in the selection what is actually playable.

## Source references

[Compatibility](../../docs/compatibility.md), [main.ts](../../src/main.ts)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Selected for unattended implementation: expose installed race playability in the new selection menu, distinguish missing start/ACT or unusable checkpoint gates from supported missions, and validate via deterministic original-data/headless browser checks without relying on real rendering.

Selection now retains Nuke as a visible unavailable entry with missing-actor/start reasons, disables loading and preflights programmatic requests before touching the live scene. Static rule assessment separates finite usable gate routes, combat-only classic races, supported non-lap missions and drivable maps without single-player rules. Explicit browser practice has no countdown, checkpoint victory or completion payout while driving/repair/recovery remain ordinary game state. Unknown-rule maps no longer attempt an undefined opponent roster. Saved unavailable selections fall back to a loadable choice. Added six deterministic tests including Stock/Advanced Nuke, arena and gate-less missions; new headless Chromium regression verifies blocked Nuke preserves scene, real arena W-driving survives timer expiry, and Control Freak remains a peds mission with zero gates. No actual-display visual judgment was required; desktop MCP target closing timed out while locked and is recorded separately from passing application tests.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
DAT-02 complete. Six unit/original-data tests and production headless Chromium availability regression pass; original arena moves with practice timer frozen, genuine zero-gate mission remains enabled, GL error0 and no fatal console errors. TypeScript/build pass. Static availability does not certify full mission scripts or ground reachability; existing native gameplay gaps stay with their original tickets.
<!-- SECTION:FINAL_SUMMARY:END -->
