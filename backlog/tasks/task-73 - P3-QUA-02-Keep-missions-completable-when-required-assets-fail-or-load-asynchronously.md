---
id: TASK-73
title: >-
  [P3] QUA-02: Keep missions completable when required assets fail or load
  asynchronously
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
labels:
  - priority-3
  - QUA-02
  - quality
  - legacy-needs-validation
dependencies: []
references:
  - src/main.ts
  - src/rules.ts
priority: medium
ordinal: 3076
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **QUA-02**
Numeric priority: **3** (1 is highest)
Original status: **Needs validation**
Category: **Robustness, Testing, and Maintainability**

## Scope and evidence

Check missions when opponents or pedestrians fail to load or load asynchronously; a missing required asset must not make a mission inexplicably impossible to complete.

## Source references

[main.ts](../../src/main.ts), [rules.ts](../../src/rules.ts)
<!-- SECTION:DESCRIPTION:END -->
