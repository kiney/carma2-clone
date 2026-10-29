---
id: TASK-116
title: >-
  [P1] PHY-19: Trace the first excessive-energy impulse in original world-prop
  crashes
status: done
assignee: []
created_date: '2026-10-24 14:42'
updated_date: '2026-10-29 14:09'
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
- [x] #4 Complete the user-authorized bounded investigation, retain confirmed and uncertain findings, and explicitly record acceptance rather than claiming a demonstrated cause fix.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-24 14:54 UTC: User requested an approximately fifteen-minute causal investigation. If no concrete hot lead emerges, close with known facts and accept occasional explosions protected by PHY-18. No speculative global damping/solver rewrite.

2026-10-24: Bounded audit started14:54UTC and closed within approximately15minutes per user instruction. Eight original-inertia prescribed contact solves expose biased near-dependent-row amplification (speed4047,omega89084), but nine actual guard-geometry cases did not reproduce an explosion. Original HW dependence-removal, single-row gate and residual-correction safeguards were verified statically; exact native outcome and historical first contact remain unproven. Wake/release callback invalidation, inertia scaling and basic coupling/Jacobian signs showed no defect. No solver/physics or live scene changes. Original cause-fix criteria remain intentionally unchecked; user-authorized closure accepts the remaining occasional-explosion limitation protected by PHY-18.

2026-10-29 fresh disruptive in-world stall meets the stated reopening condition. PERF-24/TASK-129 (P1 next) owns the newly selected first-event capture, runaway wreck world-query/CCD amplification and coherent car containment. Earliest FAIR is already wrecked but still in-map at speed1371.94 actor units/s and spin14789.63rad/s; real measured ticks up to1448ms and five-tick updates5837ms. FAIR and FRBUMPR.DA dominate slow world-contact collection. The initiating impulse is unrecorded and not proven identical to the earlier prop numerical gap. Keep this accepted bounded investigation history; do not relabel its original cause fixed. See docs/screwie-runaway-car-stall.md.

2026-10-29 stronger follow-up establishes actual source-generated mechanism, beyond the old prescribed-contact counterexample. One procedural box/floor suffices: native and angular packets individually benign, merged packet injects extreme energy; full production tick reproduces. Audited original HW numerical oracle rejects the same packet with bounded partial multipliers and status-1. Native RHS clipping confirmed correct. Native residual correction tail is ineffective on returned output in tested control, superseding the earlier uncertain safeguard interpretation. PERF-24 owns actual contact/numerical repair and runtime acceptance. Details/repro commands: docs/runaway-contact-root-cause.md. Historical first FAIR/Timber impulse remains unproven.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed as investigated / accepted remaining compatibility gap, not fixed. Native numerical safeguard differences and bounded counterexamples are documented in docs/timber-runaway-props.md. No reliable initiating Timber-contact reproduction or small evidence-backed patch emerged. Retain PHY-18 containment; reopen for frequent explosions, disruptive in-world stalls or an available first-event contact packet.
<!-- SECTION:FINAL_SUMMARY:END -->
