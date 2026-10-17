# Post-PERF-04 live Timber drop, 2026-10-17

Engine checkpoint `39468ce`. The user paused a severe live-play drop in Stock
Timber / Eagle3 Green. The scene was not reloaded, resumed, stepped, repaired or
repositioned during diagnosis. Chrome DevTools MCP was unavailable; Playwright
attached to the existing production tab over CDP.

## Separate observed problems

1. **An active-play stall remains unattributed.** Last game period: 1,000 ms
   (capped); cumulative skipped physics: 9,560 ms at game time 100,990 ms. No
   rolling recorder was installed in the newly prepared browser, so there is
   no pre-pause phase timing to identify the exact offending frame. A CPU profile
   taken after pausing cannot recover that history. The established bounded live
   recorder is now installed (1,024 retained rows per ring, survives pauses and
   race changes) for subsequent active-play attribution.
2. **A material extended-view render regression is reproduced in this scene.**
   The earlier short PERF-04 fixtures missed this adverse camera/population view.
   Preserve this finding separately from the unexplained active stall.

## Paused render-only comparison

Visible hardware Chromium; AMD/radeonsi ANGLE, WebGL2, drawing buffer
**2832×1672**. Three serial approximately 850 ms RAF samples, no physics stepping:

| Presentation                          | FPS  | Frame p95 | Main-pass calls | Triangles |
| ------------------------------------- | ---- | --------- | --------------- | --------- |
| Extended ranges                       | 47.3 | 33.4 ms   | 2,576           | 42,276    |
| Native render ranges, diagnostic only | 58.8 | 16.8 ms   | 756             | 22,295    |
| Extended ranges restored              | 45.9 | 33.4 ms   | 2,576           | 42,276    |

The diagnostic substitutes a cloned camera with the native far plane only for
the main render pass and hides inactive pedestrian roots only while drawing.
Visibility and renderer callbacks are restored in `finally`; the real camera,
native processing and settings stay unchanged. Game time and skipped time remain
identical after comparison. These short shared-workstation samples establish
extra render cost, not the cause or duration of the earlier active-play stall.

Of the 2,576 extended-view submissions, 1,354 belong to scenery/effects, 964 to
pedestrians and 258 to cars. The population contains 584 pedestrians: 27 native
active and 94 eligible visible, including 67 distant inactive poses.

A separate approximately 2.13 s paused CPU profile, mapped using exact-byte-
verified hidden source maps, attributes approximately 1.40 s inclusively to the
renderer. `getProgram` accounts for 584 ms inclusively; `getParameters` for
332 ms self time. These overlap and must not be added. This is program selection
and parameter construction, not proof of fresh shader compilation. Native
material versions stay stable while light-state versions advance each render
frame. The sky/main light-state changes and shared material/instancing variants
are candidates for focused testing; neither is yet established as the sole
cause. Render submission/material work warrants optimization before claiming
visibility has negligible cost across Timber.

## Collision snapshot: anomalies and limits

The immutable numeric export contains 25 current collision bodies: six active
cars, six detached parts and thirteen admitted noncars (eight immovable), plus
actual live-joint membership. Hull sizes/inertias are finite and not unusually
large. Zee and its detached spoiler are at Y542.35 and Y543.24, rotating at about
18.9 and 21.8 rad/s; retain this unexpected state without asserting it caused
the performance drop. They have no joint connecting them in this capture.

One independent Node clone diagnostic constructs current hierarchy-aware 40 ms
paths and runs a fresh body-pair guard. It finds 14 candidate pairs, 109 sampled
intervals and no capped motion; the cold guard call takes about 15.5 ms. Removing
the distant Zee/spoiler pair reduces sampling, but changes workload/JIT warmth.
This excludes neither earlier pair trouble nor world contacts: forces, native
world collection, local-response retries, damage callbacks and whole-tick
execution are not replayed. It is not an original-frame or FPS reconstruction.

Ignored raw evidence: `artifacts/live-perf04-drop-{state,bodies}.json`,
`artifacts/live-perf04-drop.cpuprofile`, `artifacts/live-perf04-drop-summary.json`,
`artifacts/live-perf04-drop-render-comparison.json`,
`artifacts/live-perf04-drop-clone-probe.json` and screenshot
`artifacts/live-perf04-drop.png`. No original assets or binary dumps are tracked.
