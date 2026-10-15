# PERF-19: ordinary world-contact spikes

## Evidence and measurement limits

The post-PHY-16 user recording is **Stock desert2**, Eagle3, engine `5fcbec0`,
AMD/radeonsi through ANGLE, drawing buffer 2612 × 1805. It is not Timber.
Private reports remain in ignored `artifacts/phy16-live-recording*.json`.

At simulation time 81.28 s, the recorder measured a 420 ms tick, including
292 ms in 108 ordinary `worldContacts` calls, 51.2 ms in world guards,
24.6 ms in final pair guarding and 16.6 ms in pair collection. Its enclosing
update had **one tick**, so later four/five-tick catch-up amplified the stall
but did not cause it. A corresponding RAF interval was 450 ms; average render
CPU was approximately 3 ms. These inclusive wall durations cannot identify GC,
scheduling or GPU stalls. The earlier unrecorded 9-FPS episode is separate.

**Instrumentation correction discovered during implementation:** recorder v3
wrapped the three response collectors without forwarding the existing
`correctionObserverSource` contract. This disabled response preparation reuse.
The older short performance probe also wrapped `scene.updateMatrixWorld`,
classifying descendants as custom transform providers, and wrapped world query
providers that certify reuse. Those measurements are real _instrumented_
workloads, not an unbiased normal-play baseline. They cannot establish the
normal-game magnitude of the historical spike. Both tools now preserve these
contracts; regression tests cover their installation and restoration.
`perf19-hardware-before.json` and `perf19-hardware-preparation.json` retain the
adverse old-probe samples, but must not be used for normal-play speed claims.

## Implemented changes

### Prepare selected ACT subtrees once per unchanged physics phase

Native `FindFacesInBox` eagerly prepares every descendant of selected column
roots plus additional actors **before** bounds admission. A handful of emitted
faces can therefore require thousands of repeated actor and MODEL checks.

`WorldCollision.beginNativePreparation/endNativePreparation` now bound reuse to
one synchronous simulation `step`, with cleanup in `finally`. Complete ordinary
subtrees reuse their preparation. Pose invalidation clears actor preparation;
geometry/topology invalidation clears both actor and MODEL preparation. Noncar
pull/return, retained clones, dynamic participation, destruction publication,
GROOVE movement and simulation pose publication invalidate the relevant state.
Standalone calls remain eager. Unknown mutating callbacks and custom transform
updaters invalidate preparation rather than retaining their hidden state.

Native traversal, finite capacity, water faces, ACT pulls, MODEL stop callbacks
and their ordering still run every query. The production face observer only
captures moving-owner poses and is explicitly read-only. No face or collision
feature is dropped, and no solver iterations, visibility or timestep changes.

### Remove temporary-array work from native ACT arithmetic

CPU sampling then identified matrix validation/copying and bounds arithmetic as
remaining collector work. Matrix multiplication, LP inverse, point/bounds
transforms and leaf bounds tests now use fixed scalar arithmetic instead of
nested arrays, maps and per-call summation-order tables. Public validation and
Float32 stores/sum association are retained. Installed numeric captures and
512 seeded differential fixtures cover signed zero, subnormals, extreme values,
overflow and malformed input as well as ordinary inputs.

### Separate GROOVE evaluation from changed geometry

`stopActor` keeps its native evaluation/interruption semantics. A separate
`poseRevision` advances only when an ordinary actor's resulting world matrix
changes; custom update methods publish conservatively. Culled callbacks and
repeated identical spins no longer trigger all moving-owner preparation and
dynamic refresh solely because evaluation ran. Changed parent transforms remain
observable. Stock desert2 has 14 straight paths and seven rock objects, **no
spins**; the closest pump is 36.7 world units from the frozen captured bodies.
This is a verified redundant-work fix, not proof that pumps caused that capture.

## Controlled original-data comparison

`tools/profile-world-contacts.mjs` launches an isolated Chromium, suppresses
rendering, prepares one production 40-ms hierarchy sweep and calls ordinary
world contacts with cold/warm native face caches. No autonomous driving loop.
Two passes use the fresh original eleven-car desert grid and a twenty-body
pose/hull capture at 13 s. The latter is **not** the 81-s outlier or a complete
race restore. CPU sampling and optional subphase counters are enabled.

| Cold face-cache workload | Eager actor / MODEL checks | Scoped actor / MODEL checks | Eager ms, first / second | Final ms, first / second |
| ------------------------ | -------------------------: | --------------------------: | -----------------------: | -----------------------: |
| Fresh original grid      |                1892 / 1793 |                   172 / 163 |               23.6 / 7.2 |               22.2 / 4.3 |
| Captured poses           |                1616 / 1536 |                    101 / 96 |               30.2 / 7.1 |                6.4 / 3.3 |

Reports: `artifacts/perf19-eager.json`, `perf19-scoped.json`, `perf19-final.json`
and adjacent CPU profiles. All eight contact signatures match exactly, including
six contacts for each captured-pose pass. Fixture and original-capture hashes
match. Preparation alone reduced checks 11–16× but had mixed timings; scalar
kernel work improved the measured second-pass collector times further. Cold
first-pass JIT/GC/scheduling variance remains visible rather than discarded.
Warm native face-cache calls remain around sub-millisecond totals. These are
SwiftShader-backed **CPU kernel** measurements, not predicted hardware FPS.

Reproduce with local originals present:

```sh
npm run build
npm start
node tools/profile-world-contacts.mjs --eager --output artifacts/world-eager.json
node tools/profile-world-contacts.mjs --reference artifacts/world-eager.json --output artifacts/world-scoped.json
```

The two commands compare current arithmetic with/without preparation reuse.
The saved implementation baseline above additionally predates scalar arithmetic
changes. Without the private pose capture, use `--grid-only`; other stock tracks
can be selected with `--track timber2 --grid-only`. No original fixtures are
committed. `--reference` asserts fixture/contact equivalence, not a timing limit.

## Continuing outlier diagnosis

Recorder v4 adds a bounded ring for ordinary contact calls taking at least 2 ms:
body label/index, simulation time, hull/raw/eligible face counts and transform,
collection, recovery, sweep and reduction times. It retains no body objects,
chains/restores an existing observer, survives owner replacement and pauses,
and runs only when explicitly installed. Ordinary gameplay has no timer calls
from this diagnostic. This provides attribution if the rare live spike recurs.

The 300-face cache and native callbacks remain observable operations. Further
candidate reduction, recovery optimization and moving-world guard reuse require
new evidence. Do not interpret this ticket as proof that every possible frame
spike is eliminated or begin visibility expansion on that assumption.

References: `src/physics/simulation.ts`, `src/world.ts`, `src/native-actor-pick.ts`,
`src/world-groove.ts`, [native face-cache evidence](c2-world-face-cache-re.md),
[PERF-11 envelopes](world-face-performance.md),
[local response orchestration](local-response-performance.md).

## Runtime validation and remaining acceptance

- Production build and full numerical/original-data suite: 2959 tests passed.
  Final review added an external-pose rollback regression: evaluating a GROOVE
  back to its historical pose must invalidate a different pose prepared at
  query entry. The focused GROOVE/world/recorder suites also pass afterward.
- Chromium's captured Timber pile passes forward/reverse release, physical
  bumper-removal control and repair. Four Stock/Advanced crash cases completed
  with clean runtime/network diagnostics; screenshots were inspected.
- The extended Porker2 SPAM test fails its stationary split-secondary assertion.
  An isolated build of **unchanged checkpoint `1f33742` reproduces that failure**:
  finite state and conserved mass, but no secondary displacement over the old
  long fixture. This is tracked separately as **PHY-17 / TASK-111**, P1 `next`.
  It is not hidden by relaxing the assertion; the harness now saves the failing
  split result. Prefer a new bounded reproduction for that investigation.
- Chrome DevTools MCP is unavailable in this runtime. Browser checks use the
  repository's Playwright/Chromium and CDP tooling instead.

Corrected-probe hardware driving captures are two seconds each, AMD/radeonsi
ANGLE, 1280 × 800, with active simulation and GPU rendering. The final desert2
capture reports 37.5 FPS, frame median 22.5 / p95 55.8 / p99 108.1 ms; tick mean 16.29 ms.
Same-build eager-preparation comparison reports 38.4 FPS, median 25.4 / p95 59.8 /
p99 98.9 ms; tick mean 17.19 ms. MODEL synchronization calls fall 28525→8063,
and ordinary contact CPU totals 186.7→137.6 ms. These are short startup drives,
not identical deterministic crash replays; the eager run may overlap a short
baseline bundle build. **No demonstrated overall hardware-FPS gain or improved
worst-frame guarantee** follows from this comparison. Adverse tail retained.

A separate final Timber startup drive reports 58.4 FPS,
median 16.1 / p95 27.1 / p99 44.4 / max 71.4 ms. Both final captures have no uncaught,
network or WebGL errors. Neither recreates the user's ravine/pile episode.

On 2026-10-15 the user accepted the playtest result and requested closure;
PERF-19 is `done`. The historical worst outlier was not reproduced exactly,
so this is not a guarantee that all frame spikes are gone. PERF-01 remains
the performance umbrella. The subsequent Carrier2 side-rest and Eagle variant
damage reports are tracked separately under PHY-10 and DMG-06.
Playtest focus: crowded damaged-car piles in Timber/desert2, loose parts and
repair, plus contacts with moving scenery. Recorder v4 can retain the contact
subphase/body evidence across the next pause without disabling reuse.
