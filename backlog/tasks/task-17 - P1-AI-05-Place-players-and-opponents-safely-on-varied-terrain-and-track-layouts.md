---
id: TASK-17
title: >-
  [P1] AI-05: Place players and opponents safely on varied terrain and track
  layouts
status: done
assignee: []
created_date: '2026-10-11 15:13'
updated_date: '2026-10-26 20:59'
labels:
  - priority-1
  - AI-05
  - opponents
dependencies: []
references:
  - src/physics/spawn.ts
  - src/main.ts
  - tests/browser-spawn-pairs.mjs
priority: high
ordinal: 1010
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **AI-05**
Numeric priority: **1** (1 is highest)
Original status: **Needs validation**
Category: **Opponents and Pedestrians**

## Scope and evidence

Shared safe start placement retains four original wheel anchors, slope rotation, finite ground surfaces, complete hull/terrain and car/prop clearance, nearby free-pose search and accepted-pose prediction/suspension/history initialization. Dense grids retain the failure-only wider search; unsafe starts are never forced.

Opponent loading now stages the complete original roster, animations and resources privately. Final placement uses the current player/props plus already reserved staged bodies after all asset awaits. Atomic PHIL admission publishes the full fleet together. Canceled or failed loads dispose all staged resources; late completions cannot contaminate the next race. Initial AI deadlines use the publication clock, and paused reloads clear the preceding race timestamp.

The held-second-model browser regression fails before the fix because Bugtoo5 enters physics while the remaining Bigdump/DUNE fleet still loads. It passes after the fix with only the player active during loading, then eleven supported undamaged cars including Newhawk. Original DUNE grids with Eagle/Buggy/Bigdump and New City retain zero measured initial road/car penetration. A short active-AI window records actual contacts and wastage rather than requiring invulnerability: a qualifying Newhawk control survives while Cobra is wasted after real Bigdump/Junker impacts. The unavailable historical Newhawk chronology is not claimed replayed or uniquely attributed to startup.

General navigation/stuck behavior remains AI-02/AI-04; source-defined bumpy-road initial suspension history is separately investigated as PHY-20. No crash, traction, crush or damage coefficients were retuned.

## Source references

[src/physics/spawn.ts](../../src/physics/spawn.ts), [src/main.ts](../../src/main.ts), [startup evidence](../../docs/opponent-startup.md), [lifecycle browser regression](../../tests/browser-opponent-startup.mjs), [grid/pair regression](../../tests/browser-spawn-pairs.mjs)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No partial fleet enters physics, rendering or live AI while asset loading is incomplete; player driving remains available.
- [x] #2 Complete original grids are placed against live player/props and reserved source hulls, with supported undamaged initial cars and no forced unsafe pose.
- [x] #3 Failure, cancellation and PHIL admission errors leave no published partial roster or leaked staged animation/model owners, and cannot overwrite a new race.
- [x] #4 Fleet initialization uses the publication clock, preserves the native first update and does not inherit a preceding paused race timestamp.
- [x] #5 Build, numerical startup/placement tests, Stock/Advanced controls/checkpoints, original grid/crash checks and Chrome DevTools validation pass without fatal errors.
<!-- AC:END -->



## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Queue review 2026-10-26 — position 2/5, P1.
Follow PHY-11 for a more stable crash-test baseline; this is a recommended order, not a hard dependency. Initial placement already consumes valid original hulls and does not require the unresolved deformed-hull case. Reproduce the exact Bigdump/Newhawk roster with seed and initial poses, separating unsafe spawn from subsequent AI collisions. AI-01/AI-02/AI-04 are related only if the reproduced cause belongs to objectives, navigation or recovery; completing those whole tickets is not a prerequisite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Read-only capture audit (2026-10-24): the retained October 15 Bigdump/Dune capture is a passing eleven-car roster without Newhawk. Newhawk appears only in a separate passing Newcity/Eagle3 grid. Initial poses are retained, but no qualifying failed Bigdump/Newhawk roster or RNG state exists. Those passes cannot establish resolution of the reported early active-AI waste, especially after later physics changes. Keep open: a new deterministic qualifying reproduction must record fleet, seed and poses, separating safe initial placement from subsequent AI crash behavior.

2026-10-26 diagnosis: qualified original DUNE/Bigdump/Newhawk runtime begins with eleven supported undamaged cars. Newhawk survives one four-second control; Cobra is later wasted after documented real Bigdump/Junker collisions. A deterministic held-second-model fixture instead reproduces the browser startup defect: the old simulation admits Bugtoo5 before the rest of the fleet is loaded. Implementation under validation stages all cars/resources, fits final poses against live player/props, atomically admits PHIL bodies, initializes fleet deadlines at publication time and disposes canceled/failed staged resources. New tests separately validate complete population versus failed load, and no longer demand immunity to legitimate later AI crashes. Initial bumpy-road suspension history is a distinct modest discrepancy tracked as P3 PHY-20, not claimed causal.

Final validation 2026-10-26: baseline delayed-load regression fails with a physical partial fleet; candidate passes complete seeded Bigdump/Newhawk roster, responsive player, injected middle-model failure, stale-load disposal/cancellation and paused reload clock reset. Full isolated suite: 3285 pass, 5 optional ignored-capture skips; retained-capture group subsequently 23/23 pass. Four production grids (11/11/11/6 cars), frontal/oblique release and full Stock/Advanced browser smoke (16 original gate crossings to race completion) pass without console/asset/GL errors. GPU MCP independently confirms held-model boundary and complete supported undamaged publication using AMD/radeonsi at 2066x1429. General smoke phases are now independent and render sampling is bounded; it no longer carries an incidentally wasted car into checkpoint testing. Original exact Newhawk chronology remains unavailable; no artificial early-race damage immunity was added.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed browser partial-population physics by staging and atomically publishing the complete safely placed fleet. Added rollback/cancellation/resource cleanup, publication-time AI initialization and race clock reset. Numerical, production grid/crash, lifecycle and Stock/Advanced smoke checks pass; GPU Chromium inspected with DevTools. Separate P3 PHY-20 records the unproven bumpy-road startup-history discrepancy.
<!-- SECTION:FINAL_SUMMARY:END -->
