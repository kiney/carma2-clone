---
id: TASK-35
title: '[P2] PED-03: Connect native death counting to population and mission state'
status: wip
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-11 16:33'
labels:
  - priority-2
  - PED-03
  - pedestrians
  - legacy-partial
dependencies: []
references:
  - src/pedestrians.ts
  - src/ped-native-gameplay.ts
  - src/main.ts
  - docs/c2-ped-native-gameplay-re.md
  - tests/browser-ped-native-gameplay.mjs
priority: high
ordinal: 2046
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PED-03**
Numeric priority: **2** (unchanged)
Original status: **Partial**
Category: **Opponents and Pedestrians**

## Current bounded outcome

Connect native `OneLessPed` to the real PedestrianSystem population accounting and existing group/mission objective consumers. A genuine native car-contact death associated with an existing population owner must update `hits`, `alive` and `groupCounts` exactly once, using its original spawn-group identity and the source flag `0x100` count gate. This is a new production counting-owner integration, not a rerun of the native wrapper's recorded-event tests.

Share counting ownership with ordinary visual-sweep and combat death paths, without calling their estimated launch/blood/death-transport routine as the native counting callback. Preserve native ordering: the count/objective change occurs before the score continuation. This task does not recover missing score inputs, change physical impulses, synthesize a second corpse, suppress genuine sever eligibility or claim native award parity.

Expected budget: roughly 1–3 active agent hours for the bounded counting seam and focused verification, subject to actual identity-binding findings. If that seam needs a broader physical/pose owner, move that newly discovered prerequisite to the relevant follow-up instead of silently expanding this ticket. No implementation is claimed by this scope change.

## Deferred scope

- [PED-06 / TASK-96](task-96%20-%20P2-PED-06-Integrate-ordinary-population-identities-with-native-physical-lifecycle.md): Integrate ordinary population identities with native physical lifecycle.
- [PED-07 / TASK-97](task-97%20-%20P2-PED-07-Connect-native-pedestrian-grounding-fall-and-recovery-ownership.md): Connect native pedestrian grounding, fall and recovery ownership.
- [PED-08 / TASK-98](task-98%20-%20P2-PED-08-Integrate-visible-severing-and-articulated-pedestrian-body-contacts.md): Integrate visible severing and articulated pedestrian body contacts.
- [PED-09 / TASK-99](task-99%20-%20P2-PED-09-Bind-native-pedestrian-contact-causes-awards-and-effect-outlets.md): Bind native pedestrian contact causes, awards and effect outlets.

Existing owners keep their scopes: PED-04 / TASK-57 selects authored assets and addresses missing original prerequisites; ANI-01 / TASK-62 owns complete BON/SKL/prepared-vertex playback; RAC-04 / TASK-39 owns award formulas; PUP-11 / TASK-30 owns combat powerup effects; AUD-03 / TASK-71 owns positional audio; RAC-09 / TASK-80 owns replay serialization/continuations. These follow-ups are separately closable work, not hidden acceptance requirements for this ticket.

## Historical pre-split evidence

The complete earlier description below is preserved for provenance. It records completed kernels, explicit approximations and unresolved providers across the former broad task; it is not the narrowed task's completion criterion.

Original issue ID: **PED-03**
Numeric priority: **2** (1 is highest)
Original status: **Partial**
Category: **Opponents and Pedestrians**

## Scope and evidence

Reconstruct native pedestrian collisions, impulses, fall/get-up/corpse movement, and multi-bone contact surfaces. Currently, there is a horizontal player sweep with a speed limit, estimated hit force for the source-faithful blood effect, and simplified corpse/giblet transport. Unsupported changes in ground height still trigger turns through an adapter; the native fall reaction is missing. Installed passive/active damage kernels now have eleven numerical tests: pre-impulse momentum, first contact-row lambda versus group gating, form-mass normalization, signed-byte HP and pinned-contact flags. Original form/remap/personality simple-body data and native root orientation, movement and animation-clock helpers now have eighteen numerical/data tests: 129 package profiles parse, while original DOG1 move93 has an explicitly rejected root-name defect. The native intact simple-body runtime now participates in the actual vehicle solver: passive activation before contact eligibility, character-velocity transfer, authored mass/COM/inertia, exclusion masks in narrowphase and both trajectory guards, contact damage before impulse application, source40ms gravity, quiet-ring sleep and once-per-outer-frame moved/halt outlets have seven numerical/runtime tests. The displayed pedestrian pool still uses the simplified visual sweep; connecting the native body lifecycle, real severing and animation/get-up state remains necessary. Twenty-four sever-kernel tests verify shared CRT, budget/chance, child-first FORM subtrees, registration/mask boundaries, live post-registration velocity, type5 filters, head models and once-only HP continuation; three contact-tail adapter tests check head removal before HP and preserve passive/active caller semantics. These are host contracts, not yet visible pedestrian dismemberment. Flat native FORM actors, quantized BON/SKL bone poses, reusable render slots, original dead-model/material clones and bounded shared FORM body pools are now implemented and tested. A browser asset audit initializes 136 of 160 installed personalities in each data tree; 24 missing or unsupported original-resource prerequisites remain explicit. Fifteen detached-bone tests verify actual MODEL bounds, per-bone masses, BOX/LINE/SPHERE descriptors and native registration/activation order. Analytical head contacts and the shared normal100 PHIL registrar now participate in VehicleSimulation, including BOX/SPHERE bone admission, source free forces, quiet/header distinction and manual ACT interpolation. FORM boned resources and in-place MODEL/body preparation preserve identities, flags/friction and retained joint2. These are tested solver/resource paths; replacing the displayed sweep and connecting ordinary sever/corpse/animation scope are still necessary, not a claimed production population fix. Native simple-body activation, exclusion masks, independent sleep/recovery state and no-air-drag gates are documented. Eight numerical settling tests cover the installed angular callback and four original form masses; fifteen halt/completion tests now cover source retry, lying/head moves, shared RNG and animation-driven recovery, but the full visual halt/get-up path, mixed car/prop quiet-state providers, special-volume body forces and articulated contacts remain open. Current native Chromium adapter checks Stock/Advanced keyboard-driven death and player attribution, plus separately controlled sever/independent HEAD registration. Empty selected-volume caches and Float32 animation fraction1 are corrected from installed instructions. Shared85-slot current-root grounding now connects to actual ACT/PHIL ownership before BON; metadata retains original pivot/type/style and installed face planes. Verified ordinary signed animation traversal, native completion breaks and separate moved/halt clock/velocity ownership now pass original BIPED/DOG captures; Stock/Advanced Chromium no longer rejects clock regressions. The native wrapper now implements and tests ordinary active-corpse quieting, sentinel-only water reset, passive V/Stillify/head ordering, signed animation rates and original registered corpse slicks in the shared pool. Normal population integration, bounded native process-cache ownership, living recovery grounding/effects and full articulated/replay outlets remain open. The exact100-record process pool and85-slot ground binding now preserve source reuse/eviction order, retained floor/direction/head fields and stable selected-face identities; normal scene enrollment still needs the ordinary movement/proximity owner. The actual keyboard-contact Chromium wrapper now acquires bounded process records with authentic retry0, preserves them across render release, and waits for physical quieting rather than an arbitrary snapshot deadline (Stock/Advanced PHIL1, stopped clock and release; no console/WebGL failures). Installed RescanPedProximity now writes actual canonical process fields and mutable borrowed face normals/D; 1,000 seeded native calls match23,000 fields bitwise, and the85/100-slot grounding interoperability is tested. Negative-group excluded-floor memory access stays explicitly unsupported; ordinary native wander/avoidance/acceleration and load-time spawning are separate remaining owners.

## Source references

[pedestrians.ts](../../src/pedestrians.ts), [ped-blood.ts](../../src/ped-blood.ts)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A controlled actual native vehicle contact is bound to an existing authored normal-population owner in Stock and Advanced Chromium scenes; real application alive/hit/group counters change exactly once. Merely recording fixture events is insufficient.
- [ ] #2 The original spawn group and source 0x100 count gate drive the existing group/mission target consumer; objective evaluation and count updates occur before the native score continuation.
- [ ] #3 Repeated corpse contact and overlapping legacy/native death callbacks do not repeat counts or objective completion; counting adds no estimated impulse, blood launch or duplicate physical owner.
- [ ] #4 Existing ordinary visual-sweep and combat deaths retain correct total/group counts and mission behavior through the shared accounting owner; normal race load/reset preserves population state.
- [ ] #5 Focused deterministic accounting tests and actual Chromium application-counter/objective assertions pass, with no fatal console errors. Follow-up tickets remain open; closure explicitly claims counting integration only.
<!-- AC:END -->
