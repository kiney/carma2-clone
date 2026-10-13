# PERF-13 root-cause analysis: frame feedback and jammed own-debris cluster

Analysis of 2026-10-13, source/code review plus offline evaluation of the
saved user captures. No engine change. Inputs (ignored, never commit):
`artifacts/perf01-directional-live-capture.json` (recorder v2, last 512 ticks),
`artifacts/perf01-user-drop-state.json` (113.56 s),
`artifacts/perf01-directional-body-snapshot.json` (145.68 s) and
`artifacts/perf13-frozen-final.json` (guard fractions of the 145.68 s snapshot).

Evidence labels follow `AGENTS.md`: **measured** (recorded user capture),
**experimentally inferred** (derived from saved snapshots/rows), **hypothesis**
(still needs a focused replay or binary evidence).

## Summary

1. The capture contains sustained slow windows as well as faster windows.
   When about 25 physics ticks execute per wall second, the approximate budget
   is FPS ≈ (1000 − 25·c) / o, where `c` is CPU per tick and `o` the
   non-physics frame cost. Use the measured executed tick rate when it differs. With c ≈ 30–36 ms, physics
   consumes 75–90 % of every second and remaining frame throughput falls sharply as the physics budget approaches
   one second per wall second (the stated FPS formula is linear in `c`).
2. A credible contributor to high `c` is one AI car (Cerby), its own fully detached hood and three
   jointed parts occupying very similar positions in snapshots taken about 32 s apart.
   Continuous jamming throughout that interval has not been recorded. They keep their full
   linear and angular velocity while the commit guard admits almost no motion.
   This is the PHY-13 own-debris lockup mechanism (TASK-106), here affecting an
   opponent. It may keep correction passes running and require expensive angular
   sampling; per-pass attribution remains necessary.

## 1. Native frame window feedback (measured)

`planPhysicsFrameWindow` (`src/physics/frame-window.ts`) runs
`ceil((frameEndMs - stepStartMs) / 40)` ticks, up to five.
The start also depends on the previously completed physics tick and may
resynchronize, skipping time; it is not simply `ceil(period / 40)`. The native frame-period clock follows wall
time. Steady state requires `ticks × 40 ms ≈ wall time`, giving an approximate physics budget of `25 · c`. Game-clock advancement
alone does not establish the executed tick rate because resynchronization
can skip simulation time. Derive that rate from actual tick counts.

| Window (s) | Measured FPS | CPU/tick (ms) | Ticks/update | Render CPU (ms) | Predicted (1000−25c)/o |
| ---------- | -----------: | ------------: | -----------: | --------------: | ---------------------: |
| 118–120    |         22.5 |          28.2 |         1.09 |             4.6 |                    ~25 |
| 130–132    |         23.0 |          29.4 |         1.09 |             4.9 |                    ~20 |
| 122–124    |          5.0 |          36.2 |   5.00 (cap) |             3.9 |                     ~7 |
| 144–146    |          5.0 |          34.6 |         4.40 |             9.3 |                   ~5.6 |

`o` is the frame interval minus updateFrame CPU (typically 12–15 ms, including
render, AI, matrices and RAF/vsync wait). Game time tracks wall time in every
window (ratio 0.95–1.04). Render CPU stays at 4–9 ms while FPS swings between 5
and 23. All 512 ticks have 7 active cars and 10 debris bodies, so opponent
physics activation does not explain the change.

Small changes in tick or other frame costs can explain large throughput
changes. This does not resolve the reported 180-degree correlation: recorder
v2 has no heading history. GPU work and a direction-dependent contributor
remain possible. The budget is not an independent FPS prediction because
`o` is derived from the same measured frame intervals and update costs.

Target for PERF-13 AC #2: with o ≈ 12 ms, c ≤ 15 ms leaves budget for about 52 FPS and
c ≤ 10 ms about 62 FPS before display scheduling. These are engineering
budget estimates, not guaranteed frame rates. Recorder v2 timing overhead (warm microprobe ~2 ms additional per 4,347-call
block; cold overhead was larger, see `live-timber-drop.md`) is included in the measured `c`.

## 2. Jammed Cerby cluster (experimentally inferred)

| Body                             | Endpoint drift (model units) | Speed (model units/s) | Angular speed (rad/s) |
| -------------------------------- | ---------------------------: | --------------------: | --------------------: |
| 6 cerby                          |                        0.072 |           5.75 → 5.11 |           1.58 → 1.90 |
| 10 cbfbump01 (ball joint)        |                        0.104 |           3.25 → 3.57 |         19.03 → 16.25 |
| 11 cbrfwng01 (ball joint)        |                        0.075 |           5.29 → 5.32 |           6.17 → 3.31 |
| 12 cbrrwng01 (ball joint)        |                        0.087 |           5.17 → 4.82 |          10.03 → 8.03 |
| 14 cbhood01 (detached, no joint) |                        0.075 |           5.72 → 5.23 |           6.41 → 2.34 |

- Positions and velocities use model units; metric conversion is ×6.9
  (`motion.ts`). Endpoint displacement is about 0.5–0.7 m despite speeds
  around 35 m/s at both endpoints. Endpoints do not measure total path length
  or prove unchanged velocities between captures.
- The isolated full-40-ms guard probe on the 145.68 s snapshot returns 8.1e-5 for exactly bodies
  6, 10, 11, 12 and 14 and 1 for every other body. This probe omits world clipping, forces,
  correction solves and damage; these are not recorded live commit fractions.
- `overlapRecovery` / `overlapDetected` are set on Cerby, the hood, the bumper
  and the front wing in both snapshots.
- The final-step impact list (accumulated over passes) contains 14 type-6
  recovery rows for wing/hood (11-14) and 6 for Cerby/hood (6-14). The same
  normals recur 3–4 times within one step with closing speeds of 0.1–0.3 m/s
  after earlier impulses. Several rows solve to zero impulse.

### Code path

- `simulation.ts` commit (`advance(body, PHYSICS_STEP * worldFraction *
pairFraction)`) scales only the integration time. Velocity and angular velocity
  are retained when the pair guard clips a body to an almost zero prefix.
- `guardPairTrajectory` (`pair-guard.ts`) forbids any deepening of an existing
  overlap. With a spinning jointed part, practically every motion deepens some
  hull pair.
- `recoverHullOverlap` (`geometry.ts`) emits only edge/hull intersections with a
  center-facing normal (≥ 0.2) and positive closing speed. Its rows do not
  separate the nested hulls. PHY-13 also shows it can return no rows at all.
- The correction loop (`simulation.ts`, `for (let pass = 0; pass < 8; pass++)`)
  only exits on an empty contact list. Recurring recovery rows are a plausible reason, but their per-pass
  provenance is not recorded. Measured result: 474 of 512 ticks run all eight passes
  (4,347 world-guard calls and nine pair collections). Calls can hit caches;
  they do not imply 4,347 actual world sweeps, nor identify which groups solve.
- Retained spin keeps sample counts high. World sweeps use
  `ceil(|ω| · 0.04 / 0.05)` samples (~16 at 19 rad/s per pass). The pair guard
  uses the momentum bound `|L| / I_min` (4.055 rad for the bumper, 5.3× the
  actual 0.76 rad) can request the 128-step grid. A blocked early interval returns after
  its 18 bisections; a 128-step grid does not imply all 128 intervals execute. The earlier
  clone probe halved guard cost by zeroing part spin (`live-timber-drop.md`).

Hypothesis still to verify by replay: the cluster is the dominant reason the
contact list never empties. Snapshot rows accumulate across passes; a
per-pass trace of the 483-body snapshot is required to prove it.

## 3. Further amplifiers in the correction loop (code review)

Ordered by estimated impact. None of them removes the jam on its own.

1. **Termination criterion.** A pass that applies no nonzero impulse and no
   restart/geometry change leaves state unchanged, so the next pass is identical.
   Potentially safe only after certifying all observable state and side
   effects. Returned contact rows omit joint-only impulses; quick-hinge
   projection also changes velocities before `beforeApply`. Damage, ped
   activation, RNG/effects and user callbacks may run even on zero rows.
   Unchanged body tokens alone do not justify omitting those callbacks.
2. **Scene-wide passes.** Every pass re-guards all 483 bodies, rebuilds
   `allBodies()` (six filtered arrays, about four calls per pass), calls
   `candidate()` for every body, builds new maps and copies contact rows. Incremental work needs exact geometry, pose, properties, activation,
   masks, recovery flags, world revisions and joint dependency certificates,
   including discovery of new partners. Existing CorrectionWorkingSet already
   reuses unchanged raw emitter results. A safe first reduction is one roster
   snapshot within pure synchronous collection, rebuilt after every solve.
3. **Joint-only groups.** Each pass passes `this.allJoints()` to
   `resolveContactGroups`, so joint groups without contacts are rebuilt and
   solved again. Such groups can apply real impulses or tear parts. Skip
   only proven unchanged work while preserving callbacks and their order.
4. **Conservative angular bound.** For torque-free motion `|ω| ≤ √(2E / I_min)`
   also holds (bumper: ~1.76 rad per tick instead of 4.055). Using
   `min(|L| / I_min, √(2E / I_min))` is rigorous only if the integrator
   preserves kinetic energy. This prerequisite fails in the current native-style
   integrator: inertia (1,3,10), omega (10,20,30), dt=.04 increases rotational
   energy 5150 → 5553.233 (~7.83%). Do not use the initial-energy bound;
   the existing momentum bound remains justified.
5. **Repeated commit guard for frozen bodies.** Clusters with unchanged state
   repeat the full pair-guard work every tick.

About 10 ms per tick remains unattributed in the capture (solver, damage
callbacks, forces, allocation/GC). Existing CPU profiles are SwiftShader fixture
runs, not the user scene, and cannot attribute it.

## Consequences for the tickets

- PERF-13 investigation depends on addressing the PHY-13 evidence gap.
  Resolving the cluster is a sensible priority, but neither its dominant cost
  contribution nor its necessity/sufficiency for the FPS target is proven.
  Reductions 3.1–3.3 need the certificates and side-effect preservation above;
  no global cap, callback or real joint/contact impulse should be dropped.
- PHY-13 must include the Cerby cluster: an opponent, a fully detached own part
  and three jointed parts. Its fix must stop indefinite velocity storage without
  globally disabling guards or own-debris collisions. The native outcome after
  exhausted `DoCollisions` retries (HW `0x4ba450`) is the evidence to obtain.
  Discarding velocity of a body that cannot advance over several ticks is a
  candidate behavior change, not a verified native rule.
- Next measurement: replay the 145.68 s snapshot headlessly with per-pass
  counters (contact rows per pair, impulses, changed bodies) to confirm the
  attribution, then repeat a short serial hardware capture after the fix.
