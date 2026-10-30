---
id: TASK-119
title: '[P3] DAT-06: Trace Advanced texture names outside current load scope'
status: backlog
assignee: []
created_date: '2026-10-24 17:09'
updated_date: '2026-10-30 15:11'
labels:
  - priority-3
  - DAT-06
  - assets
  - materials
  - topic-quality
dependencies: []
references:
  - docs/advanced-assets-audit.md
priority: medium
ordinal: 3091
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
DAT-04 inventories MAT texture labels that either exist elsewhere in the installation or have no basename/parsed-map-name match in the audited containers. Trace owning scene/ACT/MAT and original resource-loading scope, including unparsed format containers, before claiming data is missing. Correct proven runtime lookup gaps without global basename substitution or cross-installation namespace leakage. Retain explicit distinctions between unresolved labels, unsupported containers and genuinely missing resources.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Read-only follow-up (2026-10-24): the 38 outside-scope occurrences reduce to 15 distinct labels. Advanced PIXELMAP contains candidates for 30 occurrences; eight refer to foreign car/race packages and do not justify cross-package lookup. All 374 previously unaudited Advanced P08 containers parse, with no unmatched-label hits. Of 51 unmatched occurrences, 40 concern ten destroyed Carrier aircraft textures with actual DAT material consumers across four tracks; five car occurrences have no local DAT/ACT references; six REG labels need procedural-consumer tracing. Installed LoadInRegistees at 0x486cb0 loads application REG/PIXELMAP; RealLoadPixelmap at 0x48eaa0 searches graphics-root then pedestrian-root PIXELMAP on demand. A blanket Advanced startup library is not proven. Remains open pending call-site/registration order, PIX16/TIFF precedence and namespace evidence. Private reports in /tmp/dat06-*.json are not committed.
<!-- SECTION:NOTES:END -->
