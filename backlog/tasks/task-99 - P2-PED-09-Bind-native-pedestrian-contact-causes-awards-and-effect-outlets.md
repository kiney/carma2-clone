---
id: TASK-99
title: '[P2] PED-09: Bind native pedestrian contact causes, awards and effect outlets'
status: next
assignee: []
created_date: '2026-10-11 16:33'
updated_date: '2026-10-29 00:42'
labels:
  - priority-2
  - PED-09
  - pedestrians
  - source-PED-03
dependencies:
  - TASK-96
  - TASK-98
references:
  - src/ped-native-gameplay.ts
  - src/ped-contact-attribution.ts
  - src/ped-blood.ts
  - src/ped-recovery-effects.ts
  - src/main.ts
  - docs/c2-ped-native-gameplay-re.md
  - docs/c2-ped-contact-attribution-re.md
  - docs/c2-race-rules-re.md
  - tests/browser-ped-native-gameplay.mjs
priority: high
ordinal: 2099
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extracted from **PED-03 / TASK-35** on 2026-10-11.
Numeric priority: **2** (inherited from PED-03).
Status: **Backlog follow-up**; this work is not required to close the narrowed population-counting task.

## Remaining outcome

Provide actual native contact/death cause and retained award inputs to the already implemented race reward and effect consumers. Bind real killer/driver, cache cause flags, source event time, current/starting velocity, height/geometry and napalm state instead of reusing hard-coded height zero or player-driver fallbacks. Connect native DoGiblets, blood/scrape/status/model-change and selected-corpse-slick outlets without repeating HP, OneLessPed, Kill or launch. Native award formulas and payout remain RAC-04; combat powerup selection/lifecycles remain PUP-11; spatial playback remains AUD-03. This ticket owns the pedestrian physical-state-to-consumer adapters, not duplicate implementations of those systems.

## Existing evidence and limitations

Native attribution/death kernels and existing race award formulas/effects are available. The current native browser wrapper records effects/count/score events; its cache lacks some explicit retained award inputs. Normal gameplay and native wrappers must share actual consumers before claiming full award parity.

## Related owners

The preserved pre-split evidence is in TASK-35. Keep PED-01/PED-02/PED-05 completed scope intact; source-faithful kernels and controlled fixtures alone do not prove production population parity.

Source task: [PED-03 / TASK-35](task-35%20-%20P2-PED-03-Implement-native-pedestrian-impacts-falls-recovery-and-body-contacts.md).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Actual native population contacts populate original cause/cache and complete retained award inputs before normal credit/time/combo consumers run; player/nonplayer and repeated-corpse cases match source eligibility.
- [ ] #2 Count/objective processing precedes scoring, using the PED-03 bridge, without duplicate credit, count, HP or physical transport.
- [ ] #3 Real original blood/giblets/scrape/status and shared slick consumers receive native physical inputs from the correct owning phase, with Stock/Advanced browser checks.
- [ ] #4 Missing retained input or exceptional providers is explicitly diagnosed; no guessed height/driver or replay record is presented as verified original behavior.
<!-- AC:END -->
