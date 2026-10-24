---
id: TASK-10
title: >-
  [P1] PHY-11: Make deformed collision-hull rebuilding robust under severe
  impacts
status: backlog
assignee: []
created_date: '2026-10-11 15:13'
updated_date: '2026-10-24 17:53'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Offline audit found a deterministic precision mismatch: native-hull topology uses stored Float32 points but exact-collinear retry classified raw doubles. Bit-identical Float32 point sets can therefore differ between success and Degenerate collision hull horizon. Investigate/fix that bounded discrepancy, capture failing point sets and attempt a short original-car replay. Historical Porker2 cause is not established; do not close the full ticket solely from this synthetic fix.

Partial reviewed correction: retry collinearity now uses storedFloat32 geometry, matching the primary constructor. Bit-identical synthetic geometry no longer diverges; no epsilon/response/deformation changes. Two regressions plus36geometry/8noncar tests pass, preserving59originalstockhulls and native bentEagle topology. Bounded32originalPorker damage inputs and isolated3case/max3tick Chromium split/repair regression pass with no errors. Historical contact-driven Porker horizon failure not reproduced; ticket remains open awaiting exact failing points. Evidence docs/native-hull-re.md; ignored capture report tool included.
<!-- SECTION:NOTES:END -->
