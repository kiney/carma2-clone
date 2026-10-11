# PERF-02: render hierarchy preparation

Implemented and validated on 2026-10-12. Physics optimization, higher visibility
and resolution policy remain separate tickets; this change does not select their
implementation or claim that all driving frame-time spikes are resolved.

## Ownership and implementation

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
