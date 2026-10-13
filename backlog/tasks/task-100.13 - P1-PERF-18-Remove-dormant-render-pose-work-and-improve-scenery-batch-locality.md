---
id: TASK-100.13
title: >-
  [P1] PERF-18: Remove dormant render-pose work and improve scenery batch
  locality
status: done
assignee: []
created_date: '2026-10-13 11:29'
updated_date: '2026-10-13 23:46'
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
- [x] #1 Attribute apply/restore, batch validation, descendant matrix visits and submission/GPU costs separately at a frozen Timber pose; distinguish current hardware, software rendering and instrument overhead.
- [x] #2 Eliminate repeated render-pose/matrix work for certified unchanged dormant scenery while correctly handling wake, transforms, parent changes, removal, smash and GROOVE updates.
- [x] #3 Assess global batch visibility and implement a justified locality/culling improvement or record measured evidence that it contributes negligibly; do not assume enabling a track-wide bounding sphere solves it.
- [x] #4 Verify interpolation, committed-pose restoration, camera behavior, static/moving scenery and material/texture presentation in Stock/Advanced Chromium with screenshots and clean console/WebGL.
- [x] #5 Report running and paused frame CPU distributions, scene traversal/draw work and relevant GPU results in short serial captures without silently increasing visibility or simulation activation.
- [x] #6 Provide a separate checkpoint and user-playtest focus for view changes, scenery motion/destruction and visual regressions; retain PERF-04 as the later visibility-range task.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented certified dormant presentation: Timber pose applications473→8/frame, redundant apply/restore subtree visits1249+1249→0, shared parent/geometry checks once per frame and freshly certified source-root matrix skipping. Wake/transform/hierarchy/custom-method/geometry/material/smash changes revoke ownership. GROOVE own-ACT versus native-pulled inherited ancestry now uses explicit graphical ownership and committed rebasing before interpolation; force/collision/damage/quiet formulas unchanged. Global locality was assessed with original source spheres:49 batch draws/9294 triangles but only20 sphere-visible sources; omitting all batch drawing did not materially improve main CPU/GPU here, so spatial grouping and distances remain unchanged. 2936 full tests plus6 new probe cases pass; production build; Stock/Advanced exact matrix/pixel parity, scenery mutation/physical wake, existing population matrices and four NONCAR participation/repair regressions pass. Hardware MCP driving, screenshots and clean console/GL verified. Short serial captures retain adverse paused CPU timing and tiny GPU samples honestly; no universal FPS or canyon-stall claim. Evidence:docs/render-hierarchy-performance.md. Separate user observation of delayed debris contact recorded as P2 PHY-15/TASK-109, unreproduced. PERF-01 stays WIP and PERF-04 stays P2 next; no broader Goal completed.
<!-- SECTION:FINAL_SUMMARY:END -->
