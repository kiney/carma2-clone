/** Install a low-overhead runtime probe with only whole-step/frame wrappers.
 * Install via page.evaluate(installMinimalRuntimeProbe). Timings are inclusive.
 */
export function installMinimalRuntimeProbe(capacity = 4096) {
  if (!Number.isInteger(capacity) || capacity < 16 || capacity > 16384)
    throw new Error("Probe capacity must be an integer from 16 to 16384");
  window.__c2MinimalRuntimeProbe?.dispose?.();
  const c = window.carma,
    sim = c?.simulation;
  if (!c?.stats?.ready || !sim)
    throw new Error("Load a race before installing the minimal probe");
  const tickData = new Float64Array(capacity),
    updateData = new Float64Array(capacity * 3),
    originals = { step: sim.step, updateFrame: sim.updateFrame };
  if (
    typeof originals.step !== "function" ||
    typeof originals.updateFrame !== "function"
  )
    throw new Error("Simulation step/updateFrame methods are unavailable");
  let tickCount = 0,
    updateCount = 0,
    stopped = false;
  const now = () => performance.now();
  sim.step = function () {
    const started = now();
    try {
      return originals.step.apply(this, arguments);
    } finally {
      const elapsed = now() - started,
        index = tickCount++ % capacity;
      tickData[index] = elapsed;
    }
  };
  sim.updateFrame = function () {
    const started = now(),
      ticksBefore = tickCount;
    try {
      return originals.updateFrame.apply(this, arguments);
    } finally {
      const index = updateCount++ % capacity,
        offset = index * 3;
      updateData[offset] = now() - started;
      updateData[offset + 1] = tickCount - ticksBefore;
      updateData[offset + 2] = arguments[1] ?? NaN;
    }
  };
  const distribution = (values) => {
    if (!values.length) return null;
    values.sort((a, b) => a - b);
    const percentile = (p) => values[Math.ceil(values.length * p) - 1];
    return {
      count: values.length,
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
      max: values.at(-1),
    };
  };
  const metadata = () => {
    const gl = c.renderer.getContext(),
      debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      webglVersion: gl.getParameter(gl.VERSION),
      antialias: gl.getContextAttributes()?.antialias ?? null,
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      viewport: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
      position: c.player?.state?.position?.toArray?.() ?? null,
      orientation: c.player?.state?.orientation?.toArray?.() ?? null,
      readiness: {
        opponents: c.opponentsReady === true,
        pedestrianSystemInstalled: !!c.pedestrians,
      },
      population: {
        rivals: c.rivals?.length ?? 0,
        pedestrians: c.pedestrians?.states?.length ?? 0,
        activePedestrians:
          c.pedestrians?.states?.filter((state) => state.active).length ?? 0,
        cars: sim.cars?.length ?? 0,
        debris: sim.debris?.length ?? 0,
        noncars: sim.noncars?.length ?? 0,
        movingWorld: sim.movingWorld?.length ?? 0,
      },
    };
  };
  const getRange = (data, start, end, stride = 1, field = 0) => {
    const length = Math.min(end - start, capacity),
      values = new Array(length),
      first = end - length;
    for (let i = 0; i < length; i++)
      values[i] = data[((first + i) % capacity) * stride + field];
    return values;
  };
  function snapshotRange(startingTicks = 0, startingUpdates = 0) {
    const ticks = getRange(tickData, startingTicks, tickCount),
      updates = getRange(updateData, startingUpdates, updateCount, 3),
      tickCounts = getRange(updateData, startingUpdates, updateCount, 3, 1),
      periods = getRange(updateData, startingUpdates, updateCount, 3, 2);
    return {
      version: 1,
      totalTicks: tickCount,
      totalUpdates: updateCount,
      sampledTicks: ticks.length,
      sampledUpdates: updates.length,
      columns: {
        ticks: ["cpuMs"],
        updates: ["cpuMs", "ticks", "requestedPeriodMs"],
      },
      rows: {
        ticks: ticks.map((value) => [value]),
        updates: updates.map((value, index) => [
          value,
          tickCounts[index],
          periods[index],
        ]),
      },
      summary: {
        tickMs: distribution(ticks),
        updateMs: distribution(updates),
        ticksPerUpdate: distribution(tickCounts),
      },
      note: "Only sim.step and sim.updateFrame are wrapped; tick CPU is inclusive. Fixed typed-array rings retain the latest samples.",
    };
  }
  async function capture({
    label = "minimal",
    durationMs = 2500,
    key = "KeyW",
  } = {}) {
    if (stopped) throw new Error("Probe has been disposed");
    if (!(durationMs >= 250 && durationMs <= 5000))
      throw new Error("Capture duration must be 250–5000 ms");
    const oldPaused = c.paused,
      canvas = c.renderer.domElement,
      initial = metadata(),
      initialElapsed = sim.elapsed,
      initialGameTimeMs = c.stats.gameTimeMs,
      initialSkipped = c.stats.physicsSkippedMs,
      startingTicks = tickCount,
      startingUpdates = updateCount;
    let raf = 0,
      timer = 0,
      keyDown = false;
    const intervals = [];
    const start = now();
    let previous = start;
    const frame = () => {
      const current = now();
      intervals.push(current - previous);
      previous = current;
      raf = requestAnimationFrame(frame);
    };
    try {
      if (key) {
        keyDown = true;
        canvas.dispatchEvent(
          new KeyboardEvent("keydown", { code: key, bubbles: true }),
        );
      }
      c.paused = false;
      raf = requestAnimationFrame(frame);
      await new Promise((resolve) => {
        timer = setTimeout(resolve, durationMs);
      });
      const end = now(),
        elapsed = end - start,
        final = metadata(),
        result = snapshotRange(startingTicks, startingUpdates);
      return {
        label,
        requestedDurationMs: durationMs,
        actualDurationMs: elapsed,
        initial,
        final,
        frameMs: distribution([...intervals]),
        fps: (intervals.length * 1000) / elapsed,
        simulationAdvancedMs: (sim.elapsed - initialElapsed) * 1000,
        physicsSkippedMs: c.stats.physicsSkippedMs - initialSkipped,
        clocks: {
          initialElapsedSeconds: initialElapsed,
          finalElapsedSeconds: sim.elapsed,
          initialGameTimeMs,
          finalGameTimeMs: c.stats.gameTimeMs,
          initialPhysicsSkippedMs: initialSkipped,
          finalPhysicsSkippedMs: c.stats.physicsSkippedMs,
          wallDurationMs: elapsed,
        },
        runtime: {
          tickCount: tickCount - startingTicks,
          updateCount: updateCount - startingUpdates,
          tickRate: ((tickCount - startingTicks) * 1000) / elapsed,
          tickMs: result.summary.tickMs,
          updateMs: result.summary.updateMs,
          ticksPerUpdate: result.summary.ticksPerUpdate,
        },
        glError: c.renderer.getContext().getError(),
        timingNote:
          "CPU wall times; full sim.step/updateFrame durations are inclusive. The RAF sampler measures frame intervals; no GPU wait is injected.",
      };
    } finally {
      try {
        clearTimeout(timer);
        cancelAnimationFrame(raf);
      } finally {
        try {
          if (keyDown)
            canvas.dispatchEvent(
              new KeyboardEvent("keyup", { code: key, bubbles: true }),
            );
        } finally {
          c.paused = oldPaused;
        }
      }
    }
  }
  const probe = {
    version: 1,
    capacity,
    capture,
    snapshot: () => snapshotRange(),
    metadata,
    dispose() {
      if (stopped) return;
      stopped = true;
      if (sim.step === probe.wrappedStep) sim.step = originals.step;
      if (sim.updateFrame === probe.wrappedUpdateFrame)
        sim.updateFrame = originals.updateFrame;
      delete window.__c2MinimalRuntimeProbe;
    },
  };
  probe.wrappedStep = sim.step;
  probe.wrappedUpdateFrame = sim.updateFrame;
  window.__c2MinimalRuntimeProbe = probe;
  return { version: probe.version, capacity, ...metadata() };
}
