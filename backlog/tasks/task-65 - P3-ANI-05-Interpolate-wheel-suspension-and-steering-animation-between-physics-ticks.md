---
id: TASK-65
title: >-
  [P3] ANI-05: Interpolate wheel suspension and steering animation between
  physics ticks
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-24 19:20'
labels:
  - priority-3
  - ANI-05
  - animation
dependencies: []
references:
  - src/main.ts
  - src/render-pose.ts
priority: medium
ordinal: 3064
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **ANI-05**
Numeric priority: **3** (1 is highest)
Original status: **Partial**
Category: **Animation, Rendering, and Audio**

## Scope and evidence

Interpolate wheel suspension and steering pose as needed as well. Body/part poses are smoothed, but `wheelLengths` and `curvature` still come directly from the physics tick for animation.

## Source references

[main.ts](../../src/main.ts), [render-pose.ts](../../src/render-pose.ts)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Offline-suitable implementation: add browser presentation interpolation for native suspension lengths and steering curvature, using existing GROOVE matrix equations. Capture controls at committed physics tick boundaries/pose epochs, evaluate temporary render matrices, and restore them exactly after drawing. Do not advance animation clocks/spin or write physics-facing wheelDamageOffsets. Validate original Eagle/Buggy bindings and matrix/state invariants with numerical tests and one bounded headless runtime check; no real-display smoothness claim.

Implemented scalar control history captured beside body poses before each actual physics tick, invalidated on recovery pose epoch and progressive/full repair revision. Player and rivals use sampled lengths/curvature only during drawing; native GROOVE equations are shared with ordinary update, and exact committed local transforms are restored in finally. Animation clock/spin, component damage and physics-facing wheelDamageOffsets remain unchanged. Reused pose snapshots avoid per-RAF snapshot allocation. Ten new history/presentation tests plus existing animation/motion/GROOVE checks pass; original Eagle/Buggy 80-update/480-matrix baseline comparison is bit-identical for ordinary output. Full original-install suite: 3246 passed. Production/headless actual-key Eagle drive at1024x720 SwiftShader verified 114 sampled calls, 684 exact restores, temporary matrices at draw, real0.84-unit movement and paused clock unchanged; no console/request/GL errors. Existing Buggy shear-link modes remain ANI-02 scope; physical-display smoothness is not claimed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wheel suspension and steering now interpolate at the same physics fraction as body poses, entirely within a reversible drawing pass. Source motion, damage, animation clocks and collisions retain committed values. Tests and evidence: docs/c2-wheel-presentation.md; npm run test:wheel-presentation.
<!-- SECTION:FINAL_SUMMARY:END -->
