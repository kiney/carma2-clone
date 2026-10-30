---
id: TASK-109
title: '[P2] PHY-15: Investigate delayed car contact with detached debris'
status: backlog
assignee: []
created_date: '2026-10-13 23:11'
updated_date: '2026-10-30 18:09'
labels:
  - priority-2
  - PHY-15
  - physics
  - reported
  - topic-destruction
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AI-02 review (2026-10-30) establishes a related shared-bounds lifetime distinction, not a reproduced cause of delayed debris contact: installed4b9a80 retains world+f4 = union physicalbb1 OLD/current with Float32±double.0025. Finish4bab8f commits ACT to+8c but does not rewrite+f4. New AI sensible-place uses current committed aggregatebb1 with source Float32 transformation/padding; moving targets can differ at the placement-tolerance boundary. Review exact retained prepared-world-bounds ownership here alongside delayed part contacts if implementing a shared provider; do not substitute raw browser predicted poses. See docs/ai02-production-integration.md. Ordinary contact equations are unchanged by AI-02.
<!-- SECTION:NOTES:END -->
