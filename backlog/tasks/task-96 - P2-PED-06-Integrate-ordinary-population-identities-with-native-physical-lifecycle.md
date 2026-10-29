---
id: TASK-96
title: >-
  [P2] PED-06: Integrate ordinary population identities with native physical
  lifecycle
status: done
assignee: []
created_date: '2026-10-11 16:33'
updated_date: '2026-10-29 20:22'
labels:
  - priority-2
  - PED-06
  - pedestrians
  - source-PED-03
dependencies:
  - TASK-35
references:
  - src/pedestrians.ts
  - src/ped-native-runtime.ts
  - src/ped-native-gameplay.ts
  - src/ped-body-pool.ts
  - docs/c2-native-ped-spawn-re.md
  - tests/browser-ped-native-gameplay.mjs
priority: high
ordinal: 2096
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extracted from **PED-03 / TASK-35** on 2026-10-11.
Numeric priority: **2** (inherited from PED-03).
Status: **Backlog follow-up**; this work is not required to close the narrowed population-counting task.

## Remaining outcome

Bind existing, authored population identities to the native FORM/PHIL/render/process owners and their supported admission limits. Feed the real current root, pose and velocity into the existing native runtime without creating a second represented pedestrian. Replace the visual player sweep and estimated corpse transport only for genuinely admitted native owners, preserving unsupported personalities and explicit capacity behavior. Preserve current walking/avoidance behavior until its canonical owner is recovered; a movement adapter must be documented rather than described as native parity. Ordinary native wander/avoidance/acceleration and source load-time actor/face spawning chronology remain this task's explicit production-integration work, with WLD-03 supplying ordered track resources. Actor/animation selection belongs to PED-04; complete BON/SKL playback belongs to ANI-01.

## Existing evidence and limitations

Native runtime, contact kernels, FORM hosts and bounded pools already exist and are numerically tested. Current browser-native fixtures are controlled enrollments; normal PedestrianSystem still owns its independent actors, sweep and corpse transport.

## Related owners

The preserved pre-split evidence is in TASK-35. Keep PED-01/PED-02/PED-05 completed scope intact; source-faithful kernels and controlled fixtures alone do not prove production population parity.

Source task: [PED-03 / TASK-35](task-35%20-%20P2-PED-03-Implement-native-pedestrian-impacts-falls-recovery-and-body-contacts.md).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 At least one real authored ordinary population identity in each Stock/Advanced browser scene is admitted through FORM/PHIL and receives actual solver contacts; no duplicate population identity or collider is created.
- [x] #2 Passive activation receives the actual character velocity/mass/COM/inertia; admitted native owners bypass the old visual sweep and estimated second launch.
- [x] #3 Admission, offscreen/release/reacquisition, reload and capacity exhaustion retain original identities and bounded resources, with unsupported asset prerequisites reported explicitly.
- [x] #4 Population/count/mission ownership uses PED-03 and existing movement remains correct; native movement/spawn chronology is backed by source evidence before claiming parity.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
User selected PED-06 implementation. Audit live ordinary population versus controlled native enrollment; integrate in isolated /tmp/carma-ped06 to preserve playtest tabs. Root owns identity/lifecycle/render/physics integration, with narrow read-only source/API audits and deterministic tests before final browser checks. Preserve original assets, existing counting/animations, bounded source pools and explicit unsupported branches.

Implemented normal authored population→FORM/PHIL ownership, raw pre-migration MODEL/MAT/shared-CRT spawn chronology and marker loader order, canonical process/ground caches, source ordinary movement/object scan, actual contact/death/count bridge and bounded resource teardown. Supported owners never use legacy sweep, mean displacement or estimated second launch, including offscreen/capacity states. Corrected original buoyancy, default idle period/FSM fallback, objective flags, per-car electric range and repulsion event retention. Preserved PED-10 retained-visible admission and immediate matrix-certificate invalidation; capacity-denied nearby substitutes stay hidden. Details: docs/ped06-production-integration.md.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed and integrated. npm test:3551 passed, no failures/skips; production build passes. Stock/Advanced actual solver hits and once-only counting, bounded preallocated resource reuse, offscreen release/reacquisition and fresh race reload pass. Combat powerup and native nearby-admission browser regressions pass. Hardware Chromium via DevTools MCP:actual W-drive collision HP100→0, one native impact/count, zero console/WebGL errors. PED-07/08/09 retain their detailed recovery, articulation and full cause/effect scope.
<!-- SECTION:FINAL_SUMMARY:END -->
