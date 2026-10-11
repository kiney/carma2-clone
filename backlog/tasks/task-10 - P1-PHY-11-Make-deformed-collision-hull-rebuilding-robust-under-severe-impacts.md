---
id: TASK-10
title: >-
  [P1] PHY-11: Make deformed collision-hull rebuilding robust under severe
  impacts
status: wip
assignee: []
created_date: '2026-10-11 15:13'
labels:
  - priority-1
  - PHY-11
  - physics
  - legacy-partial
dependencies: []
references:
  - src/physics/geometry.ts
  - tests/browser-crash-matrix.mjs
priority: high
ordinal: 1015
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PHY-11**
Numeric priority: **1** (1 is highest)
Original status: **Partial**
Category: **Physics and world**

## Scope and evidence

Severe repeated physical contacts with original Porker2 can abort collision-shape rebuilding with `Degenerate collision hull horizon`. Observed in the Chromium crash matrix after the native track-edge integration; another identical run completed, so the failing deformed point set and original native hull behavior need deterministic capture. Raw-edge control completed; causation is not established. Preserve source feature order and physical/visual coherence; do not replace the dented shape with an arbitrary box.

## Source references

[geometry.ts](../../src/physics/geometry.ts), [crash matrix](../../tests/browser-crash-matrix.mjs)
<!-- SECTION:DESCRIPTION:END -->
