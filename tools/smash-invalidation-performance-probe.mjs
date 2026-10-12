/** Short frozen-scene PERF-10 comparison; source-only baseline stays ignored.
 * This diagnostic prepares an original material tile in the paused scene.
 * Reload the race afterwards. No simulation loops or FPS claims. */
import { Box3, Matrix4, Vector3 } from "three";
import { WorldDestruction } from "../src/world-destruction.ts";
import { NativeSmashQueue } from "../src/smash-queue.ts";
import { worldSyncCounters } from "./world-sync-performance-probe.mjs";

export async function compareSmashInvalidation(materialName = "TEZFEN") {
  const c = window.carma,
    world = c?.simulation?.world;
  if (!c?.stats.ready || !c.paused || !world)
    throw new Error("Load and pause a race first");
  const { WorldCollision: ReferenceWorld } = await import(
    /* @vite-ignore */ "/artifacts/perf10-reference/src/world.ts"
  );
  const normalize = (name) => name.replace(/\.mat$/i, "").toUpperCase();
  const original = c.simulation.destruction;
  const spec = original.specs.find(
    (s) =>
      s.trigger.kind === "material" &&
      normalize(s.trigger.name) === normalize(materialName),
  );
  if (
    !spec ||
    spec.mode !== "texturechange" ||
    spec.levels[0]?.threshold <= 0.1
  )
    throw new Error(
      "Material lacks a below-threshold texture preparation case",
    );
  let target;
  for (const mesh of world.sourceMeshes ?? []) {
    let dynamic = false;
    for (let node = mesh; node; node = node.parent)
      if (node.userData.dynamicBody || world.dynamicOwners.has(node))
        dynamic = true;
    if (dynamic || !mesh.visible) continue;
    const used = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const slot = used.findIndex(
      (m) => normalize(m.name) === normalize(materialName),
    );
    if (slot < 0) continue;
    const group = mesh.geometry.groups.find(
      (g) => (g.materialIndex ?? 0) === slot,
    );
    target = { mesh, face: group ? group.start / 3 : 0 };
    break;
  }
  if (!target) throw new Error("No original static material owner found");
  const reference = new ReferenceWorld(
    world.sourceRoot,
    world.modifiers,
    world.sourceSnapshot,
    world.nativeScene,
  );
  for (const [body, e] of world.dynamic)
    reference.addDynamic(body, e.actor, e.drivable, e.worldCollider);
  // Geometry mutation installs actor-private MODEL identities. Sharing live
  // actor bindings across two independent caches would select the other cache's
  // face crosswalk. Restore each world's bindings outside its timed region.
  const captureBindings = () =>
    [...world.nativeScene.actorObjects.keys()].map((actor) => [
      actor,
      actor.localModel,
    ]);
  const bindings = new Map([
    [world, captureBindings()],
    [reference, captureBindings()],
  ]);
  const activate = (w) => {
    for (const [actor, model] of bindings.get(w)) actor.localModel = model;
  };
  let notifications = 0;
  const runtime = new WorldDestruction(world.sourceRoot, original.specs, {
    ...original.assets,
    random: () => 0,
    onChange: () => notifications++,
    onConnotations: undefined,
    onActivation: undefined,
  });
  const queue = new NativeSmashQueue();
  runtime.configureSmashQueue(queue);
  const { mesh } = target,
    geo = mesh.geometry,
    pos = geo.getAttribute("position");
  mesh.updateWorldMatrix(true, false);
  const point = new Vector3();
  for (let corner = 0; corner < 3; corner++) {
    const i = target.face * 3 + corner;
    point.addScaledVector(
      new Vector3().fromBufferAttribute(pos, geo.index ? geo.index.getX(i) : i),
      [0.2, 0.3, 0.5][corner],
    );
  }
  point.applyMatrix4(mesh.matrixWorld);
  const query = {
    bounds: new Box3(
      point.clone().addScalar(-0.3),
      point.clone().addScalar(0.3),
    ),
    matrix: new Matrix4(),
  };
  const summary = (s) => ({
    a: s.a.toArray(),
    b: s.b.toArray(),
    c: s.c.toArray(),
    normal: s.normal.toArray(),
    material: s.material,
    flags: s.faceFlags,
    materialFlags: s.materialFlags,
    mode: s.collisionMode,
    actor: s.actor?.uuid,
    face: s.native?.sourceFaceIndex ?? s.faceIndex,
  });
  const equivalent = () => {
    for (const capacity of [300, 1]) {
      const events = (w) => {
        activate(w);
        const log = [];
        const rows = w.collectFaces(query, capacity, true, {
          onFace: (s) => log.push(["face", s.native?.actor.id, s.faceIndex]),
          pullActorFromWorld: (a) => {
            log.push(["pull", a.uuid]);
            return null;
          },
          stopGroovidelic: (a) => log.push(["stop", a.uuid]),
        });
        bindings.set(w, captureBindings());
        return { rows: rows.map(summary), log };
      };
      const actual = events(world),
        expected = events(reference);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        window.__perf10Difference = { capacity, actual, expected };
        throw new Error(
          "Changed owner lost native rows/callback/capacity equivalence",
        );
      }
    }
    const a = world
      .querySurfaces(query.bounds.min, query.bounds.max, true)
      .map(summary);
    const b = reference
      .querySurfaces(query.bounds.min, query.bounds.max, true)
      .map(summary);
    if (JSON.stringify(a) !== JSON.stringify(b))
      throw new Error("Static candidate ordering differs from full rebuild");
  };
  const saved = world.syncDiagnostics,
    samples = [];
  const deadline = performance.now() + 2000;
  try {
    let faceIndex = target.face;
    for (let repeat = 0; repeat < 3; repeat++) {
      if (performance.now() > deadline)
        throw new Error("Capture exceeded 2s budget");
      const beforeGeometry = mesh.geometry,
        beforeRevision = runtime.geometryRevision;
      const result = runtime.handleContact({
        actor: mesh,
        material: materialName,
        faceIndex,
        point,
        kind: "body",
        normalImpulse: (0.1 + spec.levels[0].threshold) / 2,
        timeMs: 100 + repeat,
      });
      if (!result.changed || !result.changes.some((x) => x.requiresRebuild))
        throw new Error("Original native notification was not retained");
      faceIndex = result.changes[0].affectedFaceIndices[0];
      const actors = runtime.drainCollisionChanges();
      if (
        repeat &&
        (actors.length ||
          mesh.geometry !== beforeGeometry ||
          runtime.geometryRevision !== beforeRevision)
      )
        throw new Error("Unchanged original tile remains dirty");
      const run = (optimized) => {
        const w = optimized ? world : reference,
          counters = worldSyncCounters();
        activate(w);
        w.syncDiagnostics = counters;
        const start = performance.now();
        if (optimized) w.invalidateActors(actors);
        else {
          w.rebuildStatic();
          w.invalidateDynamic();
        }
        const ms = performance.now() - start;
        bindings.set(w, captureBindings());
        return {
          variant: optimized ? "new" : "old",
          ms,
          counters: structuredClone(counters),
          staticTriangleBuilds: optimized
            ? (counters.staticTriangleBuilds ?? 0)
            : w.triangles,
        };
      };
      const abba = [run(false), run(true), run(true), run(false)];
      equivalent();
      samples.push({
        repeat,
        changedActors: actors.length,
        geometryChanged: mesh.geometry !== beforeGeometry,
        revisionDelta: runtime.geometryRevision - beforeRevision,
        queueCount: queue.count,
        abba,
      });
    }
    const gl = c.renderer.getContext(),
      ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      track: document.querySelector("#track-select").value,
      material: materialName,
      threshold: spec.levels[0].threshold,
      staticTriangles: reference.triangles,
      dynamicOwners: world.dynamic.size,
      notifications,
      samples,
      glError: gl.getError(),
      backend: ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      dpr: devicePixelRatio,
      note: "Frozen original-material ABBA CPU captures; setup excluded, no simulation/FPS measurement. Reload race after diagnostic.",
    };
  } finally {
    activate(world);
    world.syncDiagnostics = saved;
    runtime.dispose();
  }
}
