# Captured own-debris lockup (PHY-13)

User-driven hardware Chromium capture, 2026-10-13, source `3135cf6`.
Tracked as **PHY-13 / TASK-106**, priority 1, backlog. No engine fix is implemented.

## Verified live state

The user encountered an immobilized original green Eagle on apparently smooth
Timber pavement and paused at simulation time 149.44 s. The snapshot contains
472 currently active collision bodies. The car has four supported wheels with
positive spring loads and tyre capacities, maximum component damage 17, no
split/wastage, nonzero velocity and substantial angular velocity. Its direct
world contact flags are clear; previous body overlap is flagged.

A nearby `EIIIFRWG.DAT` part belongs to the player, is fully detached (runtime
part 1, phase 2), has no joint and has a different attachment root. Its physical
hull penetrates the car's hull by approximately 0.15023 model units. Two nearby
immovable props are clear; no other car is nearby. There is no console/WebGL
exception or hull-rebuild error in this captured session.

## Clone-only diagnosis

The complete original state was saved before probing. All trajectory integration
uses cloned kinematics and fresh body-guard/broadphase contexts; no original
position, velocity, clock, damage or attachment state is advanced. World queries
can refresh derived geometry caches but do not invoke native face-ring gameplay
callbacks. `worldContacts`, `facesNearBody`, wheel-force providers, repair and
reset are not called on the live game.

| Probe                                                    | Result                                  |
| -------------------------------------------------------- | --------------------------------------- |
| Actual player static-world guard, refined/unrefined      | Fraction 1; no contacts                 |
| World guard with spin removed, forward or reverse motion | Fraction 1; no contacts                 |
| Whole-population body trajectory guard                   | Player fraction 0.000004149319832785087 |
| Individual player / detached own wing                    | Same near-zero fraction                 |
| Player / either nearby static prop                       | Fraction 1; no penetration              |
| Clone guard excluding only the nearby detached own wing  | Player fraction 1                       |
| Fresh uncached native body contact collection            | Zero rows; overlap still detected       |
| Pair guard with player spin removed                      | Fraction ≈0.000004157                   |
| Pair guard with player forward / reverse velocity        | ≈0.000015503 / 0.000018046              |
| Pair guard with both bodies prescribed outward motion    | Fraction 1                              |

The whole-population guard has one actual guarded pair and zero attachment
dependency merges, revalidations or conservative component fallbacks. This is
**direct deep-overlap blocking**, rather than the separated blocked-prop coupling
fixed by PHY-12. Wheel traction/body support does not explain this pose as it did
the PHY-10 barrier case. No failed hull rebuild establishes PHY-11 causation.

The concrete mismatch is between empty old-overlap contact emission and strict
post-solver commitment: the solver supplies no separating impulse, while the
guard admits only a virtually zero tick. `sweepHulls` returns the result of
`recoverHullOverlap` immediately when old overlap is detected; recovery can
legitimately return no contacts after its source edge/intersection, center-facing
normal and positive-closing gates. The probe proves that compatible separation
can be admitted; it does not prove why this detached part first entered the
deep overlap or which native C2 rule should resolve it. Native detachment
admission, former-owner collision eligibility and old-overlap recovery remain
the required evidence for selecting a fix. Globally bypassing the guard or
permanently ignoring own debris is not justified by this diagnosis.

## Opponent instance and performance impact

The later PERF-13 captures (113.56 s and 145.68 s, a separate Timber race) show
the same mechanism on opponent Cerby. Its fully detached hood `cbhood01`
(no joint) overlaps the car, and the ball-jointed bumper and wings are involved
too. An isolated full-40-ms probe returns fraction 8.1e-5 for bodies 6, 10, 11,
12 and 14; every other body receives 1. These are not recorded live commit
fractions. Endpoint positions differ by about 0.5–0.7 m after converting
model units ×6.9, despite significant velocities at both endpoints.
Recurring type-6 rows and rotation are plausible cost contributors; only
per-pass replay can establish whether this cluster keeps the loop active.
Continuous lockup during all 32 s and dominant attribution remain unproven. See [root-cause analysis](perf13-root-cause-analysis.md). A fix must
cover this opponent case and the case where recovery emits rows that never
separate the hulls, besides the player case where it emits no rows.

## Performance and evidence ownership

This session did **not** reproduce the requested ≤4 FPS problem. Last 512 frame
intervals: p50 16.7 ms, p95 33.4 ms, maximum 50.1 ms. Individual tick CPU:
p50 10.1 ms, p95 28.3 ms, maximum 34.8 ms. PERF-01 remains open; these results
must not be claimed as its failing reproduction or as proof that spikes are fixed.

Actual GPU: AMD Radeon / radeonsi gfx1150, drawing buffer 2098×1466, DPR 1.484375.
The private data-derived snapshot, timing history, screenshot and pair probe are
ignored under `artifacts/perf01-user-stuck*`; no proprietary hull fixture is
committed. The original browser remains paused at the captured pose. A future
fixture loader should consume this ignored snapshot or locally generated original
data to replay the collision before changing the engine.
