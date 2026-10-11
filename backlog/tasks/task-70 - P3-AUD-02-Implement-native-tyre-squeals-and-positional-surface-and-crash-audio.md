---
id: TASK-70
title: >-
  [P3] AUD-02: Implement native tyre squeals and positional surface and crash
  audio
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-11 16:03'
labels:
  - priority-3
  - AUD-02
  - audio
  - legacy-partial
dependencies: []
references:
  - src/physics/surfaces.ts
  - src/audio.ts
priority: medium
ordinal: 3070
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **AUD-02**
Numeric priority: **3** (1 is highest)
Original status: **Partial**
Category: **Animation, Rendering, and Audio**

## Scope and evidence

Native tyre-squeal eligibility, 9000–9004 selection, pitch, shared owner/tag rules and real Web Audio voice lifecycle are integrated. Material-specific scraping/crash sounds and native positional mixing/Doppler remain missing; the tyre producer uses the authored noise index as an eligibility sentinel, as verified in the binary.

## Source references

[surfaces.ts](../../src/physics/surfaces.ts), [audio.ts](../../src/audio.ts)
<!-- SECTION:DESCRIPTION:END -->
