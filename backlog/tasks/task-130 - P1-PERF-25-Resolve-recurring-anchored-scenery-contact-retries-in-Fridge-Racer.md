---
id: TASK-130
title: >-
  [P1] PERF-25: Resolve recurring anchored-scenery contact retries in Fridge
  Racer
status: done
assignee: []
created_date: '2026-10-29 15:15'
updated_date: '2026-10-29 16:32'
labels:
  - priority-1
  - PERF-25
  - physics
  - performance
  - noncars
dependencies: []
references:
  - docs/fridge-racer-frame-time.md
priority: high
ordinal: 1135
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Live original Advanced Fridge Racer on bb61b30 remains CPU limited without runaway motion. Running captures measure21.4 and34.3FPS, physics mean30.8 and25.8ms per40ms tick, GPU0.8-0.9ms/frame. Two attached cone actors &44C0112 and &44C0126 consume30 positive contact/joint responses each per tick:300 of341 solves across five ticks. Each block mostly contains2 world rows plus3 ball-joint rows. Linear speed is approximately1e-8 to3e-7 actor units/s, spin approximately0.48/0.51rad/s, committed poses remain nearly fixed and native quiet eligibility rejects angular energy. No huge collision matrices or runaway velocities are needed. This is distinct from separately reproduced paused Chromium RAF throttling and from PERF-24 extreme-energy injection. Preserve original scene; original-derived state/hulls/one-face geometry captured only in ignored artifacts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Build a small deterministic reproduction of anchored scenery and world-contact response using procedural geometry or optional read-only original data; write and freeze meaningful failing regressions before engine edits.
- [x] #2 Diagnose repeated contact generation, joint/rest RHS, candidate/committed movement and quiet-state gates against C2 evidence; fix the causal invariant rather than lowering global retry limits or forcing sleep.
- [x] #3 Eliminate repeated futile response work for settled attached scenery while retaining real impacts, tipping, snapping, world collision and wake behavior across multiple props.
- [x] #4 Verify unchanged crash/repair/part regressions and one short real-GPU capture; separate physics CPU from independent browser RAF delivery and profiling overhead.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
User selected deeper physics investigation; browser focus cadence is treated separately as a possible workstation/window-manager effect. Preserve live Fridge Racer tab9 on5457. Reduce captured cone state, compare contact/joint/rest/candidate/commit/native quiet semantics, and freeze meaningful failing regressions before any engine correction. No retry-cap reductions or forced-sleep workaround.

Implemented native-qualified OLD finite-face phase admission for authentic fixed WORLD NONCAR ball joints. Fresh faces, sibling hulls, free/released bodies and movable/unsupported joint modes remain guarded. Working-set token includes native producer result identity and release metadata. Frozen replacement red checkpoint fc9ddbe: 6 pass/8 fail on unchanged engine, now 14/14 with identical assertion/fixture/runner hashes. Original Fridge Racer cone replay: 2400 responses over40ticks baseline versus318 fixed; both later release and settle without forced sleep. Tick CPU median48.65ms versus9.60ms in this bounded replay; normal graphical hardware run39ticks median12ms/p9536.8ms, no cone responses. Original car-car impacts, deformation, engine damage56 and normal repair verified. Build and focused cache/PERF24 regressions pass. Full candidate suite3448 pass,5 skip,1 unrelated intermittent HMR shutdown timeout; focused server suite8/8 passes with socket access. Original user tab preserved. Further source load/snap chronology questions are separate PHY-24.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed the captured anchored-cone nonprogress cycle at its browser guard/native contact boundary; no coefficient, retry-limit or sleep-threshold changes. See docs/perf25-world-joint-phase.md for frozen TDD history, original binary evidence, real-scene comparison and limitations.
<!-- SECTION:FINAL_SUMMARY:END -->
