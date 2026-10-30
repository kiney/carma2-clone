---
id: TASK-139
title: '[P1] PED-13: Complete panic animation exit into fleeing for native pedestrians'
status: done
assignee: []
created_date: '2026-10-30 20:41'
updated_date: '2026-10-30 20:58'
labels:
  - priority-1
  - PED-13
  - topic-pedestrians
  - bug
dependencies: []
priority: high
ordinal: 1002
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Live Stock TIMBER report: living pedestrians stand in front of the player waving their arms instead of fleeing. Two nearby characters (climber/lumber1, HP100, distances0.79/1.32 model units) remain in action2/Panicking and move2 across a2.2-second observed continuation. Both report nonordinary-completion-dispatch-provider. The fear gesture itself is legitimate; the current native gameplay completion adapter only implements recovery/death branches and marks ordinary fear completion unsupported. The legacy pedestrian path already transitions scared/pleading moves2..6/10/11/13 into running41, reversing direction except13, but ordinary native ownership bypasses that path.

Implement the missing completion behavior at the current native gameplay/animation owner, including direction, running speed ramp, current cache ownership and queued/replaced move semantics. Consult docs/c2-pedestrians-re.md and installed CBMoveCompleted4cbcc0; do not introduce a second elapsed-time timer or reroute native-owned pedestrians through the legacy loop. User permits modern pedestrian algorithms, but the already documented callback is a direct starting point. Keep the present live scene intact during implementation. No engine changes were made during this diagnostic.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Regression first reproduces panic completion failing to select fleeing; fixed implementation advances the actual BON completion callback into coherent running state.
- [x] #2 Living nearby pedestrians visibly flee after their reaction animation; move13 direction exception and missing-leg/available-move substitutions remain coherent.
- [x] #3 No duplicate animation completion, turn, RNG draw or physical activation; original-asset Chromium tests and existing recovery/death regressions pass.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented positive BON completion at its existing owner, not a timer. Verified HW/SW: fear2..6/10/11 -> direction reversal unless suicidal, then run41;13 -> run40 without reversal. Cached100/.09 only with cache and no missing legs; normal planner handles50/51 substitutions and queue state. No fear RNG, blind/Valium gate or running timestamp write. All19 new actual BON regressions were red before engine changes and pass unchanged afterward. Full suite3779 pass/6 optional skip/0 failures; asset-free CI3277 pass/439 skip/0 failures; build and original StockTimber/AdvancedNewcity1 browser2/2 pass. Hardware DevTools preserved user scene: five fear callbacks enter41, nearest climber actually runs,91 game updates and no new errors/GL errors. Existing stale fear completion bits were rearmed once only to migrate the already-broken live state, not as recurring engine behavior. Native retained sound-handle stop remains a documented one-shot-audio boundary.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed the panic animation dead end through the actual native completion and movement owners. Flee direction, run selection, cached acceleration and limb substitutions are covered; original assets and vehicle physics remain unchanged. Existing user scene is repaired without reload. See docs/ped13-panic-completion.md.
<!-- SECTION:FINAL_SUMMARY:END -->
