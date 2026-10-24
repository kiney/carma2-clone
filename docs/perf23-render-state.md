# PERF-23: stable render light state

The adverse extended-view Timber scene exposed repeated Three.js program
selection, rather than excessive polygon counts alone. The browser now includes
the existing directional sun in both sky and main camera layers. Main lighting,
original native material shaders, fog, visual distances, draw submissions and
simulation activation are unchanged. The Basic-material sky ignores lighting.

## Confirmed mechanism

Both sequential render passes use the same Three scene/depth render-state cache.
Previously the sky camera (layer 1) excluded the default-layer sun, while the
main camera included it. Three 0.180's directional-light count alternated
1 -> 0 -> 1, incrementing its light-state version twice each frame. Every visible
Lambert material then entered `setProgram -> getProgram -> getParameters` even
with an unchanged material version and cached shader. Program selection is not
the same as compiling a new shader.

`sun.layers.enable(1)` keeps that directional count invariant. No additional
light or shader approximation is introduced. Remaining regular/instanced
material switches, visible-hierarchy traversal and drawing costs still exist;
this ticket does not claim to eliminate every PERF-01 active-play stall.

## Hardware evidence, 2026-10-24

Visible Chromium 156 through Chrome DevTools MCP, WebGL2 on
`ANGLE (AMD, AMD Radeon Graphics (radeonsi gfx1150 LLVM 19.1.7), OpenGL 4.6)`.
Shared workstation, short serial captures, no GPU waits or stress sweep.

The Timber view reconstructs the saved adverse camera pose with deterministic
fresh original population selection. It is not restoration of the unavailable
complete historical damage/AI state. Both sides of the same-page comparison use
exactly the same fixed pose, 2,174 submissions, 41,139 triangles, 584 pedestrians
(16 native active / 85 visible), far plane 140 and **2835x1674** drawing buffer.
Temporarily toggling the sun's sky membership reproduces the unchanged baseline
behavior, then restores the production mask. Only one game tab renders during
the accepted comparison. An earlier candidate sample with a second live tab
was discarded as concurrent rendering contamination.

| Timber adverse view, 2 s each | Legacy         | Fixed          |
| ----------------------------- | -------------- | -------------- |
| FPS                           | 50.1           | 59.5           |
| Frame p95 / max               | 33.4 / 50.0 ms | 16.7 / 33.3 ms |
| Mean / p95 render CPU         | 15.1 / 30.7 ms | 7.6 / 10.9 ms  |
| Program selections per frame  | 685            | 14             |

Program counts come from a separate four-frame observer outside FPS captures.
Render CPU wraps the two whole render calls; it is inclusive CPU wall time,
not GPU timing. Physics stays paused and its clock remains zero throughout.
Independent unchanged-baseline production measurement was also 50.1 FPS with
15.1 ms mean render CPU. Small buffer rounding and host load limit precision.

A normal Snow view at the same buffer retained 1,277 calls, 24,708 triangles,
487 pedestrians (22 active / 92 visible): both sides about 60 FPS; render CPU
6.43 -> 4.68 ms, program selections 233 -> 4 per frame. A separate 1.8 s real-W
Snow drive completed with no skipped physics time or WebGL/console errors;
whole-game FPS was 44.7 with remaining physics/cold-frame costs. This is a
compatibility check, not a promise of 60 FPS during arbitrary collisions.

## Regression checks and reproduction

`npm run test:render-state` builds and runs the Stock Timber / Advanced Carrier
Chromium test. It compares actual sky and main WebGL pixel buffers byte-for-byte
at one paused pose while toggling the legacy/fixed light membership, and counts
program selections across four subsequent frames. Both scenes have identical
pixels, stable fixed light versions, fewer selections and no console/network/GL
errors. These software-rendered conformance tests make no hardware FPS claim.

Timber selection counts over four frames: 1,144 -> 56; Carrier: 1,176 -> 80.
Normal driving/crash checks retain their existing separate tests. The shared
scene/pass matrix logic and native physics code are unchanged by this fix.

Ignored reports: `artifacts/perf23-hardware-comparison.json`,
`artifacts/perf23-ordinary-and-driving.json`,
`artifacts/perf23-render-state-test.log` and
`artifacts/browser-render-state.json`. The original live-stall record remains
[separate evidence](perf04-live-timber-drop.md); its active-frame attribution is
not inferred from this paused rendering result.
