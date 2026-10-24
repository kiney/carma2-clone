---
id: TASK-116
title: >-
  [P1] PHY-19: Trace the first excessive-energy impulse in original world-prop
  crashes
status: next
assignee: []
created_date: '2026-10-24 14:42'
labels:
  - priority-1
  - PHY-19
  - physics
  - diagnostics
dependencies: []
references:
  - docs/timber-runaway-props.md
priority: high
ordinal: 110
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PHY-18 contains escaped free props and eliminates their empty-world high-spin guard amplification. The initiating collision that produced roughly897550rad/s and33338world-units/s remains unproven: captured inertia matches original mechanics, and current free forces only apply gravity. Investigate a bounded original-prop collision and retain the first implausible impulse, contact matrix/residual and before/after mass/inertia/velocity; verify solver convergence and native failure semantics before changing crash dynamics. This is separate from already reproduced persistent off-world cost, and is not evidence that PHY-17 caused the event.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Capture or construct a bounded original-mechanics collision exposing the first excessive energy increase, rather than starting from the final runaway state.
- [ ] #2 Attribute the increase to contact/joint solve, force, placement or integration with numerical evidence and original C2 references where available.
- [ ] #3 Implement the demonstrated cause correction with strong-crash, mass/inertia, joint and damage regressions; retain PHY-18 escape containment as a backstop.
<!-- AC:END -->
