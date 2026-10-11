---
id: TASK-62
title: '[P3] ANI-01: Play original pedestrian BON/SKL animations and root frames'
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-11 16:03'
labels:
  - priority-3
  - ANI-01
  - animation
  - legacy-partial
dependencies: []
references:
  - src/formats.ts
  - src/pedestrians.ts
priority: medium
ordinal: 3060
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **ANI-01**
Numeric priority: **3** (1 is highest)
Original status: **Partial**
Category: **Animation, Rendering, and Audio**

## Scope and evidence

Connect complete BON/SKL bone/root-frame playback to displayed pedestrian states. Native flat FORM asset loading now retains remapped model variants and independent child/parent attachment vectors; original Stock/Advanced Blokebl, Bandsman and twolf are tested. Seventeen native pose tests verify child angle quantization, absolute character orientation, attachment anchors and frozen-bone gates. The current displayed pedestrian pool still uses averaged root locomotion and procedural limbs; the new per-instance root/flat-bone playback bridge is being integrated.

## Source references

[formats.ts](../../src/formats.ts), [pedestrians.ts](../../src/pedestrians.ts)
<!-- SECTION:DESCRIPTION:END -->
