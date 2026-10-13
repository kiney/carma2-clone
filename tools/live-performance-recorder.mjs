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
    ],
  };
  const rings = Object.fromEntries(
    Object.entries(columns).map(([key, names]) => [
      key,
      { data: new Float64Array(capacity * names.length), count: 0 },
    ]),
  );
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
  function wrap(owner, name, measure) {
    if (typeof owner?.[name] !== "function") return;
    const hadOwn = Object.prototype.hasOwnProperty.call(owner, name);
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    const original = owner[name];
    function measured(...args) {
      if (stopped || window.carma?.paused) return original.apply(this, args);
      return measure.call(this, original, args);
    }
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
        ]);
      lastFrame = now;
    } else lastFrame = undefined;
    frame.fill(0);
    raf = requestAnimationFrame(onFrame);
  }
  const recorder = {
    version: 2,
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
        version: 2,
        generation,
        stopped,
        paused: window.carma?.paused,
        note: "Inclusive CPU timings, fixed scalar rings; generation changes on race/owner replacement. Frame buckets span recorder RAF callbacks, not the internal game frame boundary. No GPU timings.",
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
