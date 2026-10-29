---
id: TASK-57
title: '[P3] PED-04: Select pedestrian actors and animations from original data'
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-29 01:14'
labels:
  - priority-3
  - PED-04
  - pedestrians
dependencies: []
references:
  - src/pedestrians.ts
priority: medium
ordinal: 3047
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PED-04**
Numeric priority: **3** (1 is highest)
Original status: **Partial**
Category: **Opponents and Pedestrians**

## Scope and evidence

Personality FORM/REMAP/default-move records now drive exact native MODEL identifiers, per-bone variants/NULLs, remapped vertices and child/parent attachments. Resource-only directory registration removes arbitrary ACT selection and its default transforms; flat FORM actors use source context/default material and captured MAT pointers. Shared root-specific pedestrian storage, cached immutable BON/SKL input and explicit template disposal preserve ownership. Living production playback is integrated under ANI-01; remaining animation/render branches stay there.

## Source references

[pedestrians.ts](../../src/pedestrians.ts)

## PED-03 scope split (2026-10-11)

Scope extracted from the former broad PED-03: retain native FORM/ACT/MODEL/pivot identities and classify the historical 24 unsupported personality prerequisites in each data tree. The current clean serial loader inventory initializes 138/160: two valid spaced backup filenames are fixed, while twelve absent package libraries, eight exact missing MODEL declarations and two draft FORM references remain explicit structured source-resource diagnostics. No guessed aliases or unrelated package preloads conceal absent dependencies. This inventory is distinct from the 136 race-requested personality-name set and does not prove every population or death fixture. This remains asset selection/compatibility work; normal population PHIL admission belongs to PED-06 and sever topology to PED-08.

Related tasks: [TASK-96](task-96%20-%20P2-PED-06-Integrate-ordinary-population-identities-with-native-physical-lifecycle.md), [TASK-98](task-98%20-%20P2-PED-08-Integrate-visible-severing-and-articulated-pedestrian-body-contacts.md).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-28 22:45
---
Related concrete renderer evidence recorded under ANI-01/TASK-62: CitySwat FLIGHTMEC1.act / MANBWC.ACT keeps an authored46.63-degree whole-body lean in the ordinary living population. Confirm ACT/FORM model selection and hand the actual selected root/bone pose to production playback; avoid a package-specific upright hack. Original archived ACT parsed read only; browser outer/visual transforms themselves remain upright.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed data-driven pedestrian resource selection and missing-source classification. Corrected MODEL/FORM assets feed ANI-01 presentation; complete death/morph/special rendering and native population physics remain their existing active/next owners.
<!-- SECTION:FINAL_SUMMARY:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Exact original FORM/MODEL variants, NULLs, remaps and captured MAT identities replace heuristic package ACT selection in Stock and Advanced.
- [x] #2 The historical 24 unsupported records are individually classified with safe missing-resource/model diagnostics and ownership-safe cache/disposal behavior.
- [x] #3 Original CitySwat/Bandsman/animals and full Stock/Advanced production populations render through the corrected asset provider without fatal asset/browser errors.
<!-- AC:END -->







## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Selected 2026-10-29: joint first stage ANI-01/PED-04, then PED-06 -> PED-07 -> PED-08 -> PED-09. Preserve existing numeric priorities. Implement and validate in an isolated source/build so the user's paused production scene remains intact.

2026-10-29 implementation completion: binary405c25..405c4a allocates flat identity FORM ACTs;406d3c..406d68 looks up exact MODEL tokens. Authored ACT matrices/materials are not imported as native bone defaults. Corrected source-default inheritance and exact named MAT bindings; sharednative-peds storage and explicitdispose retain resources until last template release. Seven dedicated tests and full suite3,359 passes; Stock/Advanced Newcity1 browser cases each use791 native presentations with no console/asset/GL failures. Full 24-record classification and context limitations: docs/c2-ped-asset-selection-re.md.
<!-- SECTION:NOTES:END -->
