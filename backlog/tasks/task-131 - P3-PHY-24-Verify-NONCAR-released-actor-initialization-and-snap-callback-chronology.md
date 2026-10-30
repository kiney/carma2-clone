---
id: TASK-131
title: >-
  [P3] PHY-24: Verify NONCAR released-actor initialization and snap callback
  chronology
status: backlog
assignee: []
created_date: '2026-10-29 16:32'
updated_date: '2026-10-30 15:12'
labels:
  - priority-3
  - PHY-24
  - physics
  - noncars
  - topic-physics
dependencies: []
references:
  - docs/perf25-world-joint-phase.md
priority: medium
ordinal: 3102
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PERF-25 source audit found two concrete NONCAR lifecycle parity questions. createNonCarBody derives attached/default WORLD joint state from mechanics even for authored ! released actors, while mass selection checks that marker. Native HW response 0x4bbe7a..0x4bbef5 calls post-movement callback +194 (TestNonCarSnapOff 0x420380) after candidate reintegration; current browser bend/snap checks happen after committed movement. Neither discrepancy establishes the cause of the historical fatal sign report. Audit the original load/pull ownership and callback/rejection ordering, reproduce meaningful behavioral differences, then correct supported deviations without weakening ordinary world collisions or inventing attachment modes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Verify original attached/released marker and load/pull rules, and add procedural or optional original-data regressions for any demonstrated mismatch.
- [ ] #2 Compare per-response snap candidate/rejection timing with original source and document or correct the browser deviation while preserving real impacts, free mass, repair and reclaim.
<!-- AC:END -->
