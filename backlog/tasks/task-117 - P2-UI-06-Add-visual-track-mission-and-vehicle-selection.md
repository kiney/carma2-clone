---
id: TASK-117
title: '[P2] UI-06: Add visual track, mission and vehicle selection'
status: done
assignee: []
created_date: '2026-10-24 15:50'
updated_date: '2026-10-24 16:20'
labels:
  - priority-2
  - UI-06
  - ui
  - selection
dependencies: []
references:
  - src/selection-menu.ts
  - src/selection-previews.ts
  - src/selection-catalog.ts
priority: high
ordinal: 2117
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the flat race and car dropdowns with image tiles. Group reused race environments so players can recognize a location and then choose its named race or mission with clear objective information. Load previews from the locally supplied original installation, preserve Stock/Advanced identities, persisted selection, race loading and debug tools, and keep all authored UI in English. Do not bundle proprietary previews.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Track and vehicle selection use real local-asset preview images with accessible selectable tiles and useful missing-image fallbacks.
- [x] #2 Races sharing an environment are grouped while every existing playable race/mission remains individually selectable with clear names and objectives.
- [x] #3 Stock/Advanced distinction, saved selection, keyboard access, responsive layout, loading and pause/debug behavior remain usable.
- [x] #4 Production build and focused real-browser selection/loading checks pass without fatal console errors.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented location -> event/mission -> vehicle tiles with native LOCATION names, Stock/Advanced/All filters, search, pressed-state keyboard buttons, persisted load selections, responsive layout and sticky load/debug actions. Original CarImage P16/P08 fragments are composited with the installed changecar.txt positions (192x128 stock artwork), not mistaken for separate car views. Location previews render original ACT/DAT/MAT/PIX geometry once using an isolated disposable 400x220 renderer, with no simulation; new jobs start only while the menu is open and idle. Native map-series identities group variants; unknown/custom naming is documented as heuristic and never removes events. Optional preview errors retain selectable labelled tiles; malformed add-on selection metadata is isolated. Original files remain untouched; session previews and screenshots are not bundled or committed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Validated production build; full npm test passed 3145 tests before adding the final native fragment regression, which passed separately together with five catalog tests. Production browser-selection regression passed Stock/Advanced images, mission selection, keyboard activation, saved selection/reload and 390px layout with no console/request errors. Existing browser-debug regression passed real driving, timer freeze, credit/powerup grants and repair paths with GL error0. Headed Chrome DevTools MCP verified desktop/narrow screenshots, actual Eye of the Beaver mission loading and final production menu with no warning/error console messages. Preview and grouping tests are registered in npm test; npm run test:selection exposes the focused browser check. Known limitation: custom map-series naming may group differently, and thumbnails can take a moment to generate on first browsing.
<!-- SECTION:FINAL_SUMMARY:END -->
