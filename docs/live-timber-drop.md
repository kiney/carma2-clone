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
