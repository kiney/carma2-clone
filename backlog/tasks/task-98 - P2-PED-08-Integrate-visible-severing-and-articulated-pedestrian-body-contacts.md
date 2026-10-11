---
id: TASK-98
title: >-
  [P2] PED-08: Integrate visible severing and articulated pedestrian body
  contacts
status: backlog
assignee: []
created_date: '2026-10-11 16:33'
updated_date: '2026-10-11 16:33'
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
- [ ] #1 An original-data ordinary population impact removes eligible displayed bones locally and registers genuinely independent detached physical parts with source transforms/mass/velocity.
- [ ] #2 Repeated torso/limb/corpse contacts preserve source masks, pinned-damage and once-only HP/count semantics; physical contact geometry follows current body/part state.
- [ ] #3 Retained joints and resource release/reuse are coherent through death, offscreen state and race reset; no orphan PHIL/ACT/MODEL owner remains.
- [ ] #4 Stock/Advanced body variants and representative nonhumanoid/exceptional prerequisites are checked; unrecovered native branches remain explicit rather than silently approximated.
<!-- AC:END -->
