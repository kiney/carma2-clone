---
id: TASK-112
title: >-
  [P1] DMG-06: Bind variant-specific WAM data so Gold Eagle bodywork can crush
  and detach
status: done
assignee: []
created_date: '2026-10-15 19:11'
updated_date: '2026-10-15 21:28'
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
- [x] #1 Resolve the correct authored WAM in the selected car/resource scope, supported by native loading evidence; report unresolved or zero-part bindings instead of silently accepting them.
- [x] #2 Original Gold and representative other variants bind expected principal/detachable actors; Stock and Advanced assets remain isolated appropriately.
- [x] #3 Localized impacts change actual Gold body vertices and corresponding damage/collision state; repeated impacts, detachment and repair work in numerical tests and Chromium.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Independent read-only original-asset reproduction confirms the binding failure: normal WAM with Gold geometry gives0 runtime parts, component damage and hull revision but zero mesh influence. In an isolated in-memory configuration using the actual Gold WAM,18 parts bind and a matching impact deforms front body/bumper/wing (maximum influence approximately0.804). No original file or live state was changed. All11 inspected Eagle recolors contain the stale EAGLE3.WAM token while providing their own variant WAM: black, blue, blue2, cyan, gold, green, lime, pink, purp, white and yellow. Native filename-selection details remain to verify during implementation; do not guess an alias rule from the suffixes.

2026-10-15 Carrier2 paused user playtest confirms the same defect for EAGLEGREEN: only four standard-named wing actors bind, versus 18 with its authored variant WAM. The principal EAGLENEG.ACT body remains unbound with zero vertex deformation; wings deform and one detaches. Health1, hull revision12 and structuralRevision1 show physical damage continues. The car is on its side (89.81 degrees), with no wheel support, and hierarchy doNothing=true (one sleep, zero wakes). Nearby static RUNGER deck triangles lie at Y=-6.824999809; the transformed physical hull minimum is -6.820544906, above the deck plane, while149 of720 principal body vertices are below that plane (minimum -6.906123333). This establishes visible/collision mismatch in the paused damaged pose, not physical deck tunnelling. Exact finite triangle and original-undamaged hull comparison remain useful regressions; missing WAM is confirmed, but not every visual protrusion is proven caused by it. Preserve artifacts/carrier-entrapment-{paused,support,visible}.json and screenshot locally. Address this binding defect before changing global collision/sleep behavior based on this scene.

Implemented native-informed local WAM resolution: selected configuration directory + authored token, then selected TXT basename.WAM if missing. Both player and opponent loaders pass the actual selected path; no global basename or cross-Stock/Advanced fallback. rec2 LoadCar0x488f70 / LoadCarCrush0x42a280 provide reconstruction evidence. Missing/invalid files and partial/zero actor bindings emit diagnostics. Native spaced softness names now parse (Advanced OK). All122 catalog cars audited:52Stock/70Advanced,71 resource selections changed,32 previously missing/zero-binding instances resolved; all11 Eagle recolors bind18/18 including principal body. Remaining authored partial/root coverage is documented under DMG-01; Advanced DIGGA trailing ACT byte under DAT-01. No fuzzy matching or original-asset changes.

Validation: build succeeds;2973 tests pass, including new resource-scope/fallback/error tests and original Gold/Green/Blue/Mustang cumulative body/hull crush, detachment requests and repair. Isolated Chromium binding regression passes Stock Gold/Green/Mustang and Advanced Green: real principal vertex displacement, retained dents, finite published hulls, physical detached object and full repair/reparenting. Existing browser-wam-effects driven crash and Eagle3/Copcar/Vlad3 effects regression passes. No browser console, network or WebGL errors. Backend SwiftShader1280x800, functional tests not performance measurements. Chrome DevTools MCP unavailable; reproducible Playwright harness used. Audit command: node --import tsx tools/audit-car-wam.mjs; browser command: npm run test:wam-binding. Captures remain ignored.

Live-state preservation correction: tests did not connect to or manipulate user9222, but Vite HMR automatically reloaded the user5173 tab at the source edit (navigation timestamp matches damage.ts mtime). Original Carrier crash snapshot remains saved in ignored artifacts; live tab is paused at race start, not the original crash state. User informed. Future paused-state investigations must account for dev-server hot reload before editing runtime source.
<!-- SECTION:NOTES:END -->
