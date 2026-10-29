---
id: TASK-127
title: >-
  [P1] PHY-22: Restore ignore-world scenery cache ownership and unblock
  physical-slot reclamation
status: done
assignee: []
created_date: '2026-10-29 12:51'
updated_date: '2026-10-29 13:07'
labels:
  - priority-1
  - PHY-22
  - physics
  - noncars
  - regression
dependencies: []
references:
  - docs/noncar-capacity-recovery.md
  - docs/c2-noncar-wake-pull-re.md
priority: high
ordinal: 1150
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User reports another apparently indestructible roadside sign wasting The Plow. Preserved Desert1 live state has all49 physical scenery slots occupied and47 sleeping, with2563 historical capacity deferrals. A sole awake IGNORE_WORLD_COLLISIONS lift (&99!0013, motor idle but native ec=false) lacks retained GetFacesNearObject bounds. The host missing-cache guard consequently vetoes all normal scenery reclamation. Verified installed HW FindObjectCollisions calls GetFacesNearObject at0x4bd7f8 even for flag0x80; bounds/inverse writes0x4c222d/0x4c2245 precede model-emission disable and empty physical range. Fix that missing ownership through the existing native cache, preserving no-world-contact behavior and near-body protection. Do not replace this with arbitrary eviction or invented current bounds. The sign incident itself remains reported: nearest candidate &28d0256 is already detached; no historical accepted-impact/component-change trace establishes the actual wasting row. Clean original-data approaches must be recorded separately from the cluttered episode.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Awake ignore-world noncars maintain the original predictive retained query bounds/inverse while exposing no physical world-contact rows or world-guard hits.
- [x] #2 An idle-motor lift does not globally veto reclamation: nearby overlapping sleeping props remain protected and distant eligible sleeping props release capacity through normal source reclaim effects.
- [x] #3 Original Stock/Advanced Desert lift/sign and current failed-admission regressions pass; original assets remain read only and user live state is preserved.
- [x] #4 Record the uncertainty of the reported fatal sign impact and retain bounded accepted/rejected impact telemetry for recurrence.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the verified HW flag0x80 integration: awake ignore-world noncars now retain the ordinary candidate-frame native cache while producing zero physical world rows and retaining world-guard bypass. Global missing-provider protection remains intact. In the preserved saturated scene a separate dry reclaim clock with only the missing lift cache supplied identifies46 otherwise eligible sleepers; no live effects or state changes applied. Focused numerical/provider suites:61 tests pass, including new missing-cache/near-versus-far regressions and bounded accepted/rejected impact-history checks. Production build passes; original Stock/Advanced new lift/reclaim browser cases and existing Newcity capacity/contact-driven sign cases pass. MCP hardware AMD2070x1435 verifies native predictive bounds, zero lift contacts/guard hits, near-object retention and distant-slot release; original Desert1/Plow scene renders with ready populations and clean console/GL. Bounded opt-in impact recorder installed in unchanged paused failed user tab. The actual historical sign-wastage cause is not proven and remains P1 next TASK-128/PHY-23. No damage coefficients, collision guards, object capacities or forced-eviction policy changed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Native ignore-world cache omission and resulting global scenery-reclaim starvation are fixed and validated. Existing retryable admission remains unchanged. Rebuilt source is ready for a fresh page load; preserved cached user tab was not reloaded or repaired. The separate reported fatal light-scenery impact remains open under PHY-23 pending committed-row/component evidence.
<!-- SECTION:FINAL_SUMMARY:END -->
