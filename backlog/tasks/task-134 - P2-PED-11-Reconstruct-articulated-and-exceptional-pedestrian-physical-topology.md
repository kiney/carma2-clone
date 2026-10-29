---
id: TASK-134
title: >-
  [P2] PED-11: Reconstruct articulated and exceptional pedestrian physical
  topology
status: backlog
assignee: []
created_date: '2026-10-29 21:33'
labels:
  - priority-2
  - PED-11
  - pedestrians
  - source-PED-08
dependencies:
  - TASK-98
priority: high
ordinal: 2134
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PED-08 completes ordinary simple-character severing and bounded part ownership. Its explicit exceptional-provider boundary remains: full level2/6 FORM conversion, temporary articulated matrices, actual HINGE/BALLNSOCKET and retained joint2 constraints, nonhumanoid/exploding sever selection and LINE physics. Original audit finds BIPEDF DOCTOR4 joints and DOG1 nonhumanoid16-bone variants; ordinary BIPED1 NULL-joint parts already work. Recover these source branches before admitting their bodies; do not silently substitute free ragdolls or BOX shapes. See docs/ped08-production-integration.md and docs/c2-ped-bone-runtime-re.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Original BIPEDF articulated conversion and authored constraints drive actual body topology with coherent release/reset.
- [ ] #2 Retained joint2 and exceptional/nonhumanoid sever branches are source-backed and numerically/browser validated without weakening ordinary sever regressions.
<!-- AC:END -->
