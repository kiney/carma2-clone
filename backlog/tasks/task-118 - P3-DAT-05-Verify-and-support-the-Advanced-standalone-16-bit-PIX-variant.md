---
id: TASK-118
title: '[P3] DAT-05: Verify and support the Advanced standalone 16-bit PIX variant'
status: done
assignee: []
created_date: '2026-10-24 17:09'
updated_date: '2026-10-24 17:33'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Offline follow-up: community parser and CarEd menu-image documentation establish the headerless C2 RGB565 variant as intentional. Implement a narrowly scoped bounded reader with exact sequential field/data/END validation; retain strict standard-chunk validation. Audit every original variant and exercise preview fallback without requiring physical display.

Implemented a separately identified bounded headerless format5 RGB565 reader; standard chunk parsing is unchanged. Validates dimensions/stride/count/data length/reserved fields and exact END. All 96 original Advanced fragments now parse; UI census321/321containers. Car selection composes six standalone PIX16 fragments when no packed preview exists, with complete indexed PIX8 fallback. Four parser tests include malformed lengths/records, every nonempty truncated prefix and offset Uint8Array; original Eagle and DIGGA composition checks, six audit tests, existing12format tests and production build pass. Community tooling used as evidence only, no code copied. DAT06 resource scope remains separate.

Headless Chromium selection regression additionally passes with actual Advanced DIGGA standalone preview192x128, Stock/Advanced scene loads, English selector interaction and no fatal runtime/console/request errors. Validation uses SwiftShader while desktop locked; no physical-display/performance claim.
<!-- SECTION:NOTES:END -->
