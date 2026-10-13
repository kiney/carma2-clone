---
id: TASK-109
title: '[P2] PHY-15: Investigate delayed car contact with detached debris'
status: backlog
assignee: []
created_date: '2026-10-13 23:11'
labels:
  - priority-2
  - PHY-15
  - physics
  - reported
dependencies: []
priority: high
ordinal: 2090
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User playtest after PERF-17 included driving into detached parts, repairing a wreck and overturned recovery, with no reproduced regression. The user sometimes perceives pieces sliding into the vehicle before collision response grips; original-game parity is unknown. The paused Timber snapshot at elapsed74.88s contains seven pieces but does not capture the preceding reported contact event. Do not conflate this with resolved PHY-13 deeply overlapping own-part lockups. Compare committed collision hulls/contact timing and interpolated graphical poses, including parent-rotation anchor interpolation, before claiming a solver defect. Potential presentation mismatch is an unverified source-derived hypothesis. Keep original data read-only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reproduce and record rendered versus committed transforms and accepted contact rows before and during a reported delayed debris contact.
- [ ] #2 Determine whether any mismatch is presentation, shape/contact eligibility or native behavior; document evidence and implement the bounded verified remedy if needed.
<!-- AC:END -->
