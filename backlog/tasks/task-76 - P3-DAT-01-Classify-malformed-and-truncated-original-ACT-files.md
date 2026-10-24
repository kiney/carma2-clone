---
id: TASK-76
title: '[P3] DAT-01: Classify malformed and truncated original ACT files'
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-24 16:46'
labels:
  - priority-3
  - DAT-01
  - assets
  - legacy-data-issue
dependencies: []
references:
  - docs/actor-compatibility.md
  - tools/audit-actor-compatibility.mjs
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

Selected for the 2026-10-24 unattended session: classify actual original ACT anomalies and their consumers using read-only data, deterministic checks and concise evidence; preserve strict parser behavior unless independently justified.

Read-only classification is complete: both PROG.ACT entries are identical 13-byte text placeholders, not damaged ACT streams. Both HW/SW executables contain a PROG.ACT filename literal; original loading context remains unresolved, so no unused-file claim or permissive parser fallback was added. Advanced DIGGA has 122 known chunks and complete END bytes2648..2655, then one LF at2656; audit-only trimming parses one root. Production parser/installation unchanged, so this classification does not claim Advanced DIGGA loading is repaired. Corrected compatibility notes and added bounded reusable audit with CARMA2_ROOT support, hashes and explicit parser outcomes. Synthetic tests cover multiple root ENDs, trailing whitespace, unknown tags and bounds; original assertions pass and skip cleanly when absent.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
DAT-01 classification scope complete. Four focused tests pass with installed assets; absent-installation run passes three and skips the original case. Node/format/diff checks pass. Evidence and remaining original-consumer uncertainty are documented in docs/actor-compatibility.md; proprietary files were not modified or committed.
<!-- SECTION:FINAL_SUMMARY:END -->
