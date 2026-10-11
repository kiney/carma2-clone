---
id: TASK-41
title: >-
  [P2] AUD-05: Match native pickup, ability, checkpoint, and race announcement
  sounds
status: done
assignee: []
created_date: '2026-10-11 15:14'
labels:
  - priority-2
  - AUD-05
  - audio
  - legacy-done
dependencies: []
references:
  - docs/c2-event-audio-re.md
  - src/event-audio.ts
priority: high
ordinal: 2073
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **AUD-05**
Numeric priority: **2** (1 is highest)
Original status: **Done**
Category: **Animation, Rendering, and Audio**

## Scope and evidence

Removed the checkpoint sample from powerup/crate rewards and ability grants. Real bottle collection uses the GENERAL sound list (Stock 5401), and Mine pickup 14 uses the evidenced 5400 sound; grants/use/expiry have no generic pickup sound. Checkpoint, final lap, race completion, and time expiry have their own voices without a duplicate gate announcement. Spatial outlets and additional effect sounds remain under AUD-03/04.

## Source references

[Audio notes](../../docs/c2-event-audio-re.md), [event-audio.ts](../../src/event-audio.ts)
<!-- SECTION:DESCRIPTION:END -->
