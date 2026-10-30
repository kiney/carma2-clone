---
id: TASK-138
title: '[P3] QUA-15: Diagnose intermittent Vite HMR shutdown test timeout'
status: backlog
assignee: []
created_date: '2026-10-30 20:28'
updated_date: '2026-10-30 22:06'
labels:
  - priority-3
  - QUA-15
  - topic-quality
  - tests
dependencies: []
priority: medium
ordinal: 3136
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Known unrelated intermittent test: tests/server-startup.test.mjs development server closes Vite before waiting on its open HMR socket sometimes exceeds its15000ms shutdown deadline. Previously recorded during PERF-25 and AI-04; recurred during PED-12 asset-free checkout with a Vite dependency-scan Request is outdated/restarted or closed message. Other server tests and an isolated8/8 run pass. No server code changed in PED-12. Investigate shutdown/dependency-scan/HMR race and deterministic reproduction before changing timeouts; do not blanket retry or weaken the assertion. Original gameplay freeze is separate PED-12.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reproduce or explain the shutdown ordering race and separate dependency scan from lingering socket ownership.
- [ ] #2 Fix root lifecycle ownership while retaining bounded exit and port-release assertions; asset-free CI and focused server tests pass.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Also recurred in PED-14 asset-free CI: only Vite-HMR shutdown case exceeded15s while dependency scan reported Request is outdated during close. All collision/recovery tests passed; no server source changed. Original-data full suite was green. Keep separate from gameplay stutter.
<!-- SECTION:NOTES:END -->
