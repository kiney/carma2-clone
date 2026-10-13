---
id: TASK-100.11
title: >-
  [P1] PERF-16: Separate static world ACTs from locally admitted physical
  objects
status: done
assignee: []
created_date: '2026-10-13 11:29'
updated_date: '2026-10-13 19:51'
labels:
  - priority-1
  - PERF-16
  - performance
  - physics
  - world
  - lifecycle
dependencies: []
references:
  - src/physics/simulation.ts
  - src/physics/phil-registry.ts
  - src/world.ts
  - src/physics/noncar-reclaim.ts
  - docs/c2-noncar-wake-pull-re.md
  - docs/c2-noncar-slot-reclaim-re.md
parent_task_id: TASK-100
priority: high
ordinal: 1220
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The captured 483-body roster includes all 466 immovable NONCARs. addNonCar() keeps ordinary ACTs outside PHIL until pull, but still adds every loaded object to the dynamic world and allBodies() without registration eligibility. Native C2 retains unpulled objects as static MODEL/world geometry and locally pulls/adopts them through ActorBoxPick, PHIL registration and same-collection candidate insertion.

Implement the missing production bridge between retained static ACTs and admitted physical participation: local pull, active roster ownership, same-collection discovery/preparation, fallback static faces on failed admission and appropriate retained-ACT return/reclaim transitions. Static obstacles must remain collidable and renderable while outside active integration. A roster filter alone is insufficient because current dynamic-owner registration removes static surface/guard coverage.

Existing native NONCAR force/mechanics and world-face implementations under WLD-01/WLD-03 are retained; this ticket owns participation and ownership transitions. Reclaim initially consumes authoritative quiet states already available and explicitly retains unsupported hierarchies. PERF-17 supplies the remaining generic hierarchy quiet providers and their follow-on lifecycle integration, so full hierarchy reclaim is not a prerequisite here. Native driver-4 NONCAR reclaim must not be applied to driver-2/3 detached/split car parts. The 483/17 traversal ratio is not a promised overall speedup.

The user explicitly authorizes substantial, reversible physics and rendering redesign to reach genuinely playable performance. Existing browser-added guard algorithms, their sampling/iteration caps and bitwise equivalence to a flawed browser orchestration are not immutable requirements. Judge changed behavior against C2 evidence and focused gameplay regressions. Use a separate reviewed Git checkpoint per ticket and provide a short user-playtest focus before the next risky change. Record intentional deviations and measured costs; do not require an exhaustive safety proof before trying an evidence-backed redesign. Keep original assets read-only, use short serial captures on the shared workstation, and reserve Web Workers as a last resort.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Record a body/PHIL/pulled/static-owner census before and after; inactive loaded ACTs no longer participate as ordinary active integration/response bodies merely because they were loaded.
- [x] #2 Validate static collision coverage, local oriented pull eligibility, immediate same-collection candidate preparation and successful activation without one-frame collision gaps.
- [x] #3 Handle admission/resource capacity failures and native fallback/sticky-failure semantics where verified; preserve ordinary world faces, drivable geometry, camera queries, smash and moving scenery.
- [x] #4 Integrate retained-ACT return/reclaim using already authoritative eligibility, cached MODEL/query bounds and source driver/ownership rules; unsupported hierarchy quiet states remain explicit until PERF-17.
- [x] #5 Check original Stock/Advanced approaches to dormant props, impulse-redirected impacts, activation, settling and repull; preserve original assets, visible scenery and source-supported gameplay effects.
- [x] #6 Report per-tick roster, bounds/guard/world work and short Chromium CPU evidence, with a separate checkpoint and user-playtest focus for scenery collisions and repeated prop activation.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented retained static ACT versus active PHIL ownership, oriented local admission and same-collection preparation, shared type-dedicated/forty-global-extra slots, distinct sticky physical versus retryable PHIL failure, supported quiet reclaim/native return/repull and connotation-clone resource/index retention. Original ACT capacity/resources remain retained; unknown hierarchy quiet stays PERF-17. Source BSS clock survives race disposal, with MODEL/cache providers read only at the due outer-frame pass. Hardware Stock/Advanced Timber initial car/part state matches; retained props stay466 while fixture active bodies fall480/484 to16/21. Whole40ms update CPU83.5->21.1ms Stock and34.3->27.9ms Advanced; adverse cold115.6ms Advanced first tick retained. See docs/noncar-participation-performance.md for limits, source addresses and ignored evidence. Build and2869 full tests pass; final focused admission/quiet checks pass. Four Stock/Advanced static approach/repull, authored debris and controlled original-road quiet/wake checks pass, with no fatal console/request/WebGL errors. Crash/repair/split/joint matrix and smash/powerup/Carrier completion pass. Quiet harness observes pre-reclaim state and distinguishes forced recovery; a labelled controlled drop avoids the original station ledge rather than altering mechanics. Severe crash checks verify actual accepted contact and finite in-world results instead of an arbitrary post-crash tether. DevTools AMD keyboard drive and original Timber tree collision verified. PERF-01 stays open; checkpoint then user scenery/debris playtest before PERF-17.
<!-- SECTION:NOTES:END -->
