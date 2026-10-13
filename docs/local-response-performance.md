# Local collision response orchestration (PERF-15)

## Result and scope

`VehicleSimulation.step` now traverses stable physical-root OLD-X order and
persistent geometry/joint response rings. It replaces eight global correction
rounds with bounded local reintegration/discovery/response. The native40ms step
and five-tick catch-up window remain unchanged. This is a structural physics
checkpoint, not closure of PERF-01 or proof of steady60FPS on the user's route.

`BodyBroadphase.pairs` can query an incident set against the complete current
roster, including lower-index unchanged neighbors. Fixed-provider edits trigger
conservative traversal restart. Geometry joins before lambda; newly reached
members' supports are collected before the coupled solve. Mutation barriers
reject stale rows after activation, registration, removal, shape/COM changes,
smash/split and attachment changes. Removed bodies cannot become apparent
external anchors. Active authored joint limits can initiate response; bilateral
anchor/hinge residuals alone cannot. Reintegration replaces NEXT from OLD and
never advances the simulation clock during a retry.

Accepted normal impacts append copied OLD-local lever/normal records to one
50-entry deferred friction pool across retries. Normal motion/gyro and guarded
poses commit first, then friction reads the accepted candidate orientation;
quiet processing follows friction. Friction does not reintegrate poses. Removed
registered bodies are filtered at flush. Default standalone contact helpers
retain immediate friction for independent callers; production uses the pool.

Angular CCD supplies directions absent from native endpoint rows, even when a
floor already supports the vehicle. Collection restores the full normal-motion
candidate before pair discovery; only final CCD commitment applies safe-prefix
clipping. Existing crush, split, repair, audio/effect and outer-frame ownership
remain production paths.

## Evidence and explicit adaptations

Installed HW addresses and source distinctions are recorded in
[c2-physics-re.md](c2-physics-re.md#local-collision-traversal-and-deferred-friction-perf-15).
The native three-report gate counts **solver failure status**, not three
successful impacts. Browser active-set solving has no equivalent reported status
and does not invent one. The30 allowance is per seed for the entire tick;
collection invalidations consume it. Eager ring closure, exact zero-response
termination, fixed/world-wide conservative restart and final CCD are explicit
browser adaptations. Exceptional joint/PHIL metadata, source saved-next ring
ordering and native friction filter byte+1dd remain incomplete.

Default world collection has explicit ACT-pull/StopGroovidelic mutation epochs;
unchanged epochs avoid whole-roster input rescans. Custom collectors retain full
inspection. Empty-input preparation can skip a scan; nonempty input filtered to
empty cannot. Producer-branded deeply frozen, immovable NONCAR hulls have
allocation-free exact scalar/identity input checks. Mutable hulls, analytic
shapes and activation retain full certification. Dormant joints are excluded
from the active roster and recertified on wake.

This does not certify arbitrary unversioned world side effects. Custom adapters
that mutate another previously visited component must explicitly invalidate the
world/face cache. Live queries prevent stale result caching but do not by
themselves schedule revisitation. Pure profiling wrappers explicitly identify
their underlying collection provider and restore owned descriptors on exit.

## Partial captured Cerby replay

The saved483-body snapshot contains17 movable bodies. One serial CPU-only
comparison uses the five-body Cerby cluster and the actual incident collector,
normal/joint solver, hierarchy motion and body commitment guard. It is a paused
**post-tick partial replay**, with world geometry, force preparation, damage,
PHIL and preceding-frame callbacks omitted. World visits are counted empty
placeholder calls, not actual triangle queries.

| Work                      | Eight global rounds | Local response |
| ------------------------- | ------------------: | -------------: |
| Response solves           |                   8 |              2 |
| Pair collections          |            8 global |    16 incident |
| World-placeholder visits  |               3,864 |             27 |
| Unrelated movable visits  |                  96 |             12 |
| Pair tests                |                  72 |             28 |
| Accepted positive normals |                  12 |              3 |
| Nonzero joint impulses    |                  72 |             18 |
| Cached bounds accesses    |               3,262 |          6,990 |

All five Cerby bodies commit fraction1, move0.168–0.213m and retain anchor error
<=5.6e-17. Deferred friction queues/applies3 records. Intentional chronology
changes produce <=2.99mm position, .0301m/s velocity and .764rad/s omega differences;
old eight-pass equality is not an acceptance target. Cold observer times139.9/
42.4ms are not full-tick or hardware performance claims. Increased bounds work
remains visible and is not hidden by the reduced world visitation count.

Reproduce locally: `node --import tsx tools/replay-local-responses.mjs`.
The ignored report is `artifacts/perf15-captured-local-responses.json`.

## Whole-tick and whole-updateFrame hardware captures

Source-only baseline `3549edf`, no assets copied, same original Stock/Advanced
Timber fixture seed0x50455246 and equal initial rigid/damage/attachment state.
Two manual ticks, one additional whole40ms `updateFrame`, then a bounded250ms
normal-AI frame window with drawing suppressed. Actual backend AMD ANGLE/radeonsi
gfx1150/OpenGL4.6; drawing buffer2100x1466. These are CPU timing observations on
shared hardware, not rendered FPS or exact replay of the user's preceding frame.
Actual ticks per update are recorded; catch-up time is not inferred from nominal
frame count. Outcomes intentionally differ under native response/friction order.

| Final comparison                                    |     Baseline |             Local |
| --------------------------------------------------- | -----------: | ----------------: |
| Stock manual first/second tick (ms)                 | 281.2 / 65.9 | 204.6 / **182.2** |
| Stock whole40ms update CPU (ms)                     |         58.3 |              41.6 |
| Stock frame-window whole-update p95/max CPU (ms)    |        347.3 |             208.6 |
| Stock actual frame-window tick p50 / max (ms)       |  74.4 / 91.5 |       48.5 / 71.6 |
| Advanced manual first/second tick (ms)              | 179.3 / 75.9 | **259.4 / 152.1** |
| Advanced whole40ms update CPU (ms)                  |         61.4 |          **76.4** |
| Advanced frame-window whole-update p95/max CPU (ms) |        151.7 |         **335.2** |
| Advanced actual frame-window tick p50 / max (ms)    | 52.9 / 105.0 |  **77.2 / 125.0** |

The results are mixed; Advanced regresses in this short capture. Keep those
samples. Source-correct local retries can do more actual solves than the old
arbitrary eight-pass limit. In the first heavy tick, Stock world-guard dispatches
fall from4,320 to590 (Advanced4,356 to598), but Stock body collections rise10→31
(Advanced10→35), and computed world sweeps64→121 (Advanced72→128). Incident
collection still validates the full static roster and builds moving discovery
bounds. Fewer dispatched calls do not imply proportionally lower CPU cost.

The earlier first implementation regressed Stock146→303ms. CPU attribution
identified repeated whole-roster input walks as a major added cost; native
bilateral zero-contact gating, fixed input certificates and explicit collection
mutation barriers cut that work. Retain all adverse attempts under ignored
`artifacts/perf15-*hardware*.json` and `perf15-stock-attribution*.cpuprofile`.
The final comparisons are `perf15-stock-optimized-hardware.json` and
`perf15-advanced-optimized-hardware.json`. PERF-13/PERF-01 still own actual-route
frame tails, remaining collection costs and attribution; this ticket does not
assert the original <=4FPS problem is fully resolved.

Reproduce serially with loopback source baseline/workspace servers:
`node tools/profile-guard-kernel.mjs --hardware --samples 2 --root data --allow-motion-changes --output artifacts/perf15-stock.json`
(or `--root adv_data`). Never run this alongside another stress/profiling job.

## Validation

The complete suite passes **2,837** tests; production build, Stock/Advanced browser
smoke, four-case crash matrix (crush/wastage/split/multiple linked parts) and
Eagle/Cerby contained-part admission/repair regressions pass. DevTools on the
hardware page verifies keyboard driving, an actual original Timber cave-wall
impact producing engine99/driver80 damage and wastage, and no console/WebGL
errors through that capture. The subsequent DevTools repair evaluation and
health query stalled at the tool boundary; they are not counted as passed.
Production Chromium repair checks pass independently. Captures remain ignored.

The Stock/Advanced smash-followup regression also passes through Carrier mission
completion with no console/request/WebGL errors. Its original hardcoded PHIL
slot suffix no longer identifies the Core reliably; the test now verifies the
actual authored `&CORE.ACT` model under the selected retained actor and the
source trigger binding. All mission-variable, native selection, side-effect and
completion assertions remain. A preexisting field called
`worldSmashOriginalIdentifier` may already contain an encoded runtime alias, so
it is not used as proof of the unrenamed source model.
Focused tests cover incident discovery, mutation/removal, OLD-X roots, joint limit
admission, retry bounds, deferred queue order/cap/candidate-frame friction,
original Eagle/Cerby damage+repair, rotating finite world impact and fresh
third-body admission with momentum conservation. Old cache-on/off numerical
conformance remains required for the new algorithm. Original data stays read-only;
snapshots, converted data and browser captures stay ignored.
