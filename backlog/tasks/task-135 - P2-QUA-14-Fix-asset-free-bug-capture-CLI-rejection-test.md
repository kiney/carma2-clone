---
id: TASK-135
title: '[P2] QUA-14: Fix asset-free bug capture CLI rejection test'
status: done
assignee: []
created_date: '2026-10-29 23:12'
updated_date: '2026-10-29 23:13'
labels:
  - priority-2
  - QUA-14
  - testing
  - bug-capture
dependencies: []
priority: high
ordinal: 2135
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
GitHub CI fails the protected-output test because carma2_orig is intentionally absent. The CLI correctly rejects the nonexistent parent before checking output scope, but the fixture expects only the later scope-rejection message. Reproduce without any original assets and preserve both output protections.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Protected output tests pass both with a local original installation and in an asset-free checkout, without weakening or changing CLI write protections.
- [x] #2 Asset-free full test suite and production build pass; original data and unrelated user changes remain untouched.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reproduced the exact CI assertion failure in an isolated git-archive checkout without carma2_orig. The fixture now checks the correct rejection phase for the actual directory state: existing original directory must reach scope rejection; absent original directory must reject the nonexistent parent. Added a separate missing-parent/no-creation regression. CLI implementation and write protections are unchanged. Focused CLI tests:6/6 pass both with original installation and asset-free. Full asset-free suite:3180 passed,428 original-data/optional cases skipped,0 failed. Asset-free TypeScript/production build passes. Validation used installed Node20; hosted Node22 was not rerun remotely. No original files or unrelated user files changed.
<!-- SECTION:NOTES:END -->
