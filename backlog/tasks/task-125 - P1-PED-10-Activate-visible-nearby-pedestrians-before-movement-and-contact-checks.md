---
id: TASK-125
title: >-
  [P1] PED-10: Activate visible nearby pedestrians before movement and contact
  checks
status: done
assignee: []
created_date: '2026-10-29 01:31'
updated_date: '2026-10-29 01:48'
labels:
  - priority-1
  - PED-10
  - pedestrians
  - reported
dependencies: []
references:
  - src/pedestrians.ts
  - src/main.ts
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User reproduced a visible stationary pedestrian directly ahead of Eagle that can be driven through in the current animation build. Live Newcity1 at gameTime25753ms: ped-spec1-456 alive=true, active=false, visible=true, retained dormant=true, frame0, no native body owner. Actor[-11.406754,-.810648,-34.610630], player[-11.455116,-.817797,-33.535243], camera[-11.596579,-.407868,-32.518198]. It is inside both native process12 and popup9 boxes, so the original popup admission predicate rejects it permanently while extended presentation renders it.

Fix the browser-added presentation/processing inconsistency: already presented dormant actors must become normally processed when inside the unchanged native process box, including same-update contact checks. Keep distant presentation-only actors inactive and keep native/unopted popup behavior. Restore source camera-jump nearness invalidation without reordering camera and pedestrian phases. Preserve native-counted body ownership, reset/reload invalidation and the user's paused scene. Do not expand simulation to visual48 units or simply call resetCar once to hide the defect.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A previously presented dormant actor inside the native process/popup boxes animates and accepts a same-update ordinary hit.
- [x] #2 Distant retained actors and unopted native popup behavior, native transport ownership and reset/dispose semantics remain correct.
- [x] #3 Source camera-jump nearness hook retains strict threshold and original update phase; numerical and actual Chromium regressions pass.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented admission of retained visible dormant actors only within the unchanged process box, before ordinary movement/combat/hit checks; promotion immediately clears dormant matrix certification. Native/unopted popup suppression and distant frozen presentation remain. Restored rec2 reconstructed camera displacement>20 nearness invalidation after actual camera calculation, for the next population pass. Ten focused admission tests and39 combined native-rule/presentation/matrix/availability tests pass. Production build and two actual keyboard-driven Stock/Advanced original Newcity1 cases pass: captured targetinactive+visible+insidepopup beforefirstframe, activebeforehit with nearReset=false, exactlyone death/count, no console/request/GL errors. Docs/pedestrian-nearby-admission.md records source confidence and boundaries.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed the visible stationary/unhittable near-pedestrian deadlock caused by retained presentation interacting with native popup suppression. Simulation range is unchanged. No complete native PHIL/ANI parity claim.
<!-- SECTION:FINAL_SUMMARY:END -->
