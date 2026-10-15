---
id: TASK-100.15
title: >-
  [P1] PERF-20: Replace repeated trajectory sampling with adaptive collision
  guarding
status: done
assignee: []
created_date: '2026-10-15 22:15'
updated_date: '2026-10-15 22:44'
labels:
  - priority-1
  - PERF-20
  - performance
  - physics
dependencies: []
references:
  - docs/physics-algorithm-comparison.md
  - docs/perf13-integration-check.md
parent_task_id: TASK-100
priority: high
ordinal: 1275
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Own physics-algorithm-comparison rows1-2: replace the browser-added sampled body trajectory guard with an evidence-selected adaptive continuous collision algorithm. Current pair guards can inspect128 intervals plus18 bisections, using repeated SAT/feature sweeps; the damaged Timber CPU profile attributes14.39% of sampled time to final pair guarding. This owns motion commitment protection, not the native impulse/damage solver, contact-emission chronology or general contact caching.

Start with a repeatable original-data damaged fixture and per-pair work counters. Evaluate conservative advancement using convex separation/distance and valid translation/angular bounds; GJK or separating-plane methods are candidates, not required technology. Preserve useful handling of rotation, parent-driven paths, compound/wire/sphere shapes, qualified existing overlap and coupled unequal prefixes. Keep unsupported paths on an explicit fallback rather than globally weakening guards. Meaningful C2 crashes and playable performance are the specification; old arbitrary sampled fractions are not immutable acceptance targets.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Select and implement an adaptive guard using reviewed motion/separation evidence; demonstrate materially fewer expensive geometric queries on separated and rotating original-data pairs.
- [x] #2 Validate head-on, oblique, side, full-turn/airborne, thin obstacle, existing-overlap escape, compound/wire/sphere and jointed/coupled prefix cases; retain finite state, crash/damage and repair behavior.
- [x] #3 Compare seeded original damaged gameplay before/after using short serial hardware captures with work counts, frame/tick distributions, actual tick rate and adverse samples; preserve user paused pages.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented complete-phase separating-plane motion certificates and continuous SAT for fixed-orientation translation. Captured free and ball/hinge motion enclose global OLD rotation, COM lever travel and initial anchor correction; quantized integrator is not treated as a smooth local rate. Prefixes retain angular/error allowances. Unsupported/custom/translation-joint and unresolved rotating-contact paths retain existing fallback; native OLD-overlap, impulse/friction/damage/world logic unchanged. Matched partial original-asset guard phases retain exact fractions and reduce moving hull transforms221 to16; cold/adverse timings retained, not a universal speedup. Detailed notes: docs/perf20-adaptive-movement-guard.md.

Validation: production build passes; full isolated suite3000pass/5private-capture skips, then all five optional cases pass with supplied captures in focused suites17+6 with no skips. New numerical coverage10continuous-SAT+22integration tests, including native multiplication-order rotation threshold, thin/oblique/grazing/fullturn, COM offsets, hierarchy jumps/levers and prefix coupling. Stock/Advanced four-car Chromium crash/damage/repair plus captured loose-part forward/reverse/release/repair checks pass with clean console/network/GL. Functional Chromium uses SwiftShader; short rendered captures use actual AMD ANGLE2100x1466. No overall hardware FPS gain is established: baseline15.96 then4.93FPS, earlycandidate8.97 and final7.37 with different evolving/async initial fixture in final case. Seed/hash and work counters retained in ignored artifacts/perf20-*. PERF-13 and PERF-21/22 remain open for the damaged-scene slowdown; this closes only the selected movement-guard implementation checkpoint.
<!-- SECTION:NOTES:END -->
