/** Frozen-scene comparison for PERF-11. Setup and conformance checks are untimed. */
import { Box3, Matrix4, Quaternion, Vector3 } from "three";
import { cameraWorldQueries } from "../src/camera/world-queries.ts";

const faceIdentity = (surface) => ({
  actor: surface.actor?.uuid ?? null,
  face: surface.source?.renderTriangleIndex ?? surface.faceIndex ?? null,
  sourceFace: surface.source?.sourceFaceIndex ?? null,
  a: surface.a.toArray(),
  b: surface.b.toArray(),
  c: surface.c.toArray(),
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const counters = () => ({
  nodeTests: 0,
  leafTests: 0,
  indexBuilds: 0,
  faceBoundsBuilds: 0,
  candidateReferences: 0,
  returnedFaces: 0,
  queryCalls: 0,
  localQueries: 0,
  cellVisits: 0,
  legacyReferences: 0,
  guardSweepFaces: 0,
  guardEnvelopeFallbacks: 0,
  ordinaryRayFaceTests: 0,
});

export async function compareWorldFaceLocality(nodeIndices) {
  const c = window.carma,
    world = c?.simulation?.world;
  if (!c?.stats.ready || !c.paused || !world?.nativeScene)
    throw new Error("Load and pause an original race before diagnostics");
  const trackName = document.querySelector("#track-select")?.value ?? "";
  const defaults = /timber/i.test(trackName)
    ? [0, 4, 178, 192]
    : [
        0,
        4,
        Math.floor(c.track.pathNodes.length / 2),
        c.track.pathNodes.length - 1,
      ];
  const indices = nodeIndices ?? defaults;
  const [
    { WorldCollision: ReferenceWorld },
    { VehicleSimulation: ReferenceSimulation },
  ] = await Promise.all([
    import(/* @vite-ignore */ "/artifacts/perf11-reference/src/world.ts"),
    import(
      /* @vite-ignore */ "/artifacts/perf11-reference/src/physics/simulation.ts"
    ),
  ]);

  // Construct the comparison cache over the same paused immutable world input.
  const reference = new ReferenceWorld(
    world.sourceRoot,
    world.modifiers,
    world.sourceSnapshot,
    world.nativeScene,
  );
  for (const [body, entry] of world.dynamic)
    reference.addDynamic(
      body,
      entry.actor,
      entry.drivable,
      entry.worldCollider,
    );

  const savedDiagnostics = world.faceDiagnostics;
  const summary = (surface) => ({
    ...faceIdentity(surface),
    normal: surface.normal.toArray(),
    material: surface.material,
    flags: surface.faceFlags,
    materialFlags: surface.materialFlags,
    mode: surface.collisionMode,
  });
  const elapsed = (fn) => {
    const start = performance.now();
    const value = fn();
    return { value, ms: performance.now() - start };
  };
  const assertSame = (label, actual, expected) => {
    if (!same(actual, expected)) {
      window.__perf11Difference = { label, actual, expected };
      throw new Error(`${label}: exact legacy comparison differs`);
    }
  };
  const checkDeadline = (deadline) => {
    if (performance.now() > deadline)
      throw new Error("Frozen query capture exceeded its 2s bound");
  };
  const result = {
    track: trackName,
    nodes: [],
    nativeCollector: [],
    note: "Frozen paused-scene ABBA timings; setup/conformance excluded. No simulation, geometry mutation, or FPS claim.",
  };

  try {
    const sceneDeadline = performance.now() + 2000;
    for (const index of indices) {
      checkDeadline(sceneDeadline);
      const p = c.track.pathNodes[index];
      if (!p) throw new Error(`Missing authored path node ${index}`);
      const query = {
        min: new Vector3(p[0] - 0.4, p[1] - 0.1, p[2] - 0.6),
        max: new Vector3(p[0] + 0.4, p[1] + 0.65, p[2] + 0.6),
      };
      const legacy = (w) => w.querySurfaces(query.min, query.max, true);
      const local = () => world.queryLocalSurfaces(query.min, query.max, true);
      const oldColdStart = performance.now();
      const oldRows = legacy(reference);
      const coldOldMs = performance.now() - oldColdStart;
      const diag = counters();
      const saved = world.faceDiagnostics;
      world.faceDiagnostics = diag;
      const coldNew = elapsed(local);
      world.faceDiagnostics = saved;
      const newRows = coldNew.value;
      const queryCounters = structuredClone(diag);
      checkDeadline(sceneDeadline);
      const oldIds = oldRows.map(faceIdentity),
        newIds = newRows.map(faceIdentity);
      let cursor = 0;
      for (const id of newIds) {
        while (cursor < oldIds.length && !same(oldIds[cursor], id)) cursor++;
        if (cursor === oldIds.length)
          throw new Error(
            `Node ${index}: local faces are not an ordered legacy subset`,
          );
        cursor++;
      }
      const currentLegacy = world
        .querySurfaces(query.min, query.max, true)
        .map(summary);
      assertSame(
        `node ${index} broad query`,
        currentLegacy,
        oldRows.map(summary),
      );

      // The query-local hit path is compared against the archived broad query.
      const rayFrom = new Vector3(p[0], p[1] + 2, p[2]);
      const rayDelta = new Vector3(0, -4, 0);
      const oldCamera = cameraWorldQueries(reference),
        newCamera = cameraWorldQueries(world);
      const cameraRay = (queries) => {
        const hit = queries.ray(rayFrom, rayDelta);
        return hit && { fraction: hit.fraction, normal: hit.normal.toArray() };
      };
      assertSame(
        `node ${index} camera ray`,
        cameraRay(newCamera),
        cameraRay(oldCamera),
      );
      const oldCameraFaces = oldCamera
        .faces(query.min, query.max)
        .map((face) => ({
          point: face.point.toArray(),
          normal: face.normal.toArray(),
          twoSided: face.twoSided,
        }));
      const newCameraFaces = newCamera
        .faces(query.min, query.max)
        .map((face) => ({
          point: face.point.toArray(),
          normal: face.normal.toArray(),
          twoSided: face.twoSided,
        }));
      assertSame(
        `node ${index} camera box faces`,
        newCameraFaces,
        oldCameraFaces,
      );

      const makeBody = () => {
        const orientation = c.player.state.orientation.clone();
        let localBottom = Infinity;
        for (const hull of c.player.hulls)
          for (const vertex of hull.vertices)
            localBottom = Math.min(
              localBottom,
              vertex.clone().applyQuaternion(orientation).y,
            );
        const ground = world.height(p[0], p[2], p[1] + 2) ?? p[1];
        const position = new Vector3(p[0], ground - localBottom + 0.03, p[2]);
        return {
          ...c.player,
          state: {
            ...c.player.state,
            position,
            predictedPosition: position.clone(),
            orientation,
            predictedOrientation: orientation.clone(),
          },
          worldRecovery: false,
          worldOverlapDetected: false,
        };
      };
      const body = makeBody();
      const basePosition = body.state.position.clone(),
        baseOrientation = body.state.orientation.clone();
      const turn = new Quaternion();
      const poseFrom = (position, orientation) => (fraction) => ({
        position: position
          .clone()
          .add(new Vector3(0.08, -0.1, 0.04).multiplyScalar(fraction)),
        orientation: orientation
          .clone()
          .multiply(
            turn.setFromAxisAngle(new Vector3(0, 1, 0), 0.05 * fraction),
          ),
      });
      const pose = poseFrom(basePosition, baseOrientation);
      const invokeGuard = (
        w,
        Simulation,
        targetBody = body,
        targetPose = pose,
        targetPosition = basePosition,
        targetOrientation = baseOrientation,
      ) => {
        const context = Object.create(Simulation.prototype);
        context.world = w;
        return context.sweepWorldTrajectory(
          targetBody,
          4,
          targetPose,
          targetPosition,
          targetOrientation,
        );
      };
      const guardSummary = (guard) => ({
        fraction: guard.fraction,
        crossingFraction: guard.crossingFraction,
        contacts: guard.contacts.map((contact) => ({
          point: contact.point.toArray(),
          normal: contact.normal.toArray(),
          sourceType: contact.sourceType,
          faceFriction: contact.faceFriction,
          source: contact.sourceSurface
            ? faceIdentity(contact.sourceSurface)
            : null,
        })),
      });
      const guardDiagnostics = counters();
      const oldReferenceQuery = reference.querySurfaces;
      const legacyGuard = { returnedFaces: 0, queryCalls: 0 };
      reference.querySurfaces = function (...args) {
        legacyGuard.queryCalls++;
        const rows = oldReferenceQuery.apply(this, args);
        legacyGuard.returnedFaces += rows.length;
        return rows;
      };
      world.faceDiagnostics = guardDiagnostics;
      let newGuard;
      try {
        newGuard = invokeGuard(
          world,
          Object.getPrototypeOf(c.simulation).constructor,
        );
      } finally {
        world.faceDiagnostics = saved;
      }
      const newGuardCounters = structuredClone(guardDiagnostics);
      let oldGuard;
      try {
        oldGuard = invokeGuard(reference, ReferenceSimulation);
      } finally {
        reference.querySurfaces = oldReferenceQuery;
      }
      assertSame(
        `node ${index} trajectory guard`,
        guardSummary(newGuard),
        guardSummary(oldGuard),
      );
      reference.querySurfaces = oldReferenceQuery;

      const recoveryCases = [];
      for (const [kind, depth, flagged] of [
        // The base pose has 0.03 clearance: 0.032 leaves 0.002 existing
        // overlap and exercises the independent guard's unflagged recovery.
        ["shallow-unflagged", 0.032, false],
        ["shallow-flagged", 0.032, true],
        ["deep", 0.2, true],
      ]) {
        checkDeadline(sceneDeadline);
        const recoveryBody = {
          ...body,
          state: {
            ...body.state,
            position: basePosition.clone(),
            orientation: baseOrientation.clone(),
          },
          worldRecovery: false,
          worldOverlapDetected: false,
        };
        const savedPosition = recoveryBody.state.position.clone();
        const savedOrientation = recoveryBody.state.orientation.clone();
        const savedRecovery = recoveryBody.worldRecovery;
        const savedOverlap = recoveryBody.worldOverlapDetected;
        let actual, expected;
        try {
          recoveryBody.state.position.y -= depth;
          recoveryBody.worldRecovery = flagged;
          recoveryBody.worldOverlapDetected = flagged;
          const recoveryPosition = recoveryBody.state.position.clone();
          const recoveryOrientation = recoveryBody.state.orientation.clone();
          const recoveryPose = poseFrom(recoveryPosition, recoveryOrientation);
          actual = invokeGuard(
            world,
            Object.getPrototypeOf(c.simulation).constructor,
            recoveryBody,
            recoveryPose,
            recoveryPosition,
            recoveryOrientation,
          );
          expected = invokeGuard(
            reference,
            ReferenceSimulation,
            recoveryBody,
            recoveryPose,
            recoveryPosition,
            recoveryOrientation,
          );
          assertSame(
            `node ${index} ${kind} recovery trajectory`,
            guardSummary(actual),
            guardSummary(expected),
          );
        } finally {
          recoveryBody.state.position.copy(savedPosition);
          recoveryBody.state.orientation.copy(savedOrientation);
          recoveryBody.worldRecovery = savedRecovery;
          recoveryBody.worldOverlapDetected = savedOverlap;
        }
        recoveryCases.push({
          kind,
          depth,
          flagged,
          exact: true,
          fraction: actual.fraction,
          crossingFraction: actual.crossingFraction,
          contacts: actual.contacts.length,
        });
      }

      const measureQuery = (variant, repetitions = 5) => {
        checkDeadline(sceneDeadline);
        const run = variant === "new" ? local : () => legacy(reference);
        const start = performance.now();
        let rows;
        for (let repeat = 0; repeat < repetitions; repeat++) rows = run();
        return {
          variant,
          repetitions,
          ms: (performance.now() - start) / repetitions,
          rows: rows.length,
        };
      };
      const cold = {
        old: {
          variant: "old",
          repetitions: 1,
          ms: coldOldMs,
          rows: oldRows.length,
        },
        new: {
          variant: "new",
          repetitions: 1,
          ms: coldNew.ms,
          rows: newRows.length,
        },
      };
      const abba = [];
      for (const variant of ["old", "new", "new", "old"])
        abba.push(measureQuery(variant));

      const measureGuard = (variant, repetitions = 2) => {
        checkDeadline(sceneDeadline);
        const run =
          variant === "new"
            ? () =>
                invokeGuard(
                  world,
                  Object.getPrototypeOf(c.simulation).constructor,
                )
            : () => invokeGuard(reference, ReferenceSimulation);
        const start = performance.now();
        for (let repeat = 0; repeat < repetitions; repeat++) run();
        return {
          variant,
          repetitions,
          ms: (performance.now() - start) / repetitions,
        };
      };
      const guardAbba = [];
      for (const variant of ["old", "new", "new", "old"])
        guardAbba.push(measureGuard(variant));

      const nativeQuery = {
        bounds: new Box3(query.min, query.max),
        matrix: new Matrix4(),
      };
      const collect = (w, capacity) => {
        const events = [];
        const rows = w.collectFaces(nativeQuery, capacity, true, {
          onFace: (surface) =>
            events.push([
              "face",
              surface.native?.actor.id,
              surface.native?.nativeFaceIndex,
            ]),
          pullActorFromWorld: () => null,
          stopGroovidelic: (actor) => events.push(["stop", actor.uuid]),
        });
        return { rows: rows.map(summary), events };
      };
      const native = [];
      for (const capacity of [300, 1]) {
        const old = collect(reference, capacity),
          current = collect(world, capacity);
        assertSame(
          `node ${index} native collector cap ${capacity}`,
          current,
          old,
        );
        native.push({
          capacity,
          rows: current.rows.length,
          events: current.events.length,
          exact: true,
        });
      }
      checkDeadline(sceneDeadline);

      result.nodes.push({
        index,
        point: p,
        legacyCandidates: oldRows.length,
        localCandidates: newRows.length,
        orderedSubset: true,
        cameraRayExact: true,
        cameraFacesExact: true,
        guardExact: true,
        recoveryExact: true,
        recoveryCases,
        counters: { query: queryCounters, guard: newGuardCounters },
        legacyGuard,
        cold,
        queryAbba: abba,
        guardAbba,
        native,
      });
      result.nativeCollector.push({ node: index, cases: native });
    }
    const gl = c.renderer.getContext(),
      ext = gl.getExtension("WEBGL_debug_renderer_info");
    result.metadata = {
      backend: ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      dpr: devicePixelRatio,
      staticTriangles: world.triangles,
      dynamicOwners: world.dynamic.size,
      glError: gl.getError(),
    };
    return result;
  } finally {
    world.faceDiagnostics = savedDiagnostics;
  }
}
