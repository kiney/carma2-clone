---
id: TASK-24
title: >-
  [P2] DMG-04: Validate crash damage, structural failure, attribution, and
  repair
status: done
assignee: []
created_date: '2026-10-11 15:13'
updated_date: '2026-10-11 15:15'
labels:
  - priority-2
  - DMG-04
  - damage
  - legacy-done
dependencies: []
references:
  - tests/browser-crash-matrix.mjs
  - docs/c2-physics-re.md
priority: high
ordinal: 2019
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **DMG-04**
Numeric priority: **2** (1 is highest)
Original status: **Done**
Category: **Damage, destruction and effects**

## Scope and evidence

Production Chromium checks W-driven head-on/oblique impacts with original Stock Eagle3, Buggy and Bigdump plus Advanced 69mach1, attribution/component deltas, reverse escape, persistent severe-crash deformation and repair. A separate ordinary Eagle3 WAM fixture reaches two simultaneous bumper joints and removes both on repair. Native Porker2 SPAM crosses condition 74, splits into independent debris/secondary rigid state and conserves mass; repair clears split state/components while preserving prior WASTED. Controlled contact setups are labelled; this regression coverage does not assert full original-game equivalence.

## Source references

[Crash matrix](../../tests/browser-crash-matrix.mjs), [RE notes](../../docs/c2-physics-re.md)

## Previously completed baseline

Imported from the former TODO.md completed checklist (item 10). Preserve this completed scope when considering remaining subsystem work.

Ordinary Stock-car motion, local cumulative crush, twelve damage components, joints/detachment, bending/splitting, and repair are present. Do not confuse them with the old arcade helper.
<!-- SECTION:DESCRIPTION:END -->
