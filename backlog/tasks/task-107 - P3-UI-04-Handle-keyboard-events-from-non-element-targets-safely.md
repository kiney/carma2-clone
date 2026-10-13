---
id: TASK-107
title: '[P3] UI-04: Handle keyboard events from non-element targets safely'
status: done
assignee: []
created_date: '2026-10-13 09:15'
updated_date: '2026-10-13 09:18'
labels:
  - priority-3
  - UI-04
  - controls
  - bug
dependencies: []
references:
  - src/main.ts
priority: medium
ordinal: 3095
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Controlled Chromium keyboard injection through Window reproduced an uncaught TypeError because the handler cast every event target to HTMLElement and called closest(). Check Element membership before testing editable controls; preserve normal canvas driving and input-field exclusion.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Window/document-targeted keyboard events do not throw and still reach driving controls; input/select/textarea/button events retain exclusion.
- [x] #2 Production build and controlled Chromium input/console checks pass.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Guard keyboard target checks with Element membership. Controlled Chromium Window/document events both produce throttle1; input/select/button/textarea events produce throttle0, no uncaught console errors, WebGL error0. Production build passes.
<!-- SECTION:FINAL_SUMMARY:END -->
