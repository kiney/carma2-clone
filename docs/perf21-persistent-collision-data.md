# PERF-21: persistent collision structures

## Ownership and implementation

This checkpoint changes collision infrastructure, not C2 impulse/friction,
crush, damage, retry budgets or the 40 ms simulation step. PERF-22 retains
contact rediscovery scheduling; PERF-13 retains whole-scene stall acceptance.

- `BodyBroadphase` keeps separate moving/fixed median BVH topologies across
  collections and ticks. Exact roster-slot identity, mobility, ordinary/exceptional
  classification and six AABB components are inspected before queries. This
  includes nonincident neighbors. Changed leaves/ancestors refit; roster/class
  changes rebuild affected trees. A normalized node-span quality measure rebuilds
  topology at 1.75 times build-time cost after spatial rearrangement. It uses
  bounded ratios, without logarithms/exponentials in the hot path.
- Sorted original `i,j` pair order, duplicate roster identities, inclusive touches
  and exceptional NaN/infinite/inverted Box3 behavior remain intact. This is
  refitted BVH ownership, not a new broadphase collision rule or persistent impulse.
- `CorrectionWorkingSet` owns one weak endpoint record for broadphase bounds and
  contact geometry. Vertex transforms and compact-feature bounds are computed
  once per changed OLD/NEXT endpoint. Face planes complete lazily when a filtered
  pair needs geometry, using the same transformed vertex storage. Sparse bounds
  queries avoid full motion/joint-ancestry certification and plane transforms.
- Full pair certificates inspect current motion, material/filter/recovery inputs
  and ancestry. A geometry certificate can be borrowed only inside synchronous
  pure collection; callback/solve barriers recapture. Full snapshot validity
  compares tokens directly, so a preceding bounds capture cannot hide a shape or
  pose change. Analytic spheres preserve radius-based boxes and tolerance.
- Deep producer-sealed hull arrays permit identity checks. Accepted crush/repair,
  splitting and detachment publish replacement arrays; mutable/custom sources
  retain content checks. Existing geometry validity tests cover those paths.
- Exact response-input certificates now persist weakly across ticks. Local
  admission and raw contact/world-result maps still start fresh each tick.
  Simulation disposal drops index ownership and response/geometry cache roots.

The former separate dormant transformed-geometry cache is removed; dormant and
moving geometry share the existing endpoint owner. Retention is bounded by the
last indexed roster plus at most two endpoint graphs per live weak body entry;
removed bodies leave the index on the next collection. Sparse fixed bodies may
retain more vertices than the former aggregate-only stationary bounds helper.

## Counters and limitations

`movingRebuilds`, `staticRebuilds`, `qualityRebuilds`, `treeRefits` and
`boundsChanges` describe actual tree work per discovery. `geometryValidityChecks`
counts shape/pose certificate walks; `validityChecks` counts full motion/response
captures. `boundsVertexTransforms` counts endpoint vertices transformed by this
owner; `geometryTransforms` counts hull plane completion, not all transform work.
Do not compare that last counter alone as proof of total CPU savings.

Full roster validation remains O(N); refitting visits changed ancestors. Dense
true overlaps still generate quadratic candidate output. No contact rows,
solved impulses, safe movement fractions or callback outcomes survive their
previous validity scope. Repeated discovery remains PERF-22 work.

An initial experimental bounds-only implementation transformed newly contacting
vertices a second time during narrow phase. Review rejected that tradeoff; it is
replaced by the shared endpoint implementation above. Its timing samples are
retained as intermediate evidence, not final results.

## Validation and measurements

- Full numerical/original-data suite: **3013 passed, 5 skipped** because optional
  private snapshots were initially absent. All five were then supplied and passed
  within the focused captured-overlap/shallow-contact suites (17 + 6 tests, no skips).
- New/refined tests cover persistent moving/fixed refits, nonincident updates,
  topology quality rebuilds, duplicate identities, exceptional boxes, zero/extreme
  bounds, mutable/producer-sealed shape replacement, shared endpoint storage,
  independent NEXT invalidation, completed provider geometry, tick admission and
  current motion validity when geometry certificates are borrowed.
- Production build and separate Chromium four-car Stock/Advanced core crash
  matrix pass, including visible authored deformation/destruction and repair.
  The recorded loose-part interlock browser checks cover driving in both
  directions, removal and repair. These functional checks use SwiftShader;
  the FPS observations below use actual AMD hardware.
- Controlled original Eagle3/cerby comparison: every setup, intermediate tick hash
  and final physics/damage/contact state matches exactly across ABBA passes.
  Damaged fixture: 6 bodies, 3 real detached parts, 4 ticks, 30 contact collections.
  Moving BVH builds fall **30 to 1** (baseline builds inferred from its unconditional
  per-call implementation; candidate counter measures1). Both implementations
  perform the same30 contact-pair tests,6 positive normal responses and500 world
  hull transforms. This checkpoint does not claim those remaining costs vanished.

Final controlled whole-tick observations, including cold/adverse samples:

| Fixture                     | Baseline median / mean, ms | Candidate median / mean, ms |
| --------------------------- | -------------------------: | --------------------------: |
| Sparse intact Eagle         |                 1.42 /4.54 |                  1.47 /4.59 |
| Dense damaged original cars |                8.28 /11.11 |            **13.97 /18.28** |

The dense final candidate is slower in this short headless run. Earlier unified
ABBA samples gave medians28.40 to15.70ms; retain both rather than selecting only
favorable observations. Cold/JIT/shared-host variability is large. The earlier
bounds-only experiment is not the final implementation. Last scalar-slot reuse
and an opt-in counter addition received focused regression checks; they do not
change collision decisions or supply a new FPS claim.

Rendered AMD ANGLE/radeonsi gfx1150 hardware checks at **2100x1466** use500ms retained
warm-up followed by approximately2500ms active W driving. Fixed-load-random runs
have the same initial16-body hash (`3376258c...09b26`), but post-warm-up fingerprints
and evolving timed states differ:

| Capture mode                              | Baseline FPS | Candidate FPS | Baseline / candidate p95 frame, ms | Skipped physics, ms |
| ----------------------------------------- | -----------: | ------------: | ---------------------------------: | ------------------: |
| Instrumented tick/pair capture            |         4.48 |         20.27 |                        334.3 /97.7 |             560 /40 |
| Bare RAF sampler, candidate then baseline |        17.85 |         15.96 |                       101.2 /121.6 |                0 /0 |

Instrumented mean physics ticks are46.33ms baseline and26.53ms candidate, with57
versus63 actual ticks. The candidate contact tree rebuilds6 times during the
longer evolving scene, rather than per collection. These are mixed observations,
**not an established overall FPS improvement**; no percentage speedup is claimed.
The bare check also does not eliminate performance regression risk. PERF-13
remains open, and PERF-22 owns repeated rediscovery. Keep playtesting this checkpoint.

Console, request/response and WebGL diagnostics are clean for rendered captures.
Chrome DevTools MCP is unavailable; the existing hardware Chromium was accessed
through Playwright CDP in isolated contexts. Existing game tabs were not used for
measurements. Reports/screenshots remain ignored under `artifacts/perf21-*` and
`artifacts/perf21/`; original assets are read-only.

Reproduce the bounded whole-tick comparison with separate source checkouts:

```sh
node --import tsx tools/compare-collision-structures.mjs /path/to/baseline
```

It reconstructs original Eagle3/cerby cars on explicitly synthetic finite floor/
wall geometry, including real SPAM-created parts, in serial ABBA order. Each pass
executes four 40 ms physics ticks; setup and fingerprinting are outside timings.
Setup, every intermediate physics-state hash and final contacts/damage/hulls must
match exactly. Cold/JIT/GC and adverse samples remain in the report. This is a
bounded physics comparison, not a Timber replay or sustained FPS benchmark.

For short hardware rendering checks use `tools/validate-performance-routes.mjs`
against separate production ports. `PERF_ROUTE_FIXED_LOAD_RANDOM=1` uses a fixed
benchmark-only Math.random input while loadRace selects opponents, then restores
normal seeded draws. Compare actual initial body hashes rather than assuming a
seed guarantees identical asynchronous loading. Timed warm-up and evolving AI
states remain nondeterministic; preserve clocks and post-warm-up fingerprints.
`PERF_ROUTE_BARE=1` removes engine method probes for the active FPS sample.
