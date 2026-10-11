---
id: TASK-103
title: '[P2] PERF-04: Increase landscape, opponent and pedestrian visual visibility'
status: next
assignee: []
created_date: '2026-10-11 21:48'
labels:
  - priority-2
  - PERF-04
  - performance
  - visibility
dependencies:
  - TASK-101
references:
  - docs/performance-investigation.md
priority: high
ordinal: 2103
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The user explicitly selected higher visual visibility as priority 2 upcoming work, to be addressed after scene-hierarchy performance work (PERF-02 / TASK-101). Current landscape visibility follows authored Yon settings; opponent and pedestrian visibility is coupled to simulation/process activation. The modern browser implementation should have more visual visibility headroom once the measured hierarchy overhead is addressed.

Leave the exact distances, rendering strategy and implementation open. Evaluate visual visibility separately from C2 simulation activation so distant presentation does not silently change opponent behavior, pedestrian threat processing, collisions or native clocks. PERF-01 provides the analysis; this ticket owns subsequent visibility decisions and validation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Begin this scope after PERF-02 / TASK-101 and use its measured baseline to assess remaining performance headroom.
- [ ] #2 Assess and improve landscape, opponent and pedestrian visual visibility; record selected distances/policy and observed limitations rather than prescribing a solution in advance.
- [ ] #3 Document and validate the relationship between visual visibility and native simulation activation; preserve C2 gameplay semantics unless an explicit intentional deviation is justified.
- [ ] #4 Validate short and long views and tunnel/open-area transitions in hardware Chromium with frame-time measurements and screenshots, without fatal console/WebGL errors or gameplay regressions.
<!-- AC:END -->
