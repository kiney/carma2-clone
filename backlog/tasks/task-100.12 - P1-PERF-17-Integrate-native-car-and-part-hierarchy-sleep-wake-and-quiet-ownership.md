---
id: TASK-100.12
title: >-
  [P1] PERF-17: Integrate native car and part hierarchy sleep, wake and quiet
  ownership
status: done
assignee: []
created_date: '2026-10-13 11:29'
updated_date: '2026-10-13 22:44'
labels:
  - priority-1
  - PERF-17
  - performance
  - physics
  - lifecycle
  - quiet
dependencies:
  - TASK-100.9
  - TASK-100.11
references:
  - src/physics/simulation.ts
  - src/physics/quiet-state.ts
  - src/physics/noncar-quiet.ts
  - docs/c2-ped-physics-lifecycle-re.md
  - docs/c2-noncar-wake-pull-re.md
  - docs/c2-noncar-slot-reclaim-re.md
parent_task_id: TASK-100
priority: high
ordinal: 1230
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Generic nativeQuietRingState and nativeQuietRingSleep have no production providers. Cars, attached/free vehicle parts and unsupported jointed NONCAR groups can therefore keep participating after settling and can block mixed-ring quieting. Detached parts remain in the force/guard roster until repair or structural removal. Several noncluster pieces in the saved Timber state have very small linear speed, but native eligibility is not established and the fast rotating Cerby group must not be arbitrarily slept.

Reconstruct and connect authoritative C2 hierarchy/contact-ring quiet state, complete-group sleep and source wake behavior. Distinguish native ec/quiet state, PHIL passive registration and motor sleep. Retain physical resting collision coverage and wake on the correct accepted contact/force/attachment transitions. Integrate these providers into the participation lifecycle from PERF-16, including only source-eligible NONCAR reclaim. Sleeping car pieces are not driver-4 scenery slots and must not acquire an invented TTL or disappearance rule.

Free unjointed prop quieting already exists; do not duplicate it. This ticket owns generic car/part/jointed-prop providers and their mixed-ring interoperability, while PED-07 retains pedestrian grounding/recovery behavior.

The user explicitly authorizes substantial, reversible physics and rendering redesign to reach genuinely playable performance. Existing browser-added guard algorithms, their sampling/iteration caps and bitwise equivalence to a flawed browser orchestration are not immutable requirements. Judge changed behavior against C2 evidence and focused gameplay regressions. Use a separate reviewed Git checkpoint per ticket and provide a short user-playtest focus before the next risky change. Record intentional deviations and measured costs; do not require an exhaustive safety proof before trying an evidence-backed redesign. Keep original assets read-only, use short serial captures on the shared workstation, and reserve Web Workers as a last resort.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Document native quiet-energy/contact/hierarchy gates and wake callers, and implement authoritative production providers for the supported car/part/jointed-NONCAR paths.
- [x] #2 Demonstrate eligible settled groups leaving expensive active force/candidate/response work while retaining contact discoverability and rendering; unresolved eligibility must be explicit.
- [x] #3 Verify wake and momentum exchange on later impacts, active forces, parent motion, detach/repair and mixed-ring transitions; do not quiet the moving Cerby cluster solely to reduce cost.
- [x] #4 Feed genuine quiet state into PERF-16 lifecycle/reclaim without reclaiming driver-2/3 vehicle pieces as ordinary NONCARs or deleting them by lifetime.
- [x] #5 Exercise multiple original cars, attached parts, free debris and props in headless numerical and Chromium settle-hit-repair scenarios, with clean runtime diagnostics.
- [x] #6 Record short-session active/resting population and repeated guard/force-work differences, and provide a checkpoint plus a user-playtest focus for persistent debris, reactivation and repair.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented production generic hierarchy/contact-ring quiet providers; exact car wheel support wake, own/descendant folds, world-joint gates, retained rest discovery, actual deferred-friction cache/flags, moment restoration and repair ownership. Ordinary detached/pulled-body creation hints verified from HW. Explicit one-phase browser split hint correction prevents reproduced airborne startup freeze without extra force; native pooled-memory aliasing and tumble/custom eligibility remain documented. Final 2910 tests/build pass, focused review17 pass; original Eagle/Cerby natural sleep-hit-repair (9ticks each), 3tick airborne split, four-car core crashes and four Stock/Advanced prop quiet/reclaim cases pass with clean GL/console/network. Sleeping-piece forces/own world contact calls0; next awake tick1/2. SwiftShader short A/B moving fixture preserves exact state/fractions and work counts but timing is mixed/adverse; hardware page creation and final async MCP probe failed before usable measurement. No hardware-FPS improvement claimed. docs/hierarchy-quiet-performance.md and docs/c2-hierarchy-quiet-re.md record evidence, limitations and playtest focus.
<!-- SECTION:NOTES:END -->
