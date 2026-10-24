---
id: TASK-111
title: '[P1] PHY-17: Diagnose a stationary split secondary after grounded Porker2 SPAM'
status: done
assignee: []
created_date: '2026-10-15 18:55'
updated_date: '2026-10-24 13:52'
labels:
  - priority-1
  - PHY-17
  - physics
  - damage
  - regression
dependencies: []
references:
  - docs/world-contact-spikes.md
  - docs/grounded-split-recovery.md
priority: high
ordinal: 1270
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The extended original Porker2 crash-matrix scenario produces a split secondary with nonzero initial velocity but exactly unchanged position over its subsequent simulation window. Reproduced on unmodified checkpoint 1f33742 as well as the PERF-19 branch, so it predates the world-contact optimization. Baseline secondaryMoved=false, secondaryFinite=true, massConserved=true; initial and final position [54.061,-0.824753999710083,23.629], initial velocity approximately [1.52548,2.82363,-0.602638]. Core four-car crash cases complete with clean console/network. This is not evidence of a general regression in split startup: PERF-17 validated the separate airborne three-tick case. Distinguish quiet/PHIL admission, existing overlap and guard response for this grounded accumulated-damage SPAM case. Private evidence: artifacts/perf19-baseline-crash-failure.json and perf19-baseline-crash-summary.json. Reduce the old prolonged search to a bounded deterministic fixture before iterating; do not repeatedly run its 180/240-step loops on the shared workstation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Extract a bounded original-data reproduction and attribute the stationary state to the responsible admission, quiet, collision or guard path.
- [x] #2 Implement the evidence-backed correction without adding an arbitrary velocity nudge or globally disabling sleeping/guards.
- [x] #3 Validate grounded and airborne split secondaries, mass/moments, detached attachments and repair in numerical tests and Chromium.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-24: User selected implementation together with PERF-23. A bounded read-only investigation runs alongside renderer work; root will integrate and validate the physics correction after the PERF-23 checkpoint. WIP count remains three including PERF-01.

2026-10-24: Reduced to eight original Porker2 component impacts, real WAM parts 6/7, ten SPAM rays and one production tick. PHIL and quiet admission are correct; a separating old support-plane row incorrectly returned zero browser world-guard commitment. Corrected only moving-hull feature admission using a per-sample common-halfspace certificate. Nearby faces, overlap recovery, native response and inverse-frame world vertices remain live; independent review caught and added the rotating-vertex counterexample. Full 3119 tests/build and four-car production crash core passed. Chromium original-data grounded/airborne/new-wall fixture passed with attachments, moments, mass and repair; headed DevTools AMD inspection independently confirmed motion and repair with clean GL/console. Historical complete damaged orientation is unavailable; documented controlled reproduction limits. PERF-23 separately checkpointed as 78175d9; PERF-01 umbrella remains open.
<!-- SECTION:NOTES:END -->
