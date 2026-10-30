---
id: TASK-32
title: >-
  [P2] AI-01: Match opponent objectives, personalities, pursuit, and crash
  reactions
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-30 18:51'
labels:
  - priority-2
  - AI-01
  - opponents
  - legacy-partial
  - topic-ai
dependencies:
  - TASK-33
references:
  - src/ai/runtime.ts
  - docs/c2-ai-repair-levitate-re.md
  - tests/browser-native-ai.mjs
priority: high
ordinal: 2041
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **AI-01**
Numeric priority: **2** (1 is highest)
Original status: **Partial**
Category: **Opponents and Pedestrians**

## Scope and evidence

The live regular-opponent fleet now uses installed-binary objective selection/lifecycle, authored nastiness/personality, synchronous populations, visibility, shared catalog grudge and real crash attribution. Pursuit, GetNear, race following, escape, freeze/thaw, freewheel, native repair scheduling and stolen-car levitation have conformance tests; the live regular fleet is tested in Stock, Advanced and Snow Chromium races. Source-only player trail recording replaces invented rival history. AI-02 completes the selected navigation/placement boundary. AI-01 now supplies the shared native per-call roster/ranking stream and reserves repair/visibility-before-personality initialization before asset awaits, applying current publication timestamps without duplicate draws. Five real-solver contact cases plus Chromium contacts validate next-frame retaliation/escape, shared grudge, exact stun/fact chronology and actual live accumulators. Original full-launch/grid chronology is separately tracked in AI-06/TASK-136; this does not claim whole-engine CRT parity. See docs/ai01-production-integration.md.

## Source references

[runtime.ts](../../src/ai/runtime.ts), [AI lifecycle evidence](../../docs/c2-ai-repair-levitate-re.md), [Chromium](../../tests/browser-native-ai.mjs)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Production roster selection uses the shared native CRT, includes per-random-slot ranking draws and preserves explicit duplicate/player IDs and original tier fallback.
- [x] #2 Repair and visibility initialization precede personality quotas; asynchronous staging cannot alter reserved AI values, publication uses current game time without repeated draws, and atomic fleet ownership is preserved.
- [x] #3 Real solver contacts reach normal damage/attribution and next-frame AI decisions; tests cover mild hits, retaliation, surviving scary-impact flee, AI-to-player and AI-to-AI semantics including grudge, stun and fact consumption.
- [x] #4 Build, asset-free tests and Chromium startup/native-AI/contact regressions pass; whole-launch/grid chronology and other remaining scope are explicitly documented rather than claimed complete.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Historical AI-05 audit 2026-10-26 (resolved by this completion): main.ts omitted RNG arguments when calling selectOpponentIds and assignNativePersonalities, so both used global Math.random while NativeOpponentFleet used sharedNativeRandom. A native seed alone cannot reproduce the complete roster/personality chronology. Dedicated startup tests explicitly seed the two selection consumers and assert actual original IDs. Review original shared-stream ownership/draw order under AI-01; do not silently treat seeded native AI alone as deterministic fleet selection.

Selected second after AI-02/TASK-33. Complete crash-to-retaliation/escape integration coverage and review shared roster/personality RNG chronology on the validated navigation/placement path. Existing objectives and personalities already run; this is residual implementation and validation, not an AI rewrite.

AI-02 is done. Fresh HW/SW audit confirms the existing regular crash reaction adapter; no replacement of collision or decision formulas is justified. Concrete startup fixes: HW5037a0/SW4fe8f0 ranking draw after each random ChooseOpponent; explicit rows rank by negative slot without RNG. InitOpponents draws per-instance repair/visibility before quota personality assignment. Browser startup now reserves this AI-local plan before awaits and applies publication-relative timestamps with no extra draws. Original full-launch sorting/player-grid/random consumers remain AI-06/TASK-136; reservation is explicitly a browser integration extension.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Corrected shared native roster/ranking draws and InitOpponents local chronology; asynchronous assets cannot change reserved AI values and publication consumes no duplicate initialization draws. Existing crash formulas verified from original HW; five true solver contact tests plus two Chromium cases prove normal attribution reaches next-frame pursuit/escape, grudge/stun rules and fact cleanup. Production build passes. Full suite3742 passed/6 optional skips; asset-free CI3240 passed/439 skips. Delayed-model Bigdump/Newhawk startup, Stock/Advanced/Snow native AI, actual browser contacts and hardware MCP retaliation/Advanced driving pass without fatal errors. AI-04 remains next; full race-launch/grid chronology remains explicitly AI-06/TASK-136.
<!-- SECTION:FINAL_SUMMARY:END -->
