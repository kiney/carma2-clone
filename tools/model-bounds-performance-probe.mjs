/** Opt-in, bounded same-input cached/uncached native collector comparison.
 * Serve from the local source server. No simulation steps or original-file edits. */
import { Box3, Matrix4, Vector3 } from "three";
import { manageNativeTrackBounds } from "../src/native-track-resources.ts";

export function compareNativeModelBounds(nodeIndices = [0, 4, 178, 192]) {
  const c = window.carma,
    world = c?.collision;
  if (!c?.stats.ready || !c.paused || !world?.nativeScene)
    throw new Error(
      "Load and pause an original race before collection diagnostics",
    );
  const originalOptions = world.nativeModelBoundsOptions;
  const resources = [...new Set(world.nativeScene.resources.values())];
  const modelIds = new Map(resources.map((r, i) => [r, i]));
  const counters = () => ({
    requests: 0,
    cacheHits: 0,
    computations: 0,
    verticesVisited: 0,
    unmanagedRequests: 0,
  });
  const equal = (a, b) => {
    if (Array.isArray(a))
      return (
        Array.isArray(b) &&
        a.length === b.length &&
        a.every((v, i) => equal(v, b[i]))
      );
    if (a && typeof a === "object")
      return (
        b &&
        typeof b === "object" &&
        Object.keys(a).length === Object.keys(b).length &&
        Object.keys(a).every((k) => equal(a[k], b[k]))
      );
    return Object.is(a, b);
  };
  const summarize = (row) => ({
    actor: row.native.actor.id,
    model: modelIds.get(row.native.model),
    sourceFace: row.native.sourceFaceIndex,
    nativeFace: row.native.nativeFaceIndex,
    a: row.a.toArray(),
    b: row.b.toArray(),
    c: row.c.toArray(),
    normal: row.normal.toArray(),
    constant: row.constant,
    flags: row.faceFlags,
    material: row.material,
  });
  const deadline = performance.now() + 1500,
    reports = [];
  try {
    // Runtime scene.resources are admitted engine-owned MODELs; reset only their
    // bounds caches, leaving preparation, revisions and geometry untouched.
    for (const resource of resources) manageNativeTrackBounds(resource);
    for (const index of nodeIndices) {
      const point = c.track.pathNodes[index];
      if (!point) throw new Error(`Missing authored path node ${index}`);
      const query = {
        bounds: new Box3(
          new Vector3(point[0] - 0.4, point[1] - 0.1, point[2] - 0.6),
          new Vector3(point[0] + 0.4, point[1] + 0.65, point[2] + 0.6),
        ),
        matrix: new Matrix4(),
      };
      const run = (cache, capacity = 300) => {
        const diagnostics = counters(),
          events = [];
        world.nativeModelBoundsOptions = { cache, diagnostics };
        const start = performance.now();
        const rows = world.collectFaces(query, capacity, true, {
          onFace: (row) =>
            events.push([
              "face",
              row.native.actor.id,
              row.native.nativeFaceIndex,
            ]),
          stopGroovidelic: (object) => events.push(["stop", object.uuid]),
          pullActorFromWorld: (object) => {
            events.push(["pull", object.uuid]);
            return null;
          },
        });
        const ms = performance.now() - start;
        return { rows: rows.map(summarize), events, diagnostics, ms };
      };
      const cold = run(true),
        reference = run(false);
      if (
        !equal(cold.rows, reference.rows) ||
        !equal(cold.events, reference.events)
      )
        throw new Error(`Node ${index}: collector/callback mismatch`);
      const samples = [];
      for (const cache of [false, true, true, false]) {
        if (performance.now() > deadline)
          throw new Error("Collector comparison exceeded 1.5s bound");
        const result = run(cache);
        if (
          !equal(result.rows, reference.rows) ||
          !equal(result.events, reference.events)
        )
          throw new Error(`Node ${index}: live query changed during capture`);
        samples.push({
          cache,
          ms: result.ms,
          rows: result.rows.length,
          ...result.diagnostics,
        });
      }
      const prefix = run(true, 1),
        baselinePrefix = run(false, 1);
      if (
        !equal(prefix.rows, baselinePrefix.rows) ||
        !equal(prefix.events, baselinePrefix.events)
      )
        throw new Error(`Node ${index}: capacity prefix/callback mismatch`);
      reports.push({
        index,
        point,
        cold: { ms: cold.ms, rows: cold.rows.length, ...cold.diagnostics },
        exact: true,
        prefixExact: true,
        callbacks: reference.events.length,
        samples,
      });
    }
    const gl = c.renderer.getContext(),
      debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      reports,
      resources: resources.length,
      metadata: {
        viewport: [innerWidth, innerHeight],
        dpr: devicePixelRatio,
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
        glError: gl.getError(),
        bodies: c.simulation.allBodies().length,
        pedestrians: c.pedestrians?.count,
        position: c.player.state.position.toArray(),
      },
      note: "Frozen original scene, no simulation steps. Cold preparation separated; serial ABBA cached/uncached collection with exact ordered rows/callbacks, capacity-prefix checks and all samples retained. Inclusive collector times include actor synchronization and callbacks. Not an FPS prediction.",
    };
  } finally {
    world.nativeModelBoundsOptions = originalOptions;
  }
}
