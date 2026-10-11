---
id: TASK-19
title: '[P2] WLD-03: Match world animation, actor ordering, and native face collection'
status: wip
assignee: []
created_date: '2026-10-11 15:13'
labels:
  - priority-2
  - WLD-03
  - world
  - legacy-partial
dependencies: []
references:
  - src/main.ts
  - src/world.ts
  - src/animation.ts
priority: high
ordinal: 2010
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **WLD-03**
Numeric priority: **2** (1 is highest)
Original status: **Partial**
Category: **Physics and world**

## Scope and evidence

World GROOVE poses, actor hierarchies and 212 stock blocks are integrated. Installed outer-frame done/visibility gates, quantized harmonic motion, native interruption/resume thresholds and first-matching-actor stop callbacks now execute from finite face collection. A shared 300-face cache uses wheel-extended bb2 bounds, strict containment and native rollover. Pre-batch ACT/DAT metadata and original mesh references now survive render batching and collision rebuilds, including mirrored winding, live retained actors and smash/dynamic eligibility. Remaining gaps: original prepared model-group/face traversal order, interleaved ACT callbacks and separate drivable-object collection ordering. Water planes now follow cache-refresh-only last-! pointer semantics and suspension-extended bounds; complete automatic-entry rays and owner eligibility remain separate gaps. Standalone tools retain an explicitly separate per-tick animation fallback. Installed ModelPickBox finite clipping now preserves strict boundary asymmetry and exact Float32 intersections (3,000 original-function checks). Track source snapshots retain source-local native face equations and effective updateable flags; Authored ACT BOUNDS, local MODEL/MAT bindings and source roots are retained. Native prepend/relink/column topology, MODEL-before-children actor picking and stable track-face migration now have installed-binary conformance checks; current MODEL cached-face resources preserve compacted indices, original provenance and destination pivots. Finite native MODEL admission now matches4,000 installed-function cases, including prepared/pivot geometry, strict clipping and current UV/flag ownership. Installed FindFacesInBox now has tested X-outer/Z-inner, expanded-column and additional-root orchestration, including capacity-zero callbacks. Initial BrActorToBounds/ExtractColumns layout now reaches the live source snapshot before track mutations, with exact Stock/Advanced checks. Installed load-time MungeTrackModel shared-edge flags now reach live collision surfaces before track mutations, with actual raw MAT identities, immutable DAT provenance and render-order/mirrored batching preservation (494 native capture packets; Stock/Advanced Chromium). These query owners are not yet the production collector. Complete native noncar/powerup load mutations and multi-material heap-order/prefix integration remain open. Native MAT admission now retains first exact duplicates, newest case-folded registry lookup with exact extensions, all admitted MODEL identities and raw TWT enumeration; production edge preparation and rendering use these real surviving resources (Stock/Advanced Newcity and Airport tests; Chromium scene/drive/race checks). Host MAT allocation/free episodes now supply genuine owned addresses, but complete native preparation/collector callbacks and original heap chronology remain unresolved.

## Source references

[main.ts](../../src/main.ts), [world.ts](../../src/world.ts), [animation.ts](../../src/animation.ts)
<!-- SECTION:DESCRIPTION:END -->
