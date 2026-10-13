---
id: TASK-100.13
title: >-
  [P1] PERF-18: Remove dormant render-pose work and improve scenery batch
  locality
status: next
assignee: []
created_date: '2026-10-13 11:29'
labels:
  - priority-1
  - PERF-18
  - performance
  - rendering
  - scene
dependencies: []
references:
  - src/main.ts
  - src/render-pose.ts
  - src/render-matrices.ts
  - src/noncar-render.ts
  - docs/render-hierarchy-performance.md
  - docs/live-timber-drop.md
parent_task_id: TASK-100
priority: high
ordinal: 1240
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every displayed RAF currently applies and restores RenderPoses for all NONCARs, including 466 sleeping batched props in the saved Timber scene. apply/restore clone poses and parent matrices and recursively update actor subtrees; roughly 932 actor subtree updates occur per frame before ordinary matrix preparation. Paused renderAlpha=1 still takes this path. The recorder matrix bucket measures prepareRenderMatrices, not all interpolation/restoration/batch validation work. NONCAR instance groups also disable frustum culling and span the supplied population.

Redesign the dormant presentation bridge so unchanged sleeping/static objects do not undergo interpolation, restoration or repeated hierarchy validation merely because their data exists. Assess and improve spatial batch locality/culling if measured submission/GPU work justifies it. Keep moving, articulated, externally changed or GROOVE-owned actors correctly updated, and keep interpolated presentation out of physics state.

This is a distinct successor to completed PERF-02 shared render-pass matrix preparation and hidden pedestrian pruning. PERF-04 continues to own increased visibility distances; preserve current visibility policy here. PHIL eligibility, graphical visibility and sleeping-state certification are different concerns. Rendering is a real unmeasured residual, not proven the dominant cause of the captured physics stall.

The user explicitly authorizes substantial, reversible physics and rendering redesign to reach genuinely playable performance. Existing browser-added guard algorithms, their sampling/iteration caps and bitwise equivalence to a flawed browser orchestration are not immutable requirements. Judge changed behavior against C2 evidence and focused gameplay regressions. Use a separate reviewed Git checkpoint per ticket and provide a short user-playtest focus before the next risky change. Record intentional deviations and measured costs; do not require an exhaustive safety proof before trying an evidence-backed redesign. Keep original assets read-only, use short serial captures on the shared workstation, and reserve Web Workers as a last resort.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Attribute apply/restore, batch validation, descendant matrix visits and submission/GPU costs separately at a frozen Timber pose; distinguish current hardware, software rendering and instrument overhead.
- [ ] #2 Eliminate repeated render-pose/matrix work for certified unchanged dormant scenery while correctly handling wake, transforms, parent changes, removal, smash and GROOVE updates.
- [ ] #3 Assess global batch visibility and implement a justified locality/culling improvement or record measured evidence that it contributes negligibly; do not assume enabling a track-wide bounding sphere solves it.
- [ ] #4 Verify interpolation, committed-pose restoration, camera behavior, static/moving scenery and material/texture presentation in Stock/Advanced Chromium with screenshots and clean console/WebGL.
- [ ] #5 Report running and paused frame CPU distributions, scene traversal/draw work and relevant GPU results in short serial captures without silently increasing visibility or simulation activation.
- [ ] #6 Provide a separate checkpoint and user-playtest focus for view changes, scenery motion/destruction and visual regressions; retain PERF-04 as the later visibility-range task.
<!-- AC:END -->
