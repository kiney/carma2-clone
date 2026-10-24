---
id: TASK-115
title: >-
  [P1] PHY-18: Prevent runaway world-prop motion from destabilizing physics and
  stalling simulation
status: next
assignee: []
created_date: '2026-10-24 14:08'
labels:
  - priority-1
  - PHY-18
  - physics
  - performance
  - regression
dependencies: []
references:
  - docs/timber-runaway-props.md
priority: high
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Live Stock Timber at 103bdad produced a 9.2-second physics tick and 16-second catch-up update, then persistent approximately 2 FPS. Only 34 bodies, but several free noncars had extreme finite motion: actor &33p0036 at omega 897550 rad/s and speed33338 world units/s far outside the track. Captured body copies isolate approximately93ms of empty-world guarding across four props and1024 unsuccessful queries. The initiating energy injection and original longest spike remain unresolved; do not conflate this continuing cost with a full causal profile. Live scene preserved paused and original-derived captures ignored. See evidence note for exact data and limits.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reproduce and attribute the first excessive energy or impulse increase using original prop mechanics, numerical diagnostics and a bounded contact/integration scenario.
- [ ] #2 Correct the demonstrated instability without suppressing ordinary strong crashes, spinning props, damage or original mass/inertia differences.
- [ ] #3 Avoid expensive complete-trajectory world checks when the motion is demonstrably clear, including off-world props, while retaining in-world obstacles and re-entry checks.
- [ ] #4 Validate numerical stability and bounded work in the captured-copy scenario, relevant crash regressions and visible Chromium; distinguish first-spike cause from subsequent catch-up amplification.
<!-- AC:END -->
