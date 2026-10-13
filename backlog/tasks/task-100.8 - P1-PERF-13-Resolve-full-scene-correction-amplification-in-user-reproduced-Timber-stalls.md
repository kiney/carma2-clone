---
id: TASK-100.8
title: >-
  [P1] PERF-13: Resolve full-scene correction amplification in user-reproduced
  Timber stalls
status: wip
assignee: []
created_date: '2026-10-13 01:22'
updated_date: '2026-10-13 08:12'
labels:
  - priority-1
  - PERF-13
  - performance
  - physics
dependencies:
  - TASK-106
references:
  - docs/live-timber-drop.md
  - src/physics/simulation.ts
  - docs/guard-kernel-performance.md
  - docs/perf13-root-cause-analysis.md
  - docs/own-debris-lockup.md
  - src/physics/frame-window.ts
  - src/physics/pair-guard.ts
parent_task_id: TASK-100
priority: high
ordinal: 1180
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User-driven hardware Chromium capture after PERF-12 records physics updateFrame up to 263.1 ms with five ticks, versus typical render CPU of 4-9 ms. Most heavy ticks perform eight global correction rounds, 4,347 world-guard calls across 483 bodies, and nine pair collections. Nonempty cached/resting contacts retain solver and callback rounds; raw-contact caching alone does not remove this amplification.

Resolve remaining repeated scene-wide work while retaining C2 motion, momentum, damage/crush/repair, callbacks, restart ordering and final guards. Lowering correction/angular/catch-up caps, skipping nonzero impulses or freezing moving parts is not an acceptable fix.

Implemented exact query-specific depth/fraction paths, allocation-free moving-edge roots/clipping, explicitly owned immutable car/part/NONCAR collision generations, certified constant-static geometry reuse and shared empty world-guard results. Mutable/custom geometry retains full fallback checks. Native steps and all correction/response rounds remain unchanged. See docs/guard-kernel-performance.md for differential tests, full distributions, adverse samples and exclusions.

The reported 180-degree direction correlation remains unisolated. Software Chromium comparisons show lower costs in several heavy cases, with mixed tails/medians; the actual hardware route and useful per-pass dependency attribution still need validation. MCP target/page startup currently times out; headless hardware EGL also reports inaccessible renderD128 and no WebGL2 context. This is a tool/environment limitation, not an application error. The original user trace/body snapshot were saved before restarting the controlled browser. No system permissions or packages were changed. Keep this P1 task in wip; do not claim the 6 FPS stall fully resolved.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Identify persistent correction rows and exact motion/geometry/attachment changes per pass in the saved user scene; distinguish useful response from redundant scene-wide work.
- [ ] #2 Reduce measured whole-tick and updateFrame CPU in bounded serial hardware captures without simply lowering native time or guard iteration limits; retain adverse samples and instrumentation overhead.
- [x] #3 Prove contact, momentum, damage/restart ordering, activation and final body/world safeguards remain valid across original Stock/Advanced multi-car debris/crush/repair scenarios.
- [x] #4 Validate running Chromium frames and regressions with clean console/WebGL; distinguish exact directional attribution from hypotheses and keep original data unmodified/unbundled.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Build a bounded, explicitly partial replay of the 145.68 s body-pair/joint snapshot; record per-pass rows, impulses, changes, cache misses and CPU. Snapshot lacks world/forces/damage state, so do not claim an exact whole tick.
2. Implement safe roster reuse within pure synchronous collection, rebuilding after solves/callbacks and preserving preparation order. Evaluate larger reuse only with complete certificates and callback preservation.
3. Trace PHY-13 native detachment/former-owner/exhausted-retry behavior and test a focused separating-motion remedy; do not simply discard velocity.
4. Repeat short serial Chromium measurements, preserving adverse samples and backend metadata. Obtain hardware heading/whole-tick evidence when the controlled browser is available.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation authorized by the user on 2026-10-13. Independent native/collision and ownership audits reviewed the exact query and source-generation boundaries. rec2 leaves DoCollisions incomplete; installed HW local retry/rest-response evidence means repeated rows cannot simply be skipped.

Current implementation: geometry.ts exact SAT predicate/first-fraction query, bit-exact edge direction dedup with exceptional/large-list fallback, scalar edge equations and fixed roots, scalar clipping and shared inverse within a query; immutable-hulls.ts explicit owned source sealing; built-in car/NONCAR loaders, accepted crush/repair/split/detachment publish sealed collider snapshots separately from mutable DamageSystem vertices; cache identity never substitutes for mutable/default source checks. Static retained guard geometry requires immovable + certified source + explicit constant/stable path + exact pose. Empty world guards are private frozen read-only values.

Validation: 2,723 full tests pass; production build passes; 15 original-car crash reports match baseline byte-for-byte. Production Chromium multi-car Stock/Advanced crash/split/repair and four original-track NONCAR joint/debris/repair suites pass with clean console/requests/WebGL; supported spawn/interlock regression passed before the final scalar/ownership extension. Final serial Stock/Advanced ABBA fixture initial state, ordered impulses/damage/hulls, kinematics, attachment state and traced world fractions are exact. Saved 483-body snapshot guard fractions are exact. Screenshots inspected. Backend for new measurements/regressions is SwiftShader; no hardware FPS claim. Final raw distributions, earlier adverse/cold samples, wrong-shared-anchor exclusions and one concurrently run exploratory-profile exclusion are recorded in docs/guard-kernel-performance.md.

Acceptance remains open for per-pass attribution in the actual saved user scene and a bounded hardware route recapture. Eight scene-wide rounds and rotating-part sampled queries remain costly. PHY-13 own-debris lockup remains separate; PERF-04 visibility remains deferred. No broader/paused Goal is completed.

Final-build follow-up: the supported spawn/grid and interlock release Chromium suite passes with no errors/failed requests/WebGL faults. Original motion-powerup browser regression also passes (Eagle/Buggy suspension, bounce, original-wall climbing, gravity/free-body and world/car pinball). Final full suite is 2,723 passed, no failures/skips; no source changes followed these checks. Remaining AC1/AC2 hardware/per-pass attribution stay open.

Reviewed 2026-10-13 analysis (docs/perf13-root-cause-analysis.md): 474/512 ticks run eight correction rounds, but per-pass pair attribution remains open. Two Cerby-cluster endpoint snapshots and partial full-40-ms guard probes establish suspicious near-static poses with substantial velocity, not continuous lockup or live commit fractions. Metric units corrected. Existing caches mean call counts are not expensive sweep counts. Contact-only zero impulses do not certify no state changes: joints, quick-hinge projection, activation and callbacks remain observable. Dirty tracking must certify all collision inputs and discover new partners. Initial-energy rotation bound is rejected: the current integrator increases rotational energy in a focused probe. Preserve momentum bound, native steps/caps and callbacks. TASK-106 is an investigation dependency; resolving the cluster is not yet proven necessary or sufficient for the FPS target.
<!-- SECTION:NOTES:END -->
