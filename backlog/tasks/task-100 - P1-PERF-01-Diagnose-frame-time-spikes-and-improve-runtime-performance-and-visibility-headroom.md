---
id: TASK-100
title: >-
  [P1] PERF-01: Diagnose frame-time spikes and reduce collision/simulation
  overhead
status: wip
assignee: []
created_date: '2026-10-11 19:16'
updated_date: '2026-10-11 21:49'
labels:
  - priority-1
  - PERF-01
  - performance
  - profiling
dependencies: []
references:
  - docs/performance-investigation.md
  - tools/profile-performance.mjs
  - tools/performance-probe.mjs
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User reports roughly 30 FPS in Chromium on modern hardware and severe frame-time spikes, notably when leaving the tunnel in Snow Way Out. Investigate first; the optimization strategy and exact changes remain deliberately open. Separate CPU simulation/collision/AI work, rendering and GPU cost, resource upload/shader compilation, garbage collection, frame pacing and development-versus-production overhead. Initial hardware evidence identifies expensive scene traversal and post-solver collision guarding as independent CPU bottlenecks.

After the user's prioritization, this active ticket retains collision/simulation investigation, evidence-driven optimization and the unresolved tunnel-exit spike. Scene-hierarchy implementation is owned by PERF-02 / TASK-101 (P1, next); resolution policy by PERF-03 / TASK-102 (P4, backlog); higher visual visibility by PERF-04 / TASK-103 (P2, next, after TASK-101). Keep the measured analysis shared but do not duplicate these implementation scopes. Evaluate worker feasibility without prescribing a threading architecture.

Use short, serial profiling captures and static algorithm review because the workstation is simultaneously used by the user; no sustained simulation or parallel stress workloads. Preserve C2 collision decisions, destruction, assets and existing gameplay. Related existing QUA-05 hardware measurement, QUA-06 memory and QUA-10 FPS diagnostics retain their narrower scopes and user-edited priorities.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Document a reproducible short Chromium baseline including actual drawing-buffer resolution, renderer/GPU backend, frame-time distribution and scene population/draw-call counts.
- [x] #2 Rank measured bottlenecks and spike triggers with CPU profiles or timing evidence; separate verified findings, static complexity evidence, hypotheses and software-renderer/shared-host limitations.
- [ ] #3 Investigate Snow Way Out tunnel-to-open-area transitions and compare resolution and isolated subsystem costs without silently changing normal gameplay behavior.
- [ ] #4 Select and validate evidence-driven collision/simulation optimizations, retaining original gameplay and anti-tunneling/interlock semantics; report matched before/after frame and tick times, worker feasibility and remaining limitations. Scene-hierarchy, resolution and visibility implementation belong to TASK-101, TASK-102 and TASK-103 respectively.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Initial analysis completed; implementation choices intentionally remain open. Hardware Chrome DevTools MCP captures identified two independent CPU bottlenecks: repeated full scene matrix traversal (about 16 ms per paused Snow frame; hidden pedestrian hierarchies own about 89% of scene nodes) and post-solver pair-guard SAT construction (about 50% of sampled physics CPU; full pair guard about 64%). Async GPU timer measured roughly 1 ms across both passes at 2098x1465. A 74.5% pixel reduction improved the matched paused sample only from 40.2 to 43.9 FPS; matrix-freezing is diagnostic only. The reported specific tunnel-exit spike remains unisolated: the bounded candidate route included rematerialization/activity changes and a crash and is excluded from clean transition claims. Added opt-in serial capture/CPU-profile tooling; its one-second standalone smoke passed but used SwiftShader and is excluded from hardware FPS conclusions. Final MCP probe lifecycle smoke verified ratio/pause restoration, disposal and zero WebGL errors. Production engine behavior unchanged. Evidence, candidate risks, visibility coupling and remaining measurements: docs/performance-investigation.md. AC3-5 remain open.

User prioritization split on 2026-10-11: TASK-101 owns scene-hierarchy optimization (P1 next), TASK-102 owns resolution policy (P4 backlog), TASK-103 owns visual visibility (P2 next, dependent on TASK-101). Historical AC4/AC5 scope was split accordingly; AC1/AC2 remain verified, AC3 and the narrowed simulation AC4 remain open. In the start-drive capture, updateFrame took 2696.1 ms of 3519.5 ms wall duration (76.6%), including frame-final physics/damage callbacks. Mean tick CPU was 39.3 ms against a 40 ms native step. Worker execution is feasible in the browser, but current scene/geometry/callback ownership prevents a drop-in move; no threading decision or engine behavior changed.
<!-- SECTION:NOTES:END -->
