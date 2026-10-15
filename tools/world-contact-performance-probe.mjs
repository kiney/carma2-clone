/** Bounded, frozen original-world contact workloads; never an application restore. */
import { Box3 } from "three";
import { parseCarMechanics } from "../src/mechanics.ts";
import { createMotionParameters } from "../src/physics/motion.ts";
import { createHierarchyMotionPhase } from "../src/physics/hierarchy-motion.ts";
import { hydrateCapturedBodies } from "../tests/support/captured-bodies.mjs";

function worldSyncCounters() {
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

export async function prepareWorldContactProfile(
  snapshot,
  trackName = "desert2",
) {
  const c = window.carma;
  c.paused = true;
  c.renderer.render = () => {};
  const prototype = Object.getPrototypeOf(c.simulation);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "updateFrame");
  prototype.updateFrame = () => ({ steps: 0, skippedMs: 0 });
  try {
    const track = [...document.querySelector("#track-select").options].find(
      (option) =>
        option.value.toLowerCase() ===
        `data/races/${trackName}/${trackName}.txt`,
    );
    const car = [...document.querySelector("#car-select").options].find(
      (option) => /^data\/cars\/eagle3\/eagle3\.txt$/i.test(option.value),
    );
    if (!track || !car)
      throw new Error(`Original ${trackName} and Eagle3 required`);
    document.querySelector("#track-select").value = track.value;
    document.querySelector("#car-select").value = car.value;
    await c.loadRace();
    const deadline = performance.now() + 90000;
    while (!(c.stats.ready && c.opponentsReady)) {
      if (c.stats.ready) c.paused = true;
      if (performance.now() > deadline) throw new Error("Race load timeout");
      await new Promise((done) => setTimeout(done, 25));
    }
    c.paused = true;
  } finally {
    if (descriptor) Object.defineProperty(prototype, "updateFrame", descriptor);
    else delete prototype.updateFrame;
  }
  const sim = c.simulation;
  const workloads = [{ name: "fresh-grid", bodies: [...sim.cars], joints: [] }];
  if (snapshot) {
    const hydrated = hydrateCapturedBodies(snapshot);
    for (const body of hydrated.bodies) {
      if (body.capturedType === "car") {
        const existing = sim.cars.find(
          (car) =>
            car.group.name.toLowerCase() === body.capturedName.toLowerCase(),
        );
        if (existing) body.motion = existing.motion;
        else {
          const name = body.capturedName;
          const path = c.assets.resolve(`data/CARS/${name}/${name}.TXT`);
          const text = await c.assets.text(path);
          const model = await c.assets.scene(
            path.slice(0, path.lastIndexOf("/")),
            name,
            {
              shading: 2,
              storage: "opponents",
            },
          );
          model.group.updateMatrixWorld(true);
          const inverse = model.group.matrixWorld.clone().invert();
          body.motion = createMotionParameters(
            parseCarMechanics(text),
            (wheel) => {
              let actor;
              model.group.traverse((node) => {
                if (node.name.toLowerCase() === wheel.actor.toLowerCase())
                  actor = node;
              });
              if (!actor) return undefined;
              const bounds = new Box3().setFromObject(actor);
              return bounds.isEmpty()
                ? actor
                    .getWorldPosition(body.state.position.clone())
                    .applyMatrix4(inverse)
                : bounds
                    .getCenter(body.state.position.clone())
                    .applyMatrix4(inverse);
            },
          );
        }
      } else if (body.capturedType === "noncar") {
        const original = sim.noncars.find(
          (row) => row.actor.name === body.capturedName,
        );
        if (!original)
          throw new Error(`Missing captured noncar ${body.capturedName}`);
        body.mechanics = original.mechanics;
      }
    }
    workloads.push({ name: "captured-pose-sweep", ...hydrated });
  }
  for (const workload of workloads) {
    // Use the production hierarchy integrator for an explicitly prepared 40ms
    // sweep. Captured post-tick prediction fields are not preceding-tick inputs.
    createHierarchyMotionPhase(
      workload.bodies,
      workload.joints,
      0.04,
    ).writeCandidates(workload.bodies);
    workload.flags = workload.bodies.map((body) => ({
      overlapDetected: body.overlapDetected,
      worldOverlapDetected: body.worldOverlapDetected,
    }));
  }
  const gl = c.renderer.getContext();
  const extension = gl.getExtension("WEBGL_debug_renderer_info");
  window.__worldContactProfile = { sim, workloads };
  return {
    track: `data/RACES/${trackName}/${trackName}.txt`,
    elapsed: sim.elapsed,
    gpu: extension && gl.getParameter(extension.UNMASKED_RENDERER_WEBGL),
    drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    dpr: window.devicePixelRatio,
    glError: gl.getError(),
    workloads: workloads.map(({ name, bodies }) => ({
      name,
      bodies: bodies.map((body, index) => ({
        id: body.capturedId ?? index,
        name: body.capturedName ?? body.group?.name ?? body.actor?.name ?? null,
        hullVertices: body.hulls.map((hull) => hull.vertices.length),
        position: body.state.position.toArray(),
        orientation: body.state.orientation.toArray(),
        predictedPosition: body.state.predictedPosition.toArray(),
        predictedOrientation: body.state.predictedOrientation.toArray(),
        wheelPositions: body.motion?.wheelPositions.map((point) =>
          point.toArray(),
        ),
        worldRecovery: body.worldRecovery,
      })),
    })),
  };
}

export function runWorldContactProfile(repeats, eager = false) {
  const { sim, workloads } = window.__worldContactProfile;
  const world = sim.world;
  const nativePreparationAvailable =
    typeof world.beginNativePreparation === "function" &&
    typeof world.endNativePreparation === "function";
  if (!eager && !nativePreparationAvailable)
    throw new Error(
      "Native preparation API unavailable; use --eager for an explicit eager baseline",
    );
  const cases = [];
  const previous = sim.worldContactDiagnostics;
  const previousSyncDiagnostics = world.syncDiagnostics;
  let active;
  sim.worldContactDiagnostics = (row) => {
    const { body, ...scalars } = row;
    if (active) active.diagnostics.push(scalars);
  };
  try {
    for (const workload of workloads) {
      for (let repeat = 0; repeat < repeats; repeat++) {
        for (const cache of ["cold", "warm"]) {
          const rows = [];
          const syncDiagnostics = worldSyncCounters();
          world.syncDiagnostics = syncDiagnostics;
          if (!eager) world.beginNativePreparation();
          try {
            for (const [index, body] of workload.bodies.entries()) {
              Object.assign(body, workload.flags[index]);
              if (cache === "cold") sim.worldFaceStates.delete(body);
              active = { id: body.capturedId ?? index, diagnostics: [] };
              const start = performance.now();
              const contacts = sim.worldContacts(body, body.hulls);
              active.cpuMs = performance.now() - start;
              active.contacts = contacts.map((contact) => ({
                point: contact.point.toArray(),
                pointB: contact.pointB?.toArray(),
                normal: contact.normal.toArray(),
                penetration: contact.penetration,
                sourceType: contact.sourceType,
                faceFriction: contact.faceFriction,
                material: contact.sourceSurface?.material ?? null,
                face: contact.sourceSurface?.faceIndex ?? null,
                owner: contact.b?.actor?.name ?? contact.b?.group?.name ?? null,
              }));
              rows.push(active);
            }
          } finally {
            if (!eager) world.endNativePreparation();
          }
          cases.push({
            name: workload.name,
            repeat,
            cache,
            rows,
            syncDiagnostics,
          });
        }
      }
    }
    return {
      cases,
      elapsed: sim.elapsed,
      paused: window.carma.paused,
      nativePreparation: {
        available: nativePreparationAvailable,
        mode: eager ? "eager" : "scoped",
        scope: eager ? "none" : "one synchronous cold/warm workload pass",
      },
    };
  } finally {
    sim.worldContactDiagnostics = previous;
    world.syncDiagnostics = previousSyncDiagnostics;
  }
}
