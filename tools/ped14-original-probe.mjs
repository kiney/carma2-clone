/**
 * Read-only original-world contact diagnostic. No captured coordinates or
 * original assets are embedded. Bundle this module, then call:
 * runPed14OriginalProbe(window.carma.collision, payload)
 *
 * The supplied world retains its real native collector and static query data.
 * Only a private, unregistered rigid body and simulation receive impulses.
 * Query caches can be refreshed; ACT pulls and GROOVE stops are observed only.
 * Returned source-derived data must stay under /tmp or ignored artifacts/.
 */
import { Group, Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import {
  DeferredContactFriction,
  resolveContacts,
} from "../src/physics/contact.ts";
import { createHierarchyMotionPhase } from "../src/physics/hierarchy-motion.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { mergeWorldContacts } from "../src/physics/world-contact-admission.ts";
import { WorldCollision } from "../src/world.ts";

const DT = 0.04;
const vector = (values, label) => {
  if (
    !Array.isArray(values) ||
    values.length !== 3 ||
    !values.every(Number.isFinite)
  )
    throw new Error(`Probe requires a finite three-vector: ${label}`);
  return new Vector3(...values);
};
const energy = (body) => {
  const local = body.state.angularVelocity
    .clone()
    .applyQuaternion(body.state.orientation.clone().invert());
  return (
    0.5 *
    (body.properties.mass * body.state.velocity.lengthSq() +
      local.dot(local.clone().multiply(body.properties.inertia)))
  );
};
function source(row) {
  const face = row.sourceSurface;
  return {
    actor: face?.source?.actor?.name ?? face?.actor?.name ?? null,
    model: face?.source?.modelName ?? null,
    sourceFace:
      face?.source?.sourceFaceIndex ??
      face?.native?.sourceFaceIndex ??
      face?.faceIndex ??
      null,
    normal: face?.normal.toArray() ?? null,
    triangle: face
      ? [face.a.toArray(), face.b.toArray(), face.c.toArray()]
      : null,
  };
}
function serialize(row, origin) {
  return {
    origin,
    point: row.point.toArray(),
    pointB: row.pointB?.toArray() ?? null,
    normal: row.normal.toArray(),
    sourceType: row.sourceType ?? null,
    worldFeature: row.worldFeature ? { ...row.worldFeature } : null,
    source: source(row),
    normalImpulse: row.normalImpulse ?? null,
    closingSpeed: row.closingSpeed ?? null,
    solverAccepted: row.solverAccepted ?? null,
  };
}
function capturedMatches(rows, expected) {
  return rows.map((row) => {
    let best;
    for (let index = 0; index < expected.length; index++) {
      const other = expected[index];
      const distance = row.point.distanceTo(
        vector(other.point, "captured point"),
      );
      const normalDot = row.normal.dot(vector(other.normal, "captured normal"));
      const score = distance + (1 - normalDot);
      if (!best || score < best.score)
        best = {
          capturedRow: index,
          score,
          distance,
          normalDot,
          sameType: row.sourceType === other.sourceType,
          // Recorder weak IDs do not survive a world reload. A matching label
          // is supporting provenance, not proof of cross-session ACT identity.
          capturedLabelMatchesActorOrModel:
            source(row).actor === other.sourceActor ||
            source(row).model === other.sourceActor,
        };
    }
    return best ?? null;
  });
}

export function runPed14OriginalProbe(suppliedWorld, payload, options = {}) {
  if (!suppliedWorld?.collectFaces || !suppliedWorld?.querySurfaces)
    throw new Error(
      "Supply the live WorldCollision object, for example window.carma.collision",
    );
  if (
    !payload?.body ||
    !Array.isArray(payload.stages) ||
    payload.stages.length < 1 ||
    payload.stages.length > 4
  )
    throw new Error("Probe requires body data and one to four bounded stages");
  const original = payload.body;
  const low = vector(original.bounds?.min, "bounds minimum"),
    high = vector(original.bounds?.max, "bounds maximum");
  if (!(low.x < high.x && low.y < high.y && low.z < high.z))
    throw new Error("Probe bounds must be nondegenerate");
  const inertia = vector(original.properties?.inertia, "inertia");
  if (
    !(original.properties.mass > 0) ||
    !Number.isFinite(original.properties.mass) ||
    Math.min(...inertia.toArray()) <= 0
  )
    throw new Error("Probe mass and inertia must be positive");
  if (
    !Array.isArray(original.orientation) ||
    original.orientation.length !== 4 ||
    !original.orientation.every(Number.isFinite)
  )
    throw new Error("Probe orientation must be a finite quaternion");
  // Optional separate world cache for callers loading the same module realm.
  // The default avoids cross-bundle Mesh instanceof incompatibility and a full
  // second world inventory. Neither mode changes the live simulation roster.
  const world = options.cloneWorld
    ? new WorldCollision(
        options.scene ?? suppliedWorld.sourceRoot,
        suppliedWorld.modifiers,
        suppliedWorld.sourceSnapshot,
        suppliedWorld.nativeScene,
      )
    : suppliedWorld;
  const simulation = new VehicleSimulation(world, new Group());
  const outlets = { actorPulls: 0, grooveStops: 0 };
  simulation.pullWorldActor = () => {
    outlets.actorPulls++;
    return null;
  };
  simulation.stopCollectedWorldActor = () => {
    outlets.grooveStops++;
  };
  simulation.stopGroovesForCollectedFaces = () => {};
  const body = {
    kind: "pedestrian",
    rigidType: 2,
    actor: new Group(),
    hulls: [buildBoxHull(low, high)],
    worldRecovery: !!original.worldRecovery,
    worldOverlapDetected: false,
    overlapRecovery: false,
    overlapDetected: false,
    suppressWorldFaces: false,
    specialVolume: {
      volume: null,
      automatic: null,
      depth: 1,
      waterDistance: Number.MAX_VALUE,
    },
    properties: {
      mass: original.properties.mass,
      inertia,
      centerOfMass: vector(original.properties.centerOfMass, "center of mass"),
      worldFriction: original.properties.worldFriction ?? 0,
      objectFriction: original.properties.objectFriction ?? 0,
      immovable: false,
      rotationLocked: false,
    },
    state: {
      position: vector(original.position, "old position"),
      orientation: new Quaternion(...original.orientation),
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
    },
  };
  const started = performance.now();
  const report = {
    diagnosticOnly: true,
    capture: payload.provenance ?? null,
    cloneWorld: !!options.cloneWorld,
    nativeScene: !!world.nativeScene,
    stages: [],
    limitations: [
      "Contact-level reconstruction, not a whole-game or PHIL/AI replay.",
      "Old pose, mass, inertia, COM and incoming velocities come from the payload.",
      "Candidate poses are reconstructed with current hierarchy integration; original per-retry candidates were not recorded.",
      "Current original-world geometry and source identity are queried; historical world mutation queues are not restored.",
      "ACT pulls/GROOVE stops are counted and suppressed; no gameplay body is registered or advanced.",
      "Normal response only; deferred friction, damage, pose commitment and character callbacks are omitted.",
      "Friction fields are irrelevant to this normal-only solve and were not captured.",
    ],
  };
  try {
    for (const stage of payload.stages) {
      const velocity = vector(stage.velocity, "stage velocity"),
        omega = vector(stage.angularVelocity, "stage angular velocity");
      if (velocity.length() > 5 || omega.length() > 20)
        throw new Error("Probe intentionally excludes already-runaway stages");
      body.state.velocity.copy(velocity);
      body.state.angularVelocity.copy(omega);
      body.worldOverlapDetected = false;
      simulation.hierarchyMotion = createHierarchyMotionPhase([body], [], DT);
      simulation.hierarchyMotion.writeCandidates([body]);
      const native = simulation.computeWorldContacts(body, body.hulls);
      const position = body.state.predictedPosition.clone(),
        orientation = body.state.predictedOrientation.clone();
      const guard = simulation.computeAdvanceWorldContacts(body, false);
      body.state.predictedPosition.copy(position);
      body.state.predictedOrientation.copy(orientation);
      const origins = new Map([
        ...native.map((row) => [row, "native-chord"]),
        ...guard.contacts.map((row) => [row, "sampled-guard"]),
      ]);
      const merged = mergeWorldContacts(
        native,
        guard.contacts,
        guard.encounters ?? guard.contacts,
      );
      const controls = {};
      for (const [name, rows] of [
        ["native", native],
        ["guard", guard.contacts],
        ["merged", merged],
      ]) {
        body.state.velocity.copy(velocity);
        body.state.angularVelocity.copy(omega);
        const before = energy(body);
        let solution;
        const impacts = resolveContacts(
          rows,
          DT,
          [],
          undefined,
          new DeferredContactFriction(),
          (result) => {
            solution = result;
          },
        );
        controls[name] = {
          count: rows.length,
          energyBefore: before,
          energyAfter: energy(body),
          energyRatio: energy(body) / before,
          velocity: body.state.velocity.toArray(),
          angularVelocity: body.state.angularVelocity.toArray(),
          normalSolution: solution,
          rows: impacts
            .slice(0, 64)
            .map((row, index) => serialize(row, origins.get(rows[index]))),
          omittedRows: Math.max(0, impacts.length - 64),
        };
      }
      const expected = stage.expectedContacts ?? [];
      report.stages.push({
        name: stage.name,
        incomingVelocity: velocity.toArray(),
        incomingAngularVelocity: omega.toArray(),
        candidatePosition: position.toArray(),
        candidateOrientation: orientation.toArray(),
        guardFraction: guard.fraction,
        guardCrossingFraction: guard.crossingFraction,
        native: native.map((row) => serialize(row, "native-chord")),
        guard: guard.contacts.map((row) => serialize(row, "sampled-guard")),
        encounters:
          guard.encounters
            ?.slice(0, 256)
            .map((row) => serialize(row, "sampled-encounter")) ?? [],
        omittedEncounters: Math.max(0, (guard.encounters?.length ?? 0) - 256),
        matches: {
          native: capturedMatches(native, expected),
          guard: capturedMatches(guard.contacts, expected),
          merged: capturedMatches(merged, expected),
        },
        expectedContacts: expected,
        controls,
      });
    }
    report.elapsedMs = performance.now() - started;
    report.outlets = outlets;
    report.liveRosterUnaffected = simulation.allBodies().length === 0;
    return report;
  } finally {
    simulation.dispose();
  }
}
