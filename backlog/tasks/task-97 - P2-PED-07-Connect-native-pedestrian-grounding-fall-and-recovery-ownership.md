---
id: TASK-97
title: '[P2] PED-07: Connect native pedestrian grounding, fall and recovery ownership'
status: done
assignee: []
created_date: '2026-10-11 16:33'
updated_date: '2026-10-29 21:06'
labels:
  - priority-2
  - PED-07
  - pedestrians
  - source-PED-03
dependencies:
  - TASK-96
  - TASK-19
references:
  - src/ped-native-grounding.ts
  - src/ped-ground-cache.ts
  - src/ped-process-cache.ts
  - src/ped-native-proximity.ts
  - src/ped-recovery-effects.ts
  - src/physics/ped-halt.ts
  - docs/c2-ped-native-grounding-re.md
  - docs/c2-ped-process-cache-re.md
  - docs/c2-ped-proximity-re.md
  - docs/c2-ped-quiet-volume-re.md
priority: high
ordinal: 2097
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extracted from **PED-03 / TASK-35** on 2026-10-11.
Numeric priority: **2** (inherited from PED-03).
Status: **Backlog follow-up**; this work is not required to close the narrowed population-counting task.

## Remaining outcome

Connect the actual population root/ACT/body to the 85-slot grounding cache and 100-record canonical process pool, finite ordered faces, recovery recache, direction/proximity/object scans and selected-face release. Complete living fall/get-up/halt/completion and retained-root recovery, including mixed car/prop quiet-state providers and selected-volume/low-gravity body/moved continuations. Resolve or explicitly reject the unchecked negative prepared-floor-group ownership boundary from the installed scanner; do not fabricate group zero or substitute a browser identifier for pointer-based native state. Preserve source RNG and phase ownership and existing avoidance behavior. This owns grounding/recovery integration, not a second implementation of PED-02 reactions or ANI-01 animation playback.

## Existing evidence and limitations

Canonical RescanPedProximity and bounded cache/ground binding match original-function captures; native recovery/head/slick kernels exist. Their normal scene ownership, living recovery and mixed providers remain incomplete.

## Related owners

The preserved pre-split evidence is in TASK-35. Keep PED-01/PED-02/PED-05 completed scope intact; source-faithful kernels and controlled fixtures alone do not prove production population parity.

Source task: [PED-03 / TASK-35](task-35%20-%20P2-PED-03-Implement-native-pedestrian-impacts-falls-recovery-and-body-contacts.md).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Normal enrolled owners acquire/reuse/release the original bounded process/ground records and actual retained source face identities in evidenced order.
- [x] #2 Living fall, blocked-ground retry, recovery direction/head/proximity and move completion run exactly once from their owning phases with Stock/Advanced coverage.
- [x] #3 Car/prop contact normals, quiet/recovery state and selected-volume forces use actual source data rather than an invented floor normal or generic impulse.
- [x] #4 Unsupported negative groups/providers are explicit and mutation-safe; cache rollover, offscreen visits and reset are deterministic and bounded.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PED-06 foundation is complete:normal population now owns native FORM/PHIL bodies, canonical100-process/85-face caches, selected ordinary support, source steering/object scan and a real cache-only RecacheAndSetFace recovery outlet. Continue detailed fall/get-up/low-gravity/vanish integration and unsupported prepared-group floor branches; source boundaries stay explicit. See docs/ped06-production-integration.md.

User authorized PED-07, PED-08 and PED-09 in that implementation order. PED-07 starts alone; isolated /tmp/carma-ped07 preserves the paused playtest and prior production builds. Audit remaining source ground/recovery/quiet/volume providers, reuse existing conformance kernels, validate real Stock/Advanced population and checkpoint before PED-08.

Completed normal population recovery and volume integration. Fixed duplicate native simple/bone quiet ownership with failing-before regressions; actual Stock72→81→41 and Advanced72→80→41 browser sequences each halt/complete once and release selected ground. Corrected NULL support and best-positive-Y halt normal, mutation-safe recovery preflight, vanish release/count without Kill, selected-volume process/activation/moved phases. Full suite3580:3569 pass,5 optional local captures skip,6 sandbox EPERM startup cases; startup rerun8/8 passes with localhost access. Final focused regressions, TypeScript/build, serial Stock/Advanced browser and hardware DevTools MCP recovery pass with no provider/console/HTTP/WebGL errors. Explicit source negative-group OOB and exceptional ownership boundaries retained. See docs/ped07-production-integration.md.
<!-- SECTION:NOTES:END -->
