---
id: TASK-129
title: >-
  [P1] PERF-24: Eliminate world-query and CCD amplification from finite runaway
  wreck motion
status: next
assignee: []
created_date: '2026-10-29 13:27'
labels:
  - priority-1
  - PERF-24
  - performance
  - physics
  - runaway
dependencies: []
references:
  - docs/screwie-runaway-car-stall.md
  - docs/timber-runaway-props.md
  - docs/c2-world-face-cache-re.md
priority: high
ordinal: 1130
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fresh original Desert1 live playtest on72f263d/index-mpUUxKme: user reports FPS collapse when rammed by Screwie. This episode is measured engine CPU saturation, distinct from the earlier browser RAF-delivery stall. A fixed40ms physics tick takes up to1448ms, five-tick updates up to5837ms. Earliest FAIR wreck still in-map has v[547.9355,1063.4322,671.6401] actor units/s and omega[1220.7705,-12348.1791,8047.6924]rad/s (speed1371.94 units/s /34079kmh, spin14789.63rad/s). Slow contact collector rows identify FAIR and FRBUMPR.DA almost exclusively, each saturating300 faces; collection dominates their contact CPU and angular world guarding dominates the worst tick. Later FAIR is far outside map with normal hull radius0.481 and unit quaternion; timing returns near10-34ms/tick. Existing PHY-18 containment intentionally excludes whole cars, and native wreck/freewheel objectives skip fallen recovery. The initiating energy injection and exact first oversized world query are not recorded; do not attribute them to Screwie or change solver coefficients speculatively. Preserve native predictive-query callbacks/order and real contact coverage. Investigate actual query bounds, extreme-motion trajectory work, whole-wreck lifecycle/backstop and first-energy-jump phase. No magic upper-Y jump cutoff or arbitrary velocity cap without evidence. See docs/screwie-runaway-car-stall.md. PHY-19 accepted numerical gap explicitly allows reopening for disruptive in-world stalls; distinguish its unproven initiating cause from this proven workload amplification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Retain a reload-safe opt-in bounded capture of first extreme-motion transition, actual query bounds, body/part ownership, tick/contact/guard costs and accepted/rejected solver rows without materially perturbing normal play.
- [ ] #2 Reproduce or isolate the original FAIR/bumper extreme-motion workload and eliminate multi-second frame amplification while preserving ordinary crashes, source callbacks and collision coverage.
- [ ] #3 Define and validate coherent escaped wreck/hierarchy handling without breaking opponent counts, race completion, repair, legitimate high jumps or player recovery; label any browser adaptation.
- [ ] #4 Validate Stock/Advanced normal and damaged car-car/world/part scenarios plus a short real Chromium capture, separating hardware FPS, diagnostic overhead and unresolved initiating impulse.
<!-- AC:END -->
