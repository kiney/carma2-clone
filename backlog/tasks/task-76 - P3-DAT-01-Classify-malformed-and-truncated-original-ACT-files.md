---
id: TASK-76
title: '[P3] DAT-01: Classify malformed and truncated original ACT files'
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-15 21:23'
labels:
  - priority-3
  - DAT-01
  - assets
  - legacy-data-issue
dependencies: []
references:
  - docs/compatibility.md
priority: medium
ordinal: 3085
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **DAT-01**
Numeric priority: **3** (1 is highest)
Original status: **Data issue**
Category: **Original Data and Asset Compatibility**

## Scope and evidence

Classify `PROG.ACT` without the expected BRender header and the truncated Advanced Digga ACT more precisely; clarify required uses and possible safe handling.

## Source references

[Compatibility](../../docs/compatibility.md)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DMG-06 all-car census corrects the Advanced DIGGA classification: ACT has a complete END record at2648..2655 followed by one newline byte at2656 (2657 bytes total). The current parser rejects the trailing byte; an audit-only in-memory trim permits complete hierarchy inspection. Original file unchanged. This is trailing-data compatibility, not an established truncated hierarchy. See tools/audit-car-wam.mjs and ignored artifacts/car-wam-audit.json.
<!-- SECTION:NOTES:END -->
