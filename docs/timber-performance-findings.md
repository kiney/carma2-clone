# Timber! structural performance findings

PERF-01 / TASK-100, 2026-10-12. Engine baseline: `59e6d8f`.
**Investigation only: no production implementation or physics tuning.**

## Executive Summary

A controlled, already damaged Timber! session reaches **approximately 4 FPS
with 3D draw submission suppressed**. The critical path is CPU physics, including
global body-pair discovery, repeated trajectory guards and correction passes.
The tick exceeds its native 40 ms interval; subsequent frames run several ticks,
making each displayed frame substantially more expensive.

The main structural opportunity is to operate on **spatially relevant pairs and
changed geometry**, rather than repeatedly rediscovering and transforming the
whole track's body population. Further SAT tuning addresses a much smaller share
of this workload than in the earlier Snow profile. These are proposed directions,
not implemented fixes or promised FPS multipliers.

The specific reported canyon route is not cleanly isolated. Short drives on the
bridge, quarry rim/floor and low water canyon did not reproduce its extreme cost.
The heavy reproduction includes normal opponents and seven detached Eagle parts;
it establishes an engine mechanism capable of the reported stalls, rather than
proving every canyon slowdown has the same cause.

## Measurement conditions

- Existing production bundle and original Stock `TIMBER2.TXT` / Eagle3 assets,
  served directly from the read-only installation. Six normally controlled
  rivals, 466 noncars and 584 pedestrians. Population/activation changes are
  recorded, not artificially disabled.
- One isolated Chromium instance; short serial captures, paused and with drawing
  suppressed between them. CSS viewport 1414×987, DPR 1.5, buffer 2121×1480,
  four-sample MSAA, 24 reported logical processors on the shared workstation.
- Chrome DevTools MCP stopped responding during page creation/listing. Normal
  X11/forced OpenGL automation also stalled; bounded EGL/Vulkan checks yielded
  no usable WebGL context. The fallback selected **SwiftShader**. Its rendering
  FPS/GPU timings are not hardware benchmarks.
- CPU captures replace only `renderer.render` with a no-op; normal scene
  preparation, camera, HUD, AI, physics and damage continue. CPU profiles and
  detailed wrappers add overhead. The last capture removes those probes and
  retains only tick/frame timers and RAF intervals. It is a subsequent evolving
  state, not a paired estimate of profiler overhead.
- No fatal application errors, failed asset requests or WebGL errors in successful
  captures. A bad diagnostic selector and backend/tool failures are separate
  from application failures. No system packages were needed.

| CPU-only capture                           | Actual wall duration | Ticks | Mean / max tick CPU |
| ------------------------------------------ | -------------------- | ----- | ------------------- |
| Start drive                                | 1.251 s              | 32    | 22.30 / 58.30 ms    |
| Bridge, authored node 4                    | 1.262 s              | 32    | 20.74 / 43.60 ms    |
| Quarry rim, node 178                       | 1.300 s              | 33    | 23.84 / 49.90 ms    |
| Quarry-floor wall approach                 | 1.517 s              | 38    | 20.92 / 52.00 ms    |
| Low water canyon, node 192                 | 1.503 s              | 38    | 19.46 / 51.00 ms    |
| Prepared fence / debris / opponent fixture | 1.602 s              | 26    | 57.52 / 139.50 ms   |
| Later heavy state, minimal instrumentation | 1.511 s              | 30    | 48.73 / 150.30 ms   |

The heavy fixture uses a previously damaged Eagle, an already prepared original
`TEZFEN` tile and initial coasting velocity 0.3 native units/s. It is not an
isolated fresh-car crash test. It produced six displayed frames (3.75 FPS),
frame p50 253.8 ms / max 397.2 ms, and 1517.4 ms in `updateFrame`: approximately
95% of capture wall time. **No world rebuild occurred during this capture.**

The subsequent minimally instrumented state also produced six frames,
**3.97 FPS**, with intervals 204.8–334.3 ms. Its 30 ticks consumed 1462 ms;
the physics time skipped by resynchronization increased by 640 ms. Movable body
count changed from 15 to 16 while total body count remained 480.

## 1. Global pair discovery and repeated geometry — highest measured priority

`collectBodyContacts` enumerates every `i < j` pair and evaluates the mask before
rejecting two immovable bodies (`src/physics/simulation.ts:3638`). The independent
`guardBodyTrajectories` repeats global discovery (`src/physics/pair-guard.ts:342`).

At the beginning of the heavy capture, 480 bodies contain 466 immovable props
and 14 movable bodies:

| Pair population           | Opportunities per complete scan |
| ------------------------- | ------------------------------: |
| All bodies                |                         114,960 |
| Immovable / immovable     |                         108,345 |
| At least one movable body |                           6,615 |

Thus **94.2%** of enumeration opportunities can never create a physical contact.
Directly enumerating movable-involving pairs gives roughly 17 times fewer
opportunities before spatial rejection. This is a work-count comparison, not
a claim of 17 times faster physics. Some props subsequently activate.

The heavy profile's approximately 1426 ms of sampled tick CPU contains:

| Function                                     | Inclusive sampled CPU | Share of tick samples |
| -------------------------------------------- | --------------------: | --------------------: |
| `guardBodyTrajectories`                      |                545 ms |                 38.2% |
| `guardPairTrajectory`, nested above          |                374 ms |                 26.2% |
| `collectBodyContacts`                        |                306 ms |                 21.4% |
| SAT penetration, nested in guards            |                 98 ms |                  6.9% |
| Contact-group solve, including its callbacks |                 28 ms |                  2.0% |

Mask exclusion alone accounts for about 144 ms of self samples across discovery.
**Do not add overlapping inclusive rows.** Bundle symbols were checked against
their bodies: `up` is the body guard, `Ok` the pair guard, `BM` SAT penetration,
`T2` the mask predicate, and `Bl` contact-group resolution for this exact bundle.

Structural candidates:

- Keep sleeping props in a retained spatial index, and discover pairs from
  moving swept bounds. Preserve wake-up/pull behavior and original pair order.
- Use tighter transformed hull bounds for genuinely constant prop paths.
  Currently even immovable props receive isotropic radius bounds expanded by
  twice their local COM distance. Custom/joint-projection paths require their
  own conservative motion bounds; immovability alone is not a universal proof.
- Share a body's transformed hulls across pairs/fractions within one immutable
  guard phase. Current pair-local maps transform the same static prop repeatedly.
  Penetration allowances remain pair-specific. Include crush, split, hull and
  attachment revisions; persistent object-identity caching would be unsafe.
- Preserve same-attachment-root unions separately from spatial rejection.

## 2. Correction passes and tick catch-up amplify the cost

The heavy capture makes 80 body-contact collections in 26 ticks. Its first
three ticks each make nine collections: the initial pass plus eight corrections.
World guards reach 30 angular samples; one tick processes 608 sample intervals.
These passes repeatedly prepare/discover work for the whole body list.

The native window remains 40 ms with up to five ticks per graphical frame
(`src/physics/frame-window.ts`). A tick costing 49–58 ms cannot keep up; several
such ticks consume 200–330 ms before another frame can be presented. This also
explains a mechanism for discontinuous motion when resynchronization skips time.

After indexing/snapshot ownership is sound, reuse unchanged bodies and unrelated
groups between correction passes. Impulses, geometry, activation and joint changes
must invalidate affected results immediately. Reducing pass/tick limits or
disabling safeguards would change behavior, not solve the excessive work.

## 3. Whole-world synchronization and redundant invalidation

Even the ordinary start capture calls `refreshDynamic` 107 times: twice per each
of 32 ticks, plus 43 graphical-frame finishes. It visits all 466 registered props,
updates actor descendants and formats matrix strings before learning whether
anything changed (`src/world.ts:289`). This costs 163 ms in that 1.25 s capture.
Native face collection also checks 1445 actor poses / 1214 meshes, and recomputes
MODEL bounds from raw vertices instead of retaining them by resource revision.

A separate original-material diagnostic proves a stronger invalidation defect:
three below-threshold contacts with the same `TEZFEN` patch advance no damage
tier and enqueue no effects. On the second and third contacts, geometry identity
and position-buffer version remain unchanged, yet `requiresRebuild` is true and
`geometryRevision` increments. Their complete invalidation sequences cost
**15.8 and 24.0 ms**. A new tile genuinely requires preparation; unchanged reuse
must be distinguished from that case.

`record` conflates the native restart notification with browser geometry dirtiness
(`src/world-destruction.ts:598,1206`). Physics responds by rebuilding the entire
static index, invalidating all retained faces and regenerating every dynamic prop's
collision triangles. In this track that affects 17,703 static surfaces plus 9210
dynamic surfaces. Body-contact recollection can repeat this up to the existing
30-restart cap. That amplification is structurally possible, but its full frequency
was not measured in a natural encounter.

Preserve the native restart: installed HW reuse branches at `0x4f2774` /
`0x4f2839` bypass new allocation, and `0x4f2ad5–0x4f2adc` writes the output flag
even when enqueue fails. See [the existing binary evidence](c2-world-smash-queue-re.md).
Separating this notification from actual topology/material/collision revisions,
and invalidating only changed owners, is the proposed direction. The heavy
4-FPS capture has zero rebuilds, so this is an independent defect.

## 4. World candidate locality is weak

The fixed four-unit XZ grid returns triangles from an entire cell and filters Y,
without a per-face XZ bounds test (`src/world.ts:785`). A small diagnostic box at
node 4 returns 203 candidates; only four pass an additional XZ AABB test. At
quarry node 178 the counts are 104 versus four. These are conservative box tests,
not actual collision counts or an implemented safe rejection rule.

An ordered, conservative 3D/spatial face index and retained planes/bounds could
remove substantial feature work. Preserve recovery-ray reach, sweep endpoint
slack, native face order/callbacks and the 300-face ring semantics. The independent
trajectory guard must not inherit that finite cache's emission cap. World sweeps
were small in ordinary captures, so this ranks below measured body-pair costs.

## Rendering, growth and remaining uncertainty

Static render batches span the track per material, limiting culling in enclosed
areas. Timber has 108 batches / 12,275 static triangles; the inspected bridge
view submits 459 calls / 22,158 triangles including the sky. Hardware GPU cost
at the reported canyon/4K pose remains unmeasured. Resolution, occlusion and
visibility policy stay separate; increasing simulation activation would amplify
the current collision scaling problem.

Effects mostly use bounded pools. Detached parts add real persistent bodies;
private MODEL replacements are retained in `nativeScene.resources` without
obvious removal of superseded resources. Long-session heap/resource growth is a
candidate for measurement, not an established leak causing this capture.

Recommended order: spatial body discovery and shared immutable geometry first;
owner-specific synchronization/invalidation next; local face acceleration and
revision-aware correction reuse after that. Keep original C2 impulses, crush,
damage, detachment, wake-up and repair. Web Workers remain the last resort:
moving an over-budget tick does not reduce its computation.

Ignored evidence and local diagnostic scripts: `artifacts/timber-investigation/`.
Reports include all short routes, both heavy captures, numerical counters, CPU
profiles, direct invalidation diagnostics and inspected screenshots. The isolated
diagnostic browser and server are closed after investigation. PERF-01 retains
the unresolved exact canyon/tunnel route; no engine optimization is claimed here.
