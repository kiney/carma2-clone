---
id: TASK-20
title: >-
  [P2] WLD-05: Integrate native world awards, triggers, debris, and surface
  effects
status: done
assignee: []
created_date: '2026-10-11 15:13'
updated_date: '2026-10-28 22:34'
labels:
  - priority-2
  - WLD-05
  - world
dependencies: []
references:
  - src/main.ts
  - src/world-smash.ts
priority: high
ordinal: 2010
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **WLD-05**
Numeric priority: **2** (1 is highest)
Original status: **Partial**
Category: **Physics and world**

## Scope and evidence

Authored awards and nearby human-car powerup triggers dispatch through native final-flush ordering. Follow-up cuboids share delayed slots and preserve source/target context. Abstract shrapnel, ghostparts and physical noncar debris consume original resources, with Stock/Advanced Chromium checks and actual retained MAT identities/live host-resource address ordering. World/WAM slicks now dispatch to the same 32-slot pool as charged oil, retaining source ACT/MODEL, original materials, delayed placement, outer-frame processing and graphics-produced wheel masks. Installed Stock/Advanced world/WAM payloads contain no slicks; original pedestrian slick settings and explicit connotation fixtures exercise the outlet. Native corpse recovery now queues original GIBSLICK/GIBSMEAR resources into the shared pool with verified CRT, latch, delayed ACT/MODEL and resource-reuse semantics; Stock/Advanced native-wrapper Chromium checks cover actual contact and recovery. The normal legacy population still uses its separate blood outlet. The selected independent world scope is complete: production followups retain the native finite 400-face prefix and distinct generated ACT identities, immediate source-edge flags publish coherently before deferred tiers, real pickup ACTs use shared final-flush grants/hide/respawn, and fancy awards use original fonts/slots/priorities. Existing original MAT/fog adaptation is retained. Ordinary native population/corpse production remains explicitly owned by PED-06/TASK-96 and PED-09/TASK-99. The uncatalogued native parallel branch reads uninitialized scratch and remains explicitly unsupported under DMG-02/TASK-22; all 111 catalogued Stock/Advanced directions are away. Host material addresses do not claim historical Windows heap parity.

## Source references

[main.ts](../../src/main.ts), [world-smash.ts](../../src/world-smash.ts)
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-27 02:52
---
DMG-01 completion now supplies shared WAM/world debris dispatch, pre-RNG visual gates, ACT-owned explosion/slick frames and source-scoped explosion textures. Reuse these completed outlets rather than reimplementing them; remaining world-specific cases remain in this task.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed selected independent single-player world integration. Build and 3,351 numerical/original-asset tests pass (five optional capture skips). Four Stock/Advanced world-effect cases and followup/Carrier browser regression pass without fatal console/asset/WebGL errors. Ordinary native pedestrian production remains with TASK-96/TASK-99; undefined parallel mod behavior remains TASK-22.
<!-- SECTION:FINAL_SUMMARY:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Native followups preserve finite collector order, actual ACT/source identity, immediate edge-mask coherence and direct pickup grants/respawns.
- [x] #2 Original world awards and fancy outlets share normal effect ordering and retain independent source ownership.
- [x] #3 Original Stock/Advanced browser cases and full Carrier objective chain pass; scoped PED and unsupported mod/network boundaries are documented.
<!-- AC:END -->







## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Queue review 2026-10-26 — position 4/5, P2.
Follow DMG-01 so car/world changes to the common connotation dispatcher are reviewed serially. WLD-01, WLD-02 and WLD-03 are already done; do not treat their existing providers as missing prerequisites. DMG-02 overlaps the remaining parallel-followup, prepared-face-order and headup work, but its ordinary shared queues/outlets already exist.
Scoped external prerequisite: completing the remaining ordinary-population/native-corpse effect integration requires PED-06 (TASK-96) and PED-09 (TASK-99), with the latter retaining its PED-08 and other transitive prerequisites. This does not block independent world awards, materials, triggers, debris or followup work. Keep that acceptance boundary explicit instead of making all world work wait for the whole pedestrian stack.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PERF-08 validation (2026-10-12): the additional production browser-smash-followup harness reaches the Carrier core contact but fails its fixed actor-name assertion at tests/browser-smash-followup.mjs:558. Actual &coR0|03.ACT versus expected &coR0122.ACT. The unchanged c89adfa source/build reproduces exactly the same failure, so this is not a bounds-cache regression. Investigate whether the assertion assumes an outdated renderer/native ACT identifier or native smashable-name binding is incomplete; preserve the native identifier semantics rather than weakening the assertion without evidence. Final Carrier completion is not validated by this particular run. Current MODEL bounds and Stock/Advanced collector rows/callbacks compare exactly with caching disabled. Logs: /tmp/perf-08-browser-smash.log and /tmp/perf-08-baseline-browser-smash.log.

2026-10-28 completion supersedes the historical PERF-08 Carrier-name failure above. Fixed source MODEL/ACT adapters and verified the full Carrier chain through eighteen real ACT targets, eight due pickup ACTs and the actual ADMIRAL death completing19. The objective fixture uses existing debug invulnerability during wait periods, not seeded counters or relaxed award gates. Source edges/collector and pickup-hit evidence: docs/c2-world-smash-source-edges-re.md and docs/c2-pickup-act-re.md.
<!-- SECTION:NOTES:END -->
