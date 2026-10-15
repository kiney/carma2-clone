---
id: TASK-110
title: >-
  [P1] PHY-16: Resolve coupled car stalls triggered by shallow loose-bodywork
  contact
status: done
assignee: []
created_date: '2026-10-14 00:17'
updated_date: '2026-10-15 17:57'
labels:
  - priority-1
  - PHY-16
  - physics
  - guard
  - captured
dependencies: []
references:
  - docs/shallow-contact-recovery.md
  - tests/browser-shallow-contact.mjs
priority: high
ordinal: 1250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User paused a partially interlocked Timber pile after PERF-18 (df4076b, elapsed 28.88 s). Capture saved locally under ignored artifacts/perf18-user-interlock.json. Player Eagle is active, not knackered or asleep, with one load-bearing wheel; all seven rendered car roots match committed physics positions. Ten physical bodies include the loose Eagle front bumper (ID 7), Mach13 (3), Porker2 (6) and Mach13's hinged door (8, parent 3). The directly obstructed pair is Mach13/bumper: committed SAT penetration 0.000389350918 model units (about 2.69 mm), native recovery overlap true, but both overlapRecovery flags false. Fresh collection emits an ordinary type-5 contact, so the PHY-13 prior-recovery admission does not apply. The current next-40-ms guard probe caps IDs 0/3/6/7/8 at 0.00001537323 through two dependency merges/four revalidations. Player/Porker committed hull penetration is zero; zeroing player angular velocity does not remove the cap. One native contact/hinge response with real accepted impulses and deferred friction still caps the five bodies at 0.000014568897. Removing only the loose bumper on fresh clones restores all remaining fractions to 1 while retaining the hinged door. This is a captured new shallow-contact/coupling variant related to completed PHY-12 and PHY-13, not evidence that their bounded completed cases regressed. PHY-14 immediate-parent suppression and unconfirmed PHY-15 perceived delayed debris contact remain separate. Engine and live paused state were not changed. The cloned kernel omits world, vehicle forces, full local retries, damage/effects and prior-tick reconstruction; it does not record the actual preceding live commitment fraction or prove permanent inability to drive out. Diagnostic CPU times are not hardware FPS measurements. Investigate native ongoing type-5 versus recovery admission and guard coupling before choosing the fix. Preserve physical released debris, genuine impacts, existing deep-overlap release and third-body/world collision behavior; do not fix this by arbitrary damping, ownership immunity or merely changing the render mesh.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Retain the ignored captured pose and reproduce the shallow-contact near-zero guard fraction, impulse-response persistence and bumper-removal control without modifying original assets or the user paused game.
- [x] #2 Confirm the causal path in the full original-car/world/force/local-response integration and compare native C2 ongoing contact/recovery behavior before changing guard admission or dependency coupling.
- [x] #3 Allow practical movement/release from this shallow debris pile while preserving meaningful debris impulses, physical attachments, deep-overlap release, world support and new third-body collision checks; add numerical regressions and Stock/Advanced Chromium playtests.
- [x] #4 Provide a separately reviewed checkpoint and focused user playtest; record source evidence, intentional policy changes and any remaining approximations.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Diagnosed with read-only HW disassembly and full production original-Timber reconstruction. Prior flag0x100 selects recovery vs ordinary CCD; it is not movement permission. Ordinary old-inside handling at0x4284e4..428512 and native 40ms reintegration impose no monotone SAT veto. Removed only extra guard prior-flag prerequisite; geometric qualification, per-hull scope, new-entry/world/mask/joint/revalidation checks retained. Full-world three-step baseline player displacement1.886e-6; fixed with physical bumper retained0.06545749, matching bumper-removal control. Positive type5 impulses, door/prop anchors and repair ownership remain. Portable regressions and optional private captured fixture added. Historical guard oracle frozen; intentional divergences explicit. Independent Sol review found no blockers. Build and2948 tests pass; Chromium captured forward/reverse/control, Eagle/Cerby old-overlap+reentry+repair, Stock/Advanced four-car crash matrix and grids/pair escape pass; screenshots inspected, no runtime/network/WebGL errors. DevTools MCP unavailable; reproducible Chromium SwiftShader1280x800 used for correctness, not hardware FPS. Full evidence, reconstruction limits and playtest focus in docs/shallow-contact-recovery.md.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed the reproduced PHY-16 flagless shallow-debris movement veto without changing native collision impulses or dependency orchestration. Original full-world before/after and bumper-removal control confirm cause and release. Reviewed source/test checkpoint; playtest damaged piles, reverse escape without repair, renewed contact and repair/recovery. Other interlock/performance tickets remain separate.
<!-- SECTION:FINAL_SUMMARY:END -->
