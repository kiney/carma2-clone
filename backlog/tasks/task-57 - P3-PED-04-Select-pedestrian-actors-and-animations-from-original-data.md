---
id: TASK-57
title: '[P3] PED-04: Select pedestrian actors and animations from original data'
status: wip
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-29 00:42'
labels:
  - priority-3
  - PED-04
  - pedestrians
  - legacy-partial
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

Make actor/animation selection data-faithful; currently, one heuristically selected ACT is used per package, and limbs move procedurally. See ANI-01 for BON/SKL playback.

## Source references

[pedestrians.ts](../../src/pedestrians.ts)

## PED-03 scope split (2026-10-11)

Scope extracted from the former broad PED-03: retain native FORM/ACT/MODEL/pivot identities and classify the 24 currently unsupported personality prerequisites in each data tree from the native asset audit. The audit initialized 136/160; missing or malformed original resources need targeted support or clear unavailability. This remains asset selection/compatibility work; normal population PHIL admission belongs to PED-06 and sever topology to PED-08.

Related tasks: [TASK-96](task-96%20-%20P2-PED-06-Integrate-ordinary-population-identities-with-native-physical-lifecycle.md), [TASK-98](task-98%20-%20P2-PED-08-Integrate-visible-severing-and-articulated-pedestrian-body-contacts.md).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Selected 2026-10-29: joint first stage ANI-01/PED-04, then PED-06 -> PED-07 -> PED-08 -> PED-09. Preserve existing numeric priorities. Implement and validate in an isolated source/build so the user's paused production scene remains intact.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-28 22:45
---
Related concrete renderer evidence recorded under ANI-01/TASK-62: CitySwat FLIGHTMEC1.act / MANBWC.ACT keeps an authored46.63-degree whole-body lean in the ordinary living population. Confirm ACT/FORM model selection and hand the actual selected root/bone pose to production playback; avoid a package-specific upright hack. Original archived ACT parsed read only; browser outer/visual transforms themselves remain upright.
---
<!-- COMMENTS:END -->
