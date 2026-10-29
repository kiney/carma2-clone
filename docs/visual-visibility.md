# PERF-04: extended visual visibility

The browser presents landscape, opponents and pedestrians farther away by
**4×**, independently of native C2 gameplay activation. Baseline: `486dac9`,
after the structural performance tickets and PERF-13 integration.

## Policy and native boundaries

| Content      | New presentation range                                                            | Preserved native behavior                                                                                                                                                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landscape    | 4 × authored GENERAL Yon × track multiplier; stock examples 35 → 140 C2 units     | Original Yon remains the input to GROOVE visibility, ghost-fragment admission and chase-camera startup framing. Near plane, projection, model scale and resolution are unchanged.                                                                                               |
| Opponents    | Up to the extended landscape range, including valid committed remote FOLLOW poses | Physical/rematerialization distance remains `max(native Yon + 10, 45)`; objective selection, clocks, RNG, PHIL membership and safe-placement decisions are unchanged.                                                                                                           |
| Pedestrians  | 4 × original process distance, capped at landscape range; stock 12 → 48 units     | Original process box (12 horizontally, 7.2 vertically), popup dimensions (9 / 5.4) and native process bounds remain fixed. Already presented near actors resume processing under the PED-10 consistency rule below. A conservative 2-unit bounding sphere avoids edge clipping. |
| Material fog | Shader fog start/end distances ×4, preserving the authored colors                 | Retained MAT descriptors and native material/glorification calculations stay unchanged. Track clipping and base GENERAL fog Yon remain distinct.                                                                                                                                |

`src/visual-distance.ts` owns the policy; `window.carma.visibility` reports the
actual loaded values and distant presentation counts. There is no visibility
setting or resolution change in this ticket.

Remote opponents are exposed **only inside the render pass**, then hidden again
in `finally`. A pose is eligible only after a real native FOLLOW pose commit;
epoch changes, mode transitions, failed placement/relocation and mismatched
poses invalidate it. Gameplay consumers, including oil admission, see native
visibility. Physics never runs for an opponent merely because it is rendered.

Inactive pedestrians retain their last authored/procedural pose. They become
visible without advancing movement, animation, RNG or damage. Visible stationary
limb hierarchies reuse prepared matrices; parent/root changes, activation,
reset and native transport ownership invalidate that certificate. Native-owned
transported characters keep their external animation and visibility ownership.
Future animation of inactive limbs must invalidate this certificate too.

Limitations: distant pedestrians do not acquire new animation while native
processing sleeps. Remote opponents use native path-following poses without
full suspension; native rematerialization may adjust the pose. Extended views
can reveal limits in the original scenery/backdrop. This change does not claim
to solve every remaining frame-time spike (PERF-01).

## Nearby admission correction (PED-10, 2026-10-29)

A retained visible actor must resume normal processing once inside the original
process box, including its inner popup box. Native popup suppression assumes an
unprocessed actor is hidden; applying it to already rendered retained poses
created visible frozen/unhittable pedestrians. The correction uses retained
presentation membership before movement/contact checks and removes the dormant
matrix certificate immediately on activation. Far actors remain presentation-only.
The original greater-than20-unit camera-jump nearness hook is also restored.
See [live evidence, source scope and tests](pedestrian-nearby-admission.md).

## Headed hardware comparison

Production builds, visible Chromium, actual WebGL2 backend
`ANGLE (AMD, AMD Radeon Graphics (radeonsi gfx1150 LLVM 19.1.7), OpenGL 4.6)`.
Chrome DevTools MCP was unavailable; the existing Playwright/CDP harness attached
to a dedicated headed Chromium. No headless, SwiftShader or drawing suppression
was used for these measurements. Fresh isolated contexts preserve existing
playtest tabs. Short captures ran **serially** on the shared workstation;
small timing differences are noisy and are not general performance predictions.

### Driving and damage

Actual drawing buffer **2100×1466**, DPR approximately 1, antialiasing enabled.
`tools/validate-performance-routes.mjs`, minimal runtime recorder, no CPU trace
or pair counters; 500 ms warmup retained separately, then 2.5 seconds per case
with real W input. Both versions loaded the full populations and identical
initial body/hull/damage fingerprints in all five fixtures. Wall-clock
scheduling and subsequent simulation states are not lockstep.

| Case                  | FPS before → after | Frame p95 before → after | Max frame before → after |
| --------------------- | ------------------ | ------------------------ | ------------------------ |
| Timber start          | 55.0 → 52.3        | 36.6 → 34.8 ms           | 41.3 → 42.8 ms           |
| Timber damaged grid   | 38.8 → 41.7        | 54.3 → 47.9 ms           | 82.4 → 57.6 ms           |
| Timber canyon forward | 60.0 → 59.2        | 33.2 → 30.1 ms           | 39.7 → 34.5 ms           |
| Timber canyon reverse | 59.2 → 55.6        | 34.0 → 33.8 ms           | 40.5 → 38.5 ms           |
| Snow start            | 48.4 → 45.7        | 40.2 → 45.3 ms           | 55.4 → 67.9 ms           |

No dropped physics time or fatal console/network/WebGL errors occurred. The
Snow sample regressed modestly; the damaged-grid improvement is not evidence
of a physics optimization. These bounded cases show no large new cliff, not a
guarantee of 60 FPS during arbitrary pileups.

### Isolated rendering and tunnel/open transition

`tools/benchmark-visibility.mjs` samples RAF intervals for 2.5 seconds per view
with physics paused. Camera motion does not move the car or run AI. This isolates
the extra drawing/hierarchy cost; it is **not driving FPS**. Screenshots verify
the Snow 22→11 camera sweep starts inside the tunnel and ends outside at the
wooden road junction. Short/long Timber views and the Snow start show original
scenery added beyond the old clipping distance.

At **2100×1466**, all four views remained approximately 60 FPS before and after;
p95 was 16.7–16.8 ms. Additional visible content is real:

| View                         | Main-pass calls before → after | Triangles before → after | Eligible visible pedestrians before → after |
| ---------------------------- | ------------------------------ | ------------------------ | ------------------------------------------- |
| Timber tunnel                | 117 → 570                      | 17,493 → 22,352          | 19 → 42                                     |
| Timber open                  | 337 → 484                      | 19,319 → 20,884          | 19 → 33                                     |
| Snow start                   | 388 → 1,102                    | 15,084 → 23,017          | 22 → 83                                     |
| Snow tunnel exit, final pose | 53 → 73                        | 11,471 → 11,675          | 22 → 25                                     |

At **3792×2032**, the separate Snow start view measured **60.1 → 59.6 FPS**,
p95 **16.7 → 16.8 ms**, maximum **16.8 → 33.4 ms**. Calls increased
440 → 1,327 and triangles 15,327 → 25,210; eligible pedestrians increased
22 → 93 while native active pedestrians stayed at 22. The aspect ratio differs
from the smaller-buffer fixture, so its draw counts are not directly comparable.

Native active-pedestrian counts remained 19 in Timber and 22 in Snow; all added
figures were inactive presentation poses. Eligible visibility includes figures
occluded by nearer scenery; it does not claim every figure contributes pixels.

Raw reports and before/after screenshots are ignored under
`artifacts/perf04-{before,after}-{routes,views,4k}*`. Original assets are not
copied into source or bundles. Reproduce against separate baseline/candidate
production servers and an existing headed hardware Chromium:

```sh
CDP_URL=http://127.0.0.1:9234 \
PERF_VISIBILITY_URL=http://localhost:5241 \
PERF_VISIBILITY_OUTPUT=artifacts/visibility.json \
node tools/benchmark-visibility.mjs
```

For a single larger-buffer check add `PERF_VISIBILITY_WIDTH=3792`,
`PERF_VISIBILITY_HEIGHT=2032`, `PERF_VISIBILITY_CASE=snow-start-view`.
Keep runs serial; there is no continuous stress sweep.

## Validation

- `npm test`: 3,114 tests, 3,109 passed, five optional private-capture cases
  skipped, no failures. New checks cover remote-pose publication/invalidation,
  render cleanup, unchanged native FOLLOW transitions/RNG, dormant pedestrian
  state/combat/ownership, matrix-cache invalidation and shader-only fog scaling.
- `npm run build`: TypeScript and production bundle pass. The final production
  main bundle matches the measured candidate (`index-Bb_31XyX.js`).
- Existing camera, native-AI (Stock/Advanced/Snow) and render-matrix Chromium
  regressions pass. These separate software-rendered compatibility tests are
  not included in hardware FPS claims.
- `tests/browser-visibility.mjs` passes in the headed AMD Chromium. A genuine
  native remote FOLLOW opponent at approximately 80 units submitted 35 meshes
  per main pass while remaining outside PHIL; native state, clocks and hidden
  visibility outside rendering stayed unchanged. Native safe relocation
  incremented the pose epoch and prevented stale presentation. An inactive
  pedestrian at approximately 30 units became visible without changing its
  movement/combat state. No fatal console, failed request or WebGL errors.

Run that focused integration check against an already built/served candidate:

```sh
CDP_URL=http://127.0.0.1:9234 \
VISIBILITY_URL=http://localhost:5241 \
node tests/browser-visibility.mjs
```
