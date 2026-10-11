---
id: TASK-21
title: >-
  [P2] DMG-01: Implement native WAM effects, damage queues, shards, and repair
  behavior
status: wip
assignee: []
created_date: '2026-10-11 15:13'
labels:
  - priority-2
  - DMG-01
  - damage
  - legacy-partial
dependencies: []
references:
  - docs/c2-wam-effects-re.md
  - docs/c2-shards-re.md
  - tests/browser-wam-effects.mjs
priority: high
ordinal: 2016
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **DMG-01**
Numeric priority: **2** (1 is highest)
Original status: **Partial**
Category: **Damage, destruction and effects**

## Scope and evidence

Complete WAM connotation parsing, reached-tier state, final-target repeats, crossed-tier flags, LOD deduplication and repair rearming are implemented. Authored one-alternative sounds and material-local glass shards run in Chromium for original Eagle3, Copcar and VLAD3, including a driven crash. Shards use source subdivision, starting-step metric velocity, gravity, spin, identity UV mapping, lifetime and pool limits. Ordinary crush now waits for all outer physics steps through the native eight-car/four-event queue; WAM/world effects share twenty records with source flush barriers and first-context retention. Physics SPAM uses its own eight-car/max-strength queue; full repair cancels SPAM while retaining ordinary events. Structural marks now execute after shape/flap/detachment phases; captured physics ticks seed a shared MSVC stream. Original GENERAL values drive bending and inverse-buckle settings. Still open: complete native RNG consumer chronology, shared fragment priorities, ghost/noncar/abstract shrapnel, slicks and full effect ownership/visibility rules.

## Source references

[WAM evidence](../../docs/c2-wam-effects-re.md), [shards](../../docs/c2-shards-re.md), [Chromium](../../tests/browser-wam-effects.mjs)
<!-- SECTION:DESCRIPTION:END -->
