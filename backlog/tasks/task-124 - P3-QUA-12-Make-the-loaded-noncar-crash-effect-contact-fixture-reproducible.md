---
id: TASK-124
title: '[P3] QUA-12: Make the loaded-noncar crash-effect contact fixture reproducible'
status: backlog
assignee: []
created_date: '2026-10-28 22:32'
updated_date: '2026-10-29 08:33'
labels:
  - priority-3
  - QUA-12
  - quality
dependencies: []
references:
  - tests/browser-crash-effects.mjs
priority: medium
ordinal: 3990
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The existing browser-crash-effects.mjs loaded-noncar subcase fails to observe a native driver-4 car-spark packet in both unchanged HEAD 3b89d2d and the WLD-05/DMG-03 candidate (2026-10-28). Both runs report the same single unmet assertion, no application errors, and otherwise successful car/car, wall, tyre, wreck/repair and loose/split-part checks. This is not evidence of a newly broken effect callback.

The fixture selects an arbitrary nearby attached prop, starts Eagle eight units behind its actor origin, and stops after seven simulation seconds if no packet arrives. The captured player remains roughly one unit from the selected actor and has no qualifying packet; unrelated spark/FRAG pool growth cannot prove contact with this prop. Diagnose actual shape/contact admission, lambda and linear-velocity gates. Make the approach reproducible against the actual loaded collider or explicitly classify an unmet contact setup. Do not weaken native gates, fabricate a packet, or make the test green by dropping its effect assertions.

Private reports: /tmp/carma-worldfx-baseline/artifacts/browser-crash-effects.json and /tmp/carma-worldfx-nxv19wde/artifacts/browser-crash-effects.json. Generated evidence is ignored; no original fixtures belong in Git.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reproduce and distinguish actual production contact failure from an ineffective scripted approach.
- [ ] #2 A qualifying original noncar contact verifies driver-4 ownership, native spark admission and effect output without relaxing production gates.
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-29 08:33
---
Related live production finding is now tracked as P1 PHY-21/TASK-126: a genuine original stop sign is sticky-x, unregistered and immovable in the users paused scene; 549/606 retained props are marked x while current physical slots are empty. A fresh same-location contact admits a prop normally; earlier failure cause is not yet known. Keep this fixtures native driver-4/spark assertions intact and coordinate contact validation with PHY-21 rather than assuming every unmet packet is merely a fixture problem.
---
<!-- COMMENTS:END -->
