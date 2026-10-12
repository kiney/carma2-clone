/** Bounded frozen-scene comparison against a source-only archived revision.
 * Not imported by the app. Put `git archive 6a1b225` in ignored
 * artifacts/perf09-reference/ before serving this module through Vite. */
import { Box3, Matrix4, Vector3 } from "three";

export function worldSyncCounters() {
  return {
    dynamicChecks: 0,
    dynamicUnchanged: 0,
    dynamicChanged: 0,
    hierarchyChecks: 0,
    triangleBuilds: 0,
    nativeActorChecks: 0,
    nativeActorWrites: 0,
    nativeGeometryChecks: 0,
    nativeGeometryWrites: 0,
    transform: {
      resolved: 0,
      cacheHits: 0,
      localChecks: 0,
      compositions: 0,
      multiplications: 0,
      nativeUpdates: 0,
    },
  };
}

export async function compareWorldSynchronization(
  nodeIndices = [0, 4, 178, 192],
) {
  const c = window.carma,
    world = c?.collision;
  if (!c?.stats.ready || !c.paused || !world?.nativeScene)
    throw new Error("Load and pause an original race before diagnostics");
  const { WorldCollision: ReferenceWorld } = await import(
    /* @vite-ignore */ "/artifacts/perf09-reference/src/world.ts"
  );
  // Independent caches share the same frozen physical input. Reference setup
  // and cold dynamic registration are excluded from the bounded measurements.
  const reference = new ReferenceWorld(
    world.sourceRoot,
    world.modifiers,
    world.sourceSnapshot,
    world.nativeScene,
  );
  for (const [body, e] of world.dynamic)
    reference.addDynamic(body, e.actor, e.drivable, e.worldCollider);
  const summary = (s) => ({
    a: s.a.toArray(),
    b: s.b.toArray(),
    c: s.c.toArray(),
    normal: s.normal.toArray(),
    constant: s.constant,
    material: s.material,
    flags: s.faceFlags,
    materialFlags: s.materialFlags,
    actor: s.actor?.uuid,
    nativeActor: s.native?.actor.id,
    face: s.native?.sourceFaceIndex ?? s.faceIndex,
    collisionMode: s.collisionMode,
  });
  const same = (a, b) => {
    if (Array.isArray(a))
      return (
        Array.isArray(b) &&
        a.length === b.length &&
        a.every((v, i) => same(v, b[i]))
      );
    if (a && typeof a === "object")
      return (
        b &&
        typeof b === "object" &&
        Object.keys(a).length === Object.keys(b).length &&
        Object.keys(a).every((k) => same(a[k], b[k]))
      );
    return Object.is(a, b);
  };
  const oldDiagnostics = world.syncDiagnostics,
    deadline = performance.now() + 2000;
  const checkDeadline = () => {
    if (performance.now() > deadline)
      throw new Error("Capture exceeded 2s bound");
  };
  try {
    const native = [];
    for (const index of nodeIndices) {
      const p = c.track.pathNodes[index];
      if (!p) throw new Error(`Missing authored path node ${index}`);
      const query = {
        bounds: new Box3(
          new Vector3(p[0] - 0.4, p[1] - 0.1, p[2] - 0.6),
          new Vector3(p[0] + 0.4, p[1] + 0.65, p[2] + 0.6),
        ),
        matrix: new Matrix4(),
      };
      const run = (optimized, capacity = 300, repetitions = 5) => {
        checkDeadline();
        const w = optimized ? world : reference,
          events = [];
        world.syncDiagnostics = worldSyncCounters();
        const start = performance.now();
        let rows;
        for (let repeat = 0; repeat < repetitions; repeat++) {
          events.length = 0;
          rows = w.collectFaces(query, capacity, true, {
            onFace: (s) =>
              events.push([
                "face",
                s.native.actor.id,
                s.native.nativeFaceIndex,
              ]),
            stopGroovidelic: (o) => events.push(["stop", o.uuid]),
            pullActorFromWorld: (o) => {
              events.push(["pull", o.uuid]);
              return null;
            },
          });
        }
        const ms = (performance.now() - start) / repetitions;
        return {
          repetitions,
          rows: rows.map(summary),
          events,
          ms,
          optimized,
          counters: optimized
            ? world.syncDiagnostics
            : {
                nativeActorChecks:
                  world.nativeScene.actorObjects.size * repetitions,
                nativeGeometryChecks:
                  world.nativeScene.meshes.size * repetitions,
              },
        };
      };
      const baseline = run(false, 300, 1),
        cold = run(true, 300, 1),
        samples = [];
      if (
        !same(baseline.rows, cold.rows) ||
        !same(baseline.events, cold.events)
      )
        throw new Error(`Node ${index}: cold query differs from baseline`);
      for (const optimized of [false, true, true, false]) {
        const r = run(optimized);
        if (!same(baseline.rows, r.rows) || !same(baseline.events, r.events))
          throw new Error(`Node ${index}: warm query differs from baseline`);
        samples.push({
          ms: r.ms,
          optimized,
          repetitions: r.repetitions,
          counters: r.counters,
        });
      }
      const prefix = run(true, 1),
        baselinePrefix = run(false, 1);
      if (
        !same(prefix.rows, baselinePrefix.rows) ||
        !same(prefix.events, baselinePrefix.events)
      )
        throw new Error(`Node ${index}: capacity prefix differs from baseline`);
      native.push({
        index,
        point: p,
        rows: baseline.rows.length,
        events: baseline.events.length,
        exact: true,
        prefixExact: true,
        cold: { ms: cold.ms, counters: cold.counters },
        samples,
      });
    }
    const snapshots = (w) =>
      [...w.dynamic].map(([body, e]) => [body.kind, e.surfaces.map(summary)]);
    const dynamic = [];
    for (const changedCount of [0, Math.min(16, world.dynamic.size)]) {
      const changed = [...world.dynamic.values()].slice(0, changedCount),
        positions = changed.map((e) => e.actor.position.clone());
      try {
        changed.forEach((e) => (e.actor.position.x += 0.001));
        reference.refreshDynamic();
        world.refreshDynamic();
        if (!same(snapshots(reference), snapshots(world)))
          throw new Error("Dynamic owner triangles differ from baseline");
        const samples = [];
        for (let i = 0; i < 4; i++) {
          checkDeadline();
          const starts = changed.map((e) => e.actor.position.clone());
          const order = i % 2 ? [true, false] : [false, true];
          for (const optimized of order) {
            world.syncDiagnostics = worldSyncCounters();
            changed.forEach((e, j) => e.actor.position.copy(starts[j]));
            const start = performance.now();
            for (let repeat = 0; repeat < 5; repeat++) {
              changed.forEach((e) => (e.actor.position.x += 0.001));
              (optimized ? world : reference).refreshDynamic();
            }
            samples.push({
              optimized,
              repetitions: 5,
              ms: (performance.now() - start) / 5,
              counters: optimized
                ? world.syncDiagnostics
                : {
                    dynamicChecks: reference.dynamic.size * 5,
                    nativeHierarchyUpdates: reference.dynamic.size * 5,
                    rootMatrixStrings: reference.dynamic.size * 5,
                  },
            });
          }
          if (!same(snapshots(reference), snapshots(world)))
            throw new Error("Repeated dynamic refresh differs from baseline");
        }
        dynamic.push({ changedCount, exact: true, samples });
      } finally {
        changed.forEach((e, i) => e.actor.position.copy(positions[i]));
        reference.refreshDynamic();
        world.refreshDynamic();
      }
    }
    const gl = c.renderer.getContext(),
      debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      native,
      dynamic,
      metadata: {
        gpu: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
        viewport: [innerWidth, innerHeight],
        dpr: devicePixelRatio,
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        actors: world.nativeScene.actorObjects.size,
        meshes: world.nativeScene.meshes.size,
        dynamic: world.dynamic.size,
        bodies: c.simulation.allBodies().length,
        pedestrians: c.pedestrians?.count,
        glError: gl.getError(),
      },
      note: "Baseline 6a1b225; identical frozen physical inputs, no simulation. Cold setup excluded, inclusive ABBA query/refresh timings, all samples retained. Baseline work counts follow its unconditional scene-wide loops. Not an FPS benchmark.",
    };
  } finally {
    world.syncDiagnostics = oldDiagnostics;
  }
}
