---
id: TASK-85
title: '[P4] QUA-07: Isolate or remove obsolete arcade-handling helpers'
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-11 16:03'
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
