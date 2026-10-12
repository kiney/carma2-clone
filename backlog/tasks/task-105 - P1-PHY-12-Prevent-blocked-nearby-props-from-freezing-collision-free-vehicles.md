---
id: TASK-105
title: >-
  [P1] PHY-12: Prevent blocked nearby props from freezing collision-free
  vehicles
status: done
assignee: []
created_date: '2026-10-12 17:58'
updated_date: '2026-10-12 18:30'
labels:
  - priority-1
  - PHY-12
  - physics
dependencies: []
references:
  - src/physics/pair-guard.ts
  - docs/c2-physics-re.md
  - docs/guard-coupling-fix.md
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A reproduced PHY-09 safety-guard defect shares a near-zero movement fraction across broadphase-near movable bodies despite no car contact. Original Eagle with 0.05 world-unit clearance has independent car pair fractions 1 but grouped fraction 0.000009918 when a nearby prop is blocked. This can freeze an airborne car; repair can change attached/debris grouping. Present before PERF-09; distinct from PHY-10 barrier support and PHY-11 degenerate hulls. Replace proximity-based coupling with interaction-local constraints and revalidation after clipping. Preserve attachment dependencies, interlock/anti-tunneling protection and native solver/damage behavior. Separate roof/query/repair coherence hypotheses are not claimed fixed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Clear airborne original and generated cars retain full motion beside blocked but non-contacting props, including repeated steps, damage and detached parts.
- [x] #2 Actual contact and attachment groups remain safe; revalidate crossings introduced by independent world/pair clipping, rotation, existing overlap and projection.
- [x] #3 Original crash/repair and guard tests, production build and short Chromium driving/prop/crash checks pass; record work counters and unchanged/revised numerical outcomes honestly.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified browser-only safety-guard defect, present before PERF-09. Original full-path certificates now couple only attachment ancestry and actual conflicting trajectories. Unequal prefixes are revalidated; bounded conservative fallback seals affected broadphase components. Native contact/impulse/crush, suspension, tyre and timestep behavior remain unchanged. Added phase-local counters and isolated before/after DevTools probe. Existing multi-hull golden expected false coupling and now asserts safe independent escape. Full suite: 2645 passes, zero failures/skips. Focused guard/coupling suite: 35 passes. Production build, crash-matrix and spawn-pair Chromium suites pass. Fifteen original-car crash reports exactly match the accepted pre-fix baseline. DevTools TIMBER driving, Eagle/Coupe impact, repair and 0.05-world-unit separated-prop regression pass; no console/WebGL errors. Thirty-neighbor stress case reaches 260 exact revalidations and one component-local fallback, preserving disconnected clear-body motion; independent geometry samples remain safe. Sol review found no correctness blocker. HW/SW hashes unchanged. See docs/guard-coupling-fix.md.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed PHY-12: a blocked non-contacting prop no longer freezes a clear vehicle. Actual contact/attachment constraints and anti-interlock protection are retained through unequal-prefix revalidation with a bounded component-local fallback. Tests, original-data production Chromium checks and DevTools validation pass. PHY-10 terrain-support traps, PHY-11 degenerate crushed hulls and unverified repair/roof hypotheses remain separate; no broader engine-fidelity or performance Goal is completed.
<!-- SECTION:FINAL_SUMMARY:END -->
