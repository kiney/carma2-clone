---
id: TASK-106
title: >-
  [P1] PHY-13: Resolve vehicle lockups caused by deeply overlapping detached own
  parts
status: done
assignee: []
created_date: '2026-10-13 00:37'
updated_date: '2026-10-13 13:23'
labels:
  - priority-1
  - PHY-13
  - physics
  - collision
  - detachment
dependencies:
  - TASK-100.9
references:
  - docs/old-overlap-recovery.md
  - tools/replay-old-overlap.mjs
priority: high
ordinal: 1200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Captured user-driven Timber/EAGLEGREEN lockup on apparently flat road after PERF-12. At simulation time149.44s the player has four supported/load-bearing wheels, functional damage max17%, nonzero linear/angular velocity and no nearby car. A fully detached own part EIIIFRWG.DAT (runtimePart1, phase2, no joint) deeply overlaps its former vehicle collision hull. The road guard permits the full tick, but the body-pair commitment guard clips player and debris to an effectively zero prefix. Cloned-state uncached contact collection emits zero rows despite reporting old overlap, so the solver cannot produce separating impulses while the guard keeps preventing movement. This is distinct from PHY-10 barrier body support, PHY-11 hull rebuild exceptions and fixed PHY-12 noncontacting blocked-prop coupling. Investigate native C2 detachment admission, former-owner collision eligibility and old-overlap contact recovery before selecting the fix. Preserve physical debris, meaningful own-piece contact after separation and crush/repair coherence. The user now explicitly authorizes replacing, removing or relaxing browser-added body/world/projection guards where they conflict with source-supported overlap recovery or impose disproportionate work; preserving the monotone SAT rule is not an acceptance requirement. Validate practical crash outcomes and relevant tunneling/interlock regressions, rather than treating every temporary increase of existing penetration as forbidden. Permanent owner/debris immunity or zeroing moving bodies to hide the failure is not the intended remedy. Diagnosis is strong for this captured pose; entry trigger and binary/reference-correct remedy remain unverified. No engine fix is implemented by this ticket creation. Actual data-derived state and screenshot remain ignored in artifacts/perf01-user-stuck*; source-only notes should reference the deterministic snapshot loader when implemented.

Selected as the second P1/next entry after PERF-14 in the structural performance queue. This existing bug owns native overlap admission/recovery and the necessary guard-policy redesign; do not create a duplicate guard/own-debris fix ticket. Installed full-detach admission uses an authored angular cone, and ordinary recovery can mark overlap even when it emits no rows. The browser adds a monotone per-hull depth invariant and sampled fractional commitment, creating a plausible release/performance feedback loop. PERF-14 first corrects joint candidate paths; PERF-15 separately replaces global correction scheduling. Broader unrelated world/sphere guard reconstruction remains outside this bounded bug scope unless required by its regression cases.

Use separate reversible Git checkpoints and provide a concise user-playtest focus between tickets. Evidence-backed structural experiments are authorized without exhaustive proof or mandatory bitwise parity with the old browser safeguard. Keep source-supported collision response, original data and short serial performance captures.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Replay the captured original-car and detached-part kinematics/hulls as a deterministic headless fixture and reproduce absent recovery rows plus near-zero accepted movement before the fix; proprietary fixtures stay ignored or load locally.
- [x] #2 Trace C2 detached-part admission, former-owner collision rules and old-overlap recovery; distinguish native behavior from browser-specific guard restrictions, including corrected joint candidate paths from PERF-14.
- [x] #3 Restore physical release/contact response in the player/wing and comparable damaged/detached cases. Allow native-supported temporary old penetration where justified, while checking new third-body impacts, separation/re-entry, fast world/car collisions and sustained interlocks. Document intentional guard-policy changes instead of requiring unchanged monotone-depth decisions.
- [x] #4 Validate head-on/oblique/repeated impacts, physical debris, attachment transitions, repair/reset and multiple original cars in Chromium with clean console/WebGL. Add meaningful numerical/gameplay regressions for the changed behavior and provide a reviewed checkpoint plus a focused user playtest.
- [x] #5 Investigate the Cerby opponent/hood/three-ball-joint cluster using bounded per-pass diagnostics; demonstrate release or source-eligible settling without deleting meaningful response, and report tick/guard-cost changes. Distinguish partial replay from actual world/forces/damage behavior and do not promise this alone cures all PERF-13 stalls.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Confirmed clone probes: player worldFraction=1 with actual motion, spin removed and +/-forward horizontal velocity. Full472-body guard playerFraction=0.000004149319832785087; the sole guarded pair is player/own fully detached front-right wing. Initial penetration0.15022994079337004 model units. Removing only that wing in the cloned diagnostic gives playerFraction1; nearby fixed props are individually clear. Guard counters dependencyMerges/revalidationCalls/conservativeFallbacks all0, so this is direct overlap blocking rather than PHY-12 transitive coupling. Native raw pair collector with fresh broadphase/cache emits0 rows and overlapDetected=true. No-spin fraction0.000004157; forward0.0000155033; reverse0.0000180465. Prescribing outward motion for both cloned bodies permits fraction1, proving the guard can admit separation when the solver supplies a compatible trajectory. Live state remains paused and unchanged (position27.757056345844088,2.4732747121370178,-24.4237200414592). Last512 recorded live frames p50~16.7ms,p95~33.4ms,max~50.1ms; tick p50~10.1ms,max~34.8ms, so this is not the requested <=4FPS reproduction. Hardware AMD Radeon at2099x1467 approximately, exact buffer in ignored state JSON. No fatal console/WebGL error.

Exact hardware capture metadata: drawing buffer2098x1466, DPR1.484375, ANGLE AMD Radeon Graphics/radeonsi gfx1150. Earlier approximate buffer wording is superseded. All diagnostic integration and collision checks operate on cloned kinematics and fresh guard/broadphase contexts. The original live game remains paused at149.44s with identical player position and no repair/reset/advancement.

Reviewed cross-link 2026-10-13: the Cerby/own-hood/three-jointed-parts cluster has similar endpoint positions at 113.56 and 145.68 s with substantial retained velocity. Positions/velocities are model units (×6.9 metric). A partial full-40-ms guard probe returns ~8.1e-5 for bodies6/10/11/12/14, not recorded live commit fractions. Accumulated type-6 rows suggest the same overlap mechanism but cannot attribute each correction pass or prove uninterrupted lockup. Include this opponent case and compare its cost, but do not claim it is proven the dominant FPS cause. Exhausted native retry and detachment eligibility still need evidence; zeroing retained velocity is not a verified remedy.

Bounded partial captured-body replay tools/replay-captured-corrections.mjs confirms type6 rows for pairs6/14 and11/14, nine joint rows each round, and real kinematic changes on bodies6/10/11/12/14 through round8. Removing only those bodies on clones empties pair collection. Missing world/forces/damage prevents declaring complete attribution or a production fix. Installed native exhaustion has no velocity reset; full detach uses angular admission rather than hull clearance and released own debris remains eligible. Ordinary recovery auxiliary-omega/local-velocity trace is mathematically equivalent to existing browser pre-candidate point velocity. The conservative monotone SAT commitment extension remains the likely incompatibility to investigate, with explicit third-body/re-entry/projection tests before relaxing it. No PHY-13 production behavior change.

2026-10-13 structural queue: reused as entry2 to avoid duplicate guard ownership. Latest user direction explicitly permits substantial reversible physics/guard redesign and intermediate playtests. Previous absolute prohibition on deeper existing overlap is superseded by native-informed recovery and practical third-body/re-entry/tunneling/interlock regression acceptance. Historical captures and no-fix conclusions remain evidence.

Implemented native-qualified per-hull OLD-overlap admission for the captured commitment phase. Eligibility requires prior recovery flag, positive actual OLD SAT depth and the same native edge-inside/finite-clip overlap detector used by recovery. Qualified cells follow source solver-selected motion without a monotone-depth veto; admitted-only pairs avoid redundant angular sampling/bisection. No owner immunity, artificial force/damage/damping, retry/timestep change or world/sphere-guard change. Fresh clear phases restore new-entry checks; independent other hulls, third bodies/world and physical hierarchy caps stay guarded. Temporary deepening/pass-through/exit-reentry within an admitted phase is the deliberate native-informed policy, not an exhaustive continuous safety promise.

Evidence: installed recovery 0x427d9c–0x427df0 returns overlap row count including zero before full candidate CCD; zero aggregate response 0x4bafb8 returns without a separating fallback; contact solves reintegrate .04 s and exhaustion does not zero velocity. Native released former-owner debris remains eligible. A separate immediate-parent versus recursive-root suppression discrepancy is tracked as PHY-14 / TASK-108 (P2 backlog), outside this guard checkpoint.

Deterministic ignored-snapshot hydration/replay reproduces the old player/wing cap 4.14932e-6 and Cerby cap .000486732 using current PERF-14 hierarchy; both become 1. Eight bounded partial pair/joint windows progress and clear at least one original overlap while preserving useful type-6/joint impulses and coincident anchors. First-window transformed hulls reduce 40→2 and 206→99. No world/forces/damage/full preceding-tick reconstruction claim. After release, legitimate work/timing can rise; adverse partial samples remain documented.

Validation: full npm test passed 2,764 tests; subsequently registered capture/hydration suite passed 17 separately (13 pass/4 clean skips without optional captures). Production build, formatting and existing fast/oblique/full-turn/interlock/finite-ground/split/repair regressions pass. Final production Chromium crash matrix passes Stock/Advanced impacts, Porker2 split/joints and Eagle queued parts/repair. New twelve-tick Eagle3/Cerby production old-overlap harness passes drive-out, renewed accepted physical own-piece type-5 contact, repair and four-wheel regrounding, with no console/failed-request/WebGL errors; functional harness uses SwiftShader, not hardware FPS evidence. Chrome DevTools MCP independently runs the original Eagle fixture and a normal-frame W-driven Jetcar crash on AMD hardware; geometry/component damage, retained ground support, physical debris response and repair verified, screenshots inspected, clean console/GL.

User's paused post-PERF-14 snapshot preserved before HMR in ignored artifacts/phy13-current-user-snapshot.json. Its player/neighbour clone guard is full motion under both policies and does not reproduce the lockup. Bounded serial hardware guard comparison is recorded in docs/old-overlap-recovery.md; not a cure claim for all Timber FPS stalls. Reviewed Git checkpoint and user playtest focus: damaged-car/loose-bodywork pileups, driving away without repair, rollovers near props, separation/re-entry and repeated repair. Next structural ticket remains PERF-15; broad paused Goal unchanged.
<!-- SECTION:NOTES:END -->
