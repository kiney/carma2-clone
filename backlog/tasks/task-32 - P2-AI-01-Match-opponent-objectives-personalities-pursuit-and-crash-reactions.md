---
id: TASK-32
title: >-
  [P2] AI-01: Match opponent objectives, personalities, pursuit, and crash
  reactions
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-30 15:11'
labels:
  - priority-2
  - AI-01
  - opponents
  - legacy-partial
  - topic-ai
dependencies: []
references:
  - src/ai/runtime.ts
  - docs/c2-ai-repair-levitate-re.md
  - tests/browser-native-ai.mjs
priority: high
ordinal: 2040
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **AI-01**
Numeric priority: **2** (1 is highest)
Original status: **Partial**
Category: **Opponents and Pedestrians**

## Scope and evidence

The live regular-opponent fleet now uses installed-binary objective selection/lifecycle, authored nastiness/personality, synchronous populations, visibility, shared catalog grudge and real crash attribution. Pursuit, GetNear, race following, escape, freeze/thaw, freewheel, native repair scheduling and stolen-car levitation have conformance tests; the live regular fleet is tested in Stock, Advanced and Snow Chromium races. Source-only player trail recording replaces invented rival history. Remaining work: broader live crash-to-retaliation/escape coverage and review of outstanding native mode/placement boundaries under AI-02.

## Source references

[runtime.ts](../../src/ai/runtime.ts), [AI lifecycle evidence](../../docs/c2-ai-repair-levitate-re.md), [Chromium](../../tests/browser-native-ai.mjs)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AI-05 audit 2026-10-26: main.ts currently omits RNG arguments when calling selectOpponentIds and assignNativePersonalities, so both use global Math.random while NativeOpponentFleet uses sharedNativeRandom. A native seed alone cannot reproduce the complete roster/personality chronology. Dedicated startup tests explicitly seed the two selection consumers and assert actual original IDs. Review original shared-stream ownership/draw order under AI-01; do not silently treat seeded native AI alone as deterministic fleet selection.
<!-- SECTION:NOTES:END -->
