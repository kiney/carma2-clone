---
id: TASK-74
title: '[P3] QUA-03: Expand browser coverage across tracks and vehicle classes'
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-30 15:11'
labels:
  - priority-3
  - QUA-03
  - quality
  - legacy-partial
  - topic-quality
dependencies: []
references:
  - tests/browser.mjs
  - tools/car-damage-audit.mjs
priority: medium
ordinal: 3077
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **QUA-03**
Numeric priority: **3** (1 is highest)
Original status: **Partial**
Category: **Robustness, Testing, and Maintainability**

## Scope and evidence

Expand browser coverage to all available Stock/Advanced tracks and different vehicle classes. So far only a few scenes are loaded automatically; the 52-car audit is not a complete visual gameplay test.

## Source references

[browser.mjs](../../tests/browser.mjs), [car-damage-audit.mjs](../../tools/car-damage-audit.mjs)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-29 PERF-24 validation found a stale fixture in unchanged tests/browser-crash-matrix.mjs: Advanced catalog selects adv_data/RACES/Carrier_mission/CARRIER_mission.txt, now an honestly practice-only event with no physical rivals. Three Stock scenarios pass; harness then aborts with Loaded original race has no physical rival. Reconcile this fixture with current race availability semantics; do not fabricate opponents or weaken damage assertions. Real-GPU MCP Advanced Fridge Racer/69mach1 versus Coupe crash and repair provided separate coverage. Frozen PERF-24 regression contract must remain unchanged. Full-suite server HMR-shutdown timeout occurred once but focused reruns passed on baseline and isolated checkout; distinguish intermittent infrastructure failure from physics regression.
<!-- SECTION:NOTES:END -->
