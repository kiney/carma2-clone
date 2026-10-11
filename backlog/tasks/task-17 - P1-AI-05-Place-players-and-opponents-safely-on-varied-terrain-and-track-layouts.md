---
id: TASK-17
title: >-
  [P1] AI-05: Place players and opponents safely on varied terrain and track
  layouts
status: backlog
assignee: []
created_date: '2026-10-11 15:13'
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
ordinal: 1049
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
