---
id: TASK-136
title: >-
  [P3] AI-06: Reconstruct original grid rankings and race-launch selection
  chronology
status: backlog
assignee: []
created_date: '2026-10-30 18:42'
labels:
  - priority-3
  - AI-06
  - opponents
  - topic-ai
dependencies:
  - TASK-32
priority: medium
ordinal: 3135
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
AI-01 fixes per-call SelectOpponents candidate/ranking draws and InitOpponents local initialization/personality order, reserving AI startup before browser asset awaits. Remaining separately evidenced launch/grid fidelity: installed single-player DoGame calls SelectOpponents at HW503ad5 and503af9, and SortOpponents4e2950 sorts tOpp_spec.ranking using comparator4e2930 then draws the player grid slot at4e2994. The browser retains rankings but deliberately uses its existing safe request-order grid; it does not reproduce both launch calls or all intervening CRT consumers. Establish actual menu/restart/mission context before adding discarded selections or changing the grid. Do not claim whole-launch RNG parity from a seeded AI plan.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Map installed HW/SW launch call conditions, ranking comparator/ties, duplicates, and player-slot draw ownership with concrete evidence.
- [ ] #2 Implement justified original roster/grid ordering while retaining validated supported nonoverlapping starts and atomic publication, or explicitly document an intentional browser grid policy.
- [ ] #3 Cover Stock/Advanced random and explicit duplicate rosters, load cancellation/restart, player slot and source draw chronology without copying original fixtures.
<!-- AC:END -->
