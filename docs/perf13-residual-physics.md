# PERF-13: residual damaged-scene physics

This continues the integration check after PERF-20/21/22, engine baseline
`baf9431`. Earlier measurements remain in
[the integration investigation](perf13-integration-check.md).

## Attribution and measurement corrections

The old rendered-route harness could begin before pedestrians finished loading.
It now waits for both opponents and the installed public pedestrian system.
The seeded Timber damaged grid starts with seven cars, nine detached parts,
584 pedestrians (19 initially active), and 466 authored NONCARs. The matching
initial body fingerprint is
`3376258c0ff912f54f0cce21690322ae036d3ab294a24a4b819ce94facf09b26`.
Timed driving and AI remain nondeterministic after that initial fixture.

The minimal recorder wraps only `sim.step` and `sim.updateFrame`, retaining
fixed-size typed-array rings. It does not wrap each geometry operation. Captures
record rendered RAF intervals, drawing-buffer size, GPU backend, full tick and
update CPU distributions, executed ticks, separate simulation/game/wall clocks,
full populations and skipped time. CDP CPU sampling and detailed response tracing
are separate opt-in diagnostics, with their overhead explicitly identified.

Baseline, AMD ANGLE/radeonsi gfx1150, drawing buffer 2100 x 1466, 2.5-second
normal rendered driving windows:

| Capture                                    |  FPS | Tick mean / p95 (ms) | Frame p95 (ms) | Skipped time (ms) |
| ------------------------------------------ | ---: | -------------------: | -------------: | ----------------: |
| Full population, minimal recorder          | 8.21 |        30.90 / 56.10 |         243.40 |                80 |
| Same fixture, CPU sampling enabled         | 4.91 |        37.14 / 68.30 |         345.80 |               440 |
| Earlier edge-index-only candidate, minimal | 6.87 |        35.74 / 55.00 |         272.20 |                40 |

Additional rejected intermediate captures remain in ignored artifacts:
first-order-only minimal 6.79 FPS (tick mean 35.38 / p95 66.60 ms, frame p95 320.30 ms,
280 ms skipped); the broad-timer/CPU-profiled version 2.75 FPS (70.89/155.40 ms,
frame p95 582.40 ms, 1360 ms skipped); geometric slop before edge-cross witnesses
3.18 FPS (55.52/102.70 ms, frame p95 445.10 ms, 880 ms skipped). The observer
configurations differ and are not a clean overhead comparison. The skew-axis
regression explains and fixes the rejected event-enumeration explosion.

These adverse samples are retained. The last row is not an established gain;
the population fix also makes older no-pedestrian FPS results a different load.
One failed capture waited on a nonexistent public `pedestriansReady` getter;
that was a tooling error, fixed by checking the actual installed system.

Hidden source maps were generated separately, with exact SHA-256 verification
of the generated JavaScript against the actual profiled production bundle.
Source attribution therefore does not rely on guesses about minified names.
The fully loaded sampled baseline spends approximately 2193 ms in physics steps,
including 1281 ms in local response, 622 ms in final pair guards and 330 ms in
pair contact collection. Native world collection accounts for 294 ms. These are
inclusive, overlapping costs and cannot be added together. Recursive actor
traversal likewise must not be ranked by adding inclusive recursive frames.

## Implemented changes

- Spatial edge-feature preselection preserves authored edge-slot order and the
  original narrow-phase equations; shape ownership controls persistent reuse.
  Small hulls use scalar scans and large hulls a median BVH. Exceptional inputs
  retain all candidates. Its first normal-grid and saved-interlock four-tick
  comparisons preserve full kinematics, ordered impulses, damage, hulls and
  attachment hashes; their noisy cold timings do not establish a speedup.
- A source-certified first-order free-motion descriptor distinguishes affine COM
  motion and fixed-axis native quantized rotation from general joint/high-angle
  trajectories. An adaptive temporal SAT guard replaces centimetre-based
  subdivision for eligible convex hull cells. Support intervals and curvature
  bounds certify clear regions; exact translation SAT handles constant-angle
  intervals, including thin complete crossings with clear endpoints.
- Native quantization and the small-rotation gate are explicit events, rather
  than assumed smooth angular motion. Event brackets below 1e-10 of a tick test
  endpoint orientations conservatively. If both angle staircases jump inside
  the bracket, the existing actual-pose fallback avoids inventing mixed
  orientations. This does not change the integrator.
  Unsupported paths, native wire/sphere special cases, unqualified existing
  overlaps and exhausted interval searches retain the detailed fallback.
- Response retries retain captured trajectories for physical trees whose exact
  existing input certificates have not changed. A changed tree includes its
  current ancestors, descendants and shared external anchors. State aliases are
  dependencies too. This cache lasts one tick; final world/pair-capped commitment
  is always freshly captured. No contact impulse or damage callback is reused.

## Reproduction tools

```sh
PERF_ROUTE_URL=http://localhost:5221 PERF_ROUTE_CASE=timber-damaged-grid \
  PERF_ROUTE_MINIMAL=1 PERF_ROUTE_SEED=20201016 \
  PERF_ROUTE_FIXED_LOAD_RANDOM=1 \
  node tools/validate-performance-routes.mjs

# Diagnostic attribution only: these timings must not be presented as FPS gains.
BASELINE_URL=http://localhost:5221 CANDIDATE_URL=http://localhost:5222 \
  PERF22_SNAPSHOT=artifacts/perf18-user-interlock.json \
  PERF_RESPONSE_DETAIL=1 PERF_EDGE_DIAGNOSTICS=1 \
  node tools/compare-rendered-physics.mjs
```

Original captures, reports, executable data and screenshots remain ignored.
The Chrome DevTools MCP tool is unavailable in this session; browser validation
uses Playwright/CDP and the reproducible Chromium harness instead. Hardware
measurements below identify their actual backend; final correctness checks use
SwiftShader after the desktop debugging transport stopped responding.
No system packages or browser launch policy were changed.

## Saved response attribution

The saved ten-body interlock fixture was installed in isolated Chromium contexts
and traced for four ticks. All four repeated passes report 17 response events,
30 distinct contact geometry/impulse keys, and a maximum seed attempt of six.
Every response changes actual velocity/angular velocity; three events also
publish replacement hull identities. No exact geometry or impulse row repeats
and no records are truncated. Shape replacement can retain identical vertex
coordinates, so identity and numerical fingerprints are reported separately.
This fixture does not justify skipping positive responses or changing native
retry termination. It is a reconstructed post-tick pile, not a full historical
application replay.

## Resolution versus conservative enclosure

A further uncapped, unfiltered diagnostic of the recorded warmup geometry finds
one thin Eagle part forcing 128 intervals against each of three neighbours. Its
actual captured turn is about .189 radians; its inertia anisotropy inflates the
conservative angular enclosure to several radians. The samples have no AABB
intersections and emit no SAT/feature work, but still transform geometry each time.

Captured native paths now select temporal resolution using the existing native
angular-rate hint together with the observed four-subinterval rotation sum.
Unknown/invalid hints retain the supplied angular-travel bound. The global
momentum/inertia enclosure remains unchanged for broadphase and whole-phase
clearance certification; it is not treated as a local angular rate. Prefix
wrappers scale only the resolution hint. The same three free-pair queries fall
from 128 intervals each to 11, 11, 12, all retaining full fraction 1. This is a browser
sampling-policy change, not a new native integration equation. Full and hidden
multiple-turn collisions and changing-axis anisotropic impact tests remain
mandatory; unusually rapid gyro motion hidden between probes remains the same
class of sampling limitation as the bounded previous guard.

## Final CPU attribution and hardware acceptance

Final code passed 3,096 headless tests with no failures or skips. The original
Stock/Advanced crash and saved-interlock browser checks pass on the final
production build, with clean console/requests/WebGL. Their software backend is
a correctness check, not an FPS measurement.

Two short, serial CPU-profiled diagnostic windows use the same seeded initial
body fingerprint, complete populations, minimal wrappers, pair counters and
2100 x 1466 drawing buffer. Drawing is explicitly suppressed and asserted both
before and after capture. Later driving/AI paths remain nondeterministic; these
are not bit-exact timed replays.

| Drawing-suppressed CPU diagnostic | Baseline `baf9431` | Profiled candidate |
| --------------------------------- | -----------------: | -----------------: |
| Executed ticks                    |                 67 |                 67 |
| Mean / p95 tick CPU, ms           |       21.50 /38.20 |       16.05 /29.40 |
| Mean / p95 update CPU, ms         |       14.58 /39.00 |        9.48 /29.60 |
| Final pair guard sampled CPU, ms  |             409.23 |             105.77 |
| Legacy sampled intervals          |             21,281 |              1,535 |
| Guard feature sweeps              |             11,086 |                886 |
| Guard hull transforms             |             34,798 |              4,834 |
| Adaptive-search budget fallbacks  |                n/a |                  0 |
| Recorded skipped time, ms         |                  0 |                 80 |

The equal tick counts do not imply equal later body state: the guard policy,
timed AI and wall-clock catch-up differ. Keep the adverse skipped-time sample;
no timestep/frame-window limit was changed to obtain these results. Pair guard
CPU is now about 4% of the final sampled total rather than the earlier dominant
cost. Local native collision/response is still the largest physics descendant.
The unprofiled software CPU windows are retained too; their mean tick costs are
19.14 and 16.73 ms. Neither software result supplies hardware FPS acceptance.

The last successful _hardware-rendered_ intermediate candidate, before the
sampling-resolution fix, delivered 17.74 FPS with mean tick 23.36 ms and p95 frame
132 ms. That is an improvement over the full-population 8.21 FPS baseline, but
still has unacceptable tails. The final candidate must not inherit this
intermediate result as its own measurement.

Hardware acceptance was initially externally blocked: both the existing desktop CDP
endpoint and newly isolated desktop Chromium instances stop responding to local
CDP requests. A separate headless hardware EGL attempt cannot open
`/dev/dri/renderD128` (permission denied); this user is not in the render group
and the device currently has no per-user ACL entry. No device permissions,
session settings or original user browser were changed. The controlled software
browser remained available for correctness and CPU attribution. At checkpoint
`597b42d`, PERF-13 stayed **wip** with hardware whole-rendered-route AC2 open.
The unlocked-desktop measurements below resolve that acceptance gap. No broader
Goal is marked complete and no additional package is required.

Earlier software fallback attempts accidentally restored drawing when disposing
the broad warmup probe. Those reports are retained as
`*-restored-draw-excluded.*` and excluded from the diagnostic table. Failed CDP
transport attempts are tool/environment failures, not application crashes.

URLs in A/B commands must serve independent production builds. Two ports backed
by the same `dist/` directory do not constitute a baseline/candidate comparison.

A four-call cold ABBA ablation on the recorded, uncapped free-body warmup kernel
also disabled the first-order descriptor while retaining the native resolution
hint. Both routes keep the same blocked pair; their allowed fractions differ
because the adaptive route uses geometric slop. The sample-rate-only route is
cheaper in this small low-speed kernel (warm calls 4.41 versus 5.72 ms), so the
adaptive route is not claimed to be universally faster. It additionally removes
distance-based subdivision for eligible fast/thin encounters. This partial,
unfiltered kernel test is neither an actual rendered route nor a full replay.

Final geometric regression: two micrometre-thin tangent hulls sharing exactly
the same COM and native angular motion remain tangent for the entire tick.
Testing independent before/after orientation combinations at a simultaneous
native angle jump incorrectly clipped their motion at fraction 0.00395.
Such coupled event brackets now request the existing detailed actual-pose route
instead of accepting a physically impossible mixed orientation. The regression
keeps full motion, visits fewer than 16 adaptive intervals, and retains an
explicit fallback count. A companion relative-translation impact remains
blocked. This is a correctness routing fix; the CPU measurements above precede
this narrow change and are not relabelled as measurements of the final bundle.

## Unlocked-desktop hardware acceptance

After the user reported unlocking the workstation, the original desktop CDP
endpoint immediately responded again. No Chromium restart, GPU permission change
or package installation was required. The original user tab stayed paused and
was not navigated or stepped. All measurements used isolated contexts of that
same Chromium, AMD ANGLE/radeonsi gfx1150, at 2100 x 1466. Capture windows were
2.5 seconds, serial, minimally instrumented and fully rendered. CPU sampling,
detailed response tracing and pair counters were disabled.

The ABBA comparison uses independently served production builds: baseline
`baf9431` on port 5223, final `597b42d` on port 5221. Every initial body and full
fixture fingerprint matches across all four windows. Populations remain seven
cars, nine detached pieces, 584 pedestrians (19 initially active), and 466
authored NONCARs. Subsequent timed driving/AI states differ; this is not a
deterministic trajectory replay. Earlier adverse captures remain above, but are
not used as the denominator for the new unlocked-session gain.

| Hardware ABBA capture |   FPS | Tick mean / p95 (ms) | Update mean / p95 (ms) | Frame p95 / max (ms) | Executed ticks | Skipped time (ms) |
| --------------------- | ----: | -------------------: | ---------------------: | -------------------: | -------------: | ----------------: |
| A: baseline           | 26.77 |        21.42 / 38.70 |          20.50 / 54.00 |        71.60 / 92.70 |             64 |                 0 |
| B: final              | 38.72 |        17.76 / 35.60 |          11.99 / 34.70 |        47.90 / 84.10 |             63 |                 0 |
| C: final              | 38.23 |        17.28 / 37.80 |          12.57 / 36.10 |        56.40 / 77.00 |             65 |                 0 |
| D: baseline           | 27.37 |        21.60 / 39.90 |          20.44 / 73.80 |       94.70 / 106.20 |             65 |                 0 |

Average FPS improves about 42%, mean tick cost about 19%, and mean update cost
about 40%. Whole-rendered-route p95 improves in both final windows; tick p95
changes more modestly, so average savings must not be presented as elimination
of every expensive native response. No clock/catch-up policy was changed.

Additional final-build hardware route windows:

| Route                  |   FPS | Tick mean / p95 (ms) | Frame p95 / max (ms) | Skipped time (ms) |
| ---------------------- | ----: | -------------------: | -------------------: | ----------------: |
| Timber canyon, forward | 54.74 |          5.62 / 9.00 |        32.50 / 40.60 |                 0 |
| Timber canyon, reverse | 55.98 |         5.69 / 15.40 |        37.30 / 39.50 |                 0 |
| Snow start             | 46.37 |        11.34 / 28.70 |        44.80 / 72.80 |                 0 |

All seven captures report no console errors, failed requests/responses or WebGL
errors. Screenshots were inspected. Raw reports and logs are ignored under
`artifacts/perf13-unlocked-*`; final correctness remains backed by the 3,096
headless tests and original Stock/Advanced crash/repair/interlock checks above.
PERF-13 AC2 is now substantially met and the ticket is **done**. PERF-01 remains
open: short recreated routes cannot guarantee the absence of rare user-created
chaos stalls, and these results do not establish a universal 60 FPS target.
