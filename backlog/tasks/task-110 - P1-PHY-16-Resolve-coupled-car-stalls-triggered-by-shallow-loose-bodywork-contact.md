---
id: TASK-110
title: >-
  [P1] PHY-16: Resolve coupled car stalls triggered by shallow loose-bodywork
  contact
status: next
assignee: []
created_date: '2026-10-14 00:17'
updated_date: '2026-10-14 00:18'
labels:
  - priority-1
  - PHY-16
  - physics
  - guard
  - captured
dependencies: []
references:
  - src/physics/pair-guard.ts
  - src/physics/simulation.ts
  - docs/old-overlap-recovery.md
  - docs/guard-coupling-fix.md
  - tools/replay-old-overlap.mjs
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
- [ ] #2 Confirm the causal path in the full original-car/world/force/local-response integration and compare native C2 ongoing contact/recovery behavior before changing guard admission or dependency coupling.
- [ ] #3 Allow practical movement/release from this shallow debris pile while preserving meaningful debris impulses, physical attachments, deep-overlap release, world support and new third-body collision checks; add numerical regressions and Stock/Advanced Chromium playtests.
- [ ] #4 Provide a separately reviewed checkpoint and focused user playtest; record source evidence, intentional policy changes and any remaining approximations.
<!-- AC:END -->
