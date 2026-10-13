# PERF-02: render hierarchy preparation

Implemented and validated on 2026-10-12. Physics optimization, higher visibility
and resolution policy remain separate tickets; this change does not select their
implementation or claim that all driving frame-time spikes are resolved.

## PERF-02 ownership and implementation

`src/render-matrices.ts` prepares matrices once, after interpolation, camera,
GROOVE and effects have established the render pose, before the sky/main passes.
The renderer's automatic scene traversal is disabled only for these two calls,
then its flags are restored in `finally`, before `RenderPoses.restore()` restores
committed physical poses. Camera updates retain Three's normal behavior.

Ordinary top-level branches retain native `updateMatrixWorld(true)` traversal,
including subclass overrides, lights, cars, moving scenery and detached pieces.
Only the direct pedestrian group is handled separately. Registered population
actor identities whose root is invisible update their root, but defer their
unseen descendants. Visible actors refresh the whole subtree on the first frame
of reactivation. Blood, flames, rays and unregistered objects retain full updates.
If the pedestrian group is nested elsewhere, preparation falls back to ordinary
traversal rather than guessing at ancestor ownership.

No matrix API is overridden, actor detached from the hierarchy, or static flag
changed globally. Explicit collision/animation/physics matrix queries still
traverse hidden actors normally. The actor registry clears on population disposal.
No physics tolerances, activation/visibility distances, resolution or asset
interpretation changed. There are no application render callbacks that mutate
poses between these passes; such a future callback must review this boundary.

## Short hardware measurements

Production Chromium via Chrome DevTools MCP, AMD `radeonsi gfx1150`, ANGLE OpenGL
4.6, CSS 1414x987, DPR 1.484375, buffer 2098x1465, 4x MSAA. Serial captures last
1-2 seconds on the user's shared workstation. No CPU trace was enabled. These
samples have scheduling/instrumentation noise; they are not universal FPS promises.

| Snow Way Out measurement                       | Previous hierarchy                  | Optimized hierarchy    |
| ---------------------------------------------- | ----------------------------------- | ---------------------- |
| Paused start, 2 seconds                        | 37.0 FPS; 18.1 ms matrix work/frame | 58.9 FPS; 1.4 ms/frame |
| Identical paused post-drive pose, 1.5 seconds  | 37.6 FPS; 16.8 ms/frame             | 59.5 FPS; 1.6 ms/frame |
| Actual moving frame, paired preparation mean   | 15.52 ms                            | 1.225 ms               |
| Actual moving frame, paired preparation median | 15.25 ms                            | 1.15 ms                |

The identical-pose paused diagnostic replays the former two complete matrix
traversals before drawing, then restores the production helper. It uses the same
live content, camera, damage and population in both samples. The moving diagnostic
measures both methods consecutively at the **same frame pose** for 20 frames while
W input drives the car. Gameplay time and position advance. Its extra legacy work
is diagnostic overhead; its FPS is deliberately not reported as production FPS.
These comparisons show roughly 90% less hierarchy CPU work without freezing poses.

Independent start-drive captures also reduce hierarchy work from 15.9 to 1.1 ms
per frame, but total FPS is 15.1 before versus 14.1 after: physics CPU increases
from 36.7 to 54.9 ms/frame between separately reloaded populations. Their physics
paths are not matched. Do not claim a driving FPS improvement from these samples.
The remaining collision/simulation bottleneck is owned by PERF-05 / TASK-104.

## Validation and visibility baseline

- `npm run build` passes; the existing large-chunk advisory remains.
- `npm test`: 2550 passing tests. Nine focused matrix tests also pass after review
  strengthened hidden-effect and explicit hidden-actor update assertions.
- `node tests/browser-render-matrices.mjs`: Stock Snow/Eagle3 and Advanced
  Carrier/69mach1 pass. Real population counts 487/128, opponents 7/10; dormant
  descendant visits zero, reactivation and explicit full updates retained, visible
  world-matrix difference zero against native traversal, flags restored. Software
  WebGL is explicit for this regression, not used for hardware performance claims.
- Hardware MCP pixel comparison of optimized versus full traversal after impact
  and repair: all 12,294,280 RGBA bytes identical at 2098x1465. This bounded,
  synchronous readback is a correctness check, not a timing capture.
- Hardware MCP W-input driving and a controlled Eagle3/Skyline collision preserve
  motion, permanent deformation, component damage, a physical detached rear part,
  and full repair/component reset. Initial poses/velocities and two active cars
  are controlled test setup, not a claim of an ordinary random encounter.
- Before/after/crash screenshots inspected. No fatal console, failed local asset
  requests or WebGL errors in the focused browser checks.

The same-pose optimized capture is the retained visibility baseline: unchanged
Yon 35, 487 pedestrians/22 active, 7 rivals, 204 noncars and the original buffer.
Use the retained pose/context and measure activation/rendering separately when
starting PERF-04. Do not infer higher-distance performance from this near view.

Ignored evidence: `artifacts/perf02-validation.json`,
`artifacts/browser-render-matrices.json` and browser screenshots. Raw MCP captures
and before/after images are in `/tmp/perf02-*`. The opt-in performance probe now
times `scene.prepareRenderMatrices` outside the render calls, so its CPU duration
must be included when comparing old inclusive renderer timings with new ones.

## PERF-18: dormant scenery presentation

The previous bridge applied and restored temporary poses for the entire retained
NONCAR population on every displayed frame, including pause. Timber's frozen
user capture had 466 retained props, 6 physical props and 7 pieces: 480 apply calls,
1,239 recursive node visits in each apply/restore phase and 3,123 preparation
visits per frame. Batch validation also revisited the same ancestor and its
unrelated child list for every retained object. Physics sleep did not certify
graphical immobility.

The new bridge consumes frame-local batch certificates after GROOVE, smash and
effects have established presentation. Certified source subtrees skip temporary
pose application/restoration and the additional presentation matrix traversal.
Shared ancestor paths and geometry validate once per frame; own-node transforms,
membership, visibility, manual/world matrices, matrix modes and uploaded buffer
versions remain checked. Unrelated ancestor siblings no longer invalidate every
object. Wake, removal, reparenting, custom matrix outlets, geometry/material edits
and destruction return affected objects permanently to ordinary drawing.
`worldSmashDisabled` stays hidden when batch-owned hiding is relinquished.

`RenderPoses.apply()` separately detects an unchanged target local pose before
allocating restore snapshots or updating the subtree. Its relative component tolerance of 64 × Number.EPSILON handles world-to-local roundoff, not a gameplay motion
threshold; manual-matrix equality remains exact. Changed poses and opaque custom
outlets preserve committed restoration. The presentation-only traversal leaves
explicit Three matrix methods and collision/animation queries native.

GROOVE is a separate graphical owner. Installed HW 478beb–478cac writes the exact
GROOVE ACT independently of PHIL membership; native pull retains that pointer but
severs inherited ACT parentage. Three deliberately retains source parents, so an
admitted child must stop inheriting graphical ownership from those parents.
After parent animation, the existing committed actor-sync outlet rebases such a
child before interpolation saves its restore pose. Dynamic queries refresh from
that committed geometry, never from an interpolated pose. Exact own-GROOVE ACTs
stay graphical-owned. This is a browser/native hierarchy adapter correction;
no collision, force, quiet-state or damage formula changed.

### Bounded measurements and locality decision

Chrome DevTools MCP: AMD Radeon `radeonsi gfx1150`, ANGLE OpenGL 4.6, buffer
2100x1466, DPR 1.484375. Captures last 350–500 ms, at most 24 frames. Only one test tab
animates during the serial comparisons; the peer's RAF is temporarily parked
and restored. Other workstation activity, JIT/GC and the small sample count still
matter. The opt-in probe times inclusive apply/restore, batch/certificate work,
matrix preparation and both draw passes separately; visit counting has an
explicit off mode. There are no per-node clocks. GPU queries read asynchronously
every eighth paired sky/main frame and never wait for the GPU.

| Fresh paused Timber, per frame          | c27935a baseline |     PERF-18 |
| --------------------------------------- | ---------------: | ----------: |
| Render-pose apply calls                 |              473 |           8 |
| Apply/restore recursive node visits     |     1,249 /1,249 |        0 /0 |
| Shared matrix preparation visits        |            3,361 |       2,434 |
| Presentation span p50 /p95, ms          |         6.0 /9.2 |   7.1 /13.6 |
| Main draw calls /triangles              |      259 /18,141 | 248 /18,007 |
| Paired GPU mean, ms (two ready queries) |             0.90 |        0.74 |

These are separately loaded populations, not identical simulation snapshots.
Procedural population differences explain the different draw counts; camera,
original track/car, Yon and buffer are held fixed. The first production capture
does **not** show a paused CPU-span improvement despite removing the redundant
work. An earlier optimized development capture at 259 draws measured 4.7 ms p50,
10.4 ms p95 and 2,422 preparation visits; compilation/population and scheduling
differences prevent treating that as an exact speedup. With visit instrumentation
off, its p50/p95 were 5.3/9.6 ms, so no constant profiling-overhead subtraction is
claimed. The reliable result is the removed work, supported by exact pixel and
matrix comparisons on each scene, rather than a universal FPS promise.

Short normal W-input production captures (350 ms) advance native simulation
0.40/0.36 s. Baseline/optimized presentation p50 is 12.0/9.8 ms, p95
49.5/46.7 ms; frame intervals p50 are 17.3/16.0 ms and p95 are 61.2/43.8 ms.
Apply calls fall 473→8. GPU samples are 0.80/0.83 ms, only one ready query each.
These fresh-start samples do not reproduce the user's canyon/crash stall.

A one-shot camera/frustum diagnostic counts 20 global groups,466 slots,
9,294 submitted triangles, 465 eligible source instances but only 20
sphere-intersecting sources/256 triangles. The actual groups produce 49 main
draw calls. Omitting all those batches solely for a bounded diagnostic drops
main calls 248→199 and triangles 18,007→8,713, yet main CPU p50 stays 3.3 ms;
paired GPU mean changes 0.74→0.70 ms (two ready queries each). This supports leaving
spatial regrouping unchanged at current distances: its maximum measured benefit
is small, while extra local groups can increase draw calls. This is not evidence
that global batches are optimal at greater Yon or on every GPU. PERF-04 retains
the visibility task and can repeat the estimator there. No track-wide bounding
sphere was introduced as a purported solution.

### Validation and reproduction

`npm test` passed 2,936 tests, including the final ownership/destruction
regressions. Six additional submission-probe conformance tests pass and are
registered for subsequent full runs. Production build passes.
`npm run test:render-presentation` loads original Stock Timber/Eagle3 and Advanced
Carrier/Eagle3 and compares 4,096,000 RGBA bytes per scene: zero differences against
full native matrix preparation. Visible and retained-source matrices agree
exactly. Real source ACT transform/child/reparent/ancestor edits and physical wake
leave the batch; unchanged car interpolation is a no-op and changed poses restore
exact committed state. A real source child also exercises manual-matrix policy
under an explicitly temporary diagnostic flag, not a claim that stock NONCAR
roots currently use that mode. Reports/screenshots stay in ignored artifacts.

The probe is self-contained for `page.evaluate(captureRenderPresentation,
{durationMs:500,maxFrames:24,countVisits:true})`; it uses the application's actual
diagnostic instances in production. `estimateScenerySubmission()` is a one-shot
source-sphere/submission estimate, not a GPU timing inference. Both are exported
from `tools/render-presentation-probe.mjs`. Ignored captures are named
`artifacts/perf18-*`; correctness artifacts use
`artifacts/browser-render-presentation-*`. The user's tentative delayed piece
contact observation is separately tracked as PHY-15/TASK-109; the paused capture
does not establish its cause or original-game parity.

Final existing browser regressions also pass: Stock Snow/Advanced Carrier pedestrian matrix preparation and four Stock/Advanced NONCAR participation, wake/reclaim, debris and repair cases. Final hardware MCP production validation uses the final bundle, real keyboard driving and clean console/WebGL; final screenshots are inspected. No increased distances, changed framebuffer policy or physical activation policy is shipped.
