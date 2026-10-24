/** Paused, fixed-camera resolution analysis. Install through page.evaluate.
 * Wraps only presentation preparation and the paired sky/main render calls.
 * GPU queries are asynchronous; never inject a GPU finish or simulation step. */
export function installRenderResolutionProbe() {
  window.__c2ResolutionProbe?.dispose();
  const c = window.carma,
    renderer = c?.renderer;
  if (!c?.stats.ready || !renderer || !c.paused)
    throw new Error(
      "Load and pause a scene before installing the resolution probe",
    );
  const gl = renderer.getContext();
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  const original = {
    render: renderer.render,
    prepare: c.prepareRenderMatrices,
    ratio: renderer.getPixelRatio(),
    scaling: renderer.domElement.style.imageRendering,
  };
  let active = null;
  const distribution = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return {
      count: values.length,
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
      p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
      max: sorted.at(-1),
    };
  };
  const metadata = () => {
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      viewport: [innerWidth, innerHeight],
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      pixelRatio: renderer.getPixelRatio(),
      dpr: devicePixelRatio,
      gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      samples: gl.getParameter(gl.SAMPLES),
      gpuTimer: !!timer,
      position: c.camera.position.toArray(),
      orientation: c.camera.quaternion.toArray(),
      cameraFar: c.camera.far,
      gameTime: c.stats.gameTimeMs,
      elapsed: c.simulation.elapsed,
      skipped: c.stats.physicsSkippedMs,
      mainCalls: c.stats.drawCalls,
      mainTriangles: c.stats.triangles,
    };
  };
  c.prepareRenderMatrices = function (...args) {
    const row = active,
      start = performance.now();
    if (row) row.frameStart = start;
    try {
      return original.prepare.apply(this, args);
    } finally {
      if (row) row.prepareCpu = performance.now() - start;
    }
  };
  renderer.render = function (...args) {
    const row = active,
      sky = args[1]?.layers.mask === 2;
    if (row && sky) {
      row.pairCount++;
      row.renderCpu = 0;
      row.calls = 0;
      row.triangles = 0;
      if (timer && row.pairCount % 2 === 0) {
        row.open = gl.createQuery();
        gl.beginQuery(timer.TIME_ELAPSED_EXT, row.open);
        row.issued++;
      }
    }
    const start = performance.now();
    try {
      return original.render.apply(this, args);
    } finally {
      if (row) {
        row.renderCpu += performance.now() - start;
        row.calls += renderer.info.render.calls;
        row.triangles += renderer.info.render.triangles;
        if (!sky) {
          if (row.open) {
            gl.endQuery(timer.TIME_ELAPSED_EXT);
            row.pending.push(row.open);
            row.open = null;
          }
          row.cpu.push(row.renderCpu);
          row.prepare.push(row.prepareCpu ?? 0);
          row.paired.push(performance.now() - row.frameStart);
          row.drawCalls.push(row.calls);
          row.triangleCounts.push(row.triangles);
        }
      }
    }
  };
  const poll = (row) => {
    if (!timer) return;
    row.disjoint ||= !!gl.getParameter(timer.GPU_DISJOINT_EXT);
    row.pending = row.pending.filter((query) => {
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return true;
      if (!row.disjoint)
        row.gpu.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(query);
      return false;
    });
  };
  const nextFrame = () =>
    new Promise((resolve) => requestAnimationFrame(resolve));
  const show = async (height, scaling = "auto") => {
    if (!c.paused)
      throw new Error("Resolution diagnostics require paused physics");
    if (!["auto", "pixelated"].includes(scaling))
      throw Error("Use auto or pixelated diagnostic scaling");
    const ratio = height == null ? original.ratio : height / innerHeight;
    if (!(Number.isFinite(ratio) && ratio > 0 && ratio <= 4))
      throw Error("Invalid diagnostic pixel ratio");
    renderer.domElement.style.imageRendering = scaling;
    renderer.setPixelRatio(ratio);
    await nextFrame();
    await nextFrame();
    return metadata();
  };
  const capture = async ({
    height = null,
    scaling = "auto",
    durationMs = 1500,
    label = "resolution",
  } = {}) => {
    if (
      active ||
      !Number.isFinite(durationMs) ||
      durationMs < 250 ||
      durationMs > 2000
    )
      throw Error("Use serial captures of 250–2000ms");
    const oldRatio = renderer.getPixelRatio(),
      oldScaling = renderer.domElement.style.imageRendering;
    let raf, row;
    try {
      await show(height, scaling);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const before = metadata(),
        start = performance.now();
      row = {
        cpu: [],
        prepare: [],
        paired: [],
        drawCalls: [],
        triangleCounts: [],
        intervals: [],
        gpu: [],
        pending: [],
        issued: 0,
        disjoint: false,
        pairCount: 0,
      };
      let previous;
      const frame = (time) => {
        if (previous !== undefined) row.intervals.push(time - previous);
        previous = time;
        poll(row);
        raf = requestAnimationFrame(frame);
      };
      active = row;
      raf = requestAnimationFrame(frame);
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      active = null;
      cancelAnimationFrame(raf);
      const end = performance.now();
      for (let i = 0; i < 12 && row.pending.length; i++) {
        await nextFrame();
        poll(row);
      }
      const after = metadata();
      return {
        label,
        before,
        after,
        actualDurationMs: end - start,
        frameMs: distribution(row.intervals),
        fps: 1000 / (distribution(row.intervals)?.mean ?? Infinity),
        renderCpuMs: distribution(row.cpu),
        prepareCpuMs: distribution(row.prepare),
        prepareAndRenderCpuMs: distribution(row.paired),
        calls: distribution(row.drawCalls),
        triangles: distribution(row.triangleCounts),
        gpuMs: row.disjoint ? null : distribution(row.gpu),
        gpuQueries: {
          issued: row.issued,
          completed: row.gpu.length,
          unresolved: row.pending.length,
          disjoint: row.disjoint,
        },
        glError: gl.getError(),
        scope:
          "Paused whole RAF cadence; CPU prepare+two render calls excludes earlier presentation/HUD work. GPU spans sky+main, overlaps CPU and must not be added to it.",
      };
    } finally {
      active = null;
      cancelAnimationFrame(raf);
      if (row?.open) {
        gl.endQuery(timer.TIME_ELAPSED_EXT);
        gl.deleteQuery(row.open);
      }
      for (const query of row?.pending ?? []) gl.deleteQuery(query);
      renderer.setPixelRatio(oldRatio);
      renderer.domElement.style.imageRendering = oldScaling;
    }
  };
  window.__c2ResolutionProbe = {
    metadata,
    capture,
    show,
    restore() {
      renderer.setPixelRatio(original.ratio);
      renderer.domElement.style.imageRendering = original.scaling;
    },
    dispose() {
      if (active) throw Error("Finish capture first");
      renderer.render = original.render;
      c.prepareRenderMatrices = original.prepare;
      this.restore();
      delete window.__c2ResolutionProbe;
    },
  };
  return metadata();
}
