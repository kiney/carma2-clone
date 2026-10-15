---
id: TASK-9
title: '[P1] PHY-10: Resolve remaining cases of vehicles getting stuck on barriers'
status: backlog
assignee: []
created_date: '2026-10-11 15:13'
updated_date: '2026-10-15 21:14'
labels:
  - priority-1
  - PHY-10
  - physics
  - legacy-partial
dependencies: []
references:
  - docs/c2-physics-re.md
  - tests/barrier-release.test.mjs
priority: low
ordinal: 1014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **PHY-10**
Numeric priority: **1** (1 is highest)
Original status: **Partial**
Category: **Physics and world**

## Scope and evidence

Renewed report of getting stuck on barriers: an additional browser block with shallow pre-existing overlap against two-sided faces is fixed without changing impulses/friction/drivetrain; exit motion, deepening and independent wall contacts are checked. The original SNOW barrier is one-sided: a reproduced body-support case unloads both driven rear wheels and remains physically stuck identically before/after the fix. This specific screenshot case is not claimed fixed; R recovery remains available. Other configurations and original-runtime comparison remain open.

## Source references

[RE notes](../../docs/c2-physics-re.md), [Tests](../../tests/barrier-release.test.mjs)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-15 Carrier2 user reports being pushed into the deck by a bulldozer-like opponent. Read-only paused evidence instead shows EAGLEGREEN resting almost exactly on its side (89.81 degrees), all four wheel contacts null, hierarchy doNothing=true, one sleep transition and zero wakes. Pause itself never sets immovable. Local static deck Y=-6.824999809, physical hull minimumY=-6.820544906: no hull penetration through this plane. Visible principal body extends below it (minimumY=-6.906123333). Confirmed DMG-06 variant WAM mismatch leaves principal body undeformed while collision hull changes; investigate that first. This snapshot does not establish a new trajectory-guard lockup or justify globally weakening collision/sleep. R recovery is the intended side-rest escape; not invoked so user state remains intact. Separate anomaly preserved in same ignored capture: fordpick at approximately (690727,804830,-664058), no causal relationship to player established; trajectory history required before assigning a cause. Existing priority unchanged.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: kiney
created: 2026-10-11 16:07
---
hasn't happened for a while now, so changing prio to low
---
<!-- COMMENTS:END -->
