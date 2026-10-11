/** Opt-in browser diagnostic. Install with page.evaluate(installPerformanceProbe).
 * It changes no engine settings unless explicitly requested by a short capture.
 * Method durations are inclusive; nested rows must not be added together. */
export function installPerformanceProbe() {
  window.__c2Perf?.dispose();
  const c = window.carma;
  if (!c?.stats.ready)
    throw new Error("Load a race before installing the probe");
  const renderer = c.renderer,
    gl = renderer.getContext(),
    restores = [],
    reports = [];
  let active = null;
  const gpuTimer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  function wrap(owner, name, label = name) {
    if (typeof owner?.[name] !== "function") return;
    const original = owner[name];
    function measured(...args) {
      if (!active) return original.apply(this, args);
      const start = performance.now();
      const rendering = owner === renderer && name === "render";
      if (
        rendering &&
        gpuTimer &&
        args[1].layers.mask === 2 &&
        active.frameIntervals.length % 8 === 0 &&
        !active.gpuCurrent
      ) {
        const query = gl.createQuery();
        gl.beginQuery(gpuTimer.TIME_ELAPSED_EXT, query);
        active.gpuCurrent = query;
      }
      try {
        return original.apply(this, args);
      } finally {
        const ms = performance.now() - start;
        const row = (active.methods[label] ??= { calls: 0, ms: 0, maxMs: 0 });
        row.calls++;
        row.ms += ms;
        row.maxMs = Math.max(row.maxMs, ms);
        if (owner === renderer && name === "render") {
          active.renderCalls += renderer.info.render.calls;
          active.triangles += renderer.info.render.triangles;
          if (gpuTimer && args[1].layers.mask !== 2 && active.gpuCurrent) {
            gl.endQuery(gpuTimer.TIME_ELAPSED_EXT);
            active.gpuPending.push(active.gpuCurrent);
            active.gpuCurrent = null;
          }
        }
      }
    }
    owner[name] = measured;
    restores.push(() => {
      if (owner[name] === measured) owner[name] = original;
    });
  }
  wrap(renderer, "render", "renderer.render");
  wrap(c.scene, "updateMatrixWorld", "scene.updateMatrixWorld");
  wrap(c, "prepareRenderMatrices", "scene.prepareRenderMatrices");
  for (const name of [
    "updateFrame",
    "step",
    "advanceWorldContacts",
    "sweepWorldTrajectory",
    "collectBodyContacts",
    "solveContactGroups",
    "worldContacts",
    "syncStructuralState",
    "finishWorldGrooveFrame",
  ])
    wrap(c.simulation, name, `simulation.${name}`);
  for (const name of [
    "collectFaces",
    "syncNativeGeometry",
    "refreshDynamic",
    "querySurfaces",
    "raycast",
    "drivableWheelRaycast",
    "rebuildStatic",
  ])
    wrap(c.collision, name, `world.${name}`);
  for (const [name, owner] of [
    ["pedestrians", c.pedestrians],
    ["opponentFleet", c.opponentFleet],
    ["worldAnimation", c.worldAnimation],
    ["carAnimation", c.carAnimation],
    ["carTextures", c.carTextures],
    ["smoke", c.smoke],
  ])
    wrap(owner, "update", `${name}.update`);
  for (const name of [
    "bufferData",
    "bufferSubData",
    "texImage2D",
    "texSubImage2D",
    "compileShader",
    "linkProgram",
  ])
    wrap(gl, name, `gl.${name}`);
  const measuredRender = renderer.render;
  function distribution(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const percentile = (p) => sorted[Math.ceil(p * sorted.length) - 1];
    return {
      count: values.length,
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
      max: sorted.at(-1),
    };
  }
  function metadata() {
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    let meshCount = 0,
      visibleMeshes = 0;
    c.scene.traverse((object) => {
      if (!object.isMesh) return;
      meshCount++;
      let shown = true;
      for (let p = object; p; p = p.parent) if (!p.visible) shown = false;
      if (shown) visibleMeshes++;
    });
    return {
      viewport: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
      pixelRatio: renderer.getPixelRatio(),
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      antialias: gl.getContextAttributes().antialias,
      samples: gl.getParameter(gl.SAMPLES),
      gpuTimerAvailable: !!gl.getExtension("EXT_disjoint_timer_query_webgl2"),
      hardwareConcurrency: navigator.hardwareConcurrency,
      meshCount,
      visibleMeshes,
      pedestrians: c.pedestrians?.count ?? 0,
      activePedestrians:
        c.pedestrians?.states.filter((s) => s.active).length ?? 0,
      rivals: c.rivals.length,
      noncars: c.simulation?.noncars.length ?? 0,
      activeCars: c.simulation.cars.filter((body) =>
        c.simulation.isCarPhysicsActive(body),
      ).length,
      cameraFar: c.camera.far,
      programs: renderer.info.programs.length,
      geometryMemory: renderer.info.memory.geometries,
      textureMemory: renderer.info.memory.textures,
      position: c.player.state.position.toArray(),
      orientation: c.player.state.orientation.toArray(),
    };
  }
  async function capture({
    label = "baseline",
    durationMs = 2000,
    paused = true,
    pixelRatio,
    key,
    disableRender = false,
  } = {}) {
    if (active) throw new Error("A capture is already active");
    if (!(durationMs >= 250 && durationMs <= 5000))
      throw new Error(
        "Capture duration must be 250–5000 ms on the shared host",
      );
    const oldRatio = renderer.getPixelRatio(),
      oldPaused = c.paused;
    const render = renderer.render,
      canvas = renderer.domElement;
    let raf = 0,
      deadline = 0,
      captureState = null,
      taskObserver = null;
    try {
      c.paused = true;
      if (pixelRatio !== undefined) renderer.setPixelRatio(pixelRatio);
      renderer.render = disableRender ? () => {} : measuredRender;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const initial = metadata(),
        start = performance.now();
      const state = {
        methods: {},
        renderCalls: 0,
        triangles: 0,
        frameIntervals: [],
        longTasks: [],
        frames: [],
        gpuPending: [],
        gpuCurrent: null,
        gpuMs: [],
        gpuDisjoint: false,
      };
      captureState = state;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if (entry.startTime >= start)
            state.longTasks.push({
              startMs: entry.startTime - start,
              durationMs: entry.duration,
            });
      });
      observer.observe({ entryTypes: ["longtask"] });
      taskObserver = observer;
      const initialElapsed = c.simulation.elapsed,
        initialSkipped = c.stats.physicsSkippedMs;
      active = state;
      c.paused = paused;
      if (key)
        canvas.dispatchEvent(
          new KeyboardEvent("keydown", {
            code: key,
            bubbles: true,
          }),
        );
      let previous = performance.now();
      const frame = () => {
        const now = performance.now();
        state.frameIntervals.push(now - previous);
        state.frames.push({
          elapsedMs: now - start,
          frameMs: now - previous,
          position: c.player.state.position.toArray(),
          speed: c.player.state.speed,
          physicsTickMs: c.simulation.elapsed * 1000,
          mainDrawCalls: c.stats.drawCalls,
          mainTriangles: c.stats.triangles,
        });
        previous = now;
        if (gpuTimer) {
          state.gpuDisjoint ||= !!gl.getParameter(gpuTimer.GPU_DISJOINT_EXT);
          state.gpuPending = state.gpuPending.filter((query) => {
            if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))
              return true;
            if (!state.gpuDisjoint)
              state.gpuMs.push(
                gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6,
              );
            gl.deleteQuery(query);
            return false;
          });
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      await new Promise((resolve) => {
        deadline = setTimeout(resolve, durationMs);
      });
      const end = performance.now();
      active = null;
      cancelAnimationFrame(raf);
      observer.disconnect();
      const final = metadata();
      const report = {
        label,
        requestedDurationMs: durationMs,
        actualDurationMs: end - start,
        paused,
        disableRender,
        initial,
        final,
        frameMs: distribution(state.frameIntervals),
        intervalsOver50Ms: state.frameIntervals.filter((t) => t > 50).length,
        fps: (state.frameIntervals.length * 1000) / (end - start),
        methods: Object.fromEntries(
          Object.entries(state.methods).map(([name, r]) => [
            name,
            { ...r, meanMs: r.ms / r.calls },
          ]),
        ),
        meanDrawCalls: state.frameIntervals.length
          ? state.renderCalls / state.frameIntervals.length
          : null,
        meanTriangles: state.frameIntervals.length
          ? state.triangles / state.frameIntervals.length
          : null,
        simulationAdvancedMs: (c.simulation.elapsed - initialElapsed) * 1000,
        physicsSkippedMs: c.stats.physicsSkippedMs - initialSkipped,
        longTasks: state.longTasks,
        glError: gl.getError(),
        frames: state.frames,
        gpuElapsedMs: state.gpuDisjoint ? null : distribution(state.gpuMs),
        gpuDisjoint: state.gpuDisjoint,
        timingNote:
          "CPU wall times; nested method times are inclusive. No GPU stall/finish is injected. Capture is diagnostic, not a gameplay change.",
      };
      reports.push(report);
      return report;
    } finally {
      active = null;
      clearTimeout(deadline);
      cancelAnimationFrame(raf);
      taskObserver?.disconnect();
      if (captureState?.gpuCurrent) {
        gl.endQuery(gpuTimer.TIME_ELAPSED_EXT);
        gl.deleteQuery(captureState.gpuCurrent);
      }
      for (const query of captureState?.gpuPending ?? []) gl.deleteQuery(query);
      if (key)
        canvas.dispatchEvent(
          new KeyboardEvent("keyup", {
            code: key,
            bubbles: true,
          }),
        );
      renderer.render = render;
      renderer.setPixelRatio(oldRatio);
      c.paused = oldPaused;
    }
  }
  window.__c2Perf = {
    capture,
    metadata,
    reports,
    idle(value = true) {
      if (active) throw new Error("Finish the active capture first");
      c.paused = true;
      renderer.render = value ? () => {} : measuredRender;
    },
    dispose() {
      if (active) throw new Error("Finish the active capture before disposing");
      renderer.render = measuredRender;
      for (const restore of restores.reverse()) restore();
      delete window.__c2Perf;
    },
  };
  return metadata();
}
