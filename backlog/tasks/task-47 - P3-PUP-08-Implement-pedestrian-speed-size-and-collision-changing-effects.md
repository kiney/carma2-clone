---
id: TASK-47
title: '[P3] PUP-08: Implement pedestrian speed, size, and collision-changing effects'
status: backlog
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-30 15:12'
labels:
  - priority-3
  - PUP-08
  - powerups
  - legacy-partial
  - topic-pedestrians
  - topic-powerups
dependencies: []
references:
  - src/powerups.ts
  - src/pedestrians.ts
priority: medium
ordinal: 3028
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PUP-08**
Numeric priority: **3** (1 is highest)
Original status: **Missing**
Category: **Powerups**

## Scope and evidence

Change pedestrian speed and size, along with their collision effects. Actions `1`, `2`; also includes slow, small, fat, and thin variants.

## Source references

[powerups.ts](../../src/powerups.ts), [pedestrians.ts](../../src/pedestrians.ts)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
ANI-01 now supplies normal action2 grants/cancellation/expiry, private living/dead MODEL scaling with original per-bone remaps, attachment scaling and source ScaleForm render-origin refresh. This completes its rendering consumer, not this whole task: action1 speed behavior and native PHIL body/joint/collision resizing and propagation remain here/PED-06. See docs/c2-ped-render-effects-re.md and docs/c2-ped-presentation-re.md.
<!-- SECTION:NOTES:END -->
