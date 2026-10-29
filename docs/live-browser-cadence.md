# Live low-FPS capture: browser frame delivery

## Outcome (2026-10-29)

The reproduced approximately one-FPS interval was primarily limited by delivery
of `requestAnimationFrame` (RAF) callbacks. Measured engine CPU and GPU work do
not explain that interval. A separate paused heartbeat test and a browser
activation comparison support this conclusion. The exact Chromium activation,
occlusion or compositor mechanism remains **unknown**; this is not a verified
Chromium bug or proof that all engine performance problems are fixed.

The running scene also has material CPU costs. Keep these distinct from missing
RAF callbacks and from earlier recorded engine/contact latency spikes.

## Conditions

- Existing user tab, no reload: `?playtest=ped-animation`, race
  **SHEIK, RATTLE & ROLL**. Cached `index-Dr5HUKWt.js` from `82a5cc8`, with the
  previous PED-10 and PHY-21 runtime adapters. The new ANI-01 implementation
  (`2549a14`) was **not loaded** and cannot explain this episode.
- Hardware ANGLE AMD Radeon Graphics / radeonsi gfx1150 / LLVM 19.1.7,
  OpenGL 4.6. Drawing buffer 2067×1430, pixel ratio 1.484375, 4×MSAA.
- Ten cars, seven physically active; 26 detached parts; 461 retained scenery
  bodies, 49 admitted, 47–48 sleeping; 82 bodies in the physical roster.
  925 pedestrians, 9–15 active during the first captures.
- Short serial measurements on the shared workstation. The user authorized
  advancing the scene. It was paused again afterward; no repair, reload,
  population removal, visibility reduction or production-code change occurred.

## Measurements

| Serial capture | Duration | Result | Attribution / limits |
| --- | --- | --- | --- |
| Initial running scene | 2.03s | 43.36FPS; frame median 22.3ms, p95 42.6ms, max78.2ms | Physics 628ms total / 51 ticks, mean 12.32ms/tick; render 540ms over 176 passes; GPU mean1.10ms/frame. |
| Subsequent running scene | 3.00s | 0.67FPS; two sampled frame intervals 966.3ms and1101.3ms | Only 110.8ms total simulation-update CPU, 11.7ms render CPU and approximately 1ms GPU/frame. The largest physics update 81.9ms is insufficient to explain the approximately one-second cadence. |
| Same scene **paused**, independent heartbeat | 1.60s | RAF interval 1016.6ms; all 16 timer callbacks arrive | A 100ms `setInterval` continues at 99.8–100.1ms intervals. This rules against continuous main-thread saturation as the explanation for this measured gap. |
| Paused after MCP `select_page({bringToFront:true})` | 1.50s | 59.32FPS; median 16.4ms, p95 18.5ms | No source or simulation change; render CPU 5.24ms/frame, GPU 0.84ms. |
| Running after activation | 2.05s | 46.41FPS; median 19.8ms, p95 45.0ms, max80.2ms | Physics 646.5ms / 52 ticks, mean 12.43ms/tick; update CPU 7.08ms/frame; pedestrians 1.79ms/frame; render CPU 5.31ms/frame; matrices 0.82ms/frame; GPU 0.99ms. |

All method timings are inclusive wall-clock observations with diagnostic
overhead; do not sum parent and child durations. Serial running captures advance cars/cameras and are not fixed-state
optimization comparisons. Resume/catch-up work and discarded physics time are
retained in the raw reports; they do not identify the cause of missing RAFs.

During the slow interval, `document.visibilityState` was `visible` and
`document.hasFocus()` was true. Those observations did not distinguish the two
cadences. Bringing the browser forward changes several conditions together, so
the test does not establish a particular Chromium throttling policy.

The bounded collision-counter capture reports 12 response solves/retries across
seven ticks and no exceptional broadphase bounds or pair-guard feature sweeps.
It provides no evidence of an explosive collision workload in that interval.
No fatal console messages or WebGL errors were observed.

## Follow-up telemetry and boundaries

The preserved user tab has two opt-in, bounded diagnostics:

- `window.__perf01LiveRecorder.snapshot()` retains 512 scalar rows per existing
  timing ring, including tick/update, frame and slow world-contact timings.
- `window.__carmaCadenceRecorder.snapshot()` retains 64 RAF gaps of at least 75ms,
  heartbeat counts/maxima, visibility/focus/lifecycle events and 128 long tasks.
  Its 100ms heartbeat never steps physics or requests rendering. Both diagnostics
  have `stop()` methods and disappear on page reload.

At the next reported drop, compare RAF gaps with heartbeat gaps, long tasks and
whole physics-update durations before changing collision algorithms or reducing
resolution. Many on-time heartbeats between RAF callbacks distinguish frame
delivery delays from a long uninterrupted game callback. No diagnostic should
automatically activate the browser, since that could remove the episode before
it is captured.

Ignored raw reports and the short MCP trace are in
`artifacts/live-low-fps-2026-10-29/`. Existing PERF-01 retains the evidence;
its user-selected P5 backlog position is unchanged. This investigation closes
neither historical engine-stall attribution nor the remaining CPU headroom gap.
