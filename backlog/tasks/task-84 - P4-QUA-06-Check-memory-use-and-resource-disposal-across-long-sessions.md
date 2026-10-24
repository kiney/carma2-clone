---
id: TASK-84
title: '[P4] QUA-06: Check memory use and resource disposal across long sessions'
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-24 19:10'
labels:
  - priority-4
  - QUA-06
  - quality
dependencies: []
references:
  - src/content.ts
  - src/main.ts
priority: low
ordinal: 4080
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **QUA-06**
Numeric priority: **4** (1 is highest)
Original status: **Needs validation**
Category: **Robustness, Testing, and Maintainability**

## Scope and evidence

Check memory use across many race changes and long sessions; byte/texture caches have no eviction. Specifically monitor shared textures and disposal.

## Source references

[content.ts](../../src/content.ts), [main.ts](../../src/main.ts)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Offline resource audit: source tracing disproved suspected WAM-source GPU leak (only replacement clones render; repair and simulation teardown dispose them). Measure short serial repeated scene loads, shared textures, cache bytes and disposal identities before proposing changes. Intentional fetch-byte cache retention must be distinguished from orphaned GPU resources; real-display/hardware soak remains unavailable.

Completed bounded ownership audit and fixed a concrete cross-scene retirement defect. Prior 5-load WebGL capture found eight 64x64 uploads sourced from old pedestrian materials, reuploaded after native storages were retired because the old scene kept rendering during async loading. The frame loop now retains the last complete image while loading/not ready. Post-fix serial headless Chromium/SwiftShader 960x640: New City primary 246 geometries/220 textures/7 programs, Timber2 118/117/7, return 246/220/7; only the same two persistent 1x1 default uploads lacked current owners. All four transitions drew zero retired-scene frames; populations settled, no page/console/request errors. Audit records cache/heap/disposal/source/GL identities, asserts return counts and retains failed reports. Intentional fetched-byte cache growth is separate; instrumented GL handles are retained for deletion attribution, so this is not proof of all-day or physical-driver memory behavior. Hardware GPU/soak measurement remains QUA-05. See docs/resource-lifetime.md; report artifacts/resource-lifetime-fixed.json is ignored.
<!-- SECTION:NOTES:END -->
