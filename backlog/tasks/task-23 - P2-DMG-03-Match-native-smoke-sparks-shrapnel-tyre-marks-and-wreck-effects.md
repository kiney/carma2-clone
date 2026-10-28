---
id: TASK-23
title: >-
  [P2] DMG-03: Match native smoke, sparks, shrapnel, tyre marks, and wreck
  effects
status: done
assignee: []
created_date: '2026-10-11 15:13'
updated_date: '2026-10-28 22:34'
labels:
  - priority-2
  - DMG-03
  - damage
dependencies: []
references:
  - src/smoke.ts
  - docs/c2-smoke-columns-re.md
  - docs/c2-surface-effects-re.md
  - docs/c2-tyre-smoke-re.md
  - docs/c2-wreck-smoke-re.md
  - docs/c2-component-smoke-re.md
priority: high
ordinal: 2020
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **DMG-03**
Numeric priority: **2** (1 is highest)
Original status: **Partial**
Category: **Damage, destruction and effects**

## Scope and evidence

Original race dust colours, wheel material smoke types, source FinishCars puffs, native smoke/flame columns and persistent 100-section tyre marks are integrated. Original SKIDMARK/DESKID/SNOWSKID and OILSMEAR retain fractional PIX alpha. World and car/car crash dispatch use installed gates, contact packets, shared 32-slot spark ring, vertex-colour lines and native synchronization/lifetime. Original FRAG4/FRAG5 geometry and authored ordered car colours feed the 30-slot shrapnel pool. Chromium verifies ordinary tyre/oil marks, original car/car and isolated city-wall sparks/fragments, real WheelForces type-4 puffs and WASTED flames. The current installed-binary caller census now connects the audited single-player producers through shared pools, native phase order and actual source ownership; network-only callers are explicitly separated. Type-one prop and semi/free/split part spark packets now preserve their independent actors and driver/flag fields without inherited parent palettes. Authored abstract WAM/world connotations share the same fragment pool and source default velocity. WheelForces skid/squeal puffs (41bef0), shared tagged audio voices and CheckDamage mode-1 wreck columns now use their native callers; full repair expires matching columns and wet volumes shorten them. Component-damage smoke tiers, authored fire-point initialization, the independent CrashEarnings return gate and held/full repair lifetimes are integrated and numerically tested against original Eagle/Buggy; Driven original Eagle/Buggy browser crashes verify pre-WASTED engine40/60 tiers, repair expiry and callback ordering; engine80/steering tiers are not all reached by that audit. Authored world ghost connotations now borrow their original ACT models, preserve full affine transforms and use the shared physical priority pool, native movement and grouped expiry. Stock/Advanced Newcity and Airport browser checks verify original textures/models, full affine state, movement and grouped expiry; diagnostic ghost screenshots still need better framing. Physical noncar connotations now use original ACT/mechanics, free mass/inertia, shared dedicated/forty extra slot limits, native launches and authored mode-2 fire. Four Stock/Advanced Newcity/Carrier browser cases verify physical motion, smoke and cleanup. Free unjointed props now use the installed post-force snapshot, temporary inertia50, leaf/contact-ring quiet gates, ec and pre-lambda geometry wake. Five solver tests and Stock/Advanced city/Carrier Chromium checks verify sleep; Carrier also verifies subsequent car-impact momentum. The older arbitrary City prop approach still fails to establish its qualifying spark contact in both unchanged HEAD and this candidate; QUA-12/TASK-124 owns that fixture. Jointed/car/part hierarchy providers, native world-prop admission chronology and physical reclaim integration were completed under PERF-16/17; fifteen numerical reclaim tests preserve the original retained MODEL/cache-bound gates and ACT ownership, without a fabricated TTL. Authored replacement-model fire now uses native mode0, the actual replacement MODEL, live prepared vertices and ownerless lifetime; unrelated car repair cannot expire it. Actual retained MAT identities and live host-resource addresses supply positive-material preparation for cars, noncar debris and replacement fire, including NULL/aliases, geometry mutation and freed/reused episode rejection. Connected producers share CRT and local native phase order; complete engine-wide CRT chronology and historical Windows heap addresses are not claimed. Ordinary native pedestrian blood/giblet production belongs to PED-06/TASK-96 and PED-09/TASK-99; spatial event audio belongs to AUD-03/TASK-71. See docs/c2-effect-producer-audit.md for the installed caller census, original-data scope and validation boundaries.

## Source references

[smoke.ts](../../src/smoke.ts), [smoke evidence](../../docs/c2-smoke-columns-re.md), [surface effects](../../docs/c2-surface-effects-re.md), [tyre producer](../../docs/c2-tyre-smoke-re.md), [wreck producer](../../docs/c2-wreck-smoke-re.md), [component producer](../../docs/c2-component-smoke-re.md)
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-27 02:52
---
DMG-01 now completes WAM producer integration, captured principal-MODEL links/centroids, shared25-slot/150ms glass repair and eligible omitted-MODEL default crush. Whole-engine CRT chronology, positional sound attenuation and prepared positive-material order remain here. The scripted original Newcity WAM noncar outlet works but still emits its known prepared-order diagnostic.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed the audited independent single-player world/car effect scope. Exact Windows heap/whole-engine CRT parity, ordinary native pedestrian production and multiplayer are explicitly excluded; existing PED/audio owners retain their scopes. Source evidence and all current validation limits are in docs/c2-effect-producer-audit.md.
<!-- SECTION:FINAL_SUMMARY:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Audited single-player effect producers use shared native pools, phase order and actual ACT/MODEL ownership, including authored replacement fire.
- [x] #2 Prepared car/noncar/replacement sources use actual retained MAT identities and live host-resource addresses; NULL, aliases, mutation and lifecycle failures are tested.
- [x] #3 Original Stock/Advanced replacement/debris browser checks and hardware original-flame inspection pass; pre-existing QA failure and external PED/audio/network boundaries remain explicit.
<!-- AC:END -->







## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Queue review 2026-10-26 — position 5/5, P2.
After the selected WAM/world producer integrations, finish remaining effect producers and validate cross-producer chronology, priorities, ownership and visibility against the established callers. This ordering reduces repeated shared-dispatch/pool work; it is not a hard dependency on completing every part of DMG-01/WLD-05. ShardRuntime already shares shards and ghosts, and PERF-16/PERF-17 world admission, hierarchy quiet and reclaim integration are done despite older scope text. Native pedestrian blood/giblet pooling still overlaps the PED-06/PED-09 production-adapter work; coordinate that sub-scope without duplicating the pedestrian owners.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-28 completion: original 78-track-file census finds43 positive replacement-fire records and111 away followups, zero parallel directions. Added native mode0 fire and material-source integration with no guessed name/index ranks. Full suite3,351 passes/0failures/5optional saved-capture skips; production build passes. Four world-effect and four physical-debris browser cases pass. Hardware MCP original City pump flames render on ANGLE AMD/Radeon gfx1150 at2070x1435, with no console/GL errors. Older browser-crash-effects sole noncar-driver4 fixture assertion fails identically on unchanged3b89d2d and candidate; retained under QUA-12/TASK-124 without weakening collision gates.
<!-- SECTION:NOTES:END -->
