---
id: TASK-100.9
title: '[P1] PERF-14: Reconstruct hierarchy-aware native joint candidate movement'
status: done
assignee: []
created_date: '2026-10-13 11:29'
updated_date: '2026-10-13 12:38'
labels:
  - priority-1
  - PERF-14
  - performance
  - physics
  - joints
dependencies: []
references:
  - src/physics/simulation.ts
  - src/physics/rigid-path.ts
  - src/physics/joint.ts
  - docs/c2-physics-re.md
  - docs/c2-flap-frame-re.md
parent_task_id: TASK-100
priority: high
ordinal: 1190
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verified structural mismatch: installed HW MoveJointedObject 0x4b8c80 / child mover 0x4b8fd0 predicts the parent before its children. Ordinary ball/universal children rotate and align their joint anchors to the candidate ancestor at 0x4b9298-0x4b9317; hinge/quick-hinge prediction inherits parent finite rotation with relative-axis movement. The browser candidate() and pose-path factory independently integrate each body and only project joint positions after guarded commitment. Velocity constraints do not preserve finite-step anchor coincidence.

A clone-only 40 ms probe of the saved Cerby state, including ordinary joint-velocity preparation, produces candidate anchor gaps of about 18.25 cm at the front bumper and 5.94 cm at the rear-right wing. An anchor-aligned shadow improves one blocked pair fraction but remains near zero: this is a verified prediction discrepancy, not a proven standalone FPS/lockup cure.

Implement consistent native-informed hierarchical candidate and committed movement, including the collision paths used before and after impulses. Cover relevant hinge, ball, universal, world-translation and inherited-motion distinctions as supported by actual original data. Keep general overlap/guard redesign in PHY-13 and retry scheduling in PERF-15. Preserve the completed PHY-04 timing/rotation baseline as evidence, not as a substitute for hierarchy conformance.

The user explicitly authorizes substantial, reversible physics and rendering redesign to reach genuinely playable performance. Existing browser-added guard algorithms, their sampling/iteration caps and bitwise equivalence to a flawed browser orchestration are not immutable requirements. Judge changed behavior against C2 evidence and focused gameplay regressions. Use a separate reviewed Git checkpoint per ticket and provide a short user-playtest focus before the next risky change. Record intentional deviations and measured costs; do not require an exhaustive safety proof before trying an evidence-backed redesign. Keep original assets read-only, use short serial captures on the shared workstation, and reserve Web Workers as a last resort.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Document installed native dispatch, anchor placement, ancestor selection and angular inheritance; distinguish verified ordinary paths from unresolved flags or exceptional joints.
- [x] #2 Collision candidates, path probes and commitment use coherent parent-first hierarchy movement; ordinary ball anchors remain coincident within numerical tolerance instead of following independent child translations.
- [x] #3 Add numerical conformance for finite parent/child rotation, nonzero COM, chained parts, relevant hinge/world-joint cases and detach/repair transitions using original-data cars or redistributable synthetic inputs.
- [x] #4 Run focused crash/deformation/repair regressions and Chromium driving with attached and released parts; inspect world contacts, console and WebGL. Document intentional changes from the previous browser baseline.
- [x] #5 Provide bounded before/after anchor-error, contact/pass/guard-work and tick-cost evidence, with a Git checkpoint and a concise damaged-car user-playtest focus; do not claim that the anchor correction alone resolves PERF-13.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented captured parent-first hierarchy motion from installed HW evidence for free, ball/universal, hinge/quick-hinge and type5 translation paths. World/body probes and final commitment use the same captured poses and shared physical-tree temporal caps; ancestor/joint cache inputs are tracked. Removed the late projection and second projection guard. Disabled smashed NONCAR joint roster matches body eligibility. Unmapped flag0x400 cached-affine/ancestor variants and upward WORLD-joint corrections are explicitly documented, not claimed as full C2 parity.

Validation: full npm test passed 2,755; the subsequently added disabled-roster regression passed with all 5 NONCAR tests. Final production build, formatting and Chromium crash matrix pass (Stock Eagle/Buggy/Bigdump, Advanced 69mach1, Porker2 split, Eagle queued jointed parts and repair); no fatal console, failed-request or WebGL errors. Chrome DevTools MCP on AMD/Radeon drove a positioned Timber collision; deformation/component damage observed. Original Eagle front/rear due-reservation fixture ran production detachment + 6 ticks: 12 joint-anchor observations, peak error 0; full repair removed both owned pieces.

Clone-only prepared Cerby 40 ms anchor errors change 18.247 / 0.525 / 5.940 cm to 0. Short serial hardware CPU comparisons preserve equal initial fixture but intentionally change final state/fractions. Baseline tick medians 37.9 / 41.1 ms, final 31.3 / 29.1 ms; final maxima 123.2 / 69.9 ms remain adverse evidence. Eight correction rounds remain; world hull transforms 345→410. Rejected intermediate momentum-bound world sampling performed 1,085 transforms; separate actual-rate ancestor heuristic avoids that regression. Not a rendered-FPS or captured-user-route cure. See docs/hierarchy-motion-performance.md and ignored artifacts/perf14-validation.json.

Reviewed checkpoint and user playtest focus: crashes with hanging bodywork, walls, rollovers and repeated repair; watch for new snaps, lockups or tunnelling before the next risky PHY-13 change. Original data untouched.
<!-- SECTION:NOTES:END -->
