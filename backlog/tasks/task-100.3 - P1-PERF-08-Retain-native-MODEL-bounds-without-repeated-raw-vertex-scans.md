---
id: TASK-100.3
title: '[P1] PERF-08: Retain native MODEL bounds without repeated raw-vertex scans'
status: done
assignee: []
created_date: '2026-10-12 07:36'
updated_date: '2026-10-12 13:06'
labels:
  - priority-1
  - PERF-08
  - performance
  - physics
dependencies: []
references:
  - docs/timber-performance-findings.md
  - src/native-track-resources.ts
  - src/native-find-faces.ts
  - src/native-actor-pick.ts
documentation:
  - docs/model-bounds-performance.md
parent_task_id: TASK-100
priority: high
ordinal: 1130
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every native MODEL-bound request currently calls nativeTrackRawBounds, maps the raw vertices and validates/scans them again. MODEL rejection can therefore cost O(vertex count), including rejected and repeatedly visited models. Retain the exact original Float32 bounds/radius for unchanged resources and recompute only when the defining raw data/flags actually change.

Scope: native MODEL bounds and resource mutation validity. Full actor/scene synchronization belongs to PERF-09. Preserve explicit unresolved custom/empty-model providers, ACT/MODEL traversal order, finite emission prefixes and callbacks; do not truncate traversal after the 300-face capacity is reached.

This is selected P1 implementation work extracted from PERF-01 / TASK-100 after the Timber investigation. Use short serial captures on the shared workstation. Preserve original C2 assets, numerical decisions, contact/callback order, native clocks, wake-up, crush, damage, detachment, repair and anti-tunneling/interlock safeguards. Keep Web Workers deferred. No reduction in required simulation work, activation distances or guard limits qualifies as this optimization.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Repeated queries of an unchanged resource reuse bounds/radius and avoid vertex scans; counters document requests, computations and vertex work.
- [x] #2 Tests prove exact Float32 bounds/radius and correct invalidation for every defining mutation, replacement/private MODEL identity and flags; unresolved providers remain explicit.
- [x] #3 Native face collection preserves rows, ordering, capacity/wrap behavior and pull/StopGroovidelic callbacks on representative Stock/Advanced original tracks.
- [x] #4 Build/regressions and short Chromium collection captures pass with reduced bounds work and no fatal errors.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented exact retained RAW MODEL bounds/radius for explicitly revision-managed owners. Constant-time validity covers revision/current/identity/vertex table/count/flags; every production creation/private replacement path is admitted. In-place edits retain the existing invalidation protocol; generic externally mutable providers stay live. Migration caching is suspended through reentrant callbacks and cleared on success/failure; shared returned bounds are immutable. Hardware Timber node4: 224 computations and 10,258 vertex reads become 224 hits with zero scans; collector samples 5.1/4.1ms uncached versus 2.5/2.6ms cached, with exact rows and callbacks. 2,611 headless tests and production build pass; 15 original-car crash reports match the accepted baseline. MCP driving, impacts, screenshots and console/WebGL checks pass. An extra Carrier actor-name assertion in the whole-smash harness fails identically on c89adfa and this change, documented under WLD-05 rather than reported as a passing harness. All samples, cold costs and limitations are recorded in docs/model-bounds-performance.md.
<!-- SECTION:FINAL_SUMMARY:END -->
