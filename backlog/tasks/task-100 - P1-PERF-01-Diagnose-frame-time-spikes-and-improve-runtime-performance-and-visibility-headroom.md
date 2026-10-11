---
id: TASK-100
title: >-
  [P1] PERF-01: Diagnose frame-time spikes and improve runtime performance and
  visibility headroom
status: wip
assignee: []
created_date: '2026-10-11 19:16'
updated_date: '2026-10-11 19:37'
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
User reports roughly 30 FPS in Chromium on modern hardware and severe frame-time spikes, notably when leaving the tunnel in Snow Way Out. Investigate first; the optimization strategy and exact changes remain deliberately open. Separate CPU simulation/collision/AI work, rendering and GPU cost, resolution/DPR, resource upload/shader compilation, garbage collection, frame pacing and development-versus-production overhead. Higher landscape, opponent and pedestrian visibility is desirable after establishing performance headroom; distinguish visual visibility from source-faithful simulation activation. Rendering at native 4K may be unnecessarily costly for original low-resolution content and must be measured rather than assumed. Use short, serial profiling captures and static algorithm review because the workstation is simultaneously used by the user; no sustained simulation or parallel stress workloads. Preserve C2 behavior, assets, destruction and existing gameplay. Related existing QUA-05 hardware measurement, QUA-06 memory and QUA-10 FPS diagnostics retain their narrower scopes; reconcile findings without duplicate implementation or unrequested reprioritization.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Document a reproducible short Chromium baseline including actual drawing-buffer resolution, renderer/GPU backend, frame-time distribution and scene population/draw-call counts.
- [x] #2 Rank measured bottlenecks and spike triggers with CPU profiles or timing evidence; separate verified findings, static complexity evidence, hypotheses and software-renderer/shared-host limitations.
- [ ] #3 Investigate Snow Way Out tunnel-to-open-area transitions and compare resolution and isolated subsystem costs without silently changing normal gameplay behavior.
- [ ] #4 Select and validate subsequent optimizations from evidence, retaining original gameplay semantics and reporting before/after frame times and remaining limitations.
- [ ] #5 Assess higher visual visibility separately from native simulation distance; leave the exact resolution and distance policy open until measurements justify a choice.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Initial analysis completed; implementation choices intentionally remain open. Hardware Chrome DevTools MCP captures identified two independent CPU bottlenecks: repeated full scene matrix traversal (about 16 ms per paused Snow frame; hidden pedestrian hierarchies own about 89% of scene nodes) and post-solver pair-guard SAT construction (about 50% of sampled physics CPU; full pair guard about 64%). Async GPU timer measured roughly 1 ms across both passes at 2098x1465. A 74.5% pixel reduction improved the matched paused sample only from 40.2 to 43.9 FPS; matrix-freezing is diagnostic only. The reported specific tunnel-exit spike remains unisolated: the bounded candidate route included rematerialization/activity changes and a crash and is excluded from clean transition claims. Added opt-in serial capture/CPU-profile tooling; its one-second standalone smoke passed but used SwiftShader and is excluded from hardware FPS conclusions. Final MCP probe lifecycle smoke verified ratio/pause restoration, disposal and zero WebGL errors. Production engine behavior unchanged. Evidence, candidate risks, visibility coupling and remaining measurements: docs/performance-investigation.md. AC3-5 remain open.
<!-- SECTION:NOTES:END -->
