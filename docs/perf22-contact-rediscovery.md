# PERF-22: change-driven contact rediscovery

## Implementation and validity

This is browser-engine infrastructure, not a new C2 force/damage formula.
The original feature ordering, 40 ms step, retry budgets, normal/friction
solver, positive-impact callbacks and damage/repair paths remain active.

- A tick-owned candidate adjacency retains broadphase discoveries. Every roster
  slot's identity, mobility and certified OLD/NEXT shape/pose version is checked
  before incident filtering. Changed sources query the complete roster, including
  unchanged third bodies. Roster edits rebuild discovery; exact original slot
  order, duplicate identities and exceptional bounds remain supported.
- Expanding a response ring excludes pairs already collected in that particular
  collection. The exclusion resets before another response or mutation restart.
  Custom preparation retains the former discovery path. This is not suppression
  of zero/positive impulses or a persistent solved manifold.
- Raw pair-feature results use geometry-only certificates for ordinary CCD.
  OLD-overlap recovery additionally checks both bodies' velocities, angular
  velocities, COMs and attachment ancestry. Mass/friction and solver output flags
  no longer force a pure geometric query to repeat. Filtering and preparation
  remain live; fresh mutable rows go to every solve.
- Even when a real response invalidates full CCD output, OLD target-local vertex
  arrays and inside flags remain reusable. Transformed OLD hull identities certify
  their shape/pose; NEXT, clipping, moving edges, normals and root selection remain
  live. A separate OLD recovery record retains ordered edge intersections and
  center-facing normals, while the native HW `0x427f20` positive-closing-speed and
  attachment gates run again. Source/OLD-pose changes replace the retained hulls;
  six exact aggregate-center scalars additionally certify recovery. Both caches
  expire with the tick and bypass unknown shape providers.
- Raw static world emission is cached only **after** live native face-ring access,
  collection callbacks and filtering. Exact post-collection surface values, body
  endpoint geometry, recovery and COM certify reuse. Moving-owner faces and custom
  collectors remain live. Empty overlap evidence replays; solved rows never persist.
- Polygon angular guards may use a certified ownerless surface revision even when
  unrelated moving scenery exists: this guard already discards every owner-tagged
  surface. Activation/removal, ACT/static edits, material friction or unknown query
  providers invalidate it. Sphere guards retain their previous fallback policy.

Bounds discovery is still O(N) validation plus changed-source BVH queries and true
candidate output. Dense intersections still have quadratic output/edge work.
This checkpoint does not eliminate physically necessary response retries or
angular guard sampling.

## Diagnostics

Opt-in root/ring traces record seed, batch, ring size, attempt, changed bodies,
positive normal/joint response, rejection and world/roster mutation.
`pairDiscoveryHits` counts discovery calls needing no tree query;
`pairRowsExcluded` counts collection-local duplicate pair work.
`pairFeatureTests/Hits`, `pairOldGeometryTests/Hits` and
`pairRecoveryGeometryTests/Hits` distinguish whole-feature reuse from OLD-only
reuse. Native world misses report primary geometry/recovery/face causes; moving
or unknown providers are counted separately. These counters do not measure every
hull transform: compare timings and exact physical state as well.

## Validation and measurements

Measured against `e2f447e`, using original local data without modifying it.
Chrome DevTools MCP was unavailable; Playwright CDP accessed isolated contexts
in the existing hardware Chromium, leaving the user's paused tab unused.
AMD ANGLE/radeonsi gfx1150, LLVM 19.1.7, drawing buffer **2100 x 1466**.

The deterministic browser harness executes four direct physics ticks per pass,
in serial ABBA order. Every initial fixture and intermediate physical-state hash
must match; elapsed physics advances 160 ms in every pass. It intentionally does
not advance the asynchronous AI/render game clock and is not an original replay.
The captured ten-body case reconstructs recorded poses, source WAM parts and
joints, not the complete historical application state.

The integrated numerical/original-data suite passes **3056 tests, zero skips**.
Production build and formatting checks pass. New tests cover retained discovery
and nonincident changes, callback/positive-stress replay, face-ring overwrite,
mutable surface/recovery invalidation, OLD geometry with changing NEXT/velocity/
COM/attachments, source/OLD mutation, deep-frozen cached vectors and tick expiry.
The final four-car Stock/Advanced Chromium core crash matrix passes deformation,
detachment, severe damage, reverse driving and repair with no console, failed
request or WebGL errors. These functional crash checks use SwiftShader; rendered performance observations
use actual AMD hardware. The captured loose-part interlock browser
regression also passes forward/reverse driving, part removal and repair.

Initial damaged-grid results (before the OLD-only cache refinement): 66 contact
collections remain 66; BVH bounds tests fall 372 to216, with60 of66 discoveries
reused. Actual full pair emissions fall62 to36; the two positive normal responses
and four deferred-friction applications are unchanged. Native world emission has
no hits in that short fixture; angular guard work remains unchanged. The captured
pile has17 normal and8 joint response solves, identically in both variants.

Final captured-pile ABBA measurement after OLD CCD reuse: every initial and
intermediate tick hash matches. Of42 remaining full pair emissions, **25 reuse
OLD vertex/inside classification**, leaving17 actual OLD classifications. The
17 normal and8 joint response solves,103 angular-world collections,945 guard
hull transforms and160 ms physics advancement are unchanged. Native static world
emission reuses2 of71 attempts; this is a small saving, not the dominant one.
Recovery-only geometry is exercised by conformance tests, not by this capture's
false prior-overlap flags.

| Four-tick captured pile     |     Baseline |    Candidate |
| --------------------------- | -----------: | -----------: |
| All ticks, median ms        |        49.25 |        27.45 |
| All ticks, mean ms          |        70.80 |        52.19 |
| First tick per pass, ms     | 126.3 /195.6 | 147.2 /113.6 |
| Subsequent ticks, median ms |        35.05 |        25.30 |

Cold/JIT/adverse samples remain included. This is evidence of reduced physics
work and better tick times in this fixture, not a general44% FPS improvement.

Bare rendered driving observations, 500 ms retained warm-up and approximately
2500 ms W input per capture, before the final OLD-only refinement:

| Serial order | Version   |   FPS | p95 frame, ms | Skipped physics, ms |
| ------------ | --------- | ----: | ------------: | ------------------: |
| A            | Baseline  | 14.17 |         194.3 |                   0 |
| B            | Candidate | 19.72 |         119.4 |                  40 |
| B            | Candidate | 14.46 |         181.1 |                 120 |
| A            | Baseline  | 16.77 |         134.0 |                   0 |

The initial body hashes match, but timed warm-up, evolving AI and later poses
vary. These mixed samples **do not establish an overall FPS improvement**; keep
both favorable and adverse results. No tick/substep budget or skip policy was
changed. PERF-13 retains scene-level stall acceptance.

A separate final headless original-car comparison retains a contrary result:
intact sparse tick medians2.01 to1.80 ms, dense damaged3-car medians15.40 to17.37 ms.
Every tick hash matches. The captured rendered-world improvement therefore must
not be generalized to all fixtures.

An experimental artificial six-car deep-overlap fixture exceeded its useful
workstation budget and was terminated without a result. It is not included in
timing claims or shipped as a default benchmark. Initial headless damaged-fixture
samples were also mixed/slower; fewer queries alone are not proof of faster frames.

Reproduce a bounded comparison with separate baseline/candidate production ports:

```sh
BASELINE_URL=http://localhost:5222 CANDIDATE_URL=http://localhost:5221 \
  node tools/compare-rendered-physics.mjs
# Optional ignored local capture; never commit it:
PERF22_SNAPSHOT=artifacts/perf18-user-interlock.json \
  PERF22_OUTPUT=artifacts/perf22-captured-pile.json \
  node tools/compare-rendered-physics.mjs
```

The script rejects software GPU measurements, records console/network/WebGL
errors and closes only its own contexts. Physics evaluation has a15-second timeout.
Reports and screenshots remain ignored under `artifacts/`.
