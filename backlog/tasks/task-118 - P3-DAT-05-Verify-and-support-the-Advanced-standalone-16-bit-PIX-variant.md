---
id: TASK-118
title: '[P3] DAT-05: Verify and support the Advanced standalone 16-bit PIX variant'
status: backlog
assignee: []
created_date: '2026-10-24 17:09'
labels:
  - priority-3
  - DAT-05
  - assets
  - formats
dependencies: []
references:
  - docs/advanced-assets-audit.md
priority: medium
ordinal: 3090
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
DAT-04 identifies 96 Advanced UI PIX16 files (8238 bytes,64x64,format5) with a shared serialization convention: a 0x3d header length overlaps the next 0x21 chunk by four bytes, and pixel-chunk length excludes its count/element-size metadata. Conventional PIX8 counterparts parse. Trace original C2/BRender loader acceptance or a verified writer before adding a bounded adapter. Determine the actual consumer and missing parent PIXIES libraries for affected add-on car images. Preserve strict rejection for unrelated corrupt inputs and original read-only files; do not infer validity from repeated size alone.
<!-- SECTION:DESCRIPTION:END -->
