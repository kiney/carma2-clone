---
id: TASK-113
title: '[P1] AI-06: Prevent a valid short opponent path from freezing the whole game'
status: done
assignee: []
created_date: '2026-10-16 13:40'
updated_date: '2026-10-16 13:57'
labels:
  - priority-1
  - AI-06
  - ai
  - bug
dependencies: []
priority: high
ordinal: 20
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Live Chromium freeze on original Stock quarrynet with Green Eagle. Buffered Runtime reports 1,000 repeated uncaught Opponent next-slot metadata is missing errors. NativeOpponentFleet has two nodes and one authored section; BUZZ GetNearPlayer fills the valid projected route to twelve alternating references to that section. Browser GetNext guard treats absent global slot metadata as malformed and throws before physics/render every frame. Distinct from physics lockups and PERF-13. Preserve verified native global-slot type-2 quirk for existing metadata; define a safe browser boundary for undefined native out-of-bounds metadata. Original live scene and trace are saved under ignored artifacts/freeze-20261016.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Capture and explain the exact original-data AI failure without resetting the user scene.
- [x] #2 Valid small graphs with twelve-entry projected routes do not throw; native existing-slot/type-2 behavior and invalid-input checks remain intact.
- [x] #3 Original quarrynet GetNearPlayer transitions advance simulation and rendered frames without new console/WebGL errors.
- [x] #4 Focused headless and original-data Chromium regressions pass; document the native undefined-read boundary and commit the fix.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Confirmed original quarrynet graph: two nodes, one section; BUZZ GetNearPlayer objective start 21638 ms holds twelve valid alternating references to section zero. 1,000 retained uncaught exceptions abort every update before physics/render; this is an AI exception loop, not a demonstrated PHY/PERF deadlock. Native GetNext existing-slot/type-2 quirk retained; absent authored metadata now ends traversal at explicit browser undefined-read boundary. Original scene evidence saved before edits. Chrome155 live source editing is unavailable; attempted binding patch succeeded but Vite auto-reloaded despite an ineffective message listener, so running race state was reset (user informed), selections preserved. Diagnostics failures are separate from the application cause.

Final reviewed fix passes all 3,100 headless tests (no failures/skips), build, focused production quarrynet/Green Eagle GetNearPlayer browser scenario and existing Stock native-AI transitions. Negative control on baf9431 fails three new cases with the exact captured exception. Final focused browser run: 20 gameplay and 20 rendered frames, physics elapsed 1.60 to 2.68 seconds, player moves, valid twelve-entry section-zero route, no errors/failed requests/HTTP responses/WebGL faults; screenshot inspected. User tab is responsive and paused at reset quarrynet/Green Eagle start, selections preserved; original race state was lost to documented Vite reload. Added permanent browser-suite/script coverage and explicit workflow protection guidance. Source change only affects missing authored metadata, not collision/physics or native existing-slot/type-2/cheating behavior.
<!-- SECTION:NOTES:END -->
