---
id: TASK-112
title: >-
  [P1] DMG-06: Bind variant-specific WAM data so Gold Eagle bodywork can crush
  and detach
status: next
assignee: []
created_date: '2026-10-15 19:11'
updated_date: '2026-10-15 19:12'
labels:
  - priority-1
  - DMG-06
  - damage
  - assets
dependencies: []
references:
  - src/damage.ts
priority: high
ordinal: 1265
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verified in the paused user playtest: Stock desert2 at158.76s, data/CARS/eaglegold/EAGLEGOLD.TXT. Engine damage87, health13, deformationRevision35, but runtimeParts is empty and all28 captured damage meshes have zero position-coordinate displacement from their original arrays. Invulnerability is false. This is an asset-binding defect, not merely weak impact tuning or an unchanged render buffer.

The Gold TXT contains a legacy EAGLE3.WAM token. DamageSystem.init first tries that name in the car directory, then globally matches the filename, selecting a normal Eagle WAM. Its EAGLENEW.ACT/EIIIFBMP.DAT identifiers do not match the actual Gold EAGLENEX.ACT/EIIIFBMX.DAT actor hierarchy. The original Gold archive contains EAGLEGOLD.WAM with matching variant identifiers. Strict matching therefore binds zero runtime parts; applyModelCrush iterates those parts while collision-shape/component damage can still advance. The geometry/collision mismatch also warrants regression coverage.

Audit native WAM filename selection and resource scope before fixing; do not introduce fuzzy actor-name matching or modify original files. Check other Eagle color variants and Stock/Advanced resource precedence. Preserve the paused scene; private evidence and screenshot are in artifacts/gold-crush-paused.json, gold-crush-binding.json and gold-crush-paused.png.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Resolve the correct authored WAM in the selected car/resource scope, supported by native loading evidence; report unresolved or zero-part bindings instead of silently accepting them.
- [ ] #2 Original Gold and representative other variants bind expected principal/detachable actors; Stock and Advanced assets remain isolated appropriately.
- [ ] #3 Localized impacts change actual Gold body vertices and corresponding damage/collision state; repeated impacts, detachment and repair work in numerical tests and Chromium.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Independent read-only original-asset reproduction confirms the binding failure: normal WAM with Gold geometry gives0 runtime parts, component damage and hull revision but zero mesh influence. In an isolated in-memory configuration using the actual Gold WAM,18 parts bind and a matching impact deforms front body/bumper/wing (maximum influence approximately0.804). No original file or live state was changed. All11 inspected Eagle recolors contain the stale EAGLE3.WAM token while providing their own variant WAM: black, blue, blue2, cyan, gold, green, lime, pink, purp, white and yellow. Native filename-selection details remain to verify during implementation; do not guess an alias rule from the suffixes.
<!-- SECTION:NOTES:END -->
