---
id: TASK-129
title: >-
  [P3] PERF-24: Eliminate world-query and CCD amplification from finite runaway
  wreck motion
status: backlog
assignee: []
created_date: '2026-10-29 13:27'
updated_date: '2026-10-30 22:00'
labels:
  - PERF-24
  - performance
  - physics
  - runaway
  - priority-3
  - topic-physics
dependencies: []
references:
  - docs/screwie-runaway-car-stall.md
  - docs/timber-runaway-props.md
  - docs/c2-world-face-cache-re.md
priority: medium
ordinal: 3103
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
- [x] #4 Validate Stock/Advanced normal and damaged car-car/world/part scenarios plus a short real Chromium capture, separating hardware FPS, diagnostic overhead and unresolved initiating impulse.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Keep the redistributable single-plane controls and native oracle as independent numerical/contact fixtures. 2. Reconstruct native RQ dependence selection, protected bilateral prefix and failure/report semantics; preserve verified original RHS and ordinary handling. 3. Repair temporal coherence of native/angular contact admission without losing valid floor/wall corner constraints or anti-tunneling coverage. 4. Establish first-event all-owner capture and bound pathological trajectory/query amplification; escaped-wreck cleanup remains a backstop. 5. Validate real Stock/Advanced crashes, joints, crush/damage, detached parts, repair and short hardware Chromium captures. Do not mark complete from the research reproduction alone.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-29 user selected fundamental causal investigation and explicitly authorized Astra escalation. Root owns integration/query workload; Astra independently analyzes energy injection and real contact generation, Sol verifies original HW RQ solver/contact RHS, Luna audits alternate force/integration producers. Preserve paused live scene and use short serial numerical experiments. No production behavior change selected before evidence.

2026-10-29 fundamental investigation complete (root+independent Astra+original-binary Sol audit). Redistributable procedural box against one nearly horizontal finite triangle reproduces source-generated contradiction: native chord row opens while angular guard row closes with opposing near-dependent OLD Jacobians. Native-only and guard-only packets stay benign, merged packet energy0.337728->1429039.106 with multipliers~1.617e10 and active physical residual~-0.535. Full production40ms tick also reproduces first accepted jump and thirteen response rounds; no prescribed impulses, original assets, friction or damage needed. Native unsigned/clipped packet RHS is verified, so changing it would be a behavioral deviation. New optional bounded oracle executes audited HW normal routine4c3900 only: same merged K/b returns[.0003020222,0],status-1 after25dependence removals/51loops; eight analytical controls plus native/rest and guard packet controls validate ABI and ordinary parity. The residual-correction tail demonstrably changes scratch without updating returned outputs in tested control; do not rely on it. Own repro/native-oracle tools and precise evidence docs/runaway-contact-root-cause.md added. Actual FAIR first impulse still unrecorded, and native dependence handling is not a universal energy cap. No production physics changed. Return to next after selected understanding stage; implementation acceptance remains open.

User explicitly selected test-driven correction: write reviewed meaningful failing regressions first, checkpoint red tests and freeze their bytes, then change engine without editing those tests. Work in isolated /tmp/carma-perf24-tdd to preserve live production tab. Root owns acceptance/integration, independent worker owns test authoring, native-solver worker read-only until red checkpoint.

TDD correction implemented against immutable red checkpoint f76c807: 14 reviewed procedural regressions, initial 10 pass/4 expected failures, now 14/14 pass with identical test/fixture/runner hashes. Chronological local sampled admission replaces conflicting full-chord events and retains full encounter witnesses before row reduction. Independent Givens RQ normal solve uses verified native dependence/failure semantics, no compliance or speed/energy caps; numerical failures reach the native separate three-report owner budget. Exact duplicate unilateral equations share aggregate load to preserve existing symmetric browser behavior. Full suite 3440 tests: 3434 pass, 5 skip, 1 intermittent unrelated HMR shutdown timeout; focused HMR rerun passes on baseline and isolated checkout. Production build passes. Unchanged headless crash matrix passes three Stock cases (Eagle3, Buggy, Bigdump, including damage/deformation/repair) then stops at its stale Advanced carrier_mission practice case because no rival exists. Separate real-GPU MCP Advanced Fridge Racer/69mach1 versus Coupe crash and repair passes with deformation/component damage, no console/WebGL errors; Stock Plow/Zee crash loses two parts and remains finite. Actual FAIR first impulse is still unrecorded. Capture/lifecycle hardening acceptance #1/#3 remains open; this checkpoint fixes the independently reproducible energy source, not every possible extreme-motion stall.

AC2 remains deliberately unchecked: the procedural causal mechanism is fixed, but the historical FAIR first event is not replayed and arbitrary pre-existing extreme velocity is not yet guaranteed cheap. Do not equate green numerical regressions with closing the broader workload/lifecycle ticket.

PERF-24 causal correction checkpoint is landed; remaining capture/lifecycle hardening is inactive while user selects the distinct PERF-25 anchored-scenery retry diagnosis. Return to next to keep WIP representative of actual active work.

User deferred remaining work until the extreme-motion stall occurs again. Medium priority (P3), backlog. The reproduced energy-source correction stays implemented; do not resume speculative first-event capture or lifecycle hardening without a new concrete occurrence or explicit selection.

New concrete occurrence (PED-14/TASK-140): Stock TIMBER pedestrian root, actual bounded contact input -> adjacent1.33-degree seam contradiction ->1647x energy, then oversized world-query amplification. Both recorded normal packets and original-world reconstructed emitters reproduce it. PED-14 fixes smooth shared-edge encounter admission with frozen procedural regressions. This does not replay the older FAIR first event or guarantee cheap handling of arbitrary pre-existing runaway velocity; remaining ordinary crowded-scene throughput is separately PERF-26.
<!-- SECTION:NOTES:END -->
