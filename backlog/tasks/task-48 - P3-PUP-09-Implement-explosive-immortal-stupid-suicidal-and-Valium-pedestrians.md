---
id: TASK-48
title: >-
  [P3] PUP-09: Implement remaining immortal, stupid, suicidal and Valium
  pedestrians
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-30 17:14'
labels:
  - priority-3
  - PUP-09
  - powerups
  - legacy-missing
  - topic-pedestrians
  - topic-powerups
dependencies: []
references:
  - src/powerups.ts
  - src/pedestrians.ts
priority: medium
ordinal: 3029
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PUP-09**
Numeric priority: **3** (1 is highest)

Remaining scope: implement immortal, stupid, suicidal and Valium pedestrian effects (actions23-25 and50). Original action3 explosive pedestrians is implemented and validated under PED-11/TASK-134 through normal timed powerup and physical contact paths. Preserve that completed behavior. See src/powerups.ts, src/pedestrians.ts and docs/ped11-production-integration.md.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PED-11 completion implements original explosive pedestrians (action3, catalog powerup4) through normal grant/renew/conflict/expiry/reset and real nonhumanoid severing. This ticket remains open for actions23-25 and50 (immortal, stupid, suicidal and Valium); explosive action3 is no longer missing. See docs/ped11-explosive-powerup-re.md and docs/ped11-production-integration.md.
<!-- SECTION:NOTES:END -->
