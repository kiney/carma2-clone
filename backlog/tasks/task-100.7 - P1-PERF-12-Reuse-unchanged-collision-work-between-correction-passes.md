---
id: TASK-100.7
title: '[P1] PERF-12: Reuse unchanged collision work between correction passes'
status: done
assignee: []
created_date: '2026-10-12 07:36'
updated_date: '2026-10-13 00:01'
labels:
  - priority-1
  - PERF-12
  - performance
  - physics
dependencies:
  - TASK-100.1
  - TASK-100.2
  - TASK-100.4
  - TASK-100.5
references:
  - docs/timber-performance-findings.md
  - src/physics/simulation.ts
  - src/physics/pair-guard.ts
  - src/physics/frame-window.ts
parent_task_id: TASK-100
priority: high
ordinal: 1170
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The heavy Timber reproduction reaches eight correction passes plus the initial contact collection; each pass rediscovering the whole body's collision work amplifies an over-budget tick into several hundred milliseconds per displayed frame. Use the spatial discovery, immutable geometry and explicit revision ownership from earlier subtasks to retain work for unchanged bodies and unrelated groups between passes.

Scope: proven cross-pass reuse and changed-group recollection. Preserve the existing response/guard decisions, contact/damage ordering, angular sampling, native restart behavior, iteration caps and final conservative commitment. Impulses, new bodies, activation, in-place damage, splits, joints and moving-world callbacks must invalidate every affected result before reuse. Reducing correction or catch-up limits is outside this task.

This is selected P1 implementation work extracted from PERF-01 / TASK-100 after the Timber investigation. Use short serial captures on the shared workstation. Preserve original C2 assets, numerical decisions, contact/callback order, native clocks, wake-up, crush, damage, detachment, repair and anti-tunneling/interlock safeguards. Keep Web Workers deferred. No reduction in required simulation work, activation distances or guard limits qualifies as this optimization.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Explicit validity covers pose/velocity/shape/COM/attachment/world revisions and callback side effects; affected coupled groups are recollected immediately and unrelated groups can reuse unchanged work.
- [x] #2 Deterministic comparison preserves initial and iterative contact decisions, post-impact velocities/rotation, final safe fractions, crush/damage/detachment/repair and original restart/limit behavior.
- [x] #3 Include simultaneous road/wall and car/car/prop contacts, corners, high rotation/full turns, split restarts, joint projection, moving-world changes and previously overlapping bodies.
- [x] #4 Build/regressions and short traced plus minimally instrumented Chromium heavy-state tests demonstrate fewer repeated collections/transforms and improved tick/frame tails without disabling safeguards or fatal errors.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented exact cross-pass raw pair/world reuse with independent OLD/NEXT geometry retention and weak persistent geometry certificates. Dormant polygon noncars receive bounds-only validation before spatial admission; complete hull certification/transform occurs only for relevant pairs. Shape/motion/COM/attachment/recovery and explicit static-world/friction revisions invalidate affected results; moving or overridden providers and native callbacks remain live. Eight correction passes, 30 split restarts, angular samples, final guards and native/catch-up timing are unchanged. Final full suite: 2,698 tests pass, no skips; production build and 15 original crash outputs match the accepted baseline. Exact Stock/Advanced Timber A/B state/impacts/guard fractions match; body transforms 298->95 / 370->93, world guard collections 135->78 / 171->82. Minimally instrumented ABBA retains lower heavy-tick/frame maxima but also adverse medians/tails; no steady-FPS guarantee. Hardware production MCP validates actual driving, impulses, visible cumulative crush, component damage, physical detachment/wastage and repair/reset with clean final console/network/WebGL. Serial production Chromium spawn/interlocking, four original-track debris/joint/repair cases, camera and render-hierarchy regressions all pass. Original data is unchanged, ignored and unbundled. Evidence and reproducible bounded serial tooling: docs/correction-performance.md. PERF-01 retains exact route attribution and remaining stalls.
<!-- SECTION:NOTES:END -->
