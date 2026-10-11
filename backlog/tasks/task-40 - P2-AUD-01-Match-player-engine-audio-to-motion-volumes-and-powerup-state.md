---
id: TASK-40
title: '[P2] AUD-01: Match player engine audio to motion, volumes, and powerup state'
status: done
assignee: []
created_date: '2026-10-11 15:14'
labels:
  - priority-2
  - AUD-01
  - audio
  - legacy-done
dependencies: []
references:
  - docs/c2-engine-audio-re.md
  - src/audio.ts
priority: high
ordinal: 2069
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **AUD-01**
Numeric priority: **2** (1 is highest)
Original status: **Done**
Category: **Animation, Rendering, and Audio**

## Scope and evidence

Reconstruct the player engine loop from actual motion RPM, special-volume pitch/volume indices, and engine powerup factor. Verified installed HW binds only configured ID 0; the other two parsed IDs are not gear/load switches in this native path. Stationary playback, numerical transforms and actual Chromium driving/pause/resume are checked. Spatial opponent/police sources remain separate.

## Source references

[Engine audio evidence](../../docs/c2-engine-audio-re.md), [audio.ts](../../src/audio.ts)
<!-- SECTION:DESCRIPTION:END -->
