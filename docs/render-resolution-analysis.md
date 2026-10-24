# PERF-03: render resolution analysis

2026-10-24. Analysis and proposals only; production rendering is unchanged.

## Conclusion

Lower resolution substantially reduces GPU render time, but did not consistently
increase FPS on the measured AMD workstation. CPU presentation/driver submission
and frame scheduling dominate these views. This is a useful quality/power option,
not evidence of a fix for physics stalls. Recommend manual 3D pixel-budget presets
while retaining native HUD rendering and the existing quality option. Do not lower
resolution automatically in response to total FPS alone.

## Current implementation

- `src/main.ts` creates a WebGL renderer with antialiasing and sets its pixel ratio
  to `min(devicePixelRatio, 1.7)`. `resize()` sets its size from the CSS viewport.
  There is no absolute pixel budget. The actual context reported four MSAA samples.
- A 1920 × 1080 CSS viewport at DPR 2 currently renders 3264 × 1836 because of that
  cap. A 3840 × 2160 CSS viewport at DPR 1 renders full 4K. Physical monitor
  resolution, CSS viewport, DPR and WebGL buffer dimensions are distinct.
- HUD text is DOM; the minimap and feedback have separate 2D canvases. Lowering
  WebGL resolution leaves those overlays independent. Geometry and texture
  uploads, world traversal, draw calls and simulation do not become smaller.
- PIX/MAT loading already controls texture magnification and mip filtering.
  Lowering framebuffer resolution preserves those rules; scaling the entire
  finished canvas is a separate operation. Low-resolution source textures do not
  eliminate the value of extra coverage samples for silhouettes and distant objects.

## Hardware measurements

Headed Chromium 156, WebGL2, ANGLE AMD Radeon Graphics, radeonsi gfx1150 / LLVM
19.1.7 / OpenGL 4.6. Hardware GPU, not SwiftShader. CSS viewport 1920 × 1080,
DPR 1.484375; default buffer 2850 × 1603. The physical screen was approximately
3K, **not a native 4K display**. The diagnostic 4K buffer exceeded the production
DPR cap to measure that render workload; it was downscaled for presentation.

Original Stock EagleGreen, Snow Way Out starting view and the previously adverse
Timber view. Paused simulation and fixed camera per series; unchanged visibility,
triangles and draw calls across resolutions. Timber issued 2234 sky+main calls;
Snow 1295. No simulation ticks elapsed. Each capture lasted 1.5 seconds after a
200 ms resize warmup; baseline repeated at the end. Workstation use and JIT/driver
variation remain possible. Another paused game tab's animation callback was held
during measurement and restored afterward without changing its simulation state.

| 3D buffer            | Pixels vs 4K | Snow GPU p50 | Timber GPU p50 | Snow FPS | Timber FPS |
| -------------------- | -----------: | -----------: | -------------: | -------: | ---------: |
| 3840 × 2160          |         100% |      2.47 ms |        2.52 ms |     60.0 |       54.0 |
| 2850 × 1603, default |        55.1% |      1.59 ms |        1.59 ms |     58.7 |       56.7 |
| 2560 × 1440          |        44.4% |      1.24 ms |        1.38 ms |     59.3 |       52.1 |
| 1920 × 1080          |        25.0% |      0.81 ms |        0.96 ms |     56.7 |       49.2 |
| 1280 × 720           |        11.1% |      0.40 ms |        0.49 ms |     59.3 |       52.7 |
| Default repeated     |        55.1% |      1.43 ms |        1.63 ms |     60.0 |       57.4 |

1080p saves approximately **62–67% of measured GPU time versus 4K**, or 1.6–1.7 ms.
720p saves 81–84%, or about 2.0 ms. Against the actual default, 1080p saves roughly
0.6–0.8 ms. These are render-pass GPU savings, **not FPS improvement percentages**.
CPU prepare+render p50 was 5.9–8.8 ms in Snow and 9.8–13.0 ms in Timber; lowering
resolution does not reliably reduce that work. FPS varies non-monotonically and
is refresh-limited near 60 in Snow. There is no credible positive FPS effect to
attribute to lower resolution in these samples, nor evidence that 1080p itself
caused the slower Timber capture.

RAF frame p50 was 16.7 ms for every variant. Snow p95 was 16.7–16.8 ms except
1080p at 33.2 ms; Timber p95 was about 33.3 ms except the repeated default at
16.8 ms. These short, quantized captures do not establish rare-stall behavior or
active crash-scene performance. They isolate raster workload rather than benchmark
full gameplay or predict another GPU's gain.

`tools/render-resolution-probe.mjs` wraps only presentation preparation and the
paired sky/main renderer calls. Asynchronous GPU queries span both passes without
`gl.finish`; all accepted captures completed their 37–45 queries, with zero pending
queries, no disjoint event and GL error zero. GPU intervals exclude browser
composition/presentation and may exclude the final default-framebuffer MSAA resolve.
CPU timings exclude preceding presentation/HUD work. CPU/GPU overlap: do not add
their times. Reports are ignored `artifacts/perf03-{timber-clean,snow}.json`.
The earlier `perf03-timber-resolution.json` series still had background presentation
work and is not the accepted FPS comparison.

## Visual comparison

Nine browser PNGs and an interactive split comparison are available locally in
`artifacts/perf03-quality/index.html`; open the file in Chromium. They remain
ignored because they contain original game imagery. Snow has default, 4K, 1440p,
1080p, smooth 720p and pixelated 720p. Timber has default, 1080p and pixelated 720p.
Timber quality captures use its normal starting camera, separately from the
adverse measurement camera. Each scene's comparison holds its framing constant.

Screenshots are compositor output at 2850 × 1604, rather than source render
buffers; the default GL buffer is 2850 × 1603. The 4K screenshot therefore cannot
show the quality of a native 4K monitor. Use the viewer's 1:1 device-pixel mode
to avoid hiding differences through fit-to-window downscaling.

| Approach                                    | Observed appearance / limitation                                                                                                           | Assessment                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Existing default / higher raster resolution | Cleaner silhouettes, rails, foliage edges and small figures. Original texture detail remains limited.                                      | Preserve as quality choice.                               |
| 1440p, browser scaling                      | Very close to default in these stills; modest edge/texture sampling differences.                                                           | Conservative balanced option.                             |
| 1080p, browser scaling                      | Slightly softer car outline, wing and distant detail; readable tested figures and signage. HUD stays sharp.                                | Useful performance option, no demonstrated FPS gain here. |
| 720p, browser scaling                       | Visibly softer; thin geometry and small silhouettes lose definition.                                                                       | Optional low-GPU preset, not a proposed default.          |
| 720p, pixelated scaling                     | Visible whole-frame blocks and stair steps, including already filtered textures. HUD stays sharp.                                          | Deliberate retro option, not universally better fidelity. |
| Spatial upscaler / sharpening               | Not implemented or measured. Could alter edge contrast, introduce halos and add another GPU pass. Cannot restore absent subpixel geometry. | Consider only after simple presets prove useful.          |

These are still-image observations. Motion shimmer, temporal stability and
recognition at a native 4K display need a later moving-camera playtest; no claim
that those qualities were measured here.

## Proposed policy, pending implementation decision

1. Keep current quality available. Offer explicit **Native**, **1440p budget**,
   **1080p budget**, and optionally **720p / Retro** choices. Budget means an
   absolute pixel-area ceiling, preserve aspect ratio and never upscale the render
   buffer beyond the normal native/DPR cap. HUD stays at its existing resolution.
   A 1440p budget is a conservative balanced candidate, not a measured FPS fix.
2. Prefer browser smooth scaling for normal presets. If desired expose pixelated
   scaling separately from resolution so texture filtering is not conflated with
   whole-frame pixelation.
3. Avoid FPS-only adaptive resolution: CPU stalls would reduce quality without
   reducing their cause. Any future adaptive policy should use measured GPU
   headroom and hysteresis, respect timer availability, and be evaluated separately.
4. Defer shader upscalers, temporal reconstruction and MSAA policy changes. They
   need their own quality/compatibility measurements; antialiasing was held fixed
   here and cannot be disabled on an already-created default WebGL context.

No production source, resizing behavior, simulation activation or view distance
changed during this investigation. PERF-03 remains open for the policy decision.

## References

- [MDN: image-rendering](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/image-rendering): browser scaling is distinct from texture sampling; `pixelated` is a scaling request, not a game-specific reconstruction filter.
- [MDN: disjoint timer queries](https://developer.mozilla.org/en-US/docs/Web/API/EXT_disjoint_timer_query): asynchronous timing, WebGL2 extension distinction and invalid/disjoint intervals.
- Local implementation: `src/main.ts`, `src/style.css`, `src/content.ts`,
  `src/native-material-render.ts`, `src/render-matrices.ts`.
