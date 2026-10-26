---
id: TASK-17
title: >-
  [P1] AI-05: Place players and opponents safely on varied terrain and track
  layouts
status: next
assignee: []
created_date: '2026-10-11 15:13'
updated_date: '2026-10-26 19:43'
labels:
  - priority-1
  - AI-05
  - opponents
  - legacy-needs-validation
dependencies: []
references:
  - src/physics/spawn.ts
  - src/main.ts
  - tests/browser-spawn-pairs.mjs
priority: high
ordinal: 1010
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **AI-05**
Numeric priority: **1** (1 is highest)
Original status: **Needs validation**
Category: **Opponents and Pedestrians**

## Scope and evidence

Shared safe starting placement for player/opponents: four original wheel anchors, slope rotation, finite ground surfaces, complete hull/terrain and vehicle/prop checks; search for a nearby free pose when needed. Wheel lengths, prediction, and safe history are initialized to the accepted pose. Grid offsets follow the starting direction and remain stable during asynchronous loading. In DUNE with Eagle/Buggy/Bigdump and NEW CITY, complete-population checks found zero initial road/car penetration and four supported wheels. The earlier five-car check did not cover the complete asynchronously loaded population. Do not accept an unsafe pose if the search fails. The updated browser check now waits for the complete original opponent population rather than a transient five-car count. This exposed a dense Bigdump grid where a rival exhausted the immediate search; a wider failure-only safe search now passes initial placement checks. A subsequent full run reproduced Newhawk wasting within four seconds in a Bigdump grid despite safe initial placement; the early active-AI crash needs investigation before this entry can be closed. Isolated head-on/oblique pairs deform and escape with real reverse input, without fatal console or WebGL errors. General AI stuck behavior remains AI-04.

## Source references

[spawn.ts](../../src/physics/spawn.ts), [main.ts](../../src/main.ts), [spawn/pair browser test](../../tests/browser-spawn-pairs.mjs)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Queue review 2026-10-26 — position 2/5, P1.
Follow PHY-11 for a more stable crash-test baseline; this is a recommended order, not a hard dependency. Initial placement already consumes valid original hulls and does not require the unresolved deformed-hull case. Reproduce the exact Bigdump/Newhawk roster with seed and initial poses, separating unsafe spawn from subsequent AI collisions. AI-01/AI-02/AI-04 are related only if the reproduced cause belongs to objectives, navigation or recovery; completing those whole tickets is not a prerequisite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Read-only capture audit (2026-10-24): the retained October 15 Bigdump/Dune capture is a passing eleven-car roster without Newhawk. Newhawk appears only in a separate passing Newcity/Eagle3 grid. Initial poses are retained, but no qualifying failed Bigdump/Newhawk roster or RNG state exists. Those passes cannot establish resolution of the reported early active-AI waste, especially after later physics changes. Keep open: a new deterministic qualifying reproduction must record fleet, seed and poses, separating safe initial placement from subsequent AI crash behavior.
<!-- SECTION:NOTES:END -->
