---
id: TASK-122
title: '[P3] PUP-21: Restore eligible world pickups using authored respawn policy'
status: done
assignee: []
created_date: '2026-10-24 19:58'
updated_date: '2026-10-24 20:24'
labels:
  - priority-3
  - PUP-21
  - powerups
dependencies: []
references:
  - src/powerup-respawn.ts
  - src/powerup-respawn-effects.ts
  - src/powerups.ts
  - src/main.ts
documentation:
  - docs/c2-powerup-respawn-re.md
priority: medium
ordinal: 3093
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bounded follow-up to PUP-17. Parse original POWERUP.TXT respawn masks and GENERAL timing/effect records; schedule actual world pickup actors in the native 100-slot, first-free queue and reactivate them after the original signed deadline. Keep debug/connotation grants without actors out of the queue. Restore actor visibility only, preserving transforms/model state. Dispatch only native respawn sound, visibility-gated explosions and slick outlets. Keep the separate current swept-radius collection/source approximation explicitly open in PUP-17.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Single-player respawn masks and timing come from original tables, with bounded parser errors and optional asset-free fixtures.
- [x] #2 Queue capacity, first-free order, signed deadline arithmetic, original collected index and post-expiry/pre-final-flush timing match verified native behavior.
- [x] #3 Only world collections schedule actors; normal pause freezes respawns but debug race-timer freezing does not; race disposal clears pending state.
- [x] #4 Original respawn sound/VFX use dedicated native outlets without generic gameplay connotation side effects; numerical and bounded headless browser checks pass.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented original respawn masks/settings, fixed first-free 100-slot queue, signed deadline arithmetic and post-delay/pre-final-grant hook. Actual world collections retain their original index; null-source grants do not queue. Restoration changes visibility/render style only; disposal clears slots. Dedicated original sound/visible-explosion/slick outlets ignore generic gameplay connotation channels. Full live ACT matrices and MODEL-local bounds are retained. A strengthened browser check caught missing TWINK/BING preloads; startup now loads every authored respawn frame. Focused policy/parser/effect/source/phase/matrix checks and full 3276-case original suite pass. Final production browser check passed original Newcity/Eagle3: 120000ms/deadline boundary, disabled entries, original actor/mesh restoration, sound5402 gain1, fourteen visible original-textured sprites, timer-freeze-independent live respawn using explicit300ms fixture, pause and reload cleanup. Confirmed ANGLE/Vulkan SwiftShader, WebGL2 1280×800; no console, request, respawn-warning or GL errors. PUP-17 native wheel/body contact and source integration remains open; network notification/spatial audio remain separate.
<!-- SECTION:NOTES:END -->
