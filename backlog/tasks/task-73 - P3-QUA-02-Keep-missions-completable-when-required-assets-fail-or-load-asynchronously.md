---
id: TASK-73
title: >-
  [P3] QUA-02: Keep missions completable when required assets fail or load
  asynchronously
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-24 18:18'
labels:
  - priority-3
  - QUA-02
  - quality
  - legacy-needs-validation
dependencies: []
references:
  - src/main.ts
  - src/rules.ts
priority: medium
ordinal: 3076
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **QUA-02**
Numeric priority: **3** (1 is highest)
Original status: **Needs validation**
Category: **Robustness, Testing, and Maintainability**

## Scope and evidence

Check missions when opponents or pedestrians fail to load or load asynchronously; a missing required asset must not make a mission inexplicably impossible to complete.

## Source references

[main.ts](../../src/main.ts), [rules.ts](../../src/rules.ts)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Read-only audit reproduced two completion traps: rejected partial opponent loading never settles readiness, and missing required pedestrian groups can settle to0/0 forever. Implement explicit population load availability and persistent actionable unavailable-mission feedback; never award missing targets or silently shrink selected mission requirements. Test async completion, partial failure, selected target gaps and optional classic-race objectives headlessly.

Implemented independent loading/ready/failed population states and separate objective readiness. Required missing/failed populations become explicitly labelled Free Drive without completion payout; optional classic-race failures retain other goals and usable partial AI fleet. Persistent English HUD/menu reasons and fresh retry state; late old-generation promises cannot poison current race. Pedestrian loader reports true missing-group/personality failures separately from optional visual warnings and authored zero-spawn groups. Mixed missions wait for required peds. Seven numerical tests, existing7race-rule/3pedestrian tests and production build pass. Actual headless Newcity/Eagle failure-injection browser cases pass: pending→partialfailed required, optionalclassic with4gates, missingpeds, visiblemenu status, no payout, stale rejection after reload; no fatal console/page/network errors. In-memory fixtures only, originals unchanged. Browser compatibility fallback (not native missing-file behavior) documented in docs/population-loading.md.
<!-- SECTION:NOTES:END -->
