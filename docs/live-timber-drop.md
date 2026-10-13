# User-paused Timber drop, 2026-10-13

## Conclusion and limits

The post-drop scene still contains expensive body-pair trajectory guards around
rotating damaged parts. This is a measured residual physics bottleneck after
PERF-12, rather than a demonstrated dense-matrix solver failure. The preceding
<=4 FPS frame is **not** timed: the previous recorder was stopped for PHY-13
diagnosis and attached to an older race's Simulation. The paused FPS display
cannot recover its timings. PERF-01 remains open; this does not establish the
entire stall's cause or exclude a transient restart/solver/GC/rendering spike.

The user's page stayed paused. No repair, reset, reload, simulation tick or live
transform/velocity change was performed. No engine behavior change is made.
The subsequent actual running capture below supersedes the earlier lack of
timing evidence; it does not turn frozen probes into an exact replay.

## Captured state

- Engine `3135cf6`, documentation HEAD `2f448f2`.
- Stock `data/RACES/timber2/timber2.txt`, EAGLEGREEN, elapsed 113.56 seconds.
- Hardware AMD ANGLE/radeonsi, buffer 2098 x 1466; 212 draws/16,334 triangles.
- 7 active cars, 10 physical parts, 466 immovable props: 483 collision bodies.
- Last game period 170 ms; cumulative skipped physics time 800 ms. That total
  cannot be attributed to this single stall.
- Player damage maximum 64. Cerby's front bumper rotates at 19.025 rad/s,
  rear-right wing at 10.031 rad/s. Both **still have joints**, rather than being
  fully detached. Three active joints in total; no active pedestrians.
- Last-step 41 impacts accumulate across passes/restarts, not one solver matrix.
- No fatal console messages or WebGL errors.

The proprietary full body/hull/motion/contact snapshot, screenshot and corrected
probe stay ignored in `artifacts/perf01-user-drop-state.json`,
`artifacts/perf01-user-drop-paused.jpg` and
`artifacts/perf01-user-drop-corrected-probe.json`. Never commit them.

## Isolated next-trajectory measurements

Clone all rigid states/properties/joint endpoints, preserving shared state
identity. Borrow immutable hulls/static world geometry. Use independent
broadphase/guard workspaces, with no native face-collection callbacks. Predict
a next 40 ms trajectory and measure world guard, pair collection and final
body guard. Then solve those cloned contacts using the actual `allJoints()`
roster, vetoing impulse application. Quick-hinge projection before the veto
mutates clones; the guard is deliberately measured **before** that solve.

This is not a preceding full-tick replay: it omits forces, correction passes,
crush callbacks and the post-joint-projection guard. Fresh indexes/source-module
warming differ from the live runtime. Timings on the shared host are bounded
observations, not steady FPS predictions.

| Probe                                     | World guard | Pair collection | Body guard | Solver |
| ----------------------------------------- | ----------: | --------------: | ---------: | -----: |
| Warm unmodified, no per-pair timing       |      2.2 ms |          8.6 ms |    29.6 ms | 0.3 ms |
| Warm unmodified, per-pair timing          |      1.9 ms |          5.3 ms |    35.7 ms | 0.5 ms |
| All parts' spin zeroed **only on clones** |      0.7 ms |          2.8 ms |    15.0 ms | 0.4 ms |

Zero-spin changes contacts (1 to 4) and accepted fractions. It shows sensitivity
to part rotation, **not** a valid optimization or permission to remove rotation.

The unmodified guard discovers 63 candidates/39 pairs and performs 22
revalidations, 55 actual pair-guard calls, 3,308 hull transforms and 2,473
snapshot hits. No conservative fallback/dependency merge occurs. Zero-spin
requires 1,419 transforms. The front-bumper/detached-hood pair alone costs about
8 ms across two checks in the traced warm sample. `pair-guard.ts` can sample up
to 128 intervals with swept/penetration checks. The bumper's conservative
momentum/inertia angular-travel bound is 4.055 radians over this window.

The cloned solver has four groups; the largest has one contact and nine joint
rows. It is inexpensive here. An earlier exploratory artifact wrongly supplied
dormant prop joints and measured a post-quick-hinge trajectory; exclude those
solver timings/trajectories. An initial zero-spin predicate matched no bodies
and is also excluded. The corrected artifact supersedes both.

The original frame window allows up to five 40 ms ticks per game frame, so
expensive guards can amplify catch-up work. Actual tick/pass/restart counts in
the user's stall remain unknown; do not multiply component times into an
invented full-frame measurement.

## Recording the next actual drop

`tools/live-performance-recorder.mjs` exports a self-contained injectable
function. Use with an existing Playwright page, without reloading:

```js
import { installLivePerformanceRecorder } from "./tools/live-performance-recorder.mjs";
await page.evaluate(installLivePerformanceRecorder);
// Once the user pauses:
const capture = await page.evaluate(() =>
  window.__perf01LiveRecorder.snapshot(),
);
```

Fixed 512-row scalar rings retain RAF intervals, updateFrame and tick timings.
Tick rows distinguish commit/projection guards, world guard/contact collection,
call counts, structural sync and populations. Frame buckets include rendering,
AI, pedestrians, matrices and world animation. Timings are inclusive, not
additive; GPU time is not measured. Instrumentation has overhead.

Pause preserves history. Race/Simulation/owner replacement restores old wrappers
and attaches new ones with generation IDs. In-page race loads survive; full
navigation/reload does not. Stop with `window.__perf01LiveRecorder.stop()`.
No autonomous simulation loop runs.

Do **not** wrap world `querySurfaces`, `queryLocalSurfaces` or `modifier`: their
identities certify PERF-12 static-guard reuse. The older broad
`tools/performance-probe.mjs` wraps a query, so it cannot represent minimally
instrumented PERF-12 cache behavior. The new recorder leaves these untouched.

Targeted tests cover capacity, call/return preservation, paused history, ring
bounds, race replacement, reinjection and restoration. Independent static
review found no blockers. MCP confirms the live page remains paused at its
exact captured position/time, recorder counts stay zero in pause, world query
identities are intact, console is clean and WebGL error is zero. No production
engine change/build is required for this opt-in diagnostic tool.

## Actual subsequent 6 FPS / opposite-direction capture

The user resumed, reported about 6 FPS versus 20 FPS after turning 180 degrees,
and paused at elapsed 145.68 seconds. Version-2 rings retain 388 updates, 387
running frame intervals and the last 512 ticks. The complete capture stays
ignored in `artifacts/perf01-directional-live-capture.json`. The latest paused
FPS (42) does not represent running performance. The scene has 641 draws/19,070
triangles; collision population remains 483 bodies/10 parts.

| Actual recorded work          |     Mean |      p95 |  Maximum |
| ----------------------------- | -------: | -------: | -------: |
| Running RAF interval          | 82.65 ms | 200.0 ms | 266.6 ms |
| Physics updateFrame           | 68.95 ms | 178.9 ms | 263.1 ms |
| Ticks per update              |     2.06 |        5 |        5 |
| Tick CPU, last 512 ticks only | 33.53 ms |  58.3 ms |  82.9 ms |
| Render CPU, two passes        |  4.86 ms |   9.1 ms |  27.1 ms |
| Matrix preparation CPU        |  1.37 ms |   2.0 ms |  16.7 ms |
| Opponent update CPU           |  0.38 ms |   0.7 ms |   6.5 ms |
| Pedestrian update CPU         |  0.60 ms |   1.1 ms |   4.3 ms |

Physics updates comprise roughly 83% of the average frame interval. The worst
update has five ticks/262.7 ms tick CPU out of 263.1 ms total. Physics/catch-up
amplification therefore dominates CPU work in this actual capture. GPU time
remains unmeasured; this does not prove zero GPU contribution.

At elapsed 130.04–132.24, updates average 34.38 ms/1.15 ticks, with 30.02 ms/tick.
At 139.32–145.69, updates average 112.83 ms/3.26 ticks, with 34.59 ms/tick.
The large frame difference includes more ticks per frame, with a much smaller
change in cost per tick. These are recorded time windows, **not** exact logged
turn timestamps. Version 2 retained no heading/camera history. Do not infer
that stationary camera rotation alone changed physics.

Last-512-tick means: commit guard 7.78 ms, projection guard 1.15 ms, world guard
5.61 ms, pair collection 8.04 ms. Most ticks have exactly 4,347 world-guard
calls, nine pair collections and 483 initial world-contact collections.
Source audit explains this residual amplification:

- `simulation.ts:4941` permits eight global correction passes. The only early
  exit is an empty contact list, not convergence/no changes.
- Eight passes plus final refined commitment give `483 * 9 = 4347` calls;
  initial pair collection plus eight passes gives nine collections.
- Cached raw contacts remain nonempty and are replayed into solver/damage
  callbacks. Cache hits do not eliminate full-scene correction rounds.
- Rest rows use minimum RHS 0.01 (HW impact/rest map 0x4bac60); repeated-looking
  rows need not be no-ops. Do not terminate on raw row identity or lower caps.
- Final-state 57 impacts include six Cerby/hood pair rows and fourteen
  front-wing/hood rows, positive impulses in five/nine respectively. These
  accumulate across the step and are not a pass-by-pass trace.
- At pause, moving-world population is zero and static-world certification
  is eligible. The global moving-world cache bypass is absent in this state;
  no active physical pedestrians are present.

Camera direction affects GROOVE visibility (`PointOutOfSight` 0x4e5aa0);
driving also changes trajectories/contacts. The cause of the user's directional
correlation remains unisolated. The eight-round integration safeguard itself
has no established native C2 equivalent in this audit. Further work must
preserve real solver impulses, damage ordering and final collision guards.

### Instrumentation overhead and recorder version 3

Version 2 timed every immovable early return. A bounded pure-return microprobe
(4,347 calls per block, no simulation) measured original/timed/count-only
blocks at 0.9/21.2/0.9 ms cold and 0.4/2.5/0.2 ms warm. All samples are retained;
the cold spike has warm-up/scheduling uncertainty. This measures one observer
site, not total recorder overhead. The warm added cost is about 2.1 ms per
block and may amplify catch-up near the budget boundary. It cannot be used
to subtract a universal correction from the complete trace.

Version 3 counts immovable calls without clock reads; their CPU remains in
whole-tick timing. Movable calls stay timed. World-guard totals therefore
differ in definition between versions 2/3. Bounded frame scalars now retain
player heading/position, camera pose, draws/triangles and moving-world count.
The previous history was saved before recorder replacement. Targeted
lifecycle/count tests pass; the user remains paused at the same time/pose.
No physics behavior, iteration limit, activation or visibility change is made.

## Subsequent implementation

The authorized PERF-13 work removes repeated source-shape walks, discarded
SAT/manifold work and high-volume temporary allocations; see
[implementation and bounded validation](guard-kernel-performance.md).
It retains solver/callback rounds and does not yet close the original hardware
route acceptance. The old controlled Chromium was restarted while diagnosing
its stalled protocol connection; the recorded trace and full user-state snapshot
were saved before that restart. Earlier pause-preservation statements above
describe the diagnostic captures, not the later browser restart.
