---
id: TASK-121
title: '[P3] PUP-20: Remove flag-sensitive powerups before an accepted structural bend'
status: done
assignee: []
created_date: '2026-10-24 19:43'
updated_date: '2026-10-24 19:55'
labels:
  - priority-3
  - PUP-20
  - powerups
  - damage
dependencies: []
references:
  - src/damage.ts
  - src/powerups.ts
  - src/main.ts
documentation:
  - docs/c2-crush-queue-re.md
priority: medium
ordinal: 3092
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bounded mechanics follow-up to PUP-16: original BendCar at 0x433bc0 calls 0x4dee90 at 0x433d6a before transforming an accepted bend. The helper removes active flag-0x04 definitions belonging to local driver 8, invoking ordinary lose handlers in catalog order. The browser currently leaves Hot rod, Jelly suspension and Solid granite active after a bend. Ordinary repair, split creation and rejected/already-bent requests must not invoke this cleanup. Native icon/fizzle transitions remain in PUP-16.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Only an accepted new bend invokes cleanup, before geometry and component mutation.
- [x] #2 Removal follows original flag, recipient and driver predicates, existing lose handlers and catalog ordering; unrelated effects and inventory remain.
- [x] #3 Affected live engine, grip, protection and suspension fields synchronize in the same physics operation; removed deadlines do not run again.
- [x] #4 Numerical checks and bounded original-asset headless Chromium checks cover collision/deferred and SPAM bends, rejection, ordinary repair and split isolation.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented accepted-bend-only hook, flag/recipient/driver-aware ordinary lose dispatch in catalog order, and synchronous binding of effect fields before geometry/component writes. Corrected missing recipient retention for engine/grip/suspension/bounce activation. Independent installed SW verification agrees: BendCar 0x433c00 calls helper 0x4dab90 at 0x433daa, with the same gates as HW. Thirty-three focused unit/original cases pass, including actual qualifying scenery splitting and expiration beyond removed deadlines. Production build and bounded original Newcity/Eagle3 headless Chromium check pass for all three flags, rejection, repeated/rival bends, repair preservation and SPAM; WebGL2 SwiftShader 1280×800 with no JS/request/GL errors. Controlled SPAM/damage fixtures are explicitly marked. Native outgoing icon/fizzle behavior remains PUP-16.
<!-- SECTION:NOTES:END -->
