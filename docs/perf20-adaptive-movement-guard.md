# PERF-20: motion-certified pair guarding

## Change and scope

The final body-pair guard now uses **whole-motion separating-plane certificates**
and **continuous SAT for fixed-orientation translation** before its previous
sampled fallback. These are independent geometric algorithms, not copied
third-party source. Native impulse/friction equations, contact emitters, damage,
40ms timing, retry limits and world collision remain unchanged.

This implements the selected movement-guard checkpoint. It does **not** close
PERF-13 or claim the damaged-scene FPS problem is solved. PERF-21 owns persistent
collision data and PERF-22 owns redundant discovery; those are separate next tasks.

## Motion certificates

For a captured free body, each point is
`x(f) = C0 + delta*f + Q(f)*(q-COM)`. A source-owned envelope bounds rotation
relative to OLD using angular momentum divided by minimum principal inertia.
For radius R and maximum OLD-relative angle theta, rotational point displacement
is at most `2*R*sin(min(theta,pi)/2)`.

For a normalized separating direction n, start gap g, relative COM translation d,
and total rotational/COM error e, the entire phase is clear if
`g + min(0,n.dot(d)) > e + numericalPadding`. Cached OLD AABBs supply cheap world
axis witnesses; old hull face normals and a center direction provide additional
witnesses. Failure is unknown and retains detailed testing, not a collision claim.
This eliminates intermediate hull transforms and SAT/feature sweeps for certified
cells even if their broadphase radius bounds overlap.

Ball/hinge children inherit parent COM translation. Their error allowance includes
parent error, the OLD parent/child anchor mismatch, and both rotating COM-anchor
lever bounds. This encloses the finite anchor correction at every positive time.
Hinge envelopes include native quantization error and propagate ancestor error.
Translation joints and their affected descendants do not supply this certificate.

Native `advanceRigidBody(f*dt)` changes quantized branches and substep counts;
`angularTravel * intervalWidth` is **not** treated as a local Lipschitz bound.
Clipped paths scale COM translation but retain full global angle/error allowances.
Both source producers match the integrator's sequential multiplication at the
SMALL_ROTATION gate; replacing `omegaSquared*dt*dt` with `omegaSquared*dt**2`
misclassifies a real threshold fixture. Below that source gate, the captured
free path has exactly constant orientation and can use continuous SAT.

For certified translation, intersect the strict temporal overlap inequalities
on face normals and edge-cross axes. Their earliest common interval supplies
the safe movement prefix. This detects thin complete crossings with clear ends
without uniform temporal samples. Native OLD-overlap admissions remain per hull
cell. Unknown/custom, unsupported joint, wire and analytic sphere paths retain
existing behavior; unproven rotating near-contact cells retain sampled CCD.

## Validation

- Production TypeScript/build passes in the isolated checkout and repository.
- Full isolated suite: **3000 passed, 5 skipped** because private captures were
  initially absent. The five optional capture cases were then supplied and
  passed in focused captured/shallow suites (17 and 6 tests, no skips).
- New numerical suites: 10 continuous-SAT tests and 22 producer/integration tests.
  Coverage includes thin/head-on/oblique crossings, grazing/separating touches,
  compact vertices, moving/rotating COM offsets, full turns, signed hinge motion,
  anchor jumps, nested parent levers, unequal prefix coupling, mutable-property
  invalidation and the native rotational threshold arithmetic fixture.
- Existing four-car Stock/Advanced Chromium core crash/damage/repair matrix and
  captured forward/reverse/remove-part/repair lockup regression pass. No console,
  asset-request or WebGL errors; impact screenshots inspected. These functional
  browser suites use SwiftShader, not hardware performance measurements.
- The existing sampled fallback already misses a synthetic instantaneous joint
  teleport entirely across an obstacle. This checkpoint encloses the jump before
  certifying clearance; it does not claim to repair that existing fallback gap.

## Controlled work comparison

`tools/compare-movement-guards.mjs` reconstructs the same private original-asset
fixture from the seeded initial snapshot: 16 bodies, actual hulls, 9 moving source
bodies. Four serial ABBA phases rebuild independent states. This is a **partial
pair-guard phase**, omitting world/forces/contact callbacks and metadata not
recorded by the fixture; it is not a full crash replay.

Accepted fractions match exactly in all compared phases. With captured source
velocities, hull transforms fall **221 to16** and the new path requires **zero
sampled intervals**. Stationary transforms remain16. Final ABBA guard times:

| Workload                  | Baseline A1 / A2, ms | Candidate B1 / B2, ms |
| ------------------------- | -------------------: | --------------------: |
| Stationary captured poses |         33.97 /20.24 |           16.21 /2.50 |
| Captured velocities       |           9.43 /6.68 |       **23.56** /3.56 |

Cold/JIT/shared-host variance is large; the candidate's adverse23.56ms sample is
retained. Work counts demonstrate the structural reduction; these timings do
not establish a constant speedup or a hardware FPS prediction.

## Rendered hardware observations

Short serial AMD ANGLE/radeonsi gfx1150 captures at **2100x1466**, requested2500ms
active windows after a separately retained500ms warm-up, normal W input and AI:

| Sample          | Initial fixture |      FPS | Mean / p95 tick CPU, ms | Executed ticks | Skipped ms |
| --------------- | --------------- | -------: | ----------------------: | -------------: | ---------: |
| Baseline first  | A               |    15.96 |             26.07 /53.4 |             63 |         40 |
| Early candidate | A               | **8.97** |             32.06 /58.2 |             62 |        160 |
| Final candidate | B               |     7.37 |             36.87 /89.8 |             58 |        360 |
| Baseline repeat | A               | **4.93** |             46.51 /82.4 |             55 |        640 |

Fixture A starts with16 bodies (Eagle/Vlad/Buggy); B starts with17
(Eagle/Razorback/Buzz). The first baseline and early candidate initial body hashes
match, but their wall-clock warm-ups/capture states do not. Shared native RNG use
during asynchronous loading also means a seed alone does not guarantee identical
opponents: the new tool records fingerprints rather than assuming equivalence.
The later baseline reproduces the severe slowdown, so neither claim that this
checkpoint fixes it nor attributing all observed variation to the host is justified.

The final candidate records3773 whole-phase clearance certificates for4467 hull
checks and36985 hull transforms, versus92175 transforms in the first baseline;
these are different evolving workloads, not an exact A/B reduction claim. The
controlled partial-phase work comparison above is the exact-input evidence.
No overall FPS gain is established. All rendered captures have clean page,
request/response and WebGL diagnostics. Chrome DevTools MCP was unavailable;
the existing controlled hardware Chromium was accessed through Playwright CDP.

## Reproduction and retained evidence

Use `tools/validate-performance-routes.mjs` against separate baseline/candidate
production servers with `PERF_ROUTE_SEED=20201016`,
`PERF_ROUTE_CASE=timber-damaged-grid`, `PERF_ROUTE_PAIR_DIAGNOSTICS=1` and distinct
`PERF_ROUTE_OUTPUT` paths. Compare `initialFixture.bodiesSha256` and retain warm-up,
clock, RNG, post-warm-up fingerprint and adverse data. No sustained simulation
or parallel performance captures are required.

For the partial-phase comparison, keep a source-only checkout of the preceding
engine and point `PERF_GUARD_BASELINE_ROOT` and `PERF_GUARD_ROOT` to the two roots:

```sh
PERF_GUARD_BASELINE_ROOT=/tmp/carma-perf20-baseline PERF_GUARD_ROOT=. node --import tsx tools/compare-movement-guards.mjs artifacts/perf20-seeded-before.json
```

Private reports remain ignored: `artifacts/perf20-*`, including the seeded route
captures, partial-phase ABBA JSON, test logs and browser reports. Original assets
are read-only. Experiments ran in a source-only isolated copy to avoid repeated
Vite reloads of the user's tab. A diagnostic state was saved before final source
integration; normal dev-server hot reload may reset that tab on integration.

References: [algorithm comparison](physics-algorithm-comparison.md),
[PERF-13 residual](perf13-integration-check.md),
[continuous collision literature](https://box2d.org/files/ErinCatto_ContinuousCollision_GDC2013.pdf).
The implementation uses complete-phase bounds and analytic translation rather
than assuming that generic smooth-motion conservative advancement applies to
C2's quantized candidate evaluator.
