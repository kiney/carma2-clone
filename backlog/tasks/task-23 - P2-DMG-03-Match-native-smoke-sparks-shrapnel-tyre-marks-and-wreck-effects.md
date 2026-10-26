---
id: TASK-23
title: >-
  [P2] DMG-03: Match native smoke, sparks, shrapnel, tyre marks, and wreck
  effects
status: next
assignee: []
created_date: '2026-10-11 15:13'
updated_date: '2026-10-26 19:43'
labels:
  - priority-2
  - DMG-03
  - damage
  - legacy-partial
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

Original race dust colours, wheel material smoke types, source FinishCars puffs, native smoke/flame columns and persistent 100-section tyre marks are integrated. Original SKIDMARK/DESKID/SNOWSKID and OILSMEAR retain fractional PIX alpha. World and car/car crash dispatch use installed gates, contact packets, shared 32-slot spark ring, vertex-colour lines and native synchronization/lifetime. Original FRAG4/FRAG5 geometry and authored ordered car colours feed the 30-slot shrapnel pool. Chromium verifies ordinary tyre/oil marks, original car/car and isolated city-wall sparks/fragments, real WheelForces type-4 puffs and WASTED flames. Remaining work: other native spark/shrapnel producers, exact source consumer chronology and whole effect ownership/visibility. Type-one prop and semi/free/split part spark packets now preserve their independent actors and driver/flag fields without inherited parent palettes. Authored abstract WAM/world connotations share the same fragment pool and source default velocity. WheelForces skid/squeal puffs (41bef0), shared tagged audio voices and CheckDamage mode-1 wreck columns now use their native callers; full repair expires matching columns and wet volumes shorten them. Component-damage smoke tiers, authored fire-point initialization, the independent CrashEarnings return gate and held/full repair lifetimes are integrated and numerically tested against original Eagle/Buggy; Driven original Eagle/Buggy browser crashes verify pre-WASTED engine40/60 tiers, repair expiry and callback ordering; engine80/steering tiers are not all reached by that audit. Authored world ghost connotations now borrow their original ACT models, preserve full affine transforms and use the shared physical priority pool, native movement and grouped expiry. Stock/Advanced Newcity and Airport browser checks verify original textures/models, full affine state, movement and grouped expiry; diagnostic ghost screenshots still need better framing. Physical noncar connotations now use original ACT/mechanics, free mass/inertia, shared dedicated/forty extra slot limits, native launches and authored mode-2 fire. Four Stock/Advanced Newcity/Carrier browser cases verify physical motion, smoke and cleanup. Free unjointed props now use the installed post-force snapshot, temporary inertia50, leaf/contact-ring quiet gates, ec and pre-lambda geometry wake. Five solver tests and Stock/Advanced city/Carrier Chromium checks verify sleep; Carrier also verifies subsequent car-impact momentum. City wake/exchange coverage remains incomplete. Jointed/car/part hierarchy providers, native world-prop admission chronology and physical reclaim integration remain open; fifteen numerical reclaim tests preserve the original retained MODEL/cache-bound gates and ACT ownership, without a fabricated TTL. Additional producers remain open. Complete shared CRT chronology and prepared positive-material allocation order remain open.

## Source references

[smoke.ts](../../src/smoke.ts), [smoke evidence](../../docs/c2-smoke-columns-re.md), [surface effects](../../docs/c2-surface-effects-re.md), [tyre producer](../../docs/c2-tyre-smoke-re.md), [wreck producer](../../docs/c2-wreck-smoke-re.md), [component producer](../../docs/c2-component-smoke-re.md)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Queue review 2026-10-26 — position 5/5, P2.
After the selected WAM/world producer integrations, finish remaining effect producers and validate cross-producer chronology, priorities, ownership and visibility against the established callers. This ordering reduces repeated shared-dispatch/pool work; it is not a hard dependency on completing every part of DMG-01/WLD-05. ShardRuntime already shares shards and ghosts, and PERF-16/PERF-17 world admission, hierarchy quiet and reclaim integration are done despite older scope text. Native pedestrian blood/giblet pooling still overlaps the PED-06/PED-09 production-adapter work; coordinate that sub-scope without duplicating the pedestrian owners.
<!-- SECTION:PLAN:END -->
