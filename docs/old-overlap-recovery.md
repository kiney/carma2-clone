# PHY-13: native-qualified old-overlap admission

## Evidence and scope

The saved player/own-wing and Cerby/hood/jointed-parts captures reproduce a
conflict between C2's recovery emitter and the browser's extra commitment
guard. Recovery can detect old overlap yet produce no contact rows. The old
guard then clips movement to an almost zero prefix whenever SAT penetration
increases, even slightly. Retained velocity does not help the car escape.
This differs from the PHY-12 noncontacting-neighbour coupling fix and PHY-10
terrain support traps. [Captured diagnosis](own-debris-lockup.md) remains the
historical record.

Installed HW addresses below refer to the executable revision whose hashes/PE
metadata appear in [the physics notes](c2-physics-re.md). rec2 provides the map;
the ordinary recovery/response path was inspected in the installed binary.
No original instructions or third-party implementation are copied here.

| Path                                        | Verified behavior                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `0x4bd780 → 0x425c00 → 0x4277c0 → 0x427f20` | Pair collection and old edge/hull recovery                                                                            |
| `0x427b37–0x427b50`                         | Either object's prior-overlap flag `0x100` enables recovery                                                           |
| `0x427d9c–0x427df0`                         | Detected overlap sets next-tick `0x200` and returns recovery row count, including zero, before ordinary candidate CCD |
| `0x4bafb8–0x4bafc8`                         | Zero aggregate world/pair/joint rows returns without solving or reintegration; existing candidate remains             |
| `0x4bbe7a–0x4bbef5`                         | Contact response restores old actor transforms and reintegrates literal `.04s`; no SAT-depth-decrease rule            |
| `0x4ba62e`, `0x4c5f90`                      | Thirty-retry report is a no-op; exhaustion does not zero velocity or push the object out                              |
| `0x4ba80a–0x4ba829`, `0x4b97c7`             | Prior-recovery flag is rebuilt from preceding detection, then new detection is cleared                                |

Native overlap detection uses old edge endpoints inside the other authored hull
or finite edge/hull clipping. Emitting type-6 rows additionally needs a mixed
inside/outside edge, an outward-facing normal (dot ≥ Float32 `.2`) and positive
closing speed. Containment or rejected normals/velocities can yield zero rows.
The normal/resting equations and joint impulses stay authoritative; no new MTV,
penetration bias, artificial damage, damping or detachment force is introduced.

Fully released debris clears its physical parent and remains eligible against
its former owner. The native full-detachment angular cone does not certify zero
SAT penetration. Saved ownership is attribution/repair state, not an immunity
mask.

## Implemented rule

For every eligible **old hull pair** in a captured commitment phase:

```text
admit = (A.overlapRecovery || B.overlapRecovery)
        && oldSATDepth > 1e-6
        && nativeOldEdgeHullOverlap(A, B)
```

`geometry.nativeHullRecoveryOverlap` supplies the boolean part of the existing
recovery detector, using its same authored planes, inside test and finite clip.
The positive solid-depth gate excludes mere shell/tolerance contacts. An
admitted cell follows the solver-selected trajectory for that captured phase;
it no longer has to monotonically reduce SAT depth. An admitted-only body pair
returns without an angular walk/bisection solely to prove that old invariant.

Other initially clear hull pairs, even of these same two bodies, retain the
existing feature/SAT guard. Third bodies, finite world faces, masks, physical
joint-tree time caps and unequal-prefix revalidation also retain their checks.
Classification is rebuilt from actual old geometry every phase. Once a fresh
phase starts clear, re-entry is checked even if prior-overlap flags or saved
ownership remain. No identity-based exemption survives repair, crush, topology,
pose or activation changes.

The **whole captured-phase lifetime is a native-informed integration policy**.
The recovery collector's early return and ordinary full candidate movement are
verified; complete original scheduling in every special object mode is not.
A qualified pair may temporarily deepen, pass through, or clear/re-enter within
this one phase. This explicitly replaces the old monotone-depth promise and is
not continuous interlock prevention. The ordinary contact solver still acts on
eligible contacts. New third-body/world collisions are independently guarded.
General retry redesign remains PERF-15; world/sphere policy is unchanged.

A separate precision gap was found: native recovery row suppression compares
the same nonnull **immediate** parent (`0x427dcd–0x427ddd`); the existing browser
collector compares recursive attachment roots. Direct parent/child pairs are
excluded separately (`0x4bd900/0x4bd90c`). That nested-hierarchy discrepancy is
documented for follow-up rather than changing contact impulses in this guard
checkpoint (PHY-14 / TASK-108, P2 in `backlog`). It does not justify excluding
fully released own debris.

## Deterministic captures

`tests/support/captured-bodies.mjs` hydrates validated ignored snapshots, keeps
logical owners distinct from physical joints, supports both captured schemas
and creates distinct fixed external anchors for unrecorded dormant NONCARs.
The older wing row is misleadingly tagged `kind: car`; recorded owner/part
identity correctly classifies it as detached bodywork. Hydration never supplies
invented damage or a full runtime scene.

```sh
node --import tsx tools/replay-old-overlap.mjs \
  --baseline /tmp/your-source-only-baseline/src/physics/pair-guard.ts \
  --passes 8 --output artifacts/phy13-old-overlap-replay.json
```

The explicit comparison used source baseline `e3d0191`. Each small-cluster
window prepares actual joints, predicts through PERF-14 hierarchy movement,
collects native body rows, performs one pair/joint solve and commits. Both
guards inspect the same post-solve paths. Eight windows are a **partial** replay,
not eight global correction rounds or a restored preceding game tick: forces,
world contacts/guards, damage, detachment, effects and activation are absent.

| First window                          | Old guard    | New guard |
| ------------------------------------- | ------------ | --------- |
| Player / wing fraction                | `4.14932e-6` | `1`       |
| Player COM movement (model units)     | `7.58e-7`    | `.182701` |
| Player / wing transformed hulls       | 40           | 2         |
| Cerby cluster minimum fraction        | `.000486732` | `1`       |
| Cerby root COM movement (model units) | `.000099`    | `.204313` |
| Cerby cluster transformed hulls       | 206          | 99        |

Player first-window recovery emits zero rows. Cerby retains three type-6 rows,
two positive contact impulses and nine joint rows; velocity changes occur
through actual response. Original-data mass/inertia/COM/hulls are retained.
All joint anchors remain coincident under the new commitment. Over eight partial
windows both current cases progress and clear at least one original overlap;
baseline cases remain near zero movement. After moving apart, ordinary new
features are collected again (the player case emits a type-5 row in window 2).

Work is not uniformly cheaper after release: new motion performs legitimate
new-contact checks. Player window 2 transforms 236 hulls; Cerby later windows
reach 336. Cold partial guard timings include 41.94 ms (player) and 28.33 ms
(Cerby). Evaluation order warms phase pose samples for the second guard.
These adverse samples are retained; this replay is not a matched FPS speedup.

## Browser and regression validation

The existing full test suite plus the eight synthetic admission cases passed
2,764 tests. The subsequently registered capture/hydration suite separately
passes 17 tests; without optional captures, 13 pass and four skip cleanly.
Synthetic cases cover zero-row containment, type-6 recovery, eligibility flags,
owner-independent admission, next-phase re-entry, deliberate within-phase
excursion, a new third-body wall, independent hull cells and detector agreement.
Existing fast/oblique, angular/full-turn, momentum, split, finite-ground,
physical-tree coupling and repair regressions remain green. The production
build passes, with the existing bundle-size warning.

The user's new paused playtest snapshot (483 bodies at 111.96 s) was preserved
under ignored `artifacts/phy13-current-user-snapshot.json` before source HMR.
Its player/nearby-Wideboy partial guard admits full motion under both policies;
it does not reproduce the historical lockup.

Chrome DevTools MCP ran short serial ABBA guard comparisons on that scene and
the old captures: AMD Radeon/radeonsi through ANGLE, buffer 2100 × 1466.
Player guard times were baseline 5.0/1.0 ms versus current 1.9/.5 ms; Cerby
2.3/1.7 ms versus 1.3/.9 ms. These tiny clone-only CPU samples retain cold/order
effects and are not rendered FPS or full physics-tick measurements. The live
clock/position/pause state did not change during the probe. The first diagnostic
attempt failed on a bare module specifier in DevTools evaluation; retrying with
the actual Vite module URL worked. This was a diagnostic tool error, not an
application failure.

The final production crash matrix passes Stock Eagle/Buggy/Bigdump and Advanced
69mach1 impacts, Porker2 splitting/joints/repair and Eagle3 impact-queued
semi-detachment/repair. The dedicated production `test:overlap` harness passes
Eagle3/Cerby on original Timber: real WAM geometry is rigidly placed inside the
authored car hull, without replacement/scaling. Due reservations use production
detachment; the fixture explicitly advances release phase/removes its link to
avoid a long native timer. Twelve full simulation ticks per car include forces,
world contacts/guards, damage and ordinary response. Both cars advance about
`.239` model units over four driven steps, then an initially separated own
piece generates accepted positive type-5 impulses. Repair removes physical
debris/restores original parents, and four wheels reground on the original road.
No console errors, failed requests or WebGL errors occur. This harness uses
SwiftShader at 1280 × 800 and is functional validation, not hardware FPS evidence.

Chrome DevTools MCP independently runs the Eagle fixture on the actual AMD
backend: first-step movement `.05985`, four-step forward progress `.23925`,
renewed type-5 impulses `.05623/.11182/.05559`, and complete repair with four
grounded wheels. A separate 1.3-second W-driven, positioned original Jetcar crash
uses normal browser frames: both deformation revisions advance, component
damage accumulates and the player retains four ground contacts. Console/WebGL
remain clear; repaired and crash screenshots were inspected. See ignored
`artifacts/phy13-mcp-runtime.json` and browser reports. These controlled setups
do not claim to reproduce the entire user route.

Ignored reports include `phy13-old-overlap-replay.json`,
`phy13-hardware-guard.json`, `phy13-tests.log` and `phy13-captured-tests.log`.
Original data remains read-only and absent from source/build history.

Before PERF-15, playtest collisions among damaged cars and loose bodywork,
rollovers near props, driving away without repair, separation and renewed
contact, and repeated repair. Report any new tunnelling or lasting interlock.
This change resolves the reproduced old-overlap guard trap; it does not declare
the full Timber frame-collapse investigation complete.
