# PERF-13 integration check after the structural queue

## Follow-up implementation

The residual implementation after PERF-20/21/22 is tracked in
[PERF-13 residual physics](perf13-residual-physics.md). The measurements and
no-behavior-change statement below describe the earlier `dbc7a0d` audit, not the
new adaptive guarding and motion-cache implementation.

Update after `597b42d`: the unlocked-desktop hardware ABBA comparison and
Timber/Snow routes now satisfy PERF-13's remaining acceptance criterion. The
ticket is done; see the linked follow-up for results and limitations. The
broader PERF-01 umbrella remains open.

## Historical decision at `dbc7a0d`

**Keep PERF-13 open.** The original eight-global-pass implementation is gone,
but current damaged-gameplay integration still fails the usable frame-time
criterion. This is a concrete residual inside the existing ticket, not another
performance umbrella. PERF-04 visibility remains dependent on it. No engine,
physics limits, resolution, activation or gameplay behavior changed in this audit.

Checkpoint tested: `dbc7a0d` (includes DMG-06). Production bundle, actual AMD
ANGLE/radeonsi gfx1150 OpenGL4.6, drawing buffer **2100 x 1466**. Checks used a
separate Chromium context and production asset server. The user's existing
paused page was neither navigated nor stepped. Chrome DevTools MCP was absent;
Playwright CDP supplied the controlled hardware browser and CPU sampling.

## Rendered measurements

Five serial captures, each with a separately retained 500 ms warm-up and 2500 ms
requested active window. Normal W input, opponents, world, rendering and effects
remain active. No repeated stress loop or concurrent profiling job.

| Original Stock scene                           |      FPS | Frame median / p95 / max, ms | Mean / p95 tick CPU, ms | Executed ticks | Skipped ms |
| ---------------------------------------------- | -------: | ---------------------------: | ----------------------: | -------------: | ---------: |
| Timber start                                   |     50.8 |            16.6 /33.7 /198.0 |                6.1 /9.3 |             62 |          0 |
| Timber damaged grid                            | **15.6** |           55.2 /119.8 /153.9 |          **29.8 /50.8** |             68 |          0 |
| Timber authored node 192, toward adjacent node |     48.3 |             18.2 /36.3 /53.1 |               8.3 /23.0 |             63 |          0 |
| Timber node 192, opposite heading              |     52.7 |             17.2 /35.1 /40.9 |               6.3 /11.3 |             63 |          0 |
| Snow Way Out start                             |     28.0 |            29.5 /62.1 /210.7 |              17.5 /34.8 |             64 |          0 |

The node 192 screenshot shows a narrow tunnel/canyon corridor, not a verified
traversal of the user's original open-ravine location. The two directions have
different subsequent paths; these short starts do not isolate the historical
180-degree correlation. Snow includes a launch/roll during real startup contact,
not an isolated tunnel-exit transition. Ordinary pickups remain active (including
a Pinball pickup in the node 192 sample). Cold/adverse frame tails are retained.

The damaged fixture invokes the existing SPAM path on the player and two nearby
original opponents, then drives normally. The first run ends with 12 physical
loose parts. This is a representative original-asset damage workload, not an
exact replay of the saved 2026-10-13 crash or an assertion about ordinary
steady-state driving. Detailed observers give 24.67 executed ticks/wall second,
zero skipped time and 2,044 ms inclusive physics-update CPU in a 2,756 ms capture.
The engine is not concealing the cost by slowing or dropping simulation.

GPU timer samples average 0.81-0.96 ms across these cases; damaged-grid mean 0.86 ms.
Inclusive renderer CPU averages 3.14 ms per render call there. The primary measured
workload is CPU physics; the isolated 198/211 ms frame outliers are not fully
attributed by this statement.

## Confirmation and CPU attribution

A second damaged-grid capture with CPU sampling gives 15.3 FPS,31.0ms mean tick
CPU, 67 ticks at 24.99 ticks/s, zero skipped time and14 final parts. A third
separate original-scene run removes **all** method/live-recorder wrappers after
warm-up and samples only RAF intervals: **18.8FPS**, frame median32.1 /p95162.4 /
max176.6ms, zero skipped time. Its damage/opponent selection differs (13 initial
detachment requests versus 9 in the first run), so these are not matched A/B
samples and must not be used to calculate profiling overhead. The bare result
confirms the remaining slowdown exists without the detailed observers.

CPU profile maps against the actual minified production bundle:

| Bundle symbol           | Source owner                                 | Inclusive sampled time | Share of complete profile |
| ----------------------- | -------------------------------------------- | ---------------------: | ------------------------: |
| `vN`                    | `runLocalResponses`, `local-response.ts`     |              1,233.7ms |                    38.60% |
| `Ig`                    | final `guardPairTrajectory`, `pair-guard.ts` |                459.8ms |                    14.39% |
| Other work under `step` | remaining physics                            |               ~302.3ms |                    ~9.46% |

These rows partition the sampled physics subtree. Within local responses,
world collection accounts for 13.03% of the whole profile, pair collection 10.45%,
solve 6.27%, roster/input refresh 4.18% and prediction 3.38%. These descendants are
already included in 38.60%, and must not be added again. Exclusive self time of
the orchestration function is only 0.69%: its name in a hot stack does not prove
that its loop bookkeeping is the main problem. `sweepHullFeatures`/`sweepMovingEdges`
are shared descendants of both collection and trajectory guarding.

The complete profile spans 3,196 ms, longer than the 2,681 ms requested-route capture
including CDP boundaries. `(program)` is 17.44% unattributed outside sampled JS
stacks; GC 2.78%. Neither is proof of GPU cost or a specific scheduling cause.
The profile does not yet identify costly body pairs, actual temporal sample
counts or which repeat contacts deliver useful impulses.

## What the completed queue establishes

PERF-15 replaced global rounds with local response rings and native-informed
retry ownership. Its partial historical Cerby replay reduces 8 solves to 2 and
unrelated movable visits 96 to 12, retaining positive response and motion.
That replay omits world/forces/damage/PHIL history; it does not reconstruct the
entire old user tick. PERF-16 removes dormant scenery from the ordinary physical
roster; controlled whole-update CPU improves 83.5 to 21.1 ms Stock and 34.3 to 27.9 ms
Advanced. PERF-17/18 add quiet ownership and dormant render-work reduction;
PERF-19 reduces ordinary ACT/MODEL contact preparation. Their tests and recorded
limitations remain valid. New measured damaged-scene cost means those completed
checkpoints do not satisfy PERF-13's remaining integration criterion.

## Next bounded work

1. Preserve a seeded, repeatable damaged fixture with initial car/part identities,
   hulls, attachment state and poses. Keep the unseeded current observations.
2. Attribute local work by root/ring: collection/retry/solve counts, membership
   growth, input invalidations, exhaustion and accepted normal/joint response.
3. Attribute final pair guarding by pair: actual temporal samples, transforms,
   shape/depth queries, old-overlap handling and committed fractions.
4. Select an algorithmic change from that attribution. Compare the same fixture,
   ordinary Timber and Snow with hardware frame/tick distributions, actual tick
   rate and finite motion, crash, detachment, repair and fresh-contact regressions.

The current evidence does not select a new retry limit, weaker CCD, extra damping,
or sleeping moving pieces as a solution. Rare spikes and unresolved historical
route/directional attribution stay coordinated by PERF-01; PHY-17 remains a
separate split-secondary correctness defect.

## Reproduction and private evidence

Start the existing production server on an unused loopback port and connect to
an already running hardware Chromium with remote debugging enabled:

```sh
PORT=5221 npm start
node tools/validate-performance-routes.mjs
PERF_ROUTE_CASE=timber-damaged-grid PERF_ROUTE_PROFILE=1 PERF_ROUTE_OUTPUT=artifacts/perf13-damaged-profile.json node tools/validate-performance-routes.mjs
PERF_ROUTE_CASE=timber-damaged-grid PERF_ROUTE_BARE=1 PERF_ROUTE_OUTPUT=artifacts/perf13-damaged-bare.json node tools/validate-performance-routes.mjs
```

Defaults: `CDP_URL=http://127.0.0.1:9222`,
`PERF_ROUTE_URL=http://localhost:5221`. Run commands serially. The tool closes
only its new browser context, never the existing browser. Its screenshot shows
the paused end pose and menu; rendering measurements were taken while active.
JSON reports, CPU profile and screenshots remain ignored under `artifacts/`.
All three runs have no page/console errors, failed requests/responses or WebGL
errors. This tool-only audit relies on the unchanged checkpoint's 2973 passing
unit/original-data tests and Chromium crash/damage checks; it does not claim a
fresh whole-suite run or any engine implementation change.
