---
id: TASK-20
title: >-
  [P2] WLD-05: Integrate native world awards, triggers, debris, and surface
  effects
status: backlog
assignee: []
created_date: '2026-10-11 15:13'
updated_date: '2026-10-12 13:04'
labels:
  - priority-2
  - WLD-05
  - world
  - legacy-partial
dependencies: []
references:
  - src/main.ts
  - src/world-smash.ts
priority: high
ordinal: 2012
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **WLD-05**
Numeric priority: **2** (1 is highest)
Original status: **Partial**
Category: **Physics and world**

## Scope and evidence

Authored awards and nearby human-car powerup triggers dispatch through native final-flush ordering. Follow-up cuboids share delayed slots and preserve source/target context. Abstract shrapnel, ghostparts and physical noncar debris consume original resources, with Stock/Advanced Chromium checks and explicit prepared-material-order gaps. World/WAM slicks now dispatch to the same 32-slot pool as charged oil, retaining source ACT/MODEL, original materials, delayed placement, outer-frame processing and graphics-produced wheel masks. Installed Stock/Advanced world/WAM payloads contain no slicks; original pedestrian slick settings and explicit connotation fixtures exercise the outlet. Native corpse recovery now queues original GIBSLICK/GIBSMEAR resources into the shared pool with verified CRT, latch, delayed ACT/MODEL and resource-reuse semantics; Stock/Advanced native-wrapper Chromium checks cover actual contact and recovery. The normal legacy population still uses its separate blood outlet. Production population integration, complete race MAT/fog adaptation, exact packed face ordering at saturation, parallel followups and fancy headups remain open.

## Source references

[main.ts](../../src/main.ts), [world-smash.ts](../../src/world-smash.ts)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PERF-08 validation (2026-10-12): the additional production browser-smash-followup harness reaches the Carrier core contact but fails its fixed actor-name assertion at tests/browser-smash-followup.mjs:558. Actual &coR0|03.ACT versus expected &coR0122.ACT. The unchanged c89adfa source/build reproduces exactly the same failure, so this is not a bounds-cache regression. Investigate whether the assertion assumes an outdated renderer/native ACT identifier or native smashable-name binding is incomplete; preserve the native identifier semantics rather than weakening the assertion without evidence. Final Carrier completion is not validated by this particular run. Current MODEL bounds and Stock/Advanced collector rows/callbacks compare exactly with caching disabled. Logs: /tmp/perf-08-browser-smash.log and /tmp/perf-08-baseline-browser-smash.log.
<!-- SECTION:NOTES:END -->
