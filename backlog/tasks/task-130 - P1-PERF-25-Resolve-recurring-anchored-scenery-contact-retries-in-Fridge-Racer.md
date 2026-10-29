---
id: TASK-130
title: >-
  [P1] PERF-25: Resolve recurring anchored-scenery contact retries in Fridge
  Racer
status: next
assignee: []
created_date: '2026-10-29 15:15'
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
- [ ] #1 Build a small deterministic reproduction of anchored scenery and world-contact response using procedural geometry or optional read-only original data; write and freeze meaningful failing regressions before engine edits.
- [ ] #2 Diagnose repeated contact generation, joint/rest RHS, candidate/committed movement and quiet-state gates against C2 evidence; fix the causal invariant rather than lowering global retry limits or forcing sleep.
- [ ] #3 Eliminate repeated futile response work for settled attached scenery while retaining real impacts, tipping, snapping, world collision and wake behavior across multiple props.
- [ ] #4 Verify unchanged crash/repair/part regressions and one short real-GPU capture; separate physics CPU from independent browser RAF delivery and profiling overhead.
<!-- AC:END -->
