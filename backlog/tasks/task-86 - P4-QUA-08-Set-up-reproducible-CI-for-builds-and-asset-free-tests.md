---
id: TASK-86
title: '[P4] QUA-08: Set up reproducible CI for builds and asset-free tests'
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-24 16:51'
labels:
  - priority-4
  - QUA-08
  - quality
  - legacy-missing
dependencies: []
references:
  - .github/workflows/ci.yml
  - docs/continuous-integration.md
priority: low
ordinal: 4082
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **QUA-08**
Numeric priority: **4** (1 is highest)
Original status: **Missing**
Category: **Robustness, Testing, and Maintainability**

## Scope and evidence

Set up reproducible CI for builds and asset-free tests; keep local original-data tests cleanly optional. There is currently no CI configuration.

## Source references

[package.json](../../package.json), [tests](../../tests)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Selected for unattended implementation: reproducible asset-free build/test CI, with a local clean-copy test that does not hide or modify the original installation. Hosted execution is not assumed without an actual run.

Added .github/workflows/ci.yml with Ubuntu24.04, exact Node22.23.4 and full official action release SHAs, read-only contents permissions, no persisted checkout credentials, explicit original-installation absence check, npm ci, production build and asset-free npm test. Local isolated source copy omits original data and symlinks only installed node_modules; build passed and tests reported3101 total:2716 pass/385 skip/0 fail. Process tests required sandbox bind allowance; HMR shutdown timeout adjusted to bounded15s with child output for slower suite runs. YAML schema assertions and formatting passed. Hosted GitHub Actions has not run because no push was performed; installation from a fresh network cache was not locally re-executed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
QUA-08 CI setup complete and locally checked without original game assets. Workflow pins and commands were checked against official action/Node sources. Clean-copy build/test passes, optional original-data cases skip. Hosted execution remains explicitly unverified until a normal repository push triggers CI.
<!-- SECTION:FINAL_SUMMARY:END -->
