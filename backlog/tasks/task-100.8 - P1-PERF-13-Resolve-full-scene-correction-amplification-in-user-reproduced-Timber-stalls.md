---
id: TASK-100.8
title: >-
  [P1] PERF-13: Resolve remaining damaged-scene physics stalls after structural
  integration
status: done
assignee: []
created_date: '2026-10-13 01:22'
updated_date: '2026-10-16 13:26'
labels:
  - priority-1
  - PERF-13
  - performance
  - physics
dependencies:
  - TASK-106
  - TASK-100.9
  - TASK-100.10
  - TASK-100.11
  - TASK-100.12
  - TASK-100.13
  - TASK-100.15
  - TASK-100.16
  - TASK-100.17
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
Completed after hardware revalidation of engine checkpoint 597b42d (2026-10-16). Once the user unlocked the workstation, the original desktop Chromium CDP endpoint responded again without restart or permission changes. Matching fully rendered, minimal-observer hardware ABBA windows (AMD ANGLE/radeonsi gfx1150, 2100 x 1466) give baseline 26.77/27.37 FPS versus final 38.72/38.23 FPS; p95 frame 71.60/94.70 ms versus 47.90/56.40 ms. Mean tick falls about 19%, mean update about 40%, average FPS rises about 42%. All four seeded initial fixture/body fingerprints and full populations match; later timed AI/physics differ. No skipped simulation time, console errors, failed requests/responses or WebGL errors.

Final hardware route checks give Timber canyon forward/reverse 54.74/55.98 FPS and Snow start 46.37 FPS, with zero skipped time. All 3,096 headless tests, build, Stock/Advanced crash/damage/repair and captured-interlock Chromium checks pass. AC2 is now substantially met and all acceptance criteria are complete. PERF-01 remains open for broader performance work; these short recreated routes do not guarantee universal 60 FPS or rule out rare user-created chaos stalls. Original user tab remains paused and unchanged. Full evidence and retained adverse/software samples: docs/perf13-residual-physics.md.

Historical scope and investigation evidence (retained):

Current integration check (2026-10-15, engine checkpoint dbc7a0d): keep open. The old eight-global-round implementation has been replaced by the completed structural queue, but a short rendered hardware damaged-grid case still gives 15.6 FPS and 29.8 ms mean tick CPU. A CPU-profiled repeat gives 15.3 FPS; a separate bare RAF-only run without timing wrappers gives 18.8 FPS. Actual simulation runs about 25 ticks/s with zero skipped time in the instrumented captures. This is a concrete remaining collision/physics workload, not only historical validation debt.

Next implementation focus: attribute and reduce damaged-scene local collision processing and final pair trajectory guarding. Preserve a seeded fixture and distinguish useful response from redundant discovery, invalidation, sampling and geometry work before selecting an algorithm. Do not preselect a new cap or weaker safeguard. Ordinary Timber/node192 views are roughly 48-53 FPS; Snow startup is 28 FPS. Actual AMD ANGLE hardware, 2100 x 1466, short serial windows. Detailed measurements, limits and reproduction: docs/perf13-integration-check.md. Visibility PERF-04 remains dependent. No new PERF-20 is created because it would duplicate this scope.

Historical investigation and scope before the completed structural queue:

User-driven hardware Chromium capture after PERF-12 records physics updateFrame up to 263.1 ms with five ticks, versus typical render CPU of 4-9 ms. Most heavy ticks perform eight global correction rounds, 4,347 world-guard calls across 483 bodies, and nine pair collections. Nonempty cached/resting contacts retain solver and callback rounds; raw-contact caching alone does not remove this amplification.

Coordinate residual whole-route integration and validation while retaining C2 motion, momentum, damage/crush/repair and meaningful effects. New structural implementation is delegated to PERF-14, PHY-13, PERF-15, PERF-16, PERF-17 and PERF-18. The user explicitly authorizes replacing browser-only guard/recollection algorithms, sampling and iteration policies rather than preserving their current behavior bit-for-bit. Reducing simulated time, freezing moving parts or discarding meaningful response merely to report higher FPS remains outside the intended outcome.

Implemented exact query-specific depth/fraction paths, allocation-free moving-edge roots/clipping, explicitly owned immutable car/part/NONCAR collision generations, certified constant-static geometry reuse and shared empty world-guard results. Mutable/custom geometry retains full fallback checks. Native steps and all correction/response rounds remain unchanged. See docs/guard-kernel-performance.md for differential tests, full distributions, adverse samples and exclusions.

The reported 180-degree direction correlation remains unisolated. Software Chromium comparisons show lower costs in several heavy cases, with mixed tails/medians; the actual hardware route and useful per-pass dependency attribution still need validation. Earlier MCP startup and headless hardware EGL probes failed. MCP has since reconnected to actual AMD ANGLE Chromium, enabling bounded hardware-backed CPU comparisons with exact state/fraction hashes. Those recreated, drawing-suppressed fixtures still do not reproduce the actual rendered user route. The original user trace/body snapshot were saved before restarting the controlled browser. No system permissions or packages were changed. The 6 FPS stall remains unresolved. With structural implementation now split into the selected next queue, this partially implemented integration/validation ticket returns to backlog until its own route validation is actively resumed.

The 2026-10-13 structural brainstorming found native joint candidate anchor placement missing before collision collection, dormant ACTs admitted to the browser roster prematurely, incomplete hierarchy quiet providers, and unmeasured dormant render interpolation/restoration. Those implementation scopes belong to the selected successors; this ticket owns comparative actual-route integration and remaining direction/catch-up/GPU attribution. Completed exact optimizations and historical validation remain intact. Use independently derived native/gameplay expectations for changed orchestration rather than treating old exact browser guards as the specification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Identify persistent correction rows and exact motion/geometry/attachment changes per pass in the saved user scene; distinguish useful response from redundant scene-wide work.
- [x] #2 After the selected structural checkpoints, demonstrate substantially lower whole-tick/updateFrame costs and usable rendered frame-time tails in short serial hardware routes; retain adverse samples and observer overhead. Browser guard/recollection algorithms may change; simply slowing simulation or freezing moving objects does not qualify.
- [x] #3 Prove contact, momentum, damage/restart ordering, activation and final body/world safeguards remain valid across original Stock/Advanced multi-car debris/crush/repair scenarios.
- [x] #4 Validate running Chromium frames and regressions with clean console/WebGL; distinguish exact directional attribution from hypotheses and keep original data unmodified/unbundled.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Validate the structural queue checkpoints together on ordinary rendered Timber and Snow routes. Capture minimally instrumented frame/tick distributions, executed tick counts, populations, headings, GPU/backend/buffer and skipped time; investigate any remaining bottleneck. Reuse the retained original snapshots and partial replay with their limitations. Confirm original-car crash, deformation/detachment, repair, world activation and rendering regressions against the new native-informed behavior. Preserve completed optimization evidence and distinguish actual user-playtest observations from recreated CPU-only fixtures.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation authorized by the user on 2026-10-13. Independent native/collision and ownership audits reviewed the exact query and source-generation boundaries. rec2 leaves DoCollisions incomplete; installed HW local retry/rest-response evidence means repeated rows cannot simply be skipped.

Current implementation: geometry.ts exact SAT predicate/first-fraction query, bit-exact edge direction dedup with exceptional/large-list fallback, scalar edge equations and fixed roots, scalar clipping and shared inverse within a query; immutable-hulls.ts explicit owned source sealing; built-in car/NONCAR loaders, accepted crush/repair/split/detachment publish sealed collider snapshots separately from mutable DamageSystem vertices; cache identity never substitutes for mutable/default source checks. Static retained guard geometry requires immovable + certified source + explicit constant/stable path + exact pose. Empty world guards are private frozen read-only values.

Validation: 2,723 full tests pass; production build passes; 15 original-car crash reports match baseline byte-for-byte. Production Chromium multi-car Stock/Advanced crash/split/repair and four original-track NONCAR joint/debris/repair suites pass with clean console/requests/WebGL; supported spawn/interlock regression passed before the final scalar/ownership extension. Final serial Stock/Advanced ABBA fixture initial state, ordered impulses/damage/hulls, kinematics, attachment state and traced world fractions are exact. Saved 483-body snapshot guard fractions are exact. Screenshots inspected. Backend for new measurements/regressions is SwiftShader; no hardware FPS claim. Final raw distributions, earlier adverse/cold samples, wrong-shared-anchor exclusions and one concurrently run exploratory-profile exclusion are recorded in docs/guard-kernel-performance.md.

Acceptance remains open for per-pass attribution in the actual saved user scene and a bounded hardware route recapture. Eight scene-wide rounds and rotating-part sampled queries remain costly. PHY-13 own-debris lockup remains separate; PERF-04 visibility remains deferred. No broader/paused Goal is completed.

Final-build follow-up: the supported spawn/grid and interlock release Chromium suite passes with no errors/failed requests/WebGL faults. Original motion-powerup browser regression also passes (Eagle/Buggy suspension, bounce, original-wall climbing, gravity/free-body and world/car pinball). Final full suite is 2,723 passed, no failures/skips; no source changes followed these checks. Remaining AC1/AC2 hardware/per-pass attribution stay open.

Reviewed 2026-10-13 analysis (docs/perf13-root-cause-analysis.md): 474/512 ticks run eight correction rounds, but per-pass pair attribution remains open. Two Cerby-cluster endpoint snapshots and partial full-40-ms guard probes establish suspicious near-static poses with substantial velocity, not continuous lockup or live commit fractions. Metric units corrected. Existing caches mean call counts are not expensive sweep counts. Contact-only zero impulses do not certify no state changes: joints, quick-hinge projection, activation and callbacks remain observable. Dirty tracking must certify all collision inputs and discover new partners. Initial-energy rotation bound is rejected: the current integrator increases rotational energy in a focused probe. Preserve momentum bound, native steps/caps and callbacks. TASK-106 is an investigation dependency; resolving the cluster is not yet proven necessary or sufficient for the FPS target.

Reviewed follow-up implemented scalar SAT axes, one roster per pure correction collection phase, exact moving-path extraction with two-clone fixed paths, direct fixed-body guard sample entries and allocation-free exact pose comparison. Full tests2733 pass; production build passes;15 original-car crash reports byte-identical. Serial actual AMD ANGLE/MCP Stock Timber recreated-fixture ABBA retains exact initial/final/fraction hashes at2100x1466. Final tick p50 baseline33.1/41.3 ms vs optimized23.0/32.5 ms; adverse traced/cold/tail samples retained in docs/guard-kernel-performance.md; CPU-only drawing-suppressed fixture is not rendered user-route FPS. A bounded partial483-body replay confirms real contact/joint changes on Cerby cluster every round; no unsupported zero-impulse exit or sampling/damping change. Native retry exhaustion does not zero velocity; ordinary recovery pre-candidate motion is mathematically equivalent. Original lockup and full world/damage attribution remain open; AC1/AC2 not checked.

Final production Chromium crash matrix passes Stock Eagle/Buggy/Bigdump, Advanced 69mach1 and Porker2 split/repair, with no console errors/failed requests/WebGL faults. Screenshots inspected. MCP ordinary Timber head-on with driving input changes player health100→91, opponent100→44 and persistent player deformation revision0→1. A non-element keyboard event-target assumption discovered in the injected QA path was fixed as UI-04/TASK-107 (done); Window/document controls and editable exclusion pass with clean final console/requests/GL. Broader PERF-13 and PHY-13 remain open.

2026-10-13: structural implementation split into five new P1/next children plus reused PHY-13/TASK106. This residual integration/route-validation task moves to backlog because partial implementation alone is not WIP. Latest user authorization supersedes immutable preservation of browser-only guard/correction policies; native timebase and meaningful response remain the target. Earlier checked AC3/AC4 describe validation of the existing checkpoint; all changed systems require fresh child-ticket validation and final route integration.

2026-10-15 integration audit: rendered Timber damaged grid remains slow (15.6 FPS, tick mean29.8/p95 50.8ms, 12 debris, 24.67 ticks/s, zero skipped). Profiled repeat15.3 FPS, tick mean31.0ms; bare RAF-only confirmation18.8 FPS with no engine measurement wrappers. Different random opponents/detachment states prevent A/B overhead estimates. CPU sampling attributes38.60% inclusive to local responses and14.39% to sibling final pair guards; local-response exclusive self only0.69%, so no single control-flow bottleneck is proven. GPU elapsed mean0.86ms in the first damaged case. Ordinary starts/directions and adverse cold tails retained. Existing AC1/AC2 remain open; literal full replay of historical user tick is not claimed. No production behavior changed; ticket returns to next as the concrete P1 implementation owner after this bounded diagnosis. See docs/perf13-integration-check.md and tools/validate-performance-routes.mjs.

2026-10-16 user explicitly selected three implementation tickets from the algorithm comparison: PERF-20 adaptive movement guards (active), PERF-21 persistent collision-data ownership (next), PERF-22 repeated collision rediscovery (next). This ticket retains post-queue damaged-scene integration/validation, not duplicated implementation. Return to backlog while the selected checkpoints execute; preserve existing acceptance evidence.

Resumed after reviewed PERF-20/21/22 checkpoints (current baf9431). Re-establish rendered hardware damaged-scene attribution, then implement residual bottleneck improvements and validate full-scene tails; previous mixed/adverse samples remain evidence.

2026-10-16 residual implementation: source-certified native first-order free motion uses adaptive temporal SAT and exact translation SAT between quantized-angle events. Full endpoint face/edge-cross witnesses prevent false uncertainty explosions; browser-only penetration slop is capped at .001 and 5% local hull thickness, with the previous 1e-6 floor. Thin crossing, tangency, quantum/gate, skew, repair/replacement and unequal-prefix tests pass. Native high-angle/custom fallback still exists; captured native sampling uses actual rate hint/observed turns rather than momentum/min-inertia as a rate. Global conservative envelopes, native poses/integration, contact equations, damage/repair callbacks and clock limits remain unchanged. Synthetic anisotropic clear cases fall from 128 samples to 11–12; full/multiple-turn and changing-axis impacts remain protected.

Saved ten-body pile attribution: four repeated diagnostic passes each have 17 responses and 30 unique geometry/impulse rows; all change velocity/angular velocity, three replace collider identity, no exact row repeats, max attempt 6, no truncation. Native installed response returns row count, not a positive-stress convergence condition, so response stopping was not weakened. Input-certificate-driven tick-local trajectory reuse rebuilds changed physical trees including shared external anchors/state aliases; final commitment remains fresh.

Hardware intermediate 8.21 to 17.74 FPS is retained with adverse earlier 2.75/3.18 FPS experiments; not final acceptance. Matching final software/drawing-suppressed profiled CPU captures execute 67 ticks each, mean/p95 tick 21.50/38.20 to 16.05/29.40 ms; pair guard sampled 409.23 to 105.77 ms; guard intervals 21,281 to 1,535 and hull transforms 34,798 to 4,834. Later AI/game states differ; candidate records 80 ms skipped, baseline 0. Full tests 3,094 pass with zero failures/skips. Final production browser regressions recorded separately. AC2 stays unchecked pending actual hardware-rendered confirmation; no package or device/session permission change made.

Final production validation: 3,094 headless tests pass without failures/skips; build passes; Chromium Stock Eagle/Buggy/Bigdump and Advanced 69mach1 crash/damage/repair core passes; saved ten-body forward/reverse/bumper-control cases each pass three ticks with clean console/requests. WebGL error 0 in the crash matrix. Screenshots inspected. Hardware whole-rendered-route AC2 remains open; ticket stays WIP rather than claiming completion from software CPU results.

Final review fixes a coupled-angle regression: synchronous native quantization events could falsely block tangent co-rotating thin parts by testing impossible mixed orientations. Those ambiguous tiny brackets now use the existing actual-pose detailed fallback. Both tangent release and real relative-translation collision tests pass. Final headless suite is 3,096 tests, no failures/skips. Earlier CPU profiles precede this narrow correctness routing fix; hardware-rendered AC2 remains open.

Unlocked-desktop final acceptance: four serial 2.5-second hardware-rendered ABBA windows on baf9431 versus 597b42d reproduce the same exact initial fixture/body hashes, seven cars, nine pieces, 584 pedestrians and 466 authored NONCARs. Baseline FPS 26.77/27.37; final 38.72/38.23. Tick means 21.42/21.60 to 17.76/17.28 ms; update means 20.50/20.44 to 11.99/12.57 ms; frame p95 71.60/94.70 to 47.90/56.40 ms. All skipped time zero. Forward/reverse Timber canyon 54.74/55.98 FPS, Snow start 46.37 FPS. No browser/requests/WebGL errors. Screenshots inspected; minimal wrappers only, no CPU profiler or pair counters. Actual AMD ANGLE 2100 x 1466; timed captures are not deterministic replays. Independent evidence review agrees AC2 is substantially met for this bounded ticket. Close PERF-13; PERF-01 remains open. Hardware blocker recorded earlier was resolved after unlocking, without browser restart, package installation or device/session permission changes.
<!-- SECTION:NOTES:END -->
