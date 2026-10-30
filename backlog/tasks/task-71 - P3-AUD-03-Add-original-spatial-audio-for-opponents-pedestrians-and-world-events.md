---
id: TASK-71
title: >-
  [P3] AUD-03: Add original spatial audio for opponents, pedestrians, and world
  events
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-30 15:11'
labels:
  - priority-3
  - AUD-03
  - audio
  - legacy-partial
  - topic-audio
dependencies: []
references:
  - src/audio.ts
  - src/main.ts
priority: medium
ordinal: 3071
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **AUD-03**
Numeric priority: **3** (1 is highest)
Original status: **Partial**
Category: **Animation, Rendering, and Audio**

## Scope and evidence

Integrate spatial audio for opponents, pedestrians, and world events, along with their original sound selection. Currently there is primarily the player engine, random Impact WAVs, and corrected pickup/race announcements (AUD-05); spatial outlets are still missing.

## Source references

[audio.ts](../../src/audio.ts), [main.ts](../../src/main.ts)
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-28 22:34
---
WLD-05/DMG-03 effect completion keeps positional world/car one-shot attenuation here. Ordinary opponent engine audio already exists; the remaining flat playSound connotation outlet must not be mistaken for complete spatial event audio. See docs/c2-effect-producer-audit.md.
---
<!-- COMMENTS:END -->
