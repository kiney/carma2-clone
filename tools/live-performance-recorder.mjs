/** Inject this opt-in function into an existing page, without reloading it.
 * Fixed-size scalar rings survive pauses and race/Simulation replacement.
 * No stepping, world-query wrappers, GPU waits, or changes to game settings.
 * Nested timings are inclusive: do not add them to their parent duration.
 */
export function installLivePerformanceRecorder(capacity = 512) {
  if (!Number.isInteger(capacity) || capacity < 16 || capacity > 4096)
    throw new Error("Recorder capacity must be an integer from 16 to 4096");
  window.__perf01LiveCapture?.stop?.();
  window.__perf01LiveRecorder?.stop?.();
  const columns = {
    ticks: [
      "generation",
      "timeMs",
      "elapsedSeconds",
      "cpuMs",
      "commitGuardMs",
      "projectionGuardMs",
      "worldGuardMs",
      "worldGuardCalls",
      "pairContactsMs",
      "pairContactsCalls",
      "worldContactsMs",
      "worldContactsCalls",
      "structuralSyncMs",
      "cars",
      "debris",
    ],
    updates: [
      "generation",
      "timeMs",
      "elapsedSeconds",
      "cpuMs",
      "ticks",
      "tickCpuMs",
      "requestedPeriodMs",
      "skippedMs",
    ],
    frames: [
      "generation",
      "timeMs",
      "elapsedSeconds",
      "intervalMs",
      "renderCpuMs",
      "renderCalls",
      "opponentCpuMs",
      "pedestrianCpuMs",
      "matrixCpuMs",
      "worldAnimationCpuMs",
      "gamePeriodMs",
      "totalSkippedMs",
      "playerHeading",
      "playerX",
      "playerZ",
      "cameraX",
      "cameraZ",
      "cameraQX",
      "cameraQY",
      "cameraQZ",
      "cameraQW",
      "drawCalls",
      "triangles",
      "movingWorldBodies",
    ],
    worldContacts: [
      "generation",
      "timeMs",
      "elapsedSeconds",
      "bodyIndex",
      "cpuMs",
      "transformsMs",
      "collectMs",
      "recoveryMs",
      "sweepMs",
      "reduceMs",
      "hulls",
      "rawFaces",
      "eligibleFaces",
      "sweepTests",
      "rejectedFaces",
      "contacts",
    ],
  };
  const rings = Object.fromEntries(
    Object.entries(columns).map(([key, names]) => [
      key,
      { data: new Float64Array(capacity * names.length), count: 0 },
    ]),
  );
  // Labels share the same bounded slots as scalar rows; no body is retained.
  const worldContactLabels = new Array(capacity).fill("");
  const record = (key, values) => {
    const ring = rings[key],
      width = columns[key].length;
    const offset = (ring.count++ % capacity) * width;
    for (let i = 0; i < width; i++) ring.data[offset + i] = values[i];
  };
  const frame = new Float64Array(6);
  let owners = [],
    restores = [],
    generation = 0,
    stopped = false,
    raf;
  let lastFrame, tick, update;
  function restore() {
    for (const fn of restores.reverse()) fn();
    restores = [];
  }
  function installWorldContactDiagnostics(sim) {
    const hadOwn = Object.prototype.hasOwnProperty.call(
      sim,
      "worldContactDiagnostics",
    );
    const descriptor = Object.getOwnPropertyDescriptor(
      sim,
      "worldContactDiagnostics",
    );
    const previous =
      typeof sim.worldContactDiagnostics === "function"
        ? sim.worldContactDiagnostics
        : undefined;
    function measured(profile) {
      try {
        return previous?.call(this, profile);
      } finally {
        const elapsed = Number(profile?.cpuMs);
        if (!stopped && Number.isFinite(elapsed) && elapsed >= 2) {
          const candidateName =
            profile.body?.name ??
            profile.body?.actor?.name ??
            profile.body?.group?.name;
          const name = typeof candidateName === "string" ? candidateName : "";
          const kind =
            typeof profile.body?.kind === "string" ? profile.body.kind : "body";
          const label = `${kind}:${name}`.slice(0, 64);
          const index = rings.worldContacts.count % capacity;
          record("worldContacts", [
            generation,
            performance.now(),
            sim.elapsed ?? NaN,
            identifyBody(sim, profile.body),
            elapsed,
            profile.transformsMs,
            profile.collectMs,
            profile.recoveryMs,
            profile.sweepMs,
            profile.reduceMs,
            profile.hulls,
            profile.rawFaces,
            profile.eligibleFaces,
            profile.sweepTests,
            profile.rejectedFaces,
            profile.contacts,
          ]);
          worldContactLabels[index] = label;
        }
      }
    }
    sim.worldContactDiagnostics = measured;
    restores.push(() => {
      if (sim.worldContactDiagnostics !== measured) return;
      if (hadOwn)
        Object.defineProperty(sim, "worldContactDiagnostics", descriptor);
      else delete sim.worldContactDiagnostics;
    });
  }
  function identifyBody(sim, body) {
    // Use current simulation rosters for a numeric identity without retaining bodies.
    let offset = 0;
    for (const key of [
      "cars",
      "debris",
      "movingWorld",
      "mineBodies",
      "pedBodies",
      "pedBoneBodies",
      "noncars",
    ]) {
      const roster = sim[key];
      if (!Array.isArray(roster)) continue;
      const index = roster.indexOf(body);
      if (index >= 0) return offset + index;
      offset += roster.length;
    }
    return -1;
  }
  function wrap(owner, name, measure) {
    if (typeof owner?.[name] !== "function") return;
    const hadOwn = Object.prototype.hasOwnProperty.call(owner, name);
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    const original = owner[name];
    function measured(...args) {
      if (stopped || window.carma?.paused) return original.apply(this, args);
      return measure.call(this, original, args);
    }
    // Preserve the existing observer contract for pure response collectors.
    // Otherwise timing wrappers disable native response-preparation reuse.
    if (
      ["worldContacts", "advanceWorldContacts", "collectBodyContacts"].includes(
        name,
      )
    )
      Object.defineProperty(measured, "correctionObserverSource", {
        value: original.correctionObserverSource ?? original,
      });
    owner[name] = measured;
    restores.push(() => {
      if (owner[name] !== measured) return;
      if (hadOwn) Object.defineProperty(owner, name, descriptor);
      else delete owner[name];
    });
  }
  function attach(c) {
    restore();
    const sim = c?.simulation;
    owners = [
      c,
      sim,
      sim?.bodyTrajectoryGuard,
      c?.renderer,
      c?.opponentFleet,
      c?.pedestrians,
      c?.worldAnimation,
    ];
    if (!sim) return;
    generation++;
    frame.fill(0);
    lastFrame = undefined;
    installWorldContactDiagnostics(sim);
    wrap(sim, "step", function (original, args) {
      const previous = tick;
      const current = new Float64Array(10);
      tick = current;
      const start = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        const ms = performance.now() - start;
        record("ticks", [
          generation,
          start,
          sim.elapsed,
          ms,
          ...current.slice(0, 9),
          sim.cars.length,
          sim.debris.length,
        ]);
        if (update) {
          update[0]++;
          update[1] += ms;
        }
        tick = previous;
      }
    });
    wrap(sim, "updateFrame", function (original, args) {
      const previous = update;
      const current = new Float64Array(2);
      update = current;
      const start = performance.now();
      let result;
      try {
        return (result = original.apply(this, args));
      } finally {
        record("updates", [
          generation,
          start,
          sim.elapsed,
          performance.now() - start,
          current[0],
          current[1],
          args[1],
          result?.skippedMs ?? NaN,
        ]);
        update = previous;
      }
    });
    wrap(sim.bodyTrajectoryGuard, "run", function (original, args) {
      const current = tick;
      if (!current) return original.apply(this, args);
      const slot = current[9]++ === 0 ? 0 : 1;
      const start = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        current[slot] += performance.now() - start;
      }
    });
    for (const [name, timeSlot, countSlot] of [
      ["advanceWorldContacts", 2, 3],
      ["collectBodyContacts", 4, 5],
      ["worldContacts", 6, 7],
      ["syncStructuralState", 8, undefined],
    ])
      wrap(sim, name, function (original, args) {
        const current = tick;
        if (!current) return original.apply(this, args);
        // Dormant props take a pure immediate return. Thousands of timer
        // reads here would inflate the very catch-up work being diagnosed.
        // Count these calls; their CPU remains inside the enclosing tick.
        if (name === "advanceWorldContacts" && args[0]?.properties.immovable) {
          current[countSlot]++;
          return original.apply(this, args);
        }
        const start = performance.now();
        try {
          return original.apply(this, args);
        } finally {
          current[timeSlot] += performance.now() - start;
          if (countSlot !== undefined) current[countSlot]++;
        }
      });
    for (const [owner, name, slot, countSlot] of [
      [c.renderer, "render", 0, 1],
      [c.opponentFleet, "update", 2],
      [c.pedestrians, "update", 3],
      [c, "prepareRenderMatrices", 4],
      [c.worldAnimation, "update", 5],
    ])
      wrap(owner, name, function (original, args) {
        const start = performance.now();
        try {
          return original.apply(this, args);
        } finally {
          frame[slot] += performance.now() - start;
          if (countSlot !== undefined) frame[countSlot]++;
        }
      });
  }
  function onFrame(now) {
    if (stopped) return;
    const c = window.carma,
      sim = c?.simulation;
    const next = [
      c,
      sim,
      sim?.bodyTrajectoryGuard,
      c?.renderer,
      c?.opponentFleet,
      c?.pedestrians,
      c?.worldAnimation,
    ];
    if (next.some((owner, i) => owner !== owners[i])) attach(c);
    if (c && sim && !c.paused) {
      if (lastFrame !== undefined)
        record("frames", [
          generation,
          now,
          sim.elapsed,
          now - lastFrame,
          ...frame,
          c.stats?.framePeriodMs ?? NaN,
          c.stats?.physicsSkippedMs ?? NaN,
          c.player?.state?.heading ?? NaN,
          c.player?.state?.position.x ?? NaN,
          c.player?.state?.position.z ?? NaN,
          c.camera?.position.x ?? NaN,
          c.camera?.position.z ?? NaN,
          c.camera?.quaternion.x ?? NaN,
          c.camera?.quaternion.y ?? NaN,
          c.camera?.quaternion.z ?? NaN,
          c.camera?.quaternion.w ?? NaN,
          c.stats?.drawCalls ?? NaN,
          c.stats?.triangles ?? NaN,
          sim.movingWorld?.length ?? NaN,
        ]);
      lastFrame = now;
    } else lastFrame = undefined;
    frame.fill(0);
    raf = requestAnimationFrame(onFrame);
  }
  const recorder = {
    version: 4,
    capacity,
    columns,
    rings,
    get generation() {
      return generation;
    },
    get stopped() {
      return stopped;
    },
    snapshot() {
      return {
        version: 4,
        generation,
        stopped,
        paused: window.carma?.paused,
        note: "Inclusive CPU timings, fixed scalar rings; generation changes on race/owner replacement. Frame buckets span recorder RAF callbacks, not the internal game frame boundary. No GPU timings. World guard time excludes counted immovable early returns; full tick time includes them.",
        columns,
        rows: Object.fromEntries(
          Object.entries(rings).map(([key, ring]) => {
            const width = columns[key].length,
              count = Math.min(capacity, ring.count);
            const rows = [];
            for (let i = ring.count - count; i < ring.count; i++) {
              const offset = (i % capacity) * width;
              rows.push(Array.from(ring.data.subarray(offset, offset + width)));
            }
            return [key, rows];
          }),
        ),
        worldContactLabels: (() => {
          const ring = rings.worldContacts;
          const count = Math.min(capacity, ring.count);
          const labels = [];
          for (let i = ring.count - count; i < ring.count; i++)
            labels.push(worldContactLabels[i % capacity]);
          return labels;
        })(),
      };
    },
    stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      restore();
    },
  };
  window.__perf01LiveRecorder = recorder;
  attach(window.carma);
  raf = requestAnimationFrame(onFrame);
  return {
    version: recorder.version,
    capacity,
    generation,
    paused: window.carma?.paused,
  };
}
