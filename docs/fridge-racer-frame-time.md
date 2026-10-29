# Fridge Racer frame-time investigation (2026-10-29)

## Findings

The user's retained Advanced Fridge Racer scene on `bb61b30` exhibits two
distinct sources of stutter. Neither measurement requires another extreme-energy
collision. No engine settings, physics behavior, resolution or populations were
changed. The tab was not reloaded; short serial captures advanced normal play
from elapsed185.20 to189.68 and left it paused.

1. **Sustained physics CPU cost:** two anchored cone actors repeatedly consume
   the complete local response budget. PERF-25 owns the new concrete issue.
2. **Intermittent browser frame delivery:** even paused, RAF callbacks can arrive
   about one second apart while ordinary timers remain punctual. Activating the
   existing tab restores approximately60FPS paused. The exact browser/desktop
   mechanism is not established; this repeats the separate
   [earlier cadence observation](live-browser-cadence.md).

## Short captures

Hardware: ANGLE AMD Radeon Graphics, radeonsi gfx1150/LLVM19.1.7, OpenGL4.6;
buffer2070x1435, DPR1.484375, 4xMSAA. Six active cars, eighteen retained detached
parts, 255 scenery definitions, 446 pedestrians/eight active. The actual physical
roster has26 bodies. CPU times are inclusive and include diagnostic overhead.

| Capture | Result | Attribution |
| --- | --- | --- |
| Initial paused,1.2s | 59.96FPS; median16.6ms/p95 32.3ms | Render CPU2.44ms/frame; GPU mean0.74ms. |
| Running,1.8s | 21.39FPS; median35.7ms/p95 111.3ms | 46 ticks, mean30.80ms/max64.7ms; update CPU1425ms, GPU mean0.90ms. |
| Detailed running,1.2s | 0.80FPS; one1251.9ms frame interval | Only five ticks/233ms CPU: CPU cost alone does not explain this interval. |
| Independent paused heartbeat,1.4s | RAF gaps302.2ms and1017.5ms | Fourteen100ms heartbeats, all96.3-103.7ms; visible/focused both true. |
| Paused after tab activation,1s | 59.97FPS; median16.6ms/p95 21.8ms | GPU mean1.01ms. No source or simulation change. |
| Running after activation,1.4s | 34.27FPS; median24.4ms/p95 84.3ms/max127ms | 36 ticks, mean25.78ms/max49.6ms; GPU mean0.78ms;40ms skipped. |

Serial running samples are not identical-state benchmarks. Activation changes
several conditions together and does not identify a specific Chromium policy.
Resolution/visible polygon count is not supported as the main bottleneck here.

## Concrete physics amplification

The detailed trace records341 response solves over five physics ticks:

| Seed | Responses | Maximum attempt | Observation |
| --- | --- | --- | --- |
| `&44C0112` |150 |30 | Positive normal and joint impulses in every response. |
| `&44C0126` |150 |30 | Same; these two actors account for88% of solves. |
| `rhood01` |14 |4 | Loose Coupe bodywork. |
| `TRUNK` |10 |4 | Loose player bodywork. |
| `&52!0158` |7 |4 | Moving scenery. |

Each cone normally contributes two world rows and three bilateral ball-joint
rows. This is not a large articulated solver matrix. Both use original NONCAR44,
mass0.5, snap angle30 degrees and world friction0. Their linear speeds are tiny
(approximately1e-8/3e-7 units/s), angular speeds approximately0.48/0.51rad/s.
The retained quiet gate rejects angular energy0.00456/0.00527; committed poses
remain nearly fixed despite retained angular motion. Contact/joint/candidate
semantics need a reduced reproduction before selecting the correction. Do not
silence the symptom by forcing sleep or reducing the global thirty-response cap.

Global quiet bookkeeping is amplified but not the main measured cost:
`retainHierarchyQuiet`16.4ms/356 calls, `prepareNewHierarchy`2.3ms/346 calls,
damage callback12.5ms/341 calls, against233ms total tick CPU in that sample.
World, angular and pair collections also repeat with the response loop.

Original-derived cone state, hulls, anchors and nearby finite faces are retained
only in ignored `artifacts/fridge-cadence-2026-10-29/`. Numerical summaries are
there too. Temporary profiling wrappers were removed afterward. No fatal
console or WebGL errors were observed. The reproduced energy-injection fix is
not invalidated by these distinct residual performance findings.
