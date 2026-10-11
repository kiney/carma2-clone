---
id: TASK-67
title: '[P3] REN-02: Implement additional original BRender material and lighting rules'
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-11 17:46'
labels:
  - priority-3
  - REN-02
  - rendering
  - legacy-partial
dependencies: []
references:
  - src/content.ts
  - src/formats.ts
priority: medium
ordinal: 3066
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **REN-02**
Numeric priority: **3** (1 is highest)
Original status: **Partial**
Category: **Animation, Rendering, and Audio**

## Scope and evidence

Inventory and implement more MAT/BRender rendering rules. The current Lambert path supports texture/UV, opacity, and key culling rules, but not full material semantics. Verified native material registration fixes previously overwritten TWO_SIDED smash materials (advert2/advert3/cinema01); exact-case resource admission remains separate from case-folded lookup. Complete shading/fog and shared global registry lifetimes remain unresolved.

## Source references

[content.ts](../../src/content.ts), [formats.ts](../../src/formats.ts)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The bounds-checked MAT parser retains original coefficients, flags, index range, local fog, subdivision and all five reference roles; representative Stock/Advanced data and full local MAT inventory parse successfully.
- [x] #2 Installed C2 shading coefficients, directional Gouraud/rational specular lighting and material-local fog reach the actual production shader, independently of generic ambient brightness.
- [x] #3 Original culling, colour/opacity/depth, texture sampling and authored UV/perspective/environment flags retain their distinct state. Native sampling survives FUNK animation and atlas/tile clones.
- [x] #4 Global newest-first native lookup remains distinct from per-storage duplicate admission; actual MAT/MODEL identities and shared arena ownership survive scene loading and are released correctly at race teardown.
- [x] #5 Numerical material/registry/clone conformance, production build and actual Stock/Advanced Chromium rendering/reload checks pass without fatal console or WebGL errors. Software-palette, uncommon flags and driver precision limitations are documented without claiming full rasterizer parity.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented bounds-checked original MAT fields and production native Gouraud/rational specular lighting, C2 shading coefficients, local fog, culling/opacity/depth and texture/perspective/environment state. Sampling survives FUNK and tile clones. Genuine common MAT/MODEL admission preserves load-time bindings; shared global lookup, storage ownership, leases and race teardown are distinct. Corrected generated default-track/Simple materials and native unresolved lookup inheritance. Validation: all 1979 local MAT files (31446 records), 12 numerical material tests, all 123 scene preparation/release episodes, full suite 2542 passed, production build and actual Stock/Advanced Chromium scene/drive/reload/smash rendering with zero fatal application or WebGL errors. Evidence: docs/c2-native-material-render-re.md and docs/c2-native-resource-registration-re.md. Rare unauthored flags, full software-palette rasterization and GPU precision differences remain explicit renderer limits; this does not claim full rasterizer parity.
<!-- SECTION:FINAL_SUMMARY:END -->
