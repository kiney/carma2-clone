---
id: TASK-126
title: '[P1] PHY-21: Diagnose and fix movable scenery becoming permanently static'
status: done
assignee: []
created_date: '2026-10-29 08:33'
updated_date: '2026-10-29 13:07'
labels:
  - priority-1
  - PHY-21
  - physics
  - reported
dependencies: []
references:
  - src/physics/simulation.ts
  - src/physics/noncar-slots.ts
  - docs/c2-noncar-wake-pull-re.md
priority: high
ordinal: 1001
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Live Chromium Newcity1 at gameTime 251791 ms: original stop-sign actor &20s0078.ACT is now named &x0s0078, retained mechanics index 20, mass 0.065358 tonnes, snap angle 0, no joint, attached=false. It remains upright immediately ahead of Eagle at [45.278461,-0.823819,50.506348]. No PHIL header or physical slot, noncarPulled=false, immovable=true. Census: 606 retained noncars, 549 sticky-x actors, zero admitted/pulled/occupied noncar slots, all 40 extras free. This is a failed-admission state, not authored immovability or a torque threshold.

Installed source evidence in docs/c2-noncar-wake-pull-re.md establishes sticky x after missing mechanics or exhausted dedicated/global extra slots. Current free slots do not prove historical capacity was available. Production pullWorldActor also marks x if its actor/body lookup is missing. Determine which path created the widespread failure and correct any browser orchestration/query/ownership defect without arbitrarily resetting native failure markers or globally enlarging the physics roster.

A separate fresh original Newcity1 production Chromium case starts with zero x markers. Driving Eagle into the same original stop-sign location admits a noncar successfully (one dedicated slot, PHIL driver-4 owner), with no sticky failures. This rules out unconditional bad stop-sign mechanics/load binding, but does not establish the earlier failure cause. Preserve the users current paused scene. Related QUA-12/TASK-124 must retain its genuine contact/effect assertions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Capture the first actual sticky-x transition and attribute it to missing body identity, physical slot saturation or another verified source; distinguish intended native capacity failure from a browser defect.
- [x] #2 The same original sign and other stock props respond to genuine car contacts after the corrected scenario; test normal admission, quiet/reclaim/repull and real capacity exhaustion.
- [x] #3 Preserve source-bounded participation/performance, unchanged crash coefficients, original-data read-only policy and the existing live scene.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fresh isolated production Chromium verified the exact reported actor &20s0078 / original &20s0078.ACT: a real W-key approach from [45.278461,-0.823819,52] with initial velocity [0,0,-3] moves it from z=50.506348 to z=44.798204, rotates it and leaves velocity z=-4.36746 after 2666 ms. One dedicated index-20 slot/PHIL owner, zero x transitions. Short test only; no sustained benchmark. Private evidence /tmp/stop-sign-diagnosis.json.

Live page5 remains paused at gameTime 251791 with identical player pose. Bounded old-runtime instrumentation is installed as window.__carmaNoncarPullAudit: wraps original pullWorldActor/admitNonCar without altering return values or state, counts attempts and peak physical occupancy, retains at most 64 new failure records with missing-body versus admission-capacity attribution. Existing sticky-x markers were deliberately not reset. Read this audit on the next report; its absence after reload is expected. The historical cause of the already marked 549 actors remains unknown.

Implemented deliberate browser capacity backpressure instead of installed permanent x on allocation exhaustion. The dedicated-per-type/40-extra pool and 100-header PHIL table are unchanged. Valid waiting ACTs retain numeric Three/native identities and static MODEL coverage; normal reclaim invalidates caches and allows ordinary local retry. Missing mechanics still has the separate permanent native failure. Added bounded race-scoped capacity/missing-mechanics counters.

The exact original stop-sign browser regression fails on unchanged 59769de at the first controlled capacity failure: 42 quiet original props, 40 extras full, sign renamed &x0s0078. Candidate Stock/Advanced cases retain the name, preserve 28 actor-specific static faces, release capacity via production reclaim effects, and ordinary W-key driving then activates/displaces/tips the sign (observed rotations 1.5567/0.5830 radians). No post-release manual target admission. Four existing original Newcity/Carrier admission/quiet/reclaim/repull browser cases also pass; no console/request/GL failures, SwiftShader 1280x800 correctness only.

13 participation tests include actual once-per-second reclaim with no manual cache invalidation and no retry on cache hits. Full suite: 3372 tests, 3361 passes, 5 optional captured-fixture skips, 6 sandbox socket EPERM failures; all 8 server-startup tests pass when rerun with socket access, resolving those 6 environment failures. Build passes. Historical query that first produced the users 549 markers remains unknown; this fixes the reproduced permanent-failure class, not a claim that oversized speculative queries are eliminated.

2026-10-29 follow-up PHY-22/TASK-127 restores native query-cache ownership for IGNORE_WORLD_COLLISIONS lifts. One cacheless awake lift globally vetoed normal reclamation and kept every scenery slot occupied even after most props slept; this distinct omission is fixed with the existing source flag0x80 path. The earlier retryable-capacity fix remains valid. Reported historical fatal sign impact is still unconfirmed and separately tracked as PHY-23/TASK-128; see docs/c2-ignore-world-reclaim-re.md.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Valid scenery no longer becomes permanently unmovable after a transient full physical pool. Normal local collection retries after capacity is reclaimed; missing mechanics and finite participation remain explicit. Exact original sign regressions reproduce old failure and verify recovered motion/tipping in Stock and Advanced. User scene is preserved for one-time validated legacy-state repair; original historical saturation trigger remains unproven.
<!-- SECTION:FINAL_SUMMARY:END -->
