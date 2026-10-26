---
id: TASK-10
title: >-
  [P1] PHY-11: Make deformed collision-hull rebuilding robust under severe
  impacts
status: done
assignee: []
created_date: '2026-10-11 15:13'
updated_date: '2026-10-26 20:09'
labels:
  - priority-1
  - PHY-11
  - physics
dependencies: []
references:
  - src/physics/geometry.ts
  - tests/browser-crash-matrix.mjs
priority: high
ordinal: 1000
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

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Valid near-coplanar horizon failures recover a closed actual-point hull with original authored storage and IDs; no arbitrary replacement box.
- [x] #2 Successful native stock and bent hull feature orders remain unchanged; crash, traction and crush coefficients are untouched.
- [x] #3 Final-insertion failures are detected, real narrow ridges survive, and invalid flat or nonfinite geometry is rejected.
- [x] #4 Bounded original-car physical impacts, full repair, collision sweeps and Chromium rendering validate the integrated path.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Queue review 2026-10-26 — position 1/5, P1.
No unfinished ticket is a demonstrated prerequisite. Capture the exact failing deformed point set and replay it deterministically; the existing Float32-classification fix is partial evidence, not closure. Prioritize this potentially fatal hull-rebuild defect before broader crash/effect acceptance. AI-05 can still be investigated independently if the historical failure cannot be reproduced.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Offline audit found a deterministic precision mismatch: native-hull topology uses stored Float32 points but exact-collinear retry classified raw doubles. Bit-identical Float32 point sets can therefore differ between success and Degenerate collision hull horizon. Investigate/fix that bounded discrepancy, capture failing point sets and attempt a short original-car replay. Historical Porker2 cause is not established; do not close the full ticket solely from this synthetic fix.

Partial reviewed correction: retry collinearity now uses storedFloat32 geometry, matching the primary constructor. Bit-identical synthetic geometry no longer diverges; no epsilon/response/deformation changes. Two regressions plus36geometry/8noncar tests pass, preserving59originalstockhulls and native bentEagle topology. Bounded32originalPorker damage inputs and isolated3case/max3tick Chromium split/repair regression pass with no errors. Historical contact-driven Porker horizon failure not reproduced; ticket remains open awaiting exact failing points. Evidence docs/native-hull-re.md; ignored capture report tool included.

2026-10-26: Reproduced and traced a six-point full-volume open horizon beyond exact-collinear retry. Implemented final-failure-only actual-Float32-point QuickHull recovery, machine-coplanar facet merging, authored-ID mapping, strict containment/rank/closed-topology checks and a recovery marker for captures. Also detect a horizon left open by the final insertion. All 59 original stock hulls and the measured bent-Eagle path still require native-primary construction. Nine new contract tests pass; 36 cumulative original Porker2/Eagle/Buggy physical impacts and repair pass in 1.09s. Chrome DevTools MCP verified recovery plus keyboard driving and six original Porker2/rival collisions using AMD/radeonsi at 2063x1426, no console or GL errors. Historical exact Porker2 chronology remains unavailable and is not claimed reproduced; the demonstrated hull-failure class is handled. Evidence: docs/native-hull-re.md; ignored capture tools/report retain exact runtime points when recovery or failure occurs.

Final three-case original Porker2 Chromium split/repair regression also passes: grounded, airborne, new-wall, attachments and split masses/moments. This separate bounded harness uses SwiftShader correctness rendering, not a GPU performance measurement.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Recovered undefined near-coplanar hull topology from the actual deformed points while preserving the native successful path. Added closed-surface, volume, feature/containment, CCD and repair regressions plus bounded original-contact diagnostics. Build passes. Full suite non-server tests pass; the six sandbox port-related failures pass in the separate eight-test server-startup run with localhost access. Historical Porker2 sequence is unavailable, explicitly documented rather than claimed replayed.
<!-- SECTION:FINAL_SUMMARY:END -->
