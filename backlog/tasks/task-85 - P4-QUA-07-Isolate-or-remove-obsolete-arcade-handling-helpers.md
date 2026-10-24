---
id: TASK-85
title: '[P4] QUA-07: Isolate or remove obsolete arcade-handling helpers'
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-24 17:27'
labels:
  - priority-4
  - QUA-07
  - quality
  - legacy-partial
dependencies: []
references:
  - src/gameplay.ts
  - src/handling.ts
  - src/main.ts
priority: low
ordinal: 4081
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **QUA-07**
Numeric priority: **4** (1 is highest)
Original status: **Partial**
Category: **Robustness, Testing, and Maintainability**

## Scope and evidence

Remove or clearly isolate old arcade-handling helpers. They are not the active vehicle physics, but are still tested; `physicsConfigFromCar` continues to provide helper values, including for audio.

## Source references

[gameplay.ts](../../src/gameplay.ts), [handling.ts](../../src/handling.ts), [main.ts](../../src/main.ts)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Offline session: isolate unused arcade-only stepper/adapter and remove unread runtime configuration fields. Keep live race state, VehicleState and speedMph exports unchanged. Current source has no audio consumer of the adapter, correcting old task text. Validate import boundary, build and deterministic tests; no rendering behavior change intended.

Completed: moved unchanged arcade stepping/config helpers into explicitly named legacy modules; removed unread player/rival adapter assignments from production. Active VehicleState, VehicleInput, speedMph and race APIs remain in gameplay.ts. Eleven affected test imports updated; build, TypeScript and affected unit files pass. No active physics/audio behavior changed. Runtime source import audit finds no legacy module consumer.
<!-- SECTION:NOTES:END -->
