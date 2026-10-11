---
id: TASK-67
title: '[P3] REN-02: Implement additional original BRender material and lighting rules'
status: wip
assignee: []
created_date: '2026-10-11 15:14'
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
