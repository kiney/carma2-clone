---
id: TASK-103
title: '[P2] PERF-04: Increase landscape, opponent and pedestrian visual visibility'
status: done
assignee: []
created_date: '2026-10-11 21:48'
updated_date: '2026-10-17 19:15'
labels:
  - priority-2
  - PERF-04
  - performance
  - visibility
dependencies:
  - TASK-101
  - TASK-100.8
references:
  - docs/performance-investigation.md
  - docs/visual-visibility.md
priority: high
ordinal: 2103
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The user explicitly selected higher visual visibility as priority 2 upcoming work, to be addressed after scene-hierarchy performance work (PERF-02 / TASK-101). Current landscape visibility follows authored Yon settings; opponent and pedestrian visibility is coupled to simulation/process activation. The modern browser implementation should have more visual visibility headroom once the measured hierarchy overhead is addressed.

Leave the exact distances, rendering strategy and implementation open. Evaluate visual visibility separately from C2 simulation activation so distant presentation does not silently change opponent behavior, pedestrian threat processing, collisions or native clocks. PERF-01 provides the analysis; this ticket owns subsequent visibility decisions and validation.

The later user-reproduced Timber stalls defer visibility increases until the structural P1 queue and PERF-13 integration establish usable performance. Its dependency now includes TASK-100.8; PERF-18 scenery culling/locality does not change visibility-range ownership here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Begin this scope after PERF-02 / TASK-101 and use its measured baseline to assess remaining performance headroom.
- [x] #2 Assess and improve landscape, opponent and pedestrian visual visibility; record selected distances/policy and observed limitations rather than prescribing a solution in advance.
- [x] #3 Document and validate the relationship between visual visibility and native simulation activation; preserve C2 gameplay semantics unless an explicit intentional deviation is justified.
- [x] #4 Validate short and long views and tunnel/open-area transitions in hardware Chromium with frame-time measurements and screenshots, without fatal console/WebGL errors or gameplay regressions.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-13: Explicit dependency on residual PERF-13 integration added to keep visibility behind the selected P1 structural fixes. Priority 2, next status and ordinal 2103 were unchanged at that checkpoint.

2026-10-17: User authorized substantial visual-distance increases with before/after benchmarks in real headed hardware Chromium. Baseline engine: 486dac9. Implementation and measurements used isolated production builds and fresh browser contexts to preserve existing playtest tabs.

Implemented fourfold visual ranges: stock landscape/opponents 35 -> 140 C2 units, pedestrians 12 -> 48 (conservative 2-unit sphere), shader fog range x4. Native Yon, AI/rematerialization distance 45, pedestrian process distance 12 / popup distance 9, combat, clocks, RNG and PHIL activation remain separate. Only committed remote FOLLOW poses are exposed during rendering and restored in finally; epoch, mode and relocation invalidation prevent stale poses. Source-owned inactive pedestrian poses use revision/root-matrix certificates to preserve hierarchy gains. Distant inactive pedestrians retain their last pose. See docs/visual-visibility.md for policy, evidence and limitations.

Validation: full suite 3,114 tests (3,109 passed, five optional private-capture skips); TypeScript/production build; existing camera, Stock/Advanced/Snow native-AI and render-matrix browser regressions. Dedicated headed Chromium used AMD ANGLE hardware rendering. Five 2.5-second driving/damaged routes at 2100x1466 had matching initial body fingerprints, FPS changes roughly -6% to +7%, no large cliff and no skipped physics time. Separate paused short/long views and a screenshot-verified Snow tunnel-to-open camera sweep stayed around 60 FPS. At 3792x2032 the Snow view measured 60.1 -> 59.6 FPS despite 22 -> 93 eligible visible pedestrians, with 22 native-active unchanged.

The headed integration check observed a genuine remote FOLLOW rival at approximately 80 units submitting meshes without changing PHIL/native state; native relocation invalidated its presentation. An inactive pedestrian at approximately 30 units remained inactive while visible. No fatal console, failed request or WebGL errors. Short serial shared-workstation samples are noisy and do not promise universal 60 FPS. Chrome DevTools MCP was unavailable; the established Playwright/CDP harness attached to a dedicated visible hardware Chromium instead.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fourfold visual ranges implemented and hardware-benchmarked while preserving native simulation activation. Full tests, production build and focused Chromium regressions pass; no large new performance cliff in the bounded comparisons. Distant inactive pedestrians retain frozen poses; remaining general spikes stay under PERF-01.
<!-- SECTION:FINAL_SUMMARY:END -->
