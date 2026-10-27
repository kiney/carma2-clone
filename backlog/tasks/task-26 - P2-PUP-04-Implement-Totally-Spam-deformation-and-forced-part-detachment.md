---
id: TASK-26
title: '[P2] PUP-04: Implement Totally Spam deformation and forced part detachment'
status: done
assignee: []
created_date: '2026-10-11 15:13'
updated_date: '2026-10-27 02:52'
labels:
  - priority-2
  - PUP-04
  - powerups
  - legacy-done
dependencies: []
references:
  - src/powerups.ts
  - src/damage.ts
priority: high
ordinal: 2024
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PUP-04**
Numeric priority: **2** (1 is highest)
Original status: **Done**
Category: **Powerups**

## Scope and evidence

Action 12 uses the reconstructed TotallySpam path: local body/hull deformation, forced part detachment, and native random bend/split attempts. No direct component damage is fabricated.

## Source references

[powerups.ts](../../src/powerups.ts), [damage.ts](../../src/damage.ts)
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-27 02:52
---
DMG-01 captures principal-MODEL glass links before deformation. Browser structural splitting replaces render geometry while those retained links still refer to the original MODEL, so post-split glass may use pre-split polygons. Resolve native SplitModel topology/provenance under this existing structural split scope; do not invent a material-name remap.
---
<!-- COMMENTS:END -->
