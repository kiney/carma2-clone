---
id: TASK-62
title: '[P3] ANI-01: Play original pedestrian BON/SKL animations and root frames'
status: done
assignee: []
created_date: '2026-10-11 15:14'
updated_date: '2026-10-29 10:29'
labels:
  - priority-3
  - ANI-01
  - animation
dependencies: []
references:
  - src/ped-presentation.ts
  - src/ped-native-instance.ts
  - src/ped-render-effects.ts
  - src/pedestrians.ts
priority: medium
ordinal: 3060
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original issue ID: **ANI-01**
Numeric priority: **3** (1 is highest)
Original status: **Partial**
Category: **Animation, Rendering, and Audio**

## Scope and result

Complete original FORM/MODEL and BON/SKL presentation in the displayed population: living and death root/bone poses, source positive completion and executable FSM fallbacks, signed-byte morph transitions and clock handoff, guarded shared-CRT mutant angles, blood MODEL set1/head variants, scare/calm sequences, body/head visual powerups and exact prepared napalm vertex sampling. Active-only clocks, retained distant actors, inverse-parent compensation, single gameplay transport, reset and resource cleanup are integrated. Original Stock/Advanced human and DOG resources and all 791 Newcity1 actors are validated. Original arrays remain unchanged; mutable geometry is shared privately per personality.

## Evidence and ownership

Installed binary inspection resolves rec2 stubs and incorrect morph-rate/root-delta formulas. Source references, native addresses and confidence are recorded in [presentation evidence](../../docs/c2-ped-presentation-re.md), [morph/mutant evidence](../../docs/c2-ped-special-animation-re.md) and [MODEL/prepared-vertex evidence](../../docs/c2-ped-render-effects-re.md). Native zero-angle/zero-elapsed Infinity*0 morphology is diagnosed rather than publishing NaN poses.

Current gameplay remains the movement/count identity and supplies the existing rigid corpse root; animation now continues around that root. Native PHIL enrollment, ground/recovery owners, articulated contacts, sever topology and physical cause writers remain PED-06/07/08/09. Full collision-body resizing stays PUP-08/PED-06. Their incompleteness does not imply missing animation playback or complete pedestrian engine parity.

## PED-03 scope split (2026-10-11)

Complete prepared BON/SKL/root/bone rendering remained ANI-01 after PED-03 counting was narrowed. PED-06 owns population resource/lifecycle admission and PED-08 owns visible sever/body topology. The completion here preserves those separate acceptance criteria.

Related tasks: TASK-96, TASK-97, TASK-98, TASK-99, TASK-47 and TASK-49.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Original Stock/Advanced personalities display full source living root/bone frames, exact model resources and move ID/slot timing without package ACT default transforms or doubled movement.
- [x] #2 Active/inactive visibility, stationary multi-frame idle, heading/parent transforms, ordinary count/corpse/reset and template cleanup preserve existing gameplay and have numerical/browser checks.
- [x] #3 Complete and source-validate remaining native death-animation, morph and specialized head/model/angle rendering branches rather than treating a frozen legacy corpse as full animation parity.
- [x] #4 Connect exact prepared pedestrian vertex consumers and verify representative altered-state cases with their existing powerup owners.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Selected 2026-10-29: joint first stage ANI-01/PED-04, then PED-06 -> PED-07 -> PED-08 -> PED-09. Preserve existing numeric priorities. Implement and validate in an isolated source/build so the user's paused production scene remains intact.

2026-10-29 living-animation checkpoint: all791 actual Newcity1 actors use original-bon-skl presentation in both Stock and Advanced. CitySwat moves from46.63-degree ACT lean to source root local-X up.99994 while move30 frames advance. Original CitySwat/Blokebl/Twolf and full population parent/attachment/death-count/reset/resource tests pass; authored DOG1 stationary idle32frames@33ms regression fixed. Full suite3,359 passes/5optional saved-capture skips; subsequent four focused integration cases pass. Production Stock/Advanced browser check passes with empty console/request/GL failures, plus actual hardware MCP observation. PED-04 is done; ANI-01 intentionally remainswip for the unchecked animation/render obligations. Source docs/c2-ped-presentation-re.md.

2026-10-29 completion: implemented native signed-byte morph setup/progress/interruption/20-slot ownership and clock handoff; verified rec2 rate/root-delta discrepancies against the installed HW binary. Mutant child-angle perturbation uses actual health/action/same-time gates and shared CRT order, preserving authored angle arrays and using cached reanchors without duplicate draws. Ordinary death now plays its caller-supplied BON around the existing rigid root, follows source completion/FSM fallbacks, applies actual blood MODEL set1/head2, runs Stillify with native period gates, and resets models/clock correctly. Scare/calm head sequences and exact prepared napalm vertex sampling are integrated.

Actions 2/32/33 use normal original-data grants, group cancellation, expiry and reset; shared private per-personality living/dead geometry and remapped anchors stay source-preserving. Whole-body ACT origins refresh around supplied support with source ScaleForm equation; dormant poses reanchor once without clock/RNG work. Registered PHIL body resize remains PUP-08/PED-06, and corpse rigid transport/articulated contact ownership remains PED-06/07/08/09. Native zero-angle/zero-elapsed Infinity*0 morph remains an explicit undefined-numerics diagnostic, not a NaN rendered pose.

Validation: full original/numerical suite ran 3421 tests with 3415 passes, five optional saved-capture skips and one stale unsupported-powerup count assertion; that assertion now expects 11 instead of 16 after the five newly supported original definitions and its 28-test suite passes. Added final support-height/corpse-scale regressions; all 19 complete-presentation tests pass. Existing and completion Stock/Advanced browser suites retain all 791 native actors and pass living/death/frame/model/powerup/count/reset/resource checks, empty console/request/GL failures, SwiftShader1280x800. Hardware Chrome DevTools on isolated production build: ANGLE AMD Radeon gfx1150,2070x1435, CitySwat walking/head factor4/death91 frames0-4/blood set1 and mutant94 period132 visible with no diagnostics/errors. Root production build passes. Original live page5 remains paused and unchanged; source work/build validated separately.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-28 22:45
---
Live Chromium report (2026-10-28), original Newcity1 / NICE BEAVER: pedestrian ped-cityswat-476 near Eagle/gas station renders with a persistent whole-body lean of46.63396 degrees while alive=true, action=Running(1), moveId41, fallTime0. Outer actor has yaw only; visual quaternion is identity. Thus this is not the dead-fall branch or vehicle collision physics. Torso ACT MANBWC.ACT retains its authored tilted basis from data/PEDS/PEEPS/CitySwat/FLIGHTMEC1.act. A separate read-only parse of the original archive confirms46.63398 degrees (up[-.45680755,.68665606,-.56553417]); the tiny difference is host decompose/recompose. Other sampled CitySwat instances retain the same basis, including ordinary move30 walkers.

The loader selects the largest same-directory ACT, then rigPedestrian preserves this internal source pose and only adds procedural limb pivots. The displayed population never replaces the torso/root with the selected FORM/BON frame. Preserve this as a concrete production playback regression case when connecting the existing native root/flat-bone providers. Do not globally zero rotations or arbitrarily upright every ACT: authored bone bases and actual falling/leaning animations must remain meaningful. Rootframe application and correct package/actor selection require verification rather than inferring that every tilted authored matrix is itself corrupt. Live scene was read only apart from hiding the pause menu and remains paused.
---

created: 2026-10-28 22:45
---
Full live population check: all 165 CitySwat instances are alive and retain the identical 46.63396075-degree torso tilt, across active/inactive and move30/move41 states. This establishes a systematic source-pose presentation issue, rather than a one-off impact state.
---

created: 2026-10-29 01:48
---
PED-10/TASK-125 fixes the subsequent user report of a visible unprocessed ghost directly ahead of Eagle. Rendered root matched gameplay position; active=false insidepopup was an existing visibility/admission inconsistency. Retained near actors now activate before normal hits; this is separate from remaining ANI-01 death/morph/special-render providers.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
ANI-01 animation/render scope complete: original living/death BON/SKL, source morphs, head/blood MODEL changes, shared-CRT mutant angles, body/head visual effects, exact prepared fire vertices and coherent reset/lifetime. Native physical population/articulated contacts/recovery and full collision resizing remain in their existing PED/PUP owners; this is not full pedestrian engine parity.
<!-- SECTION:FINAL_SUMMARY:END -->
