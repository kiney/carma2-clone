---
id: TASK-5
title: '[P1] PHY-08: Match wheel-ground queries and safe-pose recovery behavior'
status: done
assignee: []
created_date: '2026-10-11 15:13'
updated_date: '2026-10-11 15:15'
labels:
  - priority-1
  - PHY-08
  - physics
  - legacy-done
dependencies: []
references:
  - src/physics/recovery.ts
  - src/physics/wheel-ray.ts
  - docs/c2-physics-re.md
priority: high
ordinal: 1007
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PHY-08**
Numeric priority: **1** (1 is highest)
Original status: **Done**
Category: **Physics and world**

## Scope and evidence

Native wheel queries accept evidenced small negative hits and endpoint/triangle tolerances; the browser sweep preserves proven safe partial movement. Eagle and Monster Beetle drive forward/reverse across finite slope transitions. Recovery uses 20 original safe poses including rotation; a real R-key test frees the Monster Beetle on SNOW WAY OUT. Actual body or roof support remains physically effective.

## Source references

[recovery.ts](../../src/physics/recovery.ts), [wheel-ray.ts](../../src/physics/wheel-ray.ts), [RE notes](../../docs/c2-physics-re.md)

## Previously completed baseline

Imported from the former TODO.md completed checklist (item 6). Preserve this completed scope when considering remaining subsystem work.

Snow edges: native wheel queries, safe partial movements, and original safe-pose recovery instead of placing the vehicle at the same edge again.
<!-- SECTION:DESCRIPTION:END -->
