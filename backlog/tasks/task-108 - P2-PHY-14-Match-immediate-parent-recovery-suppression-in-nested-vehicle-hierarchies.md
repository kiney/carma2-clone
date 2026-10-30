---
id: TASK-108
title: >-
  [P2] PHY-14: Match immediate-parent recovery suppression in nested vehicle
  hierarchies
status: backlog
assignee: []
created_date: '2026-10-13 13:18'
updated_date: '2026-10-30 15:11'
labels:
  - priority-2
  - PHY-14
  - physics
  - collision
  - joints
  - topic-physics
dependencies: []
references:
  - src/physics/simulation.ts
  - src/physics/pair-guard.ts
  - docs/old-overlap-recovery.md
priority: high
ordinal: 2141
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PHY-13 binary review verified that installed HW 0x427dcd–0x427ddd suppresses recovery rows only for a shared nonnull immediate physical parent; direct parent/child exclusion is separate at 0x4bd900/0x4bd90c. VehicleSimulation.collectBodyContacts currently passes sameAttachmentGroup based on recursive attachmentRoot equality, which is broader for a bodywork chain attached to a detached roof or split half. The body guard also intentionally suppresses internal recursive-root volume checks. Fully detached former-owner debris has no physical parent and remains eligible; do not introduce ownership immunity.

Reconstruct nested parent/child/sibling collision and recovery eligibility end-to-end. Compare ordinary rows and actual solver/damage/joint results for sibling parts, grandchild versus ancestor/other subtree, split-half retargeting, release and repair. Replace broader browser exclusions only with native evidence and focused numerical plus Chromium regressions. This was deliberately left out of PHY-13's bounded old-overlap guard change to preserve existing contact impulses there. Scope is a verified fidelity discrepancy, not a demonstrated current player lockup or FPS root cause. See docs/old-overlap-recovery.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Document verified immediate-parent exclusion/suppression versus browser recursive-root policy.
- [ ] #2 Implement eligible nested collision/recovery without breaking direct-parent or ordinary sibling semantics, release and repair.
- [ ] #3 Validate numerical and original-car Chromium nested/split cases; report intentional changed impulses and guard policy.
<!-- AC:END -->
