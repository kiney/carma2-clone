---
id: TASK-62
title: '[P3] ANI-01: Play original pedestrian BON/SKL animations and root frames'
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-28 22:45'
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

## PED-03 scope split (2026-10-11)

Scope clarification after PED-03 split: complete prepared BON/SKL/root/bone vertex playback in displayed population states remains ANI-01. PED-06 owns population resource/lifecycle admission and PED-08 owns visible sever/body topology. The narrowed PED-03 counting task does not complete animation parity.

Related tasks: [TASK-96](task-96%20-%20P2-PED-06-Integrate-ordinary-population-identities-with-native-physical-lifecycle.md), [TASK-98](task-98%20-%20P2-PED-08-Integrate-visible-severing-and-articulated-pedestrian-body-contacts.md).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-28 22:45
---
Live Chromium report (2026-10-28), original Newcity1 / NICE BEAVER: pedestrian ped-cityswat-476 near Eagle/gas station renders with a persistent whole-body lean of46.63396 degrees while alive=true, action=Running(1), moveId41, fallTime0. Outer actor has yaw only; visual quaternion is identity. Thus this is not the dead-fall branch or vehicle collision physics. Torso ACT MANBWC.ACT retains its authored tilted basis from data/PEDS/PEEPS/CitySwat/FLIGHTMEC1.act. A separate read-only parse of the original archive confirms46.63398 degrees (up[-.45680755,.68665606,-.56553417]); the tiny difference is host decompose/recompose. Other sampled CitySwat instances retain the same basis, including ordinary move30 walkers.

The loader selects the largest same-directory ACT, then rigPedestrian preserves this internal source pose and only adds procedural limb pivots. The displayed population never replaces the torso/root with the selected FORM/BON frame. Preserve this as a concrete production playback regression case when connecting the existing native root/flat-bone providers. Do not globally zero rotations or arbitrarily upright every ACT: authored bone bases and actual falling/leaning animations must remain meaningful. Rootframe application and correct package/actor selection require verification rather than inferring that every tilted authored matrix is itself corrupt. Live scene was read only apart from hiding the pause menu and remains paused.
---

created: 2026-10-28 22:45
---
Full live population check: all 165 CitySwat instances are alive and retain the identical 46.63396075-degree torso tilt, across active/inactive and move30/move41 states. This establishes a systematic source-pose presentation issue, rather than a one-off impact state.
---
<!-- COMMENTS:END -->
