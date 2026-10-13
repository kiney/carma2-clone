---
id: TASK-100.10
title: >-
  [P1] PERF-15: Replace global correction rounds with change-local C2 collision
  orchestration
status: done
assignee: []
created_date: '2026-10-13 11:29'
updated_date: '2026-10-13 15:38'
labels:
  - priority-1
  - PERF-15
  - performance
  - physics
  - collision
dependencies:
  - TASK-106
references:
  - src/physics/simulation.ts
  - src/physics/contact.ts
  - src/physics/correction-working-set.ts
  - docs/correction-performance.md
  - docs/live-timber-drop.md
  - docs/c2-physics-re.md
parent_task_id: TASK-100
priority: high
ordinal: 1210
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The saved hardware capture executes eight global correction rounds in 474 of 512 ticks. Most heavy ticks dispatch 4,347 world guards across 483 bodies and perform nine body-pair collections. The partial captured replay changes only five Cerby bodies in every round, while real contact and joint impulses remain. Raw-result caches make repeated work cheaper but do not fix global scheduling.

Installed DoCollisions 0x4ba450 uses object/response-ring retries with a 30-retry bound and a conditional list-wide restart. Replace the browser-specific global recollection/solve orchestration with a native-informed, change-local pipeline. A local persistent contact must not automatically schedule every unchanged body through eight rounds. Algorithms and browser-only caps may change; simply reducing simulation time, freezing moving parts or deleting meaningful collision response is not a performance solution.

Own prediction/collection/response/retry scheduling and dependency discovery after impulses, joint updates, shape swaps, detachment, activation and smash changes. Coordinate same-collection admission with PERF-16. Preserve meaningful damage, RNG, finite face-ring and global callback chronology, documenting native-supported ordering changes rather than requiring the old browser sequence verbatim. PERF-12 remains the completed collection-cache baseline; this ticket owns the different scheduling layer.

The user explicitly authorizes substantial, reversible physics and rendering redesign to reach genuinely playable performance. Existing browser-added guard algorithms, their sampling/iteration caps and bitwise equivalence to a flawed browser orchestration are not immutable requirements. Judge changed behavior against C2 evidence and focused gameplay regressions. Use a separate reviewed Git checkpoint per ticket and provide a short user-playtest focus before the next risky change. Record intentional deviations and measured costs; do not require an exhaustive safety proof before trying an evidence-backed redesign. Keep original assets read-only, use short serial captures on the shared workstation, and reserve Web Workers as a last resort.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Map native local retry, response-ring reintegration and conditional traversal restart to the new pipeline; label remaining approximations explicitly.
- [x] #2 Demonstrate on the saved Cerby case and a multi-car pile-up that local persistent contacts avoid repeated full-scene collection; record actual changed-body, contact, retry and world-query work.
- [x] #3 Rediscover affected neighbors and freshly admitted or structurally changed bodies in the appropriate phase; validate meaningful impulses, angular response, damage/crush, detachment and effect ordering.
- [x] #4 Use original Stock/Advanced crash, fast world-impact, split, repair and mixed-object scenarios to test the new behavior, with numerical expectations from native formulas where available rather than forced equality to the old eight-pass pipeline.
- [x] #5 Measure whole-tick/updateFrame CPU and frame-time tails in short serial Chromium captures, retaining backend/buffer metadata and adverse results. Keep the native timebase unless separate evidence establishes a defect.
- [x] #6 Finish with a reviewed checkpoint and a user-playtest focus for collision piles, repeated crashes and tunnel/canyon driving; PERF-13 retains final actual-route performance attribution.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented native-informed stable OLD-X local rings, incident discovery against the complete roster, geometry-before-lambda membership, authored-limit zero-contact admission, bounded local retries and conditional mutation/restart barriers. Shared first50 friction uses saved OLD levers and accepted candidate gyro/orientation after normal commitment, before quiet processing. Removed objects and changed shapes are rediscovered safely; default producer collection epochs avoid unnecessary global input walks. Independent source review completed. See docs/local-response-performance.md and docs/c2-physics-re.md for native addresses, adaptations and costs.

Saved483-body Cerby partial replay: 8→2 response solves; 3864→27 empty-world visitation placeholders; 18 nonzero joint impulses retained; all five selected bodies move with fraction1 and <=5.6e-17 anchor error. This omits world, forces, damage and preceding-frame history; increased bounds work remains explicit. Full original-car and production scenarios cover wall rotation, fresh third-body admission, crush, split, multiple parts, contained Eagle/Cerby movement and repair, and Stock/Advanced Carrier followup mission completion.

Validation: npm test2837/2837; production build; browser smoke, crash matrix, overlap admission and smash followups pass without fatal errors. Hardware DevTools actual keyboard driving and original Timber cave-wall impact produce damage/wastage and gl0; later repair/health MCP calls stalled and are not counted as passes. Independent production repair checks pass. All artifacts and original data remain untracked/read-only.

Whole-tick/updateFrame timings are mixed, not a steady-FPS claim. Stock whole40ms update58.3→41.6ms and sampled update-tail347.3→208.6ms, but second manual tick65.9→182.2ms. Advanced whole40ms update61.4→76.4ms and sampled update-tail151.7→335.2ms regress; retain those results. First-heavy dispatches4320→590 Stock/4356→598 Advanced, while local collections still scan the full inactive roster and actual solves can exceed the old arbitrary eight rounds. PERF-16 next owns static/admitted participation; PERF-01/PERF-13 retain whole-route tails. Native normal-solver failure status, exceptional metadata and eager-closure/CCD differences remain documented.

Checkpoint/playtest focus: pile-ups, repeated impacts, detached/hinged pieces, repair, tunnel exits and Timber canyons. Validate handling before starting PERF-16. The broader Goal remains paused.
<!-- SECTION:NOTES:END -->
