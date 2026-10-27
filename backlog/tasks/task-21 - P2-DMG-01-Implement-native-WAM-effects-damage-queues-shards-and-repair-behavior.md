---
id: TASK-21
title: >-
  [P2] DMG-01: Implement native WAM effects, damage queues, shards, and repair
  behavior
status: done
assignee: []
created_date: '2026-10-11 15:13'
updated_date: '2026-10-27 02:52'
labels:
  - priority-2
  - DMG-01
  - damage
dependencies: []
references:
  - docs/c2-wam-effects-re.md
  - docs/c2-shards-re.md
  - tests/browser-wam-effects.mjs
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **DMG-01**
Numeric priority: **2** (1 is highest)
Original status: **Partial**
Category: **Damage, destruction and effects**

## Scope and evidence

Completed: shared WAM grammar and20-record queue; reached tiers/final-target repetitions/flags/LOD deduplication; ordinary8-car/4-event crush and independent SPAM queues; native post-shape/flap/detachment structural ordering; fixed principal-MODEL material links and bounded centroids; sounds, glass and existing abstract/ghost/physical-noncar outlets; source-scoped materials/PIX and race-scoped ACT/mechanics; native visual gates and queued-ACT explosion/slick ownership; native held/full glass repair and rearming. The omitted-MODEL default crush path now follows installed CreateDefaultCrushData, without aliases or changes to authored IDs. Original Stock/Advanced WAMs author only sounds/glass; additional WAM outlets have synthetic and original-resource integration validation.

The earlier reference to rebuilding a shared ghost/shard pool was stale: it already exists. Whole-engine CRT chronology, remaining positional attenuation/prepared allocation order and unresolved structural split topology remain explicitly owned by existing DMG-03/PUP-04; this ticket does not claim full engine effect parity.

## Source references

[Current WAM evidence](../../docs/c2-wam-effects-re.md), [shards](../../docs/c2-shards-re.md), [production Chromium regression](../../tests/browser-wam-effects.mjs), [native default crush tests](../../tests/default-car-crush.test.mjs).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Original Stock and Advanced WAMs parse; damage tiers use bounded principal-MODEL material links and unique linked-vertex centroids while reading live deformation.
- [x] #2 Vehicle WAMs reach the existing abstract, glass, ghost and physical-noncar providers with car-scoped resources, native visual visibility gates and distinct geometry versus car ownership.
- [x] #3 Held glass repair uses the shared 25-record, 150 ms native animation; new damage cancels its record, full repair resets immediately, and repair never emits smash connotations.
- [x] #4 Targeted numerical tests, a production build and Chromium original-car crash/repair checks pass; limitations and cross-ticket ownership are documented without claiming full RNG or split-topology parity.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Queue review 2026-10-26 — position 3/5, P2.
First finish concrete car/WAM producer and repair-ownership gaps, reusing the existing world-side ghost/noncar providers. The current WAM callback handles abstract fragments and shards; world-side ghost/noncar dispatch already exists. ShardRuntime already shares glass priority 3 and ghost priority 4, so a new unified ghost/shard allocator is not a prerequisite. Coordinate shared dispatcher, RNG and lifecycle changes with WLD-05, DMG-02 and DMG-03 rather than duplicating providers. No demonstrated whole-ticket blocker among the three selected P2 tickets.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Earlier DMG-06 census is retained in tools/audit-car-wam.mjs. Exact case-insensitive WAM ACT matching has no ancestor/extension aliases. Explicit uncrushable entries and missing MODELs remain excluded. Crucially, installed HW LoadCar48b31d calls CreateDefaultCrushData42a160/42a170 before vertex initialization: unlisted MODELs with user data and no GROOVE get normal softness and native ID233. Current rec2 null guards are inverted relative to this executable. Bugtoo5 BUGTOO.ACT and Advanced Ped-o-matic PEDOMATICbase qualify and now deform locally. Runtime defaults remain separate from authored WAM tables. Native GROOVE owner lookup uses full case-sensitive identifiers and native child order.

Hardware validation changed12/828 root coordinate values for Bugtoo5 and12/342 for Advanced Ped-o-matic; held/full repair restored native compressed targets exactly. Authored counts stayed32 in both. Generic WAM fixture used original city resources and created5priority4 ghosts plus1 physical noncar. The noncar prepared positive-material ordering warning remains DMG-03, not a missing WAM outlet.

The ghost browser expiry regression was a harness false negative: predicted game time can regress after a stall. The test now preserves the observed successful deadline crossing and still requires the final ghost population to be empty. No game clock or fragment rules changed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed and verified on 2026-10-27. Native principal-MODEL source links (50 vertices/faces), bounded unique-vertex centroids, one shared texture choice, visual visibility gates, ACT-owned explosion/slick frames and car-local MAT/PIX ownership are integrated. WAM ghost/noncar producers reuse the existing runtime and active race ACT/mechanics scope. Held glass repair now uses the shared 25-record/150 ms native animation with sample4550; new damage cancels it, full repair resets immediately, and repair never emits smash effects. Installed CreateDefaultCrushData behavior now covers eligible omitted MODEL actors without GROOVEs, preserving explicit records and authored IDs.

Validation: production build;3313 headless checks passed,0 failed,5 optional saved-capture skips. All122 Stock/Advanced WAMs parsed. Production Chromium original Eagle3/Copcar/VLAD3 crash and real-frame Copcar repair checks passed. Existing4 ghost and4 physical-noncar browser cases passed. Hardware Chrome DevTools MCP: real Eagle/Skyline crash, scripted WAM5ghost+1noncar outlet, actual Bugtoo5 and Advanced Ped-o-matic localized default crush plus held/full repair; no fatal console/WebGL errors. Backend ANGLE AMD/radeonsi,2069x1430; not an FPS benchmark.

Explicit continuing scopes: DMG-03 whole-engine CRT chronology/positional audio/prepared positive-material order; PUP-04 unresolved native split topology, whose browser replacement geometry can leave fragment links on pre-split polygons. These existing broader tasks are not claimed complete by DMG-01. No original assets modified or committed.
<!-- SECTION:FINAL_SUMMARY:END -->
