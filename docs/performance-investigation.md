# PERF-01: frame-time investigation

2026-10-29 follow-up: [PERF-25 fixed WORLD scenery phases](perf25-world-joint-phase.md)
removes the independently reproduced Fridge Racer cone cycle. Original-level
replay drops from 2,400 responses to 318 over 40 ticks, with normal release and
settling. The user deferred PERF-24 to **P3, backlog** until the extreme-motion
stall occurs again. Its remaining first-event capture and extreme-motion
workload/lifecycle work is inactive; the demonstrated energy source was already
corrected in `bb61b30`. Window-manager/focus cadence is separate.

2026-10-29 subsequent Screwie report: [runaway wreck CPU capture](screwie-runaway-car-stall.md)
establishes a separate genuine physics stall: up to 1.45s per tick and 5.84s per
five-tick update, concentrated in FAIR/bumper world contact collection and
angular world guards. PERF-24 / TASK-129 is now deferred at P3 in `backlog`;
the historical first impulse remains unrecorded. This does not reinterpret
the earlier RAF-only case.

2026-10-29 live update: [browser frame-delivery evidence](live-browser-cadence.md)
separates a reproduced approximately 1FPS RAF cadence from engine CPU work.
Paused 100ms timer callbacks remained timely; activating the browser restored
approximately 60FPS without changing the simulation. Exact Chromium cause is
unknown; the running scene still measures 43–46FPS. This does not resolve earlier
engine stalls. PERF-01 remains user-deferred at **P5, backlog**; status/priority
references in the dated investigation below describe its earlier implementation
phase.

Latest user-paused Timber drop: [live evidence and recorder](live-timber-drop.md).
The isolated post-drop trajectory exposes expensive rotating-part pair guards;
attribution of the preceding full frame remains open. Use the durable live
recorder for subsequent playtests; wrapping world query methods disables
PERF-12 static-guard cache certification.

Status: **initial analysis completed; optimization and exact policy remain open**.
The post-PERF-05 Timber! investigation finds a reproduced CPU-only 4-FPS case,
global pair-discovery/correction amplification and independent redundant world
invalidation. See [structural findings and measurement limits](timber-performance-findings.md).
TASK-100 / PERF-01 remains priority 1, `wip`, for profiling, unresolved spikes and
finding coordination. TASK-104 / PERF-05 physics hot-path optimization is
implemented and validated; see [changes and measurements](physics-performance.md).
Web Workers remain a last resort.
TASK-101 / PERF-02 scene-hierarchy work is implemented and validated; see the
[implementation and measurements](render-hierarchy-performance.md).
TASK-103 / PERF-04 implements [extended visual visibility](visual-visibility.md)
(P2), with separate native activation and headed hardware before/after checks.
TASK-102 / PERF-03 owns resolution policy (P4, `backlog`).
No production engine behavior, resolution, simulation distance or collision
safeguard was changed during the initial analysis phase described below. The
subsequent PERF-02 change reduces render matrix traversal while preserving those
policies and physics behavior.

## Findings

The first hardware captures establish two independent CPU bottlenecks:

1. The sky and main render each update the **entire scene hierarchy**, including
   invisible pedestrian actors. In Snow Way Out this costs approximately 16 ms
   per paused frame before drawing. A paused-only matrix-freezing diagnostic
   reaches approximately 60 FPS, versus 40 FPS at the same settled car/camera pose.
   This is evidence for redundant hierarchy work, not a safe production fix.
2. During the controlled start drive, post-solver body-pair trajectory guarding
   consumes approximately 64% of sampled physics CPU time. Eager SAT axis
   construction alone consumes approximately 50% of physics time. Disabling
   these guards would reintroduce tunneling and interlocked vehicles; retain
   their decisions while investigating redundant calculations.

In the measured native-resolution image the GPU takes approximately 1 ms for
both render passes. Reducing pixel count by 74.5% changes paused FPS from 40.2
to 43.9. Resolution is a real policy gap, but it is not the dominant bottleneck
in this scene. Native 4K and other scenes have not been ruled out as GPU-bound.

The reported **specific tunnel-exit regression is not yet isolated**. A short
controlled route attempt around cave nodes 22→11 included rematerialization,
opponent activation changes and a crash. Its severe CPU stalls are real, but
the screenshots do not establish a clean tunnel-to-open-area passage. Do not
use that attempt as evidence for a tunnel-specific cause or a before/after
optimization result.

## Capture conditions and results

Baseline engine commit: `441358c`. Production bundle, Chromium through Chrome
DevTools MCP, real `ANGLE (AMD, AMD Radeon Graphics (radeonsi gfx1150 LLVM
19.1.7), OpenGL 4.6)`. No CPU/network throttling. CSS viewport 1414×987,
DPR 1.484375, actual buffer 2098×1465 (3.07357 million pixels), 4×MSAA. The host
advertises 24 logical processors and is concurrently used; short samples have
scheduling noise and are not universal FPS predictions. Timing wrappers and
the CPU trace add overhead. Durations below are wall-clock measurements;
nested method times must not be summed.

Each capture lasts 1.5–4 seconds, serially. Rendering is suppressed in the
isolated diagnostic tab between captures; simulation is paused. No continuous
simulation sweep or parallel browser stress jobs were used.

| Original Snow scene / diagnostic                     | Duration | FPS  | Frame p50 / p95 / max  | Relevant CPU cost                                                            |
| ---------------------------------------------------- | -------- | ---- | ---------------------- | ---------------------------------------------------------------------------- |
| Start grid, paused, native buffer                    | 2.01s    | 42.2 | 20.4 / 38.2 / 44.8ms   | Scene matrices 16.0 ms/frame; both render calls 20.6 ms/frame                |
| Settled post-drive pose, paused, native buffer       | 2.04s    | 40.2 | 21.6 / 44.6 / 49.4ms   | Scene matrices 16.5 ms/frame; render 21.3 ms/frame                           |
| Same settled pose, ratio 0.75 (1060×740)             | 2.03s    | 43.9 | 20.0 / 39.0 / 40.9ms   | Scene matrices 15.8 ms/frame; render 20.0 ms/frame                           |
| Same settled pose, paused matrix-freezing diagnostic | 2.01s    | 59.8 | 16.4 / 32.2 / 36.6ms   | Render 5.7 ms/frame; transforms deliberately held fixed                      |
| Start grid, actual W input, CPU trace enabled        | 3.52s    | 7.4  | 94.1 / 378.0 / 388.9ms | 68 physics ticks; mean 39.3 ms/tick, max 118.6 ms; updateFrame mean 107.8 ms |

The separate GPU-timer sample at the settled native-buffer pose measured
mean 1.004 ms, max 1.108 ms across 8 asynchronously completed, non-disjoint queries
spanning both passes. It injects no `gl.finish` or synchronous GPU wait.
GPU time is not included in the CPU method totals. Main-pass draw counts at
that pose are 303 calls / 14257 triangles; the probe totals include the additional
sky draw (304 calls / 14385 triangles). `renderer.info.autoReset` resets per render,
so the current application HUD diagnostics alone describe only the main pass.

The controlled start drive advanced 3080 ms of simulation and skipped 360 ms of
physics time through the existing five-step resynchronization budget. Long
CPU frames can therefore produce both low FPS and visibly discontinuous motion.
This does not show that interpolation itself is wrong.

## Total physics cost and worker feasibility

In the 3519.5 ms start-drive capture, `simulation.updateFrame` consumed 2696.1 ms
across 25 calls: **76.6% of capture wall duration**, averaging 107.8 ms per call.
This includes its frame-final damage/physics callbacks, not just the tick solver.
Its 68 physics ticks consumed 2673.6 ms, averaging **39.3 ms per 40 ms native tick**.
The two render calls per displayed frame consumed 576.9 ms in total (16.4% of
capture wall duration). Their scene-matrix time is nested, not additional.
These are short instrumented shared-host measurements, not universal shares for
every race, a clean steady-state benchmark or a summed CPU utilization chart.
The approximately 64% pair-guard figure is a share of **sampled physics CPU**,
whereas 76.6% uses wall duration; do not confuse their denominators.

TypeScript is compiled to JavaScript and can run in a browser Web Worker; WebAssembly
is not required. Workers execute in a separate global context without direct DOM
access and exchange messages/transferable data with the main thread. See
[MDN: Using Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers).
Live class instances, callback functions and scene identities cannot simply be
sent as an intact engine: structured cloning does not retain prototype chains
and cannot clone functions. See
[MDN: Structured clone](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm).

The current engine is not a drop-in worker module. `VehicleSimulation` updates
car/noncar actor transforms, collects original ACT/MODEL faces with interleaved
pull/StopGroovidelic callbacks, and flushes crush/smash state and gameplay effects.
`WorldCollision` reads live scene transforms and geometry. Moving ownership
requires a deliberate boundary for collision/world state, inputs, poses,
deformed vertices and ordered events, preserving native clocks and callbacks.
Rendering/input/UI/audio can consume results on the main thread, but synchronization,
latency and snapshot costs must be measured before choosing that approach.

A worker could prevent physics from blocking presentation and overlap work with
rendering. It would not reduce the physics algorithm's CPU cost: the measured
39.3 ms tick already nearly fills its 40 ms budget. Optimizing the measured
collision overhead remains useful regardless of threading. This is a feasibility
assessment, not a selected architecture or an implementation claim.

The user's 2026-10-12 direction is **code and algorithm optimization first**,
tracked in TASK-104 / PERF-05. Web Workers remain a **last resort** if residual
measurements after those improvements justify the larger redesign. Worker migration
is not part of the initial implementation scope; any such follow-up needs separate
scope and measured justification. Preserve numerical decisions, native timing,
collision safeguards and damage/crush semantics during optimization.

## Ranked bottlenecks and source evidence

### 1. Repeated hierarchy traversal — verified

`src/main.ts` renders the same scene twice. Three 0.180.0
`WebGLRenderer.render` calls `scene.updateMatrixWorld()` when the scene's
`matrixWorldAutoUpdate` is enabled. `Object3D.updateMatrixWorld` recomposes
auto-updated local matrices and visits all descendants regardless of their
visibility. Visibility pruning happens later in `projectObject`.

The measured Snow scene contains 5804 meshes, of which 738 are visible at the start.
A later census contains 15262 scene nodes; the pedestrian group owns 13618 nodes
and 4908 meshes for 487 pedestrians. Only 22 pedestrians are active near the start.
Hidden population thus accounts for about 89% of that node census. Model clones
remain attached to the scene while inactive. Static track batching already
exists; the issue is not simply one draw per original track mesh.

Candidates, not yet selected: update world matrices once after all visual poses
settle; freeze genuinely static local transforms; manage inactive visual
subtrees or shared rendering without altering pedestrian movement/activation.
Never globally freeze matrices during driving. Check current car/flap/groove,
smash, billboard, effect, camera and picking transforms before accepting changes.

### 2. SAT work inside the pair commit guard — verified

The CPU trace sampled 2586.75 ms inside `updateFrame`, including:

| Source function                                   | Inclusive sampled CPU | Share of physics |
| ------------------------------------------------- | --------------------- | ---------------- |
| `guardBodyTrajectories` (`physics/pair-guard.ts`) | 1658.77ms             | 64.1%            |
| `guardPairTrajectory`                             | 1602.60ms             | 62.0%            |
| `hullPenetration` (`physics/geometry.ts`)         | 1340.61ms             | 51.8%            |
| `axes`                                            | 1298.28ms             | 50.2%            |

The production bundle symbols `dp`, `Tk`, `du`, `L1`, `D1` were checked against
their function bodies: body guard, pair guard, depth, hull penetration, axes.
These symbols apply only to this build; they are not stable API names.

`axes` constructs all face normals and every edge×edge cross product, normalizes
and deduplicates them with a linear `.some` scan **before** penetration can reject
on its first separating axis. With `Ea`/`Eb` edges and up to`K` accepted axes,
construction can cost O((Fa+Fb+Ea×Eb)×K), plus vertex projections. Pair guarding
samples up to 128 poses and can bisect 18 times. The same clear sample's depths are
computed in `exceeds(end)` and again when updating allowed overlap.

Potential exact-result savings: reuse already-computed sample depths; generate
axes lazily in the identical order with unchanged duplicate thresholds; share
immutable transformed hull data across pairs/samples. Changing tolerances,
sample limits, contact order or solver decisions is a fidelity risk.

Ordinary spherical noncars currently use sampled convex hulls, a separate known
compatibility gap. A synthetic unit sphere helper has 132 edges versus 12 for the
stock Eagle box, producing 1584 edge-cross candidates for that pair. This is a
possible amplifier, not the measured Snow cause: the actual Snow noncar census
in this run had at most 36 edges, and no sampled sphere was identified. The 204
noncars do not all run SAT: immovable/immovable and broadphase-disjoint pairs
are rejected. Avoid attributing the measured guard cost to every dormant prop.

### 3. Cache collection and full-world synchronization — secondary, measured

The start drive made 147 native `collectFaces` calls, totaling 226.7 ms, and 181 body
contact collections totaling 277.1 ms. Every native cache collection checks all
retained meshes and actor transforms before traversal. Snow retains 901 native
actors and 667 MODEL meshes. Native cache wrap can recollect the query and repeat
the synchronization. Dynamic refresh also traverses actor children and formats
a 16-number transform string before deciding whether triangles changed.

Dirty ownership/version tracking and shared unchanged-phase work are candidates.
Preserve native 300-face capacity, ring lifetime, MODEL/ACT ordering and interleaved
pull/stop side effects. Caching across callbacks without proving validity can
change C2 behavior. Static world rebuilds are revision-gated, not unconditional
per-frame work; no rebuild was established as the dominant event in these runs.

### 4. Draw submission, visibility and resolution — verified structure, limited timing

`batchStaticWorld` creates one whole-track mesh per material. Its bounding sphere
gives coarse culling: a small visible portion can submit the entire material
batch. There is no general occlusion/sector culling. Spatially partitioned render
batches might improve long views; collision/source ACT ownership must remain
independent and transparent ordering must survive.

The renderer requests antialiasing and caps DPR at 1.7, with no absolute pixel
budget. A 3840×2160 **CSS** viewport at DPR 1.7 becomes 6528×3672 (~24.0 million
pixels); a physical 4K monitor under desktop scaling can have a smaller CSS
viewport, so monitor resolution alone cannot establish the buffer size. The
tested reduction from 3.07 million to 0.784 million pixels gives only a small CPU-
dominated gain. A resolution cap/upscaling choice should be based on GPU
measurements and visual comparison; UI can remain sharp at native CSS sizing.

### Other hypotheses, not established as dominant

Dense active-set contact solving has cubic matrix-solve cost and expensive
fallbacks, but the sampled dominant path here is pair guarding, not that solver.
GC/allocation and texture/shader warmup may contribute to individual stalls.
Initial driving submitted new buffers/textures and three new program variants;
the settled paused comparison had no upload/compile calls. GPU driver completion
cost is not equal to the `compileShader` JavaScript call duration. No missing
asset requests or console/WebGL failures occurred. Full allocation-rate,
steady-state crash/debris, garbage-collection and development-server comparisons
remain follow-up measurements; do not infer them from FPS alone.

## Higher visibility

Snow's actual camera Yon is 35 native units; landscape visibility is tied to the
authored GENERAL/track multiplier. Pedestrian process/popup distances are 12/9.
Their visibility currently follows processing activity, not an independent visual
distance. Rival visual roots are likewise hidden when physics becomes inactive;
native opponent view distance is `max(Yon+10,45)` and also feeds AI semantics.

Raising these values blindly increases both CPU work and gameplay activation.
Assess separate visual visibility/LOD or dormant pose presentation after removing
measured overhead. Rendering distant actors should not make AI, pedestrian
threat processing, collisions or native clocks secretly run at new distances.
No distance multiplier or target resolution has been chosen yet.

## Reproduce briefly

With the existing production server running (`npm start` after a build):

```sh
node tools/profile-performance.mjs --race "snow way out" --seconds 2 --cpu-profile
node tools/profile-performance.mjs --race "snow way out" --seconds 2 --ratio 0.75
node tools/profile-performance.mjs --race "snow way out" --seconds 3 --drive
```

Run serially. Captures are explicitly capped at 0.25–5 seconds; main-thread stalls
can delay the deadline. Loading time is separate. The tool closes its isolated
Chromium instance after one capture. `--headful` opens a separate visible browser
if needed for hardware access; the default headless backend may automatically
fall back to SwiftShader even without `--software`. Always read the recorded GPU
name; software FPS is not hardware performance evidence. `--width`/`--height`
allow a bounded viewport comparison, and `--no-render` is diagnostic only.

The standalone one-second capture and CDP profile export were checked and
reported zero application/request/WebGL errors. That headless run selected
SwiftShader and is **not** included in the AMD FPS table. Production was already
built from 441358c; only tooling/documentation/backlog changed in this phase.

Ignored evidence: `artifacts/performance-mcp-baseline.json`,
`artifacts/performance-cli-smoke.json` and its `.cpuprofile`. The raw MCP CPU
trace and inspected screenshots remain in `/tmp`. The opt-in probe restores
methods, ratio, pause state and transient queries on disposal; it is not loaded
by the application or included in the production bundle.

## Render FPS display validation (QUA-10, 2026-10-24)

The current counter already used uncapped render timestamps; the old capped-dt
report was stale. Its averaging policy is now isolated in `RenderFpsSampler`,
independent of `BrowserGameClock` and the 40ms simulation tick. Four deterministic
tests cover slow, fast, irregular and suspended windows.
`npm run test:render-fps` additionally controls actual Chromium animation-frame
timestamps while the initial game remains paused: ten 100ms frames display
**10 FPS**, four 250ms frames display **4 FPS**, and simulation frame/time counters
do not advance. WebGL reports no error. This headless SwiftShader test validates
measurement semantics, not achieved hardware performance. A long suspended
interval contributes to the next average once; the following window recovers.
