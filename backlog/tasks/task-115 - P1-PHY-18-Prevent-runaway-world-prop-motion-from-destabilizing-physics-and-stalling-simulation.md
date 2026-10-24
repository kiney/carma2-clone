---
id: TASK-115
title: >-
  [P1] PHY-18: Prevent runaway world-prop motion from destabilizing physics and
  stalling simulation
status: done
assignee: []
created_date: '2026-10-24 14:08'
updated_date: '2026-10-24 14:46'
labels:
  - priority-1
  - PHY-18
  - physics
  - performance
  - regression
dependencies: []
references:
  - docs/timber-runaway-props.md
priority: high
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Live Stock Timber at 103bdad produced a 9.2-second physics tick and 16-second catch-up update, then persistent approximately 2 FPS. Only 34 bodies, but several free noncars had extreme finite motion: actor &33p0036 at omega 897550 rad/s and speed33338 world units/s far outside the track. Captured body copies isolate approximately93ms of empty-world guarding across four props and1024 unsuccessful queries. The initiating energy injection and original longest spike remain unresolved; do not conflate this continuing cost with a full causal profile. Live scene preserved paused and original-derived captures ignored. See evidence note for exact data and limits.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Reproduce the captured runaway state and distinguish proven continuing high-spin cost from the unproven initiating impulse; track the latter separately if containment is selected.
- [x] #2 Contain escaped free props and fully detached parts using authored world bounds and complete ownership cleanup, without changing normal in-world speed, spin, damage or high-altitude flight.
- [x] #3 Certify clear complete free-body paths before angular sampling using current ownerless geometry, preserving obstacles, re-entry, custom-provider fallback and existing angular-contact regressions.
- [x] #4 Validate copied captured bodies, lifecycle and repair, full numerical regressions, Stock/Advanced browser crashes and visible Chromium, with truthful timing limitations.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-24: User explicitly requested implementation and authorized an escaped-object removal or containment mechanism if the initiating explosion cannot be established. Preserve the paused production reference; changes and reproduction run in an isolated checkout. Investigate root cause and bound useless world-guard work alongside lifecycle-safe out-of-world containment.

User-authorized containment branch selected; initiating energy injection remains explicitly unresolved in PHY-19. Inertia and current free-force paths were excluded by original-data comparison. Implementation uses padded authored footprint, exact fully-detached ownership/repair checks, normal native slot/ACT cleanup and complete-COM-tube world clearance. Normal in-world velocities/omega are unchanged.

Completed containment and constant-work full-motion clearance. Four copied extreme bodies retain exact final poses with512->0sampled angular sections and1024->0world queries. Visible Chromium AMD re-applied ten captured free-prop states to original Timber actors: all ten retired, slots returned to zero, driving continued, GL/console clean. Full integrated suite3140pass,0fail,0skip; productionbuild, four Stock/Advanced crash core cases, StockTimber/AdvancedCarrier escaped-prop browser checks and grounded/airborne Porker2 split+repair browser checks pass. Final independent Sol review found no blockers. Original first energy injection is not proven; PHY-19 tracks it separately. No global speed/spin cap or normal collision equation changed.
<!-- SECTION:NOTES:END -->
