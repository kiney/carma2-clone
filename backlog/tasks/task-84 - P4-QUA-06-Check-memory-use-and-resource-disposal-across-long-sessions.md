---
id: TASK-84
title: '[P4] QUA-06: Check memory use and resource disposal across long sessions'
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
labels:
  - priority-4
  - QUA-06
  - quality
  - legacy-needs-validation
dependencies: []
references:
  - src/content.ts
  - src/main.ts
priority: low
ordinal: 4080
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **QUA-06**
Numeric priority: **4** (1 is highest)
Original status: **Needs validation**
Category: **Robustness, Testing, and Maintainability**

## Scope and evidence

Check memory use across many race changes and long sessions; byte/texture caches have no eviction. Specifically monitor shared textures and disposal.

## Source references

[content.ts](../../src/content.ts), [main.ts](../../src/main.ts)
<!-- SECTION:DESCRIPTION:END -->
