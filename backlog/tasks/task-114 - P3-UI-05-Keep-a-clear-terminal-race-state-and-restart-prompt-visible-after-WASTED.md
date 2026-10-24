---
id: TASK-114
title: >-
  [P3] UI-05: Keep a clear terminal-race state and restart prompt visible after
  WASTED
status: done
assignee: []
created_date: '2026-10-17 19:43'
updated_date: '2026-10-24 18:00'
labels:
  - priority-3
  - UI-05
  - ui
  - feedback
dependencies: []
references:
  - src/main.ts
priority: medium
ordinal: 3112
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Live Timber inspection on 2026-10-17 confirms the apparent post-WASTED freeze is the implemented terminal-race transition: player wastedAt=394.12 seconds, simulation stops exactly at404.12 seconds, race.status=failed. Renderer remains responsive (approximately51-60FPS); final physics ticks take approximately3.4-4.5ms, so this case is not a hung main thread. Enter already restarts a finished race.

The transient YOU ARE WASTED / ENTER TO RESTART message expires after ten wall-clock seconds. The generic message cleanup then replaces it with PAUSED or an empty string, leaving a motionless world without persistent terminal-state feedback. Keep a clear English race-ended/WASTED indication and restart action visible until restart or another explicit screen transition. Preserve native WASTED sound/lettering, the ten-second wreck simulation and pause behavior. Do not treat normal race termination as the unrelated active-play performance stall.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Terminal failed/wasted state remains clearly visible after transient notifications expire and through pause/resume, with an explicit restart instruction or action.
- [x] #2 Preserve the existing ten-second post-WASTED simulation countdown, original WASTED feedback and Enter restart behavior.
- [x] #3 Verify in Chromium that the renderer/UI stays responsive and terminal messaging cannot be cleared into an apparently frozen unexplained scene.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Selected for headless-safe UI state fix: persistent English terminal message/restart instruction after transient notifications expire, preserving native WASTED canvas/audio, ten-second wreck simulation and Enter restart. Verify actual DOM after transient expiry and pause/menu changes without a physical display.

Persistent terminal-state fallback now underlies transient notices: wasted/time-out restart instructions survive expiry and pause/resume; completed races retain payout skip then restart. Dedicated visible pause-menu status handles hidden HUD. Valid reload clears feedback after preflight. Native WASTED canvas/audio, wreck countdown, payout timing and Enter path unchanged. Five pure tests and actual headless Chromium explicitWASTED/completed UIstate fixtures pass; frames continue, paused promptvisible, payoutskip and restarts work. Fixtures test UI state, not physical crash reproduction. See docs/race-feedback.md.
<!-- SECTION:NOTES:END -->
