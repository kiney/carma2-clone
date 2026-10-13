---
id: TASK-106
title: >-
  [P1] PHY-13: Resolve vehicle lockups caused by deeply overlapping detached own
  parts
status: backlog
assignee: []
created_date: '2026-10-13 00:37'
updated_date: '2026-10-13 00:40'
labels:
  - priority-1
  - PHY-13
  - physics
  - collision
  - detachment
dependencies: []
references:
  - docs/own-debris-lockup.md
  - docs/guard-coupling-fix.md
  - src/physics/simulation.ts
  - src/physics/pair-guard.ts
  - src/physics/geometry.ts
priority: high
ordinal: 1008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Captured user-driven Timber/EAGLEGREEN lockup on apparently flat road after PERF-12. At simulation time149.44s the player has four supported/load-bearing wheels, functional damage max17%, nonzero linear/angular velocity and no nearby car. A fully detached own part EIIIFRWG.DAT (runtimePart1, phase2, no joint) deeply overlaps its former vehicle collision hull. The road guard permits the full tick, but the body-pair commitment guard clips player and debris to an effectively zero prefix. Cloned-state uncached contact collection emits zero rows despite reporting old overlap, so the solver cannot produce separating impulses while the guard keeps preventing movement. This is distinct from PHY-10 barrier body support, PHY-11 hull rebuild exceptions and fixed PHY-12 noncontacting blocked-prop coupling. Investigate native C2 detachment admission, former-owner collision eligibility and old-overlap contact recovery before selecting the fix. Preserve physical debris, meaningful own-piece contact after separation, crush/repair coherence and anti-interlock/anti-tunneling safeguards; do not globally disable collision guards or all owner/debris collisions. Diagnosis is strong for this captured pose; entry trigger and binary/reference-correct remedy remain unverified. No engine fix is implemented by this ticket creation. Actual data-derived state and screenshot remain ignored in artifacts/perf01-user-stuck*; source-only notes should reference the deterministic snapshot loader when implemented.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Replay the captured original-car and detached-part kinematics/hulls as a deterministic headless fixture and reproduce absent recovery rows plus near-zero accepted movement before the fix; proprietary fixtures stay ignored or load locally.
- [ ] #2 Trace C2 original/rec2 detached-part admission, former-owner collision rules and old-overlap contact response; document verified behavior versus browser guard extensions before choosing the remedy.
- [ ] #3 Restore separating physical motion/contact response in this captured case and comparable deformed/detached cases without permitting deeper overlap, new car/car interlock, tunneling or permanently ignoring owner/debris collisions.
- [ ] #4 Validate head-on/oblique/repeated impacts, physical debris and attachment transitions, repair/reset, multiple original cars, and the actual Timber Chromium case; preserve numerical/asset regressions and inspect console/WebGL.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Confirmed clone probes: player worldFraction=1 with actual motion, spin removed and +/-forward horizontal velocity. Full472-body guard playerFraction=0.000004149319832785087; the sole guarded pair is player/own fully detached front-right wing. Initial penetration0.15022994079337004 model units. Removing only that wing in the cloned diagnostic gives playerFraction1; nearby fixed props are individually clear. Guard counters dependencyMerges/revalidationCalls/conservativeFallbacks all0, so this is direct overlap blocking rather than PHY-12 transitive coupling. Native raw pair collector with fresh broadphase/cache emits0 rows and overlapDetected=true. No-spin fraction0.000004157; forward0.0000155033; reverse0.0000180465. Prescribing outward motion for both cloned bodies permits fraction1, proving the guard can admit separation when the solver supplies a compatible trajectory. Live state remains paused and unchanged (position27.757056345844088,2.4732747121370178,-24.4237200414592). Last512 recorded live frames p50~16.7ms,p95~33.4ms,max~50.1ms; tick p50~10.1ms,max~34.8ms, so this is not the requested <=4FPS reproduction. Hardware AMD Radeon at2099x1467 approximately, exact buffer in ignored state JSON. No fatal console/WebGL error.

Exact hardware capture metadata: drawing buffer2098x1466, DPR1.484375, ANGLE AMD Radeon Graphics/radeonsi gfx1150. Earlier approximate buffer wording is superseded. All diagnostic integration and collision checks operate on cloned kinematics and fresh guard/broadphase contexts. The original live game remains paused at149.44s with identical player position and no repair/reset/advancement.
<!-- SECTION:NOTES:END -->
