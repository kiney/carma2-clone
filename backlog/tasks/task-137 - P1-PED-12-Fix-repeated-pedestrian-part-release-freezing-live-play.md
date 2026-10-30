---
id: TASK-137
title: '[P1] PED-12: Fix repeated pedestrian part release freezing live play'
status: done
assignee: []
created_date: '2026-10-30 20:21'
updated_date: '2026-10-30 20:28'
labels:
  - priority-1
  - PED-12
  - topic-pedestrians
  - bug
dependencies: []
priority: high
ordinal: 1001
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reproduced in live Stock TIMBER after AI-04 playtest. Every render callback throws Prepared native bone resource required through bone registrar removal -> releaseRemovedParts -> simple root release, preventing the frame from completing. Paused live scene and saved114MB local c2bug capture before reload. Investigate stable cleared/vanished part ownership through release, re-entry and second release. Preserve deferred PHIL removal proof; do not hide the exception with a catch or skip live detached bodies.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A deterministic lifecycle regression reproduces the exact reported failure before the fix and passes unchanged afterward.
- [x] #2 Absent stable bone resources follow PHIL code3 completion while live resources retain validation and deferred removal ownership.
- [x] #3 Mixed/vanished/reused parts retain masks, damage and RNG semantics; original-asset Chromium lifecycle and normal driving complete without the repeated error.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reproduced exact release->reacquire->release stack in3 frozen regressions; malformed live validation test already passed. Fixed registrar absent-identity code3 completion before preparedBone; did not weaken pool masks, PHIL proofs or deferred handling. Exact user scene resumed96game updates without reload, with no new errors, all prior HP/masks intact and affected slot released. Saved114570844-byte diagnostic locally before intervention. Build passes; full suite3760 pass/6 optional skips/0 failures; existing18 bridge cases pass; Stock/Advanced actual-contact sever/population browser passes. Asset-free CI3257 pass/439 skip plus known unrelated intermittent HMR shutdown timeout, now tracked QUA-15/TASK-138.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed repeat part-release frame-abort loop at its PHIL adapter ownership boundary. Original user TIMBER state recovered in place; permanent source fix is in production build. Four frozen headless regressions cover vanished/mixed/reused-slot lifecycles and retained live-resource validation. See docs/ped12-release-reentry.md.
<!-- SECTION:FINAL_SUMMARY:END -->
