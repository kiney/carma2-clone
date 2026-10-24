---
id: TASK-102
title: >-
  [P4] PERF-03: Evaluate rendering resolution policy for high-resolution
  displays
status: wip
assignee: []
created_date: '2026-10-11 21:48'
updated_date: '2026-10-24 15:36'
labels:
  - priority-4
  - PERF-03
  - performance
  - rendering
dependencies: []
references:
  - docs/performance-investigation.md
  - docs/render-resolution-analysis.md
priority: low
ordinal: 4102
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rendering uses desktop DPR capped at 1.7 without an absolute drawing-buffer pixel budget. Native/high-DPR 4K may spend resources beyond what original geometry and textures benefit from. However, the measured Snow scene was CPU-bound: reducing pixel count by 74.5% only improved paused FPS from 40.2 to 43.9, with roughly 1 ms GPU time at the native measured buffer. The user therefore explicitly deferred this topic at low priority.

Measure representative high-resolution cases before deciding whether any resolution policy should change. Leave the exact policy and implementation open. Keep application UI legible and distinguish CSS viewport, physical screen resolution, DPR and actual drawing-buffer dimensions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Record bounded hardware Chromium comparisons of actual buffer dimensions, GPU time, frame times and visual quality at representative high-resolution settings.
- [ ] #2 Decide from evidence whether a resolution policy change is useful; document the chosen behavior or a justified decision to retain current behavior, without assuming resolution is the dominant bottleneck.
- [ ] #3 If behavior changes, validate resizing, desktop scaling, HUD legibility and production rendering without gameplay regressions.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-24: User selected analysis and proposals first, including measured benefit and visual quality of lower 3D render resolutions. Keep P4 metadata; no production resolution-policy change is authorized in this phase. Use isolated headed Chromium, short serial same-view comparisons with actual GPU/buffer and separate HUD quality.

Analysis complete: docs/render-resolution-analysis.md records hardware Chromium GPU/CPU/RAF measurements, current DPR behavior, visual comparisons and policy options. 4K to 1080p reduced measured render-pass GPU time from about 2.5 ms to 0.8–1.0 ms; no consistent FPS gain in the CPU-dominated measured views. Nine ignored screenshot comparisons are in artifacts/perf03-quality/index.html. Production behavior unchanged; remaining criteria await a policy decision. Diagnostic probe added; paused user scene restored without simulation ticks.
<!-- SECTION:NOTES:END -->
