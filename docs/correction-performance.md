# Correction-pass reuse (PERF-12)

PERF-12 / TASK-100.7, compared with accepted engine `a3b27d0`.

## Implementation

Each physics tick owns a new `CorrectionWorkingSet` contact/world context.
Ordered body pairs reuse their **raw, unsolved** contact rows only when both
body certificates match. Empty results also retain and replay overlap evidence.
Returned points, normals and rows are copied before contact preparation or the
solver can mutate them. Masks, direct-joint exclusions, source ordering, native
callbacks, solving, damage and restart processing still execute normally.

Certificates check exact OLD/NEXT pose values, linear/angular velocity, mass,
inertia, COM, recovery flags, filters, suppression flags and attachment ancestry.
Shape checks include source identities and unversioned vertex, plane, face-index,
edge, compact-order and analytic-shape values. Impulses, crush, splits, activation
and attachment changes therefore invalidate affected work immediately; unchanged
unrelated bodies do not inherit another group's invalidation.

OLD and NEXT transformed hulls are retained independently. Weak geometry and
certificate storage can survive ticks, with exact validation on every admission;
pair rows, world results and safe fractions never survive a tick. Shape object
identity checks matter because transformed hulls borrow source feature arrays.
Repair/reset and replacement models are checked by the same rules.

Immovable polygonal noncars first get an exact swept aggregate box. Vertex values,
compact order and both poses are checked before broadphase discovery, so changing
an unrelated prop can introduce a new pair. Full shape certification and geometry
are deferred until a pair survives spatial, mask and joint filtering. Faces and
edges do not affect this aggregate box, but remain checked before narrow phase.
Native sphere bounds retain their analytic path. No assumed immutability replaces
the source-value checks.

Only the **pure static trajectory guard** reuses world results. Its certificate
includes body state, refinement mode and an explicit world revision, bumped on
rebuild, owner invalidation and dynamic admission/removal. Wall-friction edits are
also checked. Moving-world actors, world colliders, overridden query/modifier
providers and uncertified worlds keep the live path. Native face-ring collection
and side-effect callbacks are never memoized. Cache hits restore the original
candidate endpoint writes as well as contacts/fractions. Final independent
body-pair commitment and joint projection use fresh path/coupling contexts.

The 40 ms timestep, eight correction passes, 30 restart limit, angular sampling,
refinement and catch-up limits are unchanged. This optimizes existing behavior;
it does not claim new original-game physics fidelity.

## Bounded Chromium evidence

The source-only probe reconstructs a diagnostic Timber state: original Eagle,
seven parts admitted through ordinary detachment gates, an original `TEZFEN`
texture-change contact below the first destruction threshold, and angular/rival
positions taken from the earlier investigation. Five detached model assignments
match the recorded model names; two use other normally admitted parts. Rival
identity mismatches use reported deterministic-order assignments. This is a
contact-rich **reconstruction**, not an exact replay of the user's canyon route.
Stock/Advanced populations contain 480/484 bodies, including 466 noncars and
7/11 active cars; no population, activation or safeguard limit is reduced.

Race loading is held before simulation starts. Opponent selection uses a separate
seeded random stream so cold UUID/model allocation cannot change the initial
opponents. A pure collection warms retained geometry without advancing the clock.
Both modes then run two manual ticks plus a separate 250 ms normal-AI frame
sample with drawing suppressed. Samples are serial and have a two-second measured
case cap. Actual backend: **SwiftShader**, 1280×800 drawing buffer, DPR 1.
These are CPU diagnostics, not hardware-rendered FPS benchmarks.

Final traced A/B results match exactly for initial state, ordered impacts,
kinematics, hull hashes, damage/structural revisions, attachment state and every
guard fraction. Both traverse eight correction passes and ten body collections
(including restart work). The collection calls themselves remain live.

| Work per first heavy tick | Stock off → on | Advanced off → on |
| --- | --- | --- |
| Body hull transformations | 298 → 95 | 370 → 93 |
| Pair emitters computed | 109 → 87 | 109 → 78 |
| Static-world guard collections computed | 135 → 78 | 171 → 82 |
| World-guard hull transformations | 660 → 401 | 754 → 409 |

Traced first-tick CPU times were 169.5→112.9 ms stock and 62.2→58.8 ms Advanced.
Traced frame maxima were 175.6→131.7 ms stock and **65.4→81.1 ms Advanced**;
the adverse Advanced frame sample is retained.

Separate minimally instrumented ABBA first-heavy-tick samples, in off/on/on/off
order:

| Capture | Four first-heavy-tick times (ms) |
| --- | --- |
| Stock | 145.3 / 103.5 / 103.7 / 70.8 |
| Advanced | 126.4 / 117.1 / 159.9 / 199.5 |

The corresponding 250 ms CPU-only frame samples retain this full distribution:

| Capture | Mode | Frames | Frame p50 / p95 / max (ms) | Tick p50 / p95 / max (ms) |
| --- | --- | --- | --- | --- |
| Stock | off | 16 | 24.4 / 239.3 / 239.3 | 37.9 / 71.2 / 71.2 |
| Stock | on | 15 | 44.6 / 197.7 / 197.7 | 40.0 / 89.2 / 89.2 |
| Advanced | off | 11 | 59.3 / 361.4 / 361.4 | 74.1 / 100.3 / 100.3 |
| Advanced | on | 11 | 35.8 / 282.6 / 282.6 | 63.0 / 87.7 / 87.7 |

Heavy-tick maxima and these frame maxima improve, but several medians and stock
frame-tick tails worsen. Small samples, JIT/GC and shared-workstation load make
elapsed gains less stable than the exact work reductions. PERF-01 remains open
for exact route attribution and residual stalls; no steady-FPS guarantee follows.
Early attempts that eagerly certified every dormant shape regressed; deferring
full geometry until spatial admission removed that unnecessary work. Earlier
captures with different initial opponents are rejected as comparisons, separately
from application failures.

## Reproduction and validation

```sh
npm run dev
# In another terminal; run serially, not concurrently:
node tools/profile-corrections.mjs --url http://127.0.0.1:5173
node tools/profile-corrections.mjs --url http://127.0.0.1:5173 --trace-off \
  --output artifacts/perf12-minimal-corrections.json
```

`--samples 1` checks the fixture; `--samples 2` performs a short A/B; the default
four samples use ABBA. `simulation.correctionReuse` is an opt-in diagnostic
bypass, defaulting to true. `correctionDiagnostics` is unset in normal gameplay.
Tools are not imported by the application or included in production bundles.
Original assets remain read-only, served locally and unbundled. Ignored reports:
`artifacts/perf12-final-traced.json`, `artifacts/perf12-minimal-corrections.json`.

Twenty-one focused tests cover exact invalidation, compact bounds, empty overlap
replay, provider fallback, mutable-row isolation and per-tick result separation.
Actual Eagle/Buggy/Bigdump differential scenarios compare initial and iterative
ordered emissions, fractions/endpoints, physical/crush vertices, a full rotation,
road/wall and car/car/prop contacts, immediate source split restart, joints and
full repair/reset plus subsequent cleanup. Moving-world/provider mutation paths
remain live. Fifteen original crash reports match the accepted baseline exactly.

The final full suite passes **2,698 tests**, with no failures or skips; the
production build passes. Production Chrome DevTools MCP runs on AMD Radeon
hardware (radeonsi gfx1150), at 2101×1468, DPR 1.484375. Actual keyboard driving
advances the vehicle; controlled car impacts produce accepted impulses, cumulative
visible deformation, component damage, a physical detached part and rival
wastage. Repair/reset removes the debris and restores component damage to zero.
The final page has no console errors, failed asset requests or WebGL errors;
screenshots were inspected and kept under ignored `artifacts/perf12-production-*`.
Serial production Chromium regressions also pass: supported grid/spawn and
interlock release, four original-track noncar/debris/joint/repair cases,
Eagle/Bigdump camera framing and clipping, and Stock/Advanced render matrices.

An initial diagnostic dispatched a synthetic key to `Window`, giving its handler
an invalid event target; this harness error was discarded and repeated on a fresh
production page with a normal element target. MCP rejected the requested custom
screenshot path, so its default temporary screenshots were inspected and copied
into ignored artifacts. Neither tool issue is reported as an engine regression.
