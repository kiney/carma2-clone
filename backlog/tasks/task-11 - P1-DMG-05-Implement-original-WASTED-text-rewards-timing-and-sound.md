---
id: TASK-11
title: '[P1] DMG-05: Implement original WASTED text, rewards, timing, and sound'
status: done
assignee: []
created_date: '2026-10-11 15:13'
updated_date: '2026-10-11 15:15'
labels:
  - priority-1
  - DMG-05
  - damage
  - legacy-done
dependencies: []
references:
  - src/wasted.ts
  - src/native-font.ts
  - docs/c2-wasted-re.md
priority: high
ordinal: 1020
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **DMG-05**
Numeric priority: **1** (1 is highest)
Original status: **Done**
Category: **Damage, destruction and effects**

## Scope and evidence

Original SCROLLERS text, BIG_ITALIC/MEDIUM_HEADUP glyphs, colors, scroll/flash timing and the five-entry WASTED queue are integrated. Damage-triggered wasting plays the GENERAL-configured original sound (stock 5400/PUPXPLOD.WAV) exactly once; player-caused rival wrecks display the original reward. Original alpha/font rendering and WAV decoding are checked in Chromium. Spatial audio outlets remain AUD-03.

## Source references

[wasted.ts](../../src/wasted.ts), [native-font.ts](../../src/native-font.ts), [RE notes](../../docs/c2-wasted-re.md)

## Previously completed baseline

Imported from the former TODO.md completed checklist (item 7). Preserve this completed scope when considering remaining subsystem work.

Original WASTED font, scroll/queue timing, and configured sound.
<!-- SECTION:DESCRIPTION:END -->
