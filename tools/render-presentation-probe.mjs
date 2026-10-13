/** Bounded browser diagnostic: page.evaluate(captureRenderPresentation, options).
 * Captures the scene's existing running/paused state. Durations are inclusive; nested
 * method rows must not be summed. No physics/renderer settings are changed. */
export async function captureRenderPresentation({
  durationMs = 500,
  maxFrames = 24,
  countVisits = true,
} = {}) {
  if (!(Number.isFinite(durationMs) && durationMs > 0 && durationMs <= 500))
    throw new Error(
      "Render capture duration must be positive and at most 500 ms",
    );
  if (!(Number.isInteger(maxFrames) && maxFrames > 0 && maxFrames <= 24))
    throw new Error("Render capture requires 1–24 frames");
  if (typeof countVisits !== "boolean")
    throw new Error("countVisits must be boolean");
  const c = window.carma;
  if (!c?.stats.ready || !c.scene || !c.renderer)
    throw new Error("Load a scene before render presentation capture");
  if (window.__c2RenderPresentationActive)
    throw new Error("A render presentation capture is already active");
  const token = {};
  window.__c2RenderPresentationActive = token;
  const restores = [],
    queries = new Set(),
    pending = [];
  let active = false,
    frame = null,
    phase = "presentation.other";
  let raf = 0,
    timer = 0,
    durationTimer = 0,
    openQuery = null;
  let gpuTimer, gl, stopCapture;
  const frames = [],
    intervals = [],
    methods = {},
    visits = {},
    gpuMs = [];
  const observedPoses = new Set(),
    observedBatches = new Set();
  const initialDiagnostics = new Map(),
    cleanupErrors = [];
  const matches = {
    calls: 0,
    matched: 0,
    rejected: 0,
    nodeSnapshots: 0,
    ancestorSnapshots: 0,
  };
  const gpu = {
    available: false,
    issued: 0,
    ready: 0,
    skippedBusy: 0,
    disjoint: false,
    pendingAtEnd: 0,
  };
  let started = 0,
    previousFrameEnd = null,
    stopReason = null;
  const physicsStart = c.simulation?.elapsed ?? null;
  const pausedAtStart = c.paused;
  function distribution(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const percentile = (p) => sorted[Math.ceil(sorted.length * p) - 1];
    return {
      count: values.length,
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      p50: percentile(0.5),
      p95: percentile(0.95),
      max: sorted.at(-1),
    };
  }
  function ensureFrame(now) {
    const id = c.stats.frames;
    if (frame && frame.id !== id) finishFrame(now, false);
    if (!active) return null;
    if (!frame)
      frame = {
        id,
        index: frames.length + 1,
        start: now,
        methods: {},
        visits: {},
        passes: {
          sky: { calls: 0, drawCalls: 0, triangles: 0 },
          main: { calls: 0, drawCalls: 0, triangles: 0 },
        },
      };
    return frame;
  }
  function finishFrame(now, complete) {
    if (!frame) return;
    frame.spanMs = now - frame.start;
    frame.complete = complete;
    if (previousFrameEnd !== null) intervals.push(now - previousFrameEnd);
    previousFrameEnd = now;
    frames.push(frame);
    frame = null;
    if (frames.length >= maxFrames) stopCapture?.("max-frames");
    else if (now - started >= durationMs) stopCapture?.("duration");
  }
  function addMethod(target, label, ms) {
    const row = (target[label] ??= { calls: 0, ms: 0, maxMs: 0 });
    row.calls++;
    row.ms += ms;
    row.maxMs = Math.max(row.maxMs, ms);
  }
  function pollGpu() {
    if (!gpuTimer) return;
    gpu.disjoint ||= !!gl.getParameter(gpuTimer.GPU_DISJOINT_EXT);
    for (let i = pending.length - 1; i >= 0; i--) {
      const query = pending[i];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
      gpu.ready++;
      if (!gpu.disjoint) {
        const ns = gl.getQueryParameter(query, gl.QUERY_RESULT);
        if (Number.isFinite(ns)) gpuMs.push(ns / 1e6);
      }
      gl.deleteQuery(query);
      queries.delete(query);
      pending.splice(i, 1);
    }
  }
  function beginGpuPair(current) {
    if (!gpuTimer || current.index % 8 !== 0 || openQuery) return;
    if (gl.getQuery(gpuTimer.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) {
      gpu.skippedBusy++;
      return;
    }
    const query = gl.createQuery();
    if (!query) return;
    queries.add(query);
    gl.beginQuery(gpuTimer.TIME_ELAPSED_EXT, query);
    openQuery = query;
    gpu.issued++;
  }
  function endGpuPair() {
    if (!openQuery) return;
    gl.endQuery(gpuTimer.TIME_ELAPSED_EXT);
    pending.push(openQuery);
    openQuery = null;
  }
  function wrap(owner, name, label, hooks = {}) {
    if (typeof owner?.[name] !== "function") return false;
    const descriptor = Object.getOwnPropertyDescriptor(owner, name),
      original = owner[name];
    function measured(...args) {
      if (!active) return original.apply(this, args);
      const start = performance.now(),
        current = ensureFrame(start),
        oldPhase = phase;
      if (!current) return original.apply(this, args);
      const selected = typeof label === "function" ? label(args) : label;
      phase = selected;
      let value;
      try {
        hooks.before?.(this, args, current);
        value = original.apply(this, args);
        return value;
      } finally {
        const ended = performance.now();
        addMethod(methods, selected, ended - start);
        addMethod(current.methods, selected, ended - start);
        try {
          hooks.after?.(this, args, current, value);
        } finally {
          phase = oldPhase;
        }
        if (hooks.frameEnd) finishFrame(ended, true);
      }
    }
    owner[name] = measured;
    restores.push(() => {
      if (owner[name] === measured) {
        if (descriptor) Object.defineProperty(owner, name, descriptor);
        else delete owner[name];
      }
    });
    return true;
  }
  function safeCounters(value, depth = 0) {
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "string"
    )
      return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (!value || typeof value !== "object" || depth >= 2) return undefined;
    const out = {};
    for (const key of Object.keys(value).slice(0, 32)) {
      const item = safeCounters(value[key], depth + 1);
      if (item !== undefined) out[key] = item;
    }
    return Object.keys(out).length ? out : undefined;
  }
  function readDiagnostics(instance) {
    const out = {};
    for (const key of ["diagnostics", "stats", "certificateStats"]) {
      const value = safeCounters(instance[key]);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  function observeInstance(instances, instance) {
    if (!instances.has(instance))
      initialDiagnostics.set(instance, readDiagnostics(instance));
    instances.add(instance);
  }
  function numericDelta(before, after) {
    const out = {};
    for (const [key, value] of Object.entries(after)) {
      if (typeof value === "number" && typeof before?.[key] === "number")
        out[key] = value - before[key];
      else if (value && typeof value === "object") {
        const nested = numericDelta(before?.[key], value);
        if (Object.keys(nested).length) out[key] = nested;
      }
    }
    return out;
  }
  function diagnostics(instances) {
    return [...instances].map((instance) => {
      const before = initialDiagnostics.get(instance) ?? {},
        after = readDiagnostics(instance);
      return { before, after, delta: numericDelta(before, after) };
    });
  }
  try {
    // Production exposes actual instances: importing TS sources there is not
    // available and would instrument a second class even if they were served.
    // Older dev pages can use their already-imported application modules.
    let posePrototype, batchPrototype;
    const binding = { poses: null, batches: null };
    if (c.renderPoses) {
      posePrototype = Object.getPrototypeOf(c.renderPoses);
      binding.poses = "actual-instance";
    } else {
      const { RenderPoses } = await import("/src/render-pose.ts");
      posePrototype = RenderPoses.prototype;
      binding.poses = "development-module";
    }
    if ("noncarRenderBatch" in c) {
      batchPrototype = c.noncarRenderBatch
        ? Object.getPrototypeOf(c.noncarRenderBatch)
        : null;
      binding.batches = batchPrototype ? "actual-instance" : "no-instance";
    } else {
      const { NonCarRenderBatch } = await import("/src/noncar-render.ts");
      batchPrototype = NonCarRenderBatch.prototype;
      binding.batches = "development-module";
    }
    const renderer = c.renderer;
    gl = renderer.getContext();
    gpuTimer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    gpu.available = !!gpuTimer;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    let matrixOwner = Object.getPrototypeOf(c.scene);
    while (
      matrixOwner &&
      !Object.prototype.hasOwnProperty.call(matrixOwner, "updateMatrixWorld")
    )
      matrixOwner = Object.getPrototypeOf(matrixOwner);
    if (!matrixOwner)
      throw new Error("Actual scene updateMatrixWorld prototype unavailable");
    if (countVisits) {
      const descriptor = Object.getOwnPropertyDescriptor(
          matrixOwner,
          "updateMatrixWorld",
        ),
        original = matrixOwner.updateMatrixWorld;
      function counted(...args) {
        if (active) {
          visits[phase] = (visits[phase] ?? 0) + 1;
          if (frame) frame.visits[phase] = (frame.visits[phase] ?? 0) + 1;
        }
        return original.apply(this, args);
      }
      matrixOwner.updateMatrixWorld = counted;
      restores.push(() => {
        if (matrixOwner.updateMatrixWorld === counted)
          Object.defineProperty(matrixOwner, "updateMatrixWorld", descriptor);
      });
    }
    for (const name of ["apply", "capture", "restore"])
      wrap(posePrototype, name, `pose.${name}`, {
        before: (self) => observeInstance(observedPoses, self),
        frameEnd: name === "restore",
      });
    wrap(batchPrototype, "update", "batch.update", {
      before: (self) => observeInstance(observedBatches, self),
    });
    wrap(batchPrototype, "stillMatches", "batch.stillMatches", {
      before: (self, args) => {
        observeInstance(observedBatches, self);
        matches.calls++;
        matches.nodeSnapshots += args[0]?.nodes?.length ?? 0;
        matches.ancestorSnapshots += args[0]?.ancestors?.length ?? 0;
      },
      after: (_self, _args, _frame, value) => {
        if (value) matches.matched++;
        else matches.rejected++;
      },
    });
    if (!wrap(c, "prepareRenderMatrices", "matrix.prepare"))
      throw new Error("Application prepareRenderMatrices hook unavailable");
    wrap(
      renderer,
      "render",
      (args) => (args[1]?.layers?.mask === 2 ? "render.sky" : "render.main"),
      {
        before: (_self, args, current) => {
          if (args[1]?.layers?.mask === 2) beginGpuPair(current);
          current.renderBefore = {
            calls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
          };
        },
        after: (_self, args, current) => {
          const kind = args[1]?.layers?.mask === 2 ? "sky" : "main",
            row = current.passes[kind];
          const before =
            renderer.info.autoReset === false
              ? current.renderBefore
              : { calls: 0, triangles: 0 };
          row.calls++;
          row.drawCalls += renderer.info.render.calls - before.calls;
          row.triangles += renderer.info.render.triangles - before.triangles;
          if (kind === "main") endGpuPair();
        },
      },
    );
    const metadata = {
      gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      viewport: [innerWidth, innerHeight],
      pixelRatio: renderer.getPixelRatio(),
      matrixPrototype: matrixOwner.constructor?.name ?? null,
      binding,
    };
    started = performance.now();
    active = true;
    await new Promise((resolve) => {
      stopCapture = (reason) => {
        if (stopReason !== null) return;
        stopReason =
          performance.now() - started >= 1500 ? "timeout-1500ms" : reason;
        active = false;
        resolve();
      };
      timer = setTimeout(() => stopCapture("timeout-1500ms"), 1500);
      durationTimer = setTimeout(() => stopCapture("duration"), durationMs);
      const observe = () => {
        if (!active) return;
        pollGpu();
        if (performance.now() - started >= durationMs) {
          stopCapture("duration");
          return;
        }
        raf = requestAnimationFrame(observe);
      };
      raf = requestAnimationFrame(observe);
    });
    const ended = performance.now();
    if (frame) finishFrame(ended, false);
    pollGpu();
    gpu.pendingAtEnd = pending.length + (openQuery ? 1 : 0);
    const methodSummary = {};
    for (const [label, row] of Object.entries(methods))
      methodSummary[label] = {
        ...row,
        perFrameMs: distribution(frames.map((f) => f.methods[label]?.ms ?? 0)),
        perFrameCalls: distribution(
          frames.map((f) => f.methods[label]?.calls ?? 0),
        ),
      };
    const passes = {};
    for (const kind of ["sky", "main"])
      passes[kind] = {
        calls: frames.reduce((n, f) => n + f.passes[kind].calls, 0),
        drawCalls: frames.reduce((n, f) => n + f.passes[kind].drawCalls, 0),
        triangles: frames.reduce((n, f) => n + f.passes[kind].triangles, 0),
        drawCallsPerFrame: distribution(
          frames.map((f) => f.passes[kind].drawCalls),
        ),
        trianglesPerFrame: distribution(
          frames.map((f) => f.passes[kind].triangles),
        ),
      };
    return {
      options: { durationMs, maxFrames, countVisits },
      metadata,
      elapsedMs: ended - started,
      stopReason,
      frames: frames.length,
      completeFrames: frames.filter((f) => f.complete).length,
      frameIntervalsMs: distribution(intervals),
      presentationSpanMs: distribution(frames.map((f) => f.spanMs)),
      methods: methodSummary,
      updateMatrixWorldVisits: countVisits ? visits : null,
      updateMatrixWorldVisitsPerFrame: countVisits
        ? Object.fromEntries(
            Object.keys(visits).map((label) => [
              label,
              distribution(frames.map((f) => f.visits[label] ?? 0)),
            ]),
          )
        : null,
      matrixVisitNote:
        "Prototype invocation counts by innermost phase; excludes direct updateWorldMatrix calls. Visit counting adds one counter increment per invocation; compare countVisits=false for instrumentation overhead.",
      stillMatches: {
        ...matches,
        note: "nodes/ancestors are available snapshot lengths per invocation, an upper bound on deep checks; early rejection may inspect fewer nodes.",
      },
      passes,
      totalDrawCalls: passes.sky.drawCalls + passes.main.drawCalls,
      totalTriangles: passes.sky.triangles + passes.main.triangles,
      gpu: {
        ...gpu,
        pairedMs: gpu.disjoint ? null : distribution(gpuMs),
        note: "Every 8th captured sky/main pair, asynchronously ready results only; pending queries are discarded without waiting.",
      },
      diagnostics: {
        poses: diagnostics(observedPoses),
        batches: diagnostics(observedBatches),
      },
      cleanupErrors,
      physics: {
        pausedAtStart,
        pausedAtEnd: c.paused,
        elapsedDelta:
          physicsStart === null
            ? null
            : (c.simulation?.elapsed ?? physicsStart) - physicsStart,
      },
      timingNote:
        "Method durations are inclusive; batch.update includes stillMatches. Per-frame spans begin at the first timed hook, not the start of the application's entire frame.",
    };
  } finally {
    active = false;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    clearTimeout(durationTimer);
    const cleanup = (action) => {
      try {
        action();
      } catch (error) {
        cleanupErrors.push(String(error));
      }
    };
    if (openQuery && gpuTimer && gl)
      cleanup(() => gl.endQuery(gpuTimer.TIME_ELAPSED_EXT));
    openQuery = null;
    for (let i = restores.length - 1; i >= 0; i--) cleanup(restores[i]);
    if (gl) for (const query of queries) cleanup(() => gl.deleteQuery(query));
    if (window.__c2RenderPresentationActive === token)
      delete window.__c2RenderPresentationActive;
  }
}

/** One-shot browser submission estimate from actual retained batch records.
 * Does not draw, move, update the batch, or change graphics settings. A missing
 * geometry bounding sphere is computed once using the geometry's native API. */
export function estimateScenerySubmission() {
  const c = window.carma,
    batch = c?.noncarRenderBatch,
    camera = c?.camera;
  if (
    !c?.stats.ready ||
    !batch ||
    !camera ||
    !Array.isArray(batch.instances) ||
    !(batch.bodies instanceof Map)
  )
    throw new Error(
      "Loaded scene and original NONCAR batch diagnostic records required",
    );
  const start = performance.now();
  const Matrix4 = c.scene.matrixWorld.constructor;
  const projection = new Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const m = projection.elements;
  const combination = (axis, sign) =>
    sign === 1
      ? [
          m[3] + m[axis],
          m[7] + m[axis + 4],
          m[11] + m[axis + 8],
          m[15] + m[axis + 12],
        ]
      : [
          m[3] - m[axis],
          m[7] - m[axis + 4],
          m[11] - m[axis + 8],
          m[15] - m[axis + 12],
        ];
  const rawPlanes = [
    combination(0, -1),
    combination(0, 1),
    combination(1, 1),
    combination(1, -1),
  ];
  const depthPlane = [m[2], m[6], m[10], m[14]];
  if (camera.reversedDepth) rawPlanes.push(depthPlane, combination(2, -1));
  else {
    rawPlanes.push(combination(2, -1));
    // Three's stable coordinate-system values: WebGL2000, WebGPU2001.
    if (
      camera.coordinateSystem === undefined ||
      camera.coordinateSystem === 2000
    )
      rawPlanes.push(combination(2, 1));
    else if (camera.coordinateSystem === 2001) rawPlanes.push(depthPlane);
    else throw new Error("Unsupported camera clip coordinate system");
  }
  const planes = rawPlanes.map((p) => {
    const length = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
    if (!(length > 0 && Number.isFinite(length)))
      throw new Error("Nonfinite/degenerate scenery camera plane");
    const inverse = 1 / length;
    return p.map((n) => n * inverse);
  });
  const intersectsSphere = (s) =>
    planes.every(
      (p) =>
        p[0] * s.center.x + p[1] * s.center.y + p[2] * s.center.z + p[3] >=
        -s.radius,
    );
  const visibleHierarchy = (object) => {
    for (let p = object; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  const sourceGroups = new Map(batch.instances.map((group) => [group, []]));
  let retainedBodies = 0,
    unpulledBodies = 0,
    eligibleSources = 0;
  for (const record of batch.bodies.values()) {
    retainedBodies++;
    if (record.pulled) continue;
    unpulledBodies++;
    for (const source of record.meshes) {
      if (
        !source.renderable ||
        !source.uploaded ||
        !source.batch ||
        source.slot === undefined
      )
        continue;
      const members = sourceGroups.get(source.batch);
      if (members) {
        members.push(source);
        eligibleSources++;
      }
    }
  }
  let sphereComputations = 0;
  const sphereFor = (geometry) => {
    if (geometry.boundingSphere === null) {
      geometry.computeBoundingSphere();
      sphereComputations++;
    }
    return geometry.boundingSphere;
  };
  function geometryDraw(geometry, material) {
    const vertices = geometry.getAttribute("position")?.count ?? 0;
    const available = geometry.index?.count ?? vertices;
    const range = geometry.drawRange ?? { start: 0, count: Infinity };
    const drawStart = Math.max(0, range.start),
      drawEnd = Math.min(available, range.start + range.count);
    let count = 0,
      calls = 0,
      wireframe = false;
    const add = (mat, group) => {
      if (!mat || mat.visible === false) return;
      const from = Math.max(drawStart, group?.start ?? 0),
        to = Math.min(drawEnd, group ? group.start + group.count : Infinity);
      const items = Math.max(0, to - from);
      if (!items) return;
      if (mat.wireframe) {
        wireframe = true;
        return;
      }
      calls++;
      count += items;
    };
    if (Array.isArray(material))
      for (const group of geometry.groups)
        add(material[group.materialIndex], group);
    else add(material, null);
    return {
      vertices,
      available,
      elementCount: count,
      baseDrawCalls: calls,
      baseTriangles: count / 3,
      wireframeExcluded: wireframe,
    };
  }
  const totals = {
    groups: batch.instances.length,
    groupsSubmittedUpperBound: 0,
    slotCapacity: 0,
    slotsSubmittedUpperBound: 0,
    eligibleSources,
    sphereVisibleSources: 0,
    baseDrawCallsUpperBound: 0,
    positionVerticesInSubmittedGroups: 0,
    submittedElementReferencesUpperBound: 0,
    submittedTrianglesUpperBound: 0,
    eligibleSourceTriangles: 0,
    sphereVisibleTriangles: 0,
  };
  const groups = [];
  const instanceMatrix = new Matrix4(),
    worldMatrix = new Matrix4();
  for (let index = 0; index < batch.instances.length; index++) {
    const group = batch.instances[index],
      mesh = group.mesh,
      geometry = mesh.geometry;
    const sources = sourceGroups.get(group) ?? [];
    const draw = geometryDraw(geometry, mesh.material);
    const slots = mesh.count ?? group.records.length;
    const shown =
      visibleHierarchy(mesh) &&
      (mesh.layers.mask & camera.layers.mask) !== 0 &&
      draw.baseDrawCalls > 0;
    const sphere = sources.length ? sphereFor(geometry) : null;
    let visible = 0,
      invalidSpheres = 0;
    for (const source of sources) {
      // Hidden zero matrices never enter this loop: their pulled/unuploaded or
      // nonrenderable records were filtered BEFORE any sphere computation.
      mesh.getMatrixAt(source.slot, instanceMatrix);
      worldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
      const worldSphere = sphere?.clone().applyMatrix4(worldMatrix);
      if (
        !worldSphere ||
        ![
          worldSphere.center.x,
          worldSphere.center.y,
          worldSphere.center.z,
          worldSphere.radius,
        ].every(Number.isFinite) ||
        worldSphere.radius < 0
      ) {
        invalidSpheres++;
        continue;
      }
      if (shown && intersectsSphere(worldSphere)) visible++;
    }
    const submittedTriangles = shown ? draw.baseTriangles * slots : 0;
    totals.slotCapacity += slots;
    totals.slotsSubmittedUpperBound += shown ? slots : 0;
    totals.groupsSubmittedUpperBound += shown ? 1 : 0;
    totals.baseDrawCallsUpperBound += shown ? draw.baseDrawCalls : 0;
    totals.positionVerticesInSubmittedGroups += shown
      ? draw.vertices * slots
      : 0;
    totals.submittedElementReferencesUpperBound += shown
      ? draw.elementCount * slots
      : 0;
    totals.submittedTrianglesUpperBound += submittedTriangles;
    totals.eligibleSourceTriangles += shown
      ? draw.baseTriangles * sources.length
      : 0;
    totals.sphereVisibleSources += visible;
    totals.sphereVisibleTriangles += draw.baseTriangles * visible;
    groups.push({
      index,
      geometry: geometry.name || null,
      slotCapacity: slots,
      eligiblePopulation: sources.length,
      sphereVisiblePopulation: visible,
      invalidSpheres,
      shown,
      frustumCulled: mesh.frustumCulled,
      geometryDraw: draw,
      submittedTrianglesUpperBound: submittedTriangles,
      eligibleSourceTriangles: shown ? draw.baseTriangles * sources.length : 0,
      sphereVisibleTriangles: draw.baseTriangles * visible,
    });
  }
  const main = {
    drawCalls: c.stats.drawCalls ?? null,
    triangles: c.stats.triangles ?? null,
  };
  return {
    camera: {
      near: camera.near,
      far: camera.far,
      layers: camera.layers.mask,
      coordinateSystem: camera.coordinateSystem,
      reversedDepth: camera.reversedDepth ?? false,
    },
    retainedBodies,
    unpulledBodies,
    noncars: c.simulation?.nonCarCensus?.() ?? null,
    totals,
    groups,
    main,
    rendererLastPass: {
      drawCalls: c.renderer.info.render.calls,
      triangles: c.renderer.info.render.triangles,
    },
    mainTriangleShareUpperBound:
      main.triangles > 0
        ? totals.submittedTrianglesUpperBound / main.triangles
        : null,
    sphereComputations,
    estimateCpuMs: performance.now() - start,
    notes: [
      "One-shot snapshot; eligible source spheres use actual uploaded instance transforms, never hidden zero-origin slots. Sphere/frustum intersections include partially visible and occluded geometry.",
      "Submission upper bound uses allocated mesh.count slots and primary triangle draw ranges/material groups. Hidden slots still consume submitted vertex work in a drawn global group; their zero matrices do not contribute to visible-source estimates. Position-attribute counts are reported separately from indexed element references; neither implies measured vertex-shader invocation counts.",
      "Scope is the batch's retained population only. Pulled/runtime-spawned NONCARs drawing as ordinary source actors are excluded from these group estimates; the live NONCAR census is reported separately.",
      "Group camera-frustum rejection, occlusion, custom clipping, transparent double passes, shadows and other passes are not modeled. Current globally unculled groups submit all allocated slots when hierarchy/layers/material permit. No GPU milliseconds are inferred from counts.",
    ],
  };
}
