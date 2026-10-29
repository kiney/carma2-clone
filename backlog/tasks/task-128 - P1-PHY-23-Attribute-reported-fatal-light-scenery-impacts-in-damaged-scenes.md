---
id: TASK-128
title: '[P1] PHY-23: Attribute reported fatal light-scenery impacts in damaged scenes'
status: next
assignee: []
created_date: '2026-10-29 13:01'
labels:
  - priority-1
  - PHY-23
  - physics
  - reported
  - diagnostics
dependencies:
  - TASK-127
references:
  - docs/c2-ignore-world-reclaim-re.md
  - tools/impact-history-recorder.mjs
priority: high
ordinal: 1150
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User reported another apparently indestructible sign wasting The Plow during the preserved Stock Desert1 playtest. Do not label this specific crash fixed merely because PHY-22 repairs the verified lift/reclaim deadlock. All49 scenery slots were full; the nearest inspected type28 sign &28d0256 was already admitted and detached, and the actual fatal accepted-impact row and pre-impact component levels were not retained. Current car mass10t; sign mass0.076351t, torque0.1kNm, snap45degrees. Last retained car attacker is Fordpick from an earlier collision, not proof of the final cause. Clean source-data approach at6 actor units/sec releases/moves the sign and causes zero component damage over25ticks. Investigate with bounded tools/impact-history-recorder.mjs in the unchanged live tab: correlate actual committed solver rows, counterpart ACT/face, callback rejection, component deltas and whole-frame wastage. Exclude discarded attachment-breaking lambdas. Distinguish existing damage, terrain-pinned props, capacity fallback and duplicate/static collision coverage before changing formulas. Reproduce a concrete mismatch and derive any fix from native evidence; preserve playability and authored object differences.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Obtain an original-data replay or bounded live capture identifying actual accepted contact rows and component transitions for the reported fatal scenery collision.
- [ ] #2 Determine whether post-PHY-22 behavior still violates C2 collision/damage mechanics; implement and validate a source-backed correction if a defect is established.
<!-- AC:END -->
