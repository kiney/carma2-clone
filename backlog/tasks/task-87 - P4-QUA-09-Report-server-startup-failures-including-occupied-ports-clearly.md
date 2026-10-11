---
id: TASK-87
title: '[P4] QUA-09: Report server startup failures, including occupied ports, clearly'
status: wip
assignee: []
created_date: '2026-10-11 15:14'
labels:
  - priority-4
  - QUA-09
  - quality
  - legacy-partial
dependencies: []
references:
  - server/dev.mjs
priority: low
ordinal: 4083
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **QUA-09**
Numeric priority: **4** (1 is highest)
Original status: **Partial**
Category: **Robustness, Testing, and Maintainability**

## Scope and evidence

Handle server startup errors, especially an occupied port, with a clear message instead of an unhandled `EADDRINUSE` stack trace.

## Source references

[server/dev.mjs](../../server/dev.mjs)
<!-- SECTION:DESCRIPTION:END -->
