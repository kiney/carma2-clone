---
id: TASK-98
title: >-
  [P2] PED-08: Integrate visible severing and articulated pedestrian body
  contacts
status: done
assignee: []
created_date: '2026-10-11 16:33'
updated_date: '2026-10-29 21:33'
labels:
  - priority-2
  - PED-08
  - pedestrians
  - source-PED-03
dependencies:
  - TASK-96
  - TASK-97
  - TASK-62
references:
  - src/physics/ped-sever.ts
  - src/physics/ped-sever-contact.ts
  - src/physics/ped-bone-body.ts
  - src/physics/ped-bone-pool.ts
  - src/ped-native-runtime.ts
  - docs/c2-ped-sever-contact-re.md
  - docs/c2-ped-bone-runtime-re.md
  - docs/c2-ped-bone-body-re.md
  - tests/browser-ped-native-gameplay.mjs
priority: high
ordinal: 2098
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extracted from **PED-03 / TASK-35** on 2026-10-11.
Numeric priority: **2** (inherited from PED-03).
Status: **Backlog follow-up**; this work is not required to close the narrowed population-counting task.

## Remaining outcome

Make existing native sever/contact kernels drive the displayed ordinary pedestrian and independent detached FORM bone bodies. Preserve missing-bone masks, current ACT/MODEL transforms, original per-bone BOX/LINE/SPHERE bounds, masses, velocities, shared registrar admission and retained joint2. Connect active/passive contact, pinned damage and corpse continuation to real body topology without a second launch or repeated HP/Kill. Cover the exceptional/nonhumanoid/exploding and nonordinary move branches only when their native providers are recovered; explicit unsupported cases cannot be replaced with a generic corpse. Ordinary dismemberment/state ownership belongs here; full BON/SKL rendering remains ANI-01, and replay remains RAC-09.

## Existing evidence and limitations

Sever selection/contact-tail tests, authentic head bodies, flat FORM resources and detached-bone registration already exist. They are host contracts and controlled browser cases, not ordinary displayed-population dismemberment.

## Related owners

The preserved pre-split evidence is in TASK-35. Keep PED-01/PED-02/PED-05 completed scope intact; source-faithful kernels and controlled fixtures alone do not prove production population parity.

Source task: [PED-03 / TASK-35](task-35%20-%20P2-PED-03-Implement-native-pedestrian-impacts-falls-recovery-and-body-contacts.md).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An original-data ordinary population impact removes eligible displayed bones locally and registers genuinely independent detached physical parts with source transforms/mass/velocity.
- [x] #2 Repeated torso/limb/corpse contacts preserve source masks, pinned-damage and once-only HP/count semantics; physical contact geometry follows current body/part state.
- [x] #3 Retained joints and resource release/reuse are coherent through death, offscreen state and race reset; no orphan PHIL/ACT/MODEL owner remains.
- [x] #4 Stock/Advanced body variants and representative nonhumanoid/exceptional prerequisites are checked; unrecovered native branches remain explicit rather than silently approximated.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Starting after completed PED-07 checkpoint6c60071. Audit confirms real ordinary sever-to-independent-body wiring already exists; remaining production work is bounded source stored-dismembered pose ownership and correct render reacquisition chronology, atomic unsupported retained-topology preflight, and normal Stock/Advanced population impact/release/reset evidence. Full articulated/nonhumanoid/exploding providers remain explicit per AC4.

Completed ordinary production severing, OPTIONS GoreLevel mapping, bounded shared FORM pose retention and render-before-PHIL restoration, failed-admission restorage, retained-joint preflight before sever mutations, source personality defaults and direct core period callers. Source dead/no-positive-face halt now releases correctly. Serial Stock/Advanced real population car impacts verify BOX limbs/SPHERE head, source mass/ACT/MODEL, independent transforms, repeat/no-relaunch/count once, exact active-part vanished masks, storage0→1→0 and zero old PHIL/ACT/storage owners after race reset. No provider/console/HTTP/WebGL errors. Hardware DevTools verifies actual four-part car severing with source gore2 and no diagnostics. Combined focused tests151 pass/1 absent AdvancedOPTIONS skip; TypeScript/build pass. Exceptional articulated/nonhumanoid/joint2 providers stay explicitly unsupported as permitted by AC4 and remain tracked in PED-11/TASK-134; no free-body substitute. See docs/ped08-production-integration.md.
<!-- SECTION:NOTES:END -->
