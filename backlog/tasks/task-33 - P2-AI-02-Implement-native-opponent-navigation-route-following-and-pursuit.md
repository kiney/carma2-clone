---
id: TASK-33
title: '[P2] AI-02: Implement native opponent navigation, route following, and pursuit'
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-30 18:13'
labels:
  - priority-2
  - AI-02
  - opponents
  - legacy-partial
  - topic-ai
dependencies: []
references:
  - src/ai/runtime.ts
  - src/physics/opponent-placement.ts
  - docs/c2-ai-pursuit-re.md
priority: high
ordinal: 2040
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **AI-02**
Numeric priority: **2** (1 is highest)
Original status: **Partial**
Category: **Opponents and Pedestrians**

## Scope and evidence

The live native dispatcher replaces RoadNavigator targets with original section widths, speeds, types, one-way data, projected routes, corners, physical forces, GetNear acquisition and direct/trail pursuit. Physical/cheaty switching, source ACT orientation, sensible-place rematerialization attempts, volume reset and shared-route safe relocation are integrated. Native fallen detection uses cached caret materials and bounded source vertical probes. Stock/Advanced/Snow Chromium verifies normal motion, freeze/thaw and physical-to-cheaty-to-rematerialized transitions. Completed AI-02 residual scope: shared finite collision preparation, source collection-time scenery acquisition, current PHIL root/child placement candidates and numerical/browser fallback stress cases. Finished empty-route continuation explicitly selects browser0 when its optional hook is omitted; bounded4096-endpoint safe relocation remains a documented robustness adaptation. Exact moving-target retained prepared-bounds lifetime is recorded under existing PHY-15/TASK-109; current physical placement bounds and tolerances are documented in docs/ai02-production-integration.md.

## Source references

[runtime.ts](../../src/ai/runtime.ts), [placement](../../src/physics/opponent-placement.ts), [pursuit evidence](../../docs/c2-ai-pursuit-re.md)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Opponent sensible-place checks use the existing finite shared face cache and source collection callbacks, including scenery acquisition outside a physics tick.
- [x] #2 Placement checks the current PHIL root/child roster after collection, preserving passive participants, pair masks, object flag4, independent descendant eligibility and source BOX/WIRE/SPHERE placement dispatch.
- [x] #3 Numerical integration covers exhausted and late-success placement, source fallback polarity, finished empty-route continuation, bounded safe relocation and preservation of original-car damage and shape ownership.
- [x] #4 Production build and Stock/Advanced/Snow Chromium navigation/rematerialization checks pass; robustness adaptations and actual fixture/catalog limitations are documented.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Selected AI workstream order (2026-10-30): first AI-02/TASK-33, then AI-01/TASK-32, then AI-04/TASK-56. Finish shared collision-candidate preparation and verify placement/fallback transitions before reviewing behavioral reactions and integrated stuck recovery. Preserve implemented navigation and ordinary driving; audit the remaining scope against current code before changing it.

Audit confirms ordinary path following and pursuit already run. Remaining integration bypasses GetFacesNearObject and the PHIL root hierarchy; implementation is isolated in /tmp/carma-ai02-gpvq96xt while existing runtime remains untouched. Installed HW428fc0/SW429050 and HW4c1e10/SW4bdd60 verify finite preparation; HW428d10 uses common BOX bounds for WIRE/SPHERE in sensible-place mode only. Existing raw empty-route0 and bounded4096-endpoint relocation remain deliberate browser adaptations. AI-01 roster/personality chronology and AI-04 struggle semantics remain separate.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed shared finite placement preparation and source ACT pulls; check current PHIL roots/children with passive participation, masks/flag4, parent exclusion and source-only BOX/WIRE/SPHERE placement dispatch. Added retry/fallback, empty-route and bounded relocation integration tests, plus original Eagle/Buggy/Bigdump state preservation. Build passes; full suite3723 pass/6 optional skips, asset-free CI3226 pass/434 skips. Stock/Advanced/Snow browser5/12/7 rivals, quarrynet one-section free drive and hardware MCP Dune10 rivals pass with no console/WebGL failures. AI-01/AI-04 remain next; moving historical target-bound lifetime remains explicitly noted under PHY-15.
<!-- SECTION:FINAL_SUMMARY:END -->
