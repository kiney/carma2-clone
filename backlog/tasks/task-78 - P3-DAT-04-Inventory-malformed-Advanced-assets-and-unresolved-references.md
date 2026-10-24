---
id: TASK-78
title: '[P3] DAT-04: Inventory malformed Advanced assets and unresolved references'
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-24 17:09'
labels:
  - priority-3
  - DAT-04
  - assets
  - legacy-data-issue
dependencies: []
references:
  - docs/compatibility.md
  - docs/advanced-assets-audit.md
  - tools/audit-advanced-assets.mjs
priority: medium
ordinal: 3088
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **DAT-04**
Numeric priority: **3** (1 is highest)
Original status: **Data issue**
Category: **Original Data and Asset Compatibility**

## Scope and evidence

Inventory malformed Advanced MAT/UI PIX files and unresolved asset references; distinguish genuinely missing data from variants that are not yet supported.

## Source references

[Compatibility](../../docs/compatibility.md), [content.ts](../../src/content.ts)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Selected for bounded unattended read-only asset census: classify concrete Advanced parser/resource gaps and unresolved references with reproducible tooling, ignored reports and concise compatibility evidence. Do not mutate assets or silently relax parsers.

Completed serial original-data census with bounded ignored report and no parser/runtime changes:1029/1029 Advanced MAT files parse,225/321 selected UI PIX/P16 files parse,96 share a structurally distinct format5 serialization with overlapping/exclusive chunk-length conventions. Audited17327 MAT texture refs and2173 nested TIFFs; current scope resolution, outside-scope installed names and unmatched names remain distinct, not falsely labelled missing. Fixed audit scope for nested MAT/PIX siblings to owning race/car root. Report path guard rejects writes inside the original root, including symlinks. Six tests cover classification, generated malformed files, sibling scope, output safety and optional original census. Native PIX acceptance and residual texture consumers retained separately as DAT-05 and DAT-06.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
DAT-04 inventory/classification complete. Six focused tests pass including the approximately four-second read-only local census. Compatibility notes correct the old generic malformed-MAT claim. Runtime fixes are deliberately separate evidence-dependent follow-up tickets; no proprietary output is committed.
<!-- SECTION:FINAL_SUMMARY:END -->
