---
id: TASK-52
title: '[P3] PUP-16: Honor powerup icon, group, flag, Pratcam, and fizzle metadata'
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-30 15:11'
labels:
  - priority-3
  - PUP-16
  - powerups
  - legacy-partial
  - topic-ui
dependencies: []
references:
  - src/powerups.ts
priority: medium
ordinal: 3036
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PUP-16**
Numeric priority: **3** (1 is highest)
Original status: **Partial**
Category: **Powerups**

## Scope and evidence

Account for icon/group/flag/Pratcam metadata and fizzle behavior. Currently, mainly the action, parameter, name, and duration take effect.

## Source references

[powerups.ts](../../src/powerups.ts)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-24: authored group cancellation, catalog-order resets and renewal are completed under PUP-18. UI-01 exposes component damage and read-only timed/whole-race effect status. PUP-20 separately ports flag-0x04 cleanup at accepted structural bending; it must not be confused with ordinary repair or split creation. Installed Pratcam callback 0x4e0c50 is a bare return in this executable. Native icon admission, five-visible-entry 3D fizzle presentation, negative-type handling, networking flags and the flag-0x40 eligibility counter still require their own implementation/evidence; this parent remains open.
<!-- SECTION:NOTES:END -->
