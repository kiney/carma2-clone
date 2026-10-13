/** Bounded, serial body-pair + joint correction diagnostic from an ignored
 * captured state. Run with node --import tsx. This never calls step(), loads a
 * browser or writes original assets; it is not a whole-tick/FPS replay.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Group, Vector3, Quaternion } from "three";
import { VehicleSimulation, PHYSICS_STEP } from "../src/physics/simulation.ts";
import { resolveContactGroups } from "../src/physics/contact.ts";
import { advanceRigidBody } from "../src/physics/integrate.ts";
import { BodyTrajectoryGuard } from "../src/physics/pair-guard.ts";
import { sealCollisionHulls } from "../src/physics/immutable-hulls.ts";

const { values } = parseArgs({
  options: {
    snapshot: {
      type: "string",
      default: "artifacts/perf01-directional-body-snapshot.json",
    },
    output: {
      type: "string",
      default: "artifacts/perf13-captured-corrections.json",
    },
    passes: { type: "string", default: "8" },
    cluster: { type: "string", default: "6,10,11,12,14" },
  },
});
const maxPasses = Number(values.passes);
if (!Number.isInteger(maxPasses) || maxPasses < 1 || maxPasses > 8)
  throw new Error("--passes must be an integer from 1 to 8");
if (!/^\d+(,\d+)*$/.test(values.cluster))
  throw new Error("--cluster must list comma-separated captured body IDs");
const removedIds = values.cluster.split(",").map(Number);
if (
  !removedIds.length ||
  removedIds.some((id) => !Number.isInteger(id) || id < 0) ||
  new Set(removedIds).size !== removedIds.length
)
  throw new Error("--cluster must list distinct captured body IDs");
const output = resolve(values.output);
const within = (root, path) => {
  const part = relative(resolve(root), path);
  return part !== "" && !part.startsWith("..") && !isAbsolute(part);
};
if (!within("artifacts", output) && !within("/tmp", output))
  throw new Error(
    "Asset-derived output must stay in ignored artifacts/ or /tmp/",
  );
const snapshotText = await readFile(values.snapshot, "utf8");
const snapshot = JSON.parse(snapshotText);
if (
  !Array.isArray(snapshot.bodies) ||
  snapshot.bodies.length === 0 ||
  snapshot.bodies.length > 8192
)
  throw new Error("Expected a bounded captured body list");
const sourceRows = new Map(snapshot.bodies.map((row) => [row.id, row]));
assert.equal(sourceRows.size, snapshot.bodies.length, "Duplicate body IDs");
for (const id of removedIds)
  assert(sourceRows.has(id), `Unknown removed body ID ${id}`);
const digest = (text) => createHash("sha256").update(text).digest("hex");
const vector = (value) => {
  assert(
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite),
  );
  return new Vector3(...value);
};
const quaternion = (value) => {
  assert(
    Array.isArray(value) && value.length === 4 && value.every(Number.isFinite),
  );
  return new Quaternion(...value);
};
// Each dormant NONCAR constructor owns an independent origin world anchor
// (src/physics/noncar-body.ts). -1 is an unrecorded endpoint, NOT shared identity.
// Only dormant external endpoints are accepted; none participates in this solve.
function privateDormantAnchor() {
  return {
    state: {
      position: new Vector3(),
      orientation: new Quaternion(),
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
    },
    properties: {
      mass: 1,
      inertia: new Vector3(1, 1, 1),
      centerOfMass: new Vector3(),
      worldFriction: 0,
      immovable: true,
      rotationLocked: true,
    },
  };
}
function hydrate() {
  const bodies = snapshot.bodies.map((row) => {
    assert(
      ["car", "part", "noncar"].includes(row.type),
      "Unsupported captured body kind",
    );
    assert(
      row.properties.mass > 0 && row.properties.inertia.every((x) => x > 0),
    );
    const body = {
      ...structuredClone(row.flags),
      capturedId: row.id,
      properties: {
        ...structuredClone(row.properties),
        inertia: vector(row.properties.inertia),
        centerOfMass: vector(row.properties.centerOfMass),
      },
      state: {
        ...structuredClone(row.state),
        position: vector(row.state.position),
        orientation: quaternion(row.state.orientation),
        velocity: vector(row.state.velocity),
        angularVelocity: vector(row.state.angularVelocity),
        predictedPosition: vector(
          row.state.predictedPosition ?? row.state.position,
        ),
        predictedOrientation: quaternion(
          row.state.predictedOrientation ?? row.state.orientation,
        ),
      },
      hulls: row.hulls.map((hull) => ({
        ...structuredClone(hull),
        vertices: hull.vertices.map(vector),
        faces: hull.faces.map((face) => ({
          ...structuredClone(face),
          normal: vector(face.normal),
        })),
      })),
    };
    if (row.type === "noncar") sealCollisionHulls(body.hulls);
    return body;
  });
  const byId = new Map(bodies.map((body) => [body.capturedId, body]));
  for (const row of snapshot.bodies) {
    const body = byId.get(row.id);
    if (row.owner !== null && row.owner !== undefined) {
      assert(byId.has(row.owner), "Unrecorded owner");
      body.owner = byId.get(row.owner);
    }
    if (!row.joint) continue;
    const recorded = row.joint;
    assert(byId.has(recorded.child), "Unrecorded joint child");
    const external = recorded.parent === -1;
    if (external)
      assert(
        row.type === "noncar" && body.properties.immovable,
        "Cannot reconstruct an active external joint",
      );
    else assert(byId.has(recorded.parent), "Unrecorded joint parent");
    const joint = {
      ...structuredClone(recorded),
      child: byId.get(recorded.child),
      parent: external ? privateDormantAnchor() : byId.get(recorded.parent),
      childAnchor: vector(recorded.childAnchor),
      parentAnchor: vector(recorded.parentAnchor),
      planeLimits: recorded.planeLimits.map((limit) => ({
        ...structuredClone(limit),
        childDirection: vector(limit.childDirection),
        parentNormal: vector(limit.parentNormal),
      })),
    };
    for (const field of ["childAxis", "parentAxis", "translationAxis"])
      if (recorded[field]) joint[field] = vector(recorded[field]);
    for (const field of ["hingeBasis", "translationTransverse"])
      if (recorded[field]) joint[field] = recorded[field].map(vector);
    body.joint = joint;
  }
  const external = bodies.filter(
    (body) => body.joint && body.joint.parent.capturedId === undefined,
  );
  assert.equal(
    new Set(external.map((body) => body.joint.parent)).size,
    external.length,
  );
  return bodies;
}
function motion(body) {
  return {
    position: body.state.position.toArray(),
    orientation: body.state.orientation.toArray(),
    velocity: body.state.velocity.toArray(),
    angularVelocity: body.state.angularVelocity.toArray(),
  };
}
function motionChanges(bodies, before) {
  return bodies.flatMap((body) => {
    const old = before.get(body),
      now = motion(body);
    if (
      Object.keys(old).every((key) =>
        old[key].every((v, i) => Object.is(v, now[key][i])),
      )
    )
      return [];
    return [
      {
        id: body.capturedId,
        velocityDelta: vector(now.velocity).sub(vector(old.velocity)).toArray(),
        angularVelocityDelta: vector(now.angularVelocity)
          .sub(vector(old.angularVelocity))
          .toArray(),
        before: old,
        after: now,
      },
    ];
  });
}
function contactRow(contact) {
  return {
    a: contact.a.capturedId,
    b: contact.b?.capturedId ?? null,
    point: contact.point.toArray(),
    pointB: contact.pointB?.toArray(),
    normal: contact.normal.toArray(),
    sourceType: contact.sourceType,
    penetration: contact.penetration,
    faceFriction: contact.faceFriction,
  };
}
function jointRow(row) {
  const applied =
    row.sourceType === 9
      ? 0
      : row.constraint.unilateral
        ? Math.max(0, row.normalImpulse)
        : row.normalImpulse;
  return {
    child: row.a.capturedId,
    parent: row.b.capturedId,
    rowIndexWithinGroup: row.rowIndex,
    sourceType: row.sourceType,
    normalImpulse: row.normalImpulse,
    rhs: row.constraint.rhs,
    restRhs: row.constraint.restRhs,
    unilateral: row.constraint.unilateral,
    angular: row.constraint.angular,
    closingSpeed: row.closingSpeed,
    // Exact row contribution from applyJointConstraintImpulses. Full solve
    // deltas below also include contact normals, friction and quick hinges.
    bodyVelocityContributions: row.constraint.jacobians.map((entry) => ({
      id: entry.body.capturedId,
      velocityDelta: entry.linear
        .clone()
        .multiplyScalar(
          entry.body.properties.immovable
            ? 0
            : applied / entry.body.properties.mass,
        )
        .toArray(),
      angularVelocityDelta: entry.response
        .clone()
        .multiplyScalar(entry.body.properties.immovable ? 0 : applied)
        .toArray(),
    })),
  };
}
function predict(body) {
  if (body.properties.immovable) {
    body.state.predictedPosition.copy(body.state.position);
    body.state.predictedOrientation.copy(body.state.orientation);
  } else advanceRigidBody(body, PHYSICS_STEP, true);
}
const pairAllowed = (a, b) =>
  (((a.filterA ?? 0) & (b.filterB ?? 0)) |
    ((b.filterA ?? 0) & (a.filterB ?? 0))) ===
  0;
function pathsFor(bodies) {
  return new Map(
    bodies.map((body) => {
      const probe = {
        ...body,
        state: {
          ...body.state,
          position: body.state.position.clone(),
          orientation: body.state.orientation.clone(),
          velocity: body.state.velocity.clone(),
          angularVelocity: body.state.angularVelocity.clone(),
          predictedPosition: new Vector3(),
          predictedOrientation: new Quaternion(),
        },
      };
      const cache = new Map();
      const path = (fraction) => {
        if (!cache.has(fraction)) {
          if (body.properties.immovable) {
            probe.state.predictedPosition.copy(body.state.position);
            probe.state.predictedOrientation.copy(body.state.orientation);
          } else advanceRigidBody(probe, PHYSICS_STEP * fraction, true);
          cache.set(fraction, {
            position: probe.state.predictedPosition.clone(),
            orientation: probe.state.predictedOrientation.clone(),
          });
        }
        return cache.get(fraction);
      };
      path.stable = true;
      if (body.properties.immovable) path.constantPose = path(0);
      const inertia = body.properties.inertia;
      path.angularTravel =
        body.properties.immovable || body.properties.rotationLocked
          ? 0
          : (body.state.angularVelocity
              .clone()
              .applyQuaternion(body.state.orientation.clone().invert())
              .multiply(inertia)
              .length() /
              Math.min(inertia.x, inertia.y, inertia.z)) *
            PHYSICS_STEP;
      return [body, path];
    }),
  );
}
function replay(name, omitted) {
  const hydrated = hydrate();
  const bodies = hydrated.filter((body) => !omitted.has(body.capturedId));
  const selected = new Set(bodies);
  const joints = bodies.flatMap((body) =>
    body.joint && !body.properties.immovable ? [body.joint] : [],
  );
  for (const joint of joints)
    assert(
      selected.has(joint.child) && selected.has(joint.parent),
      "Counterfactual cuts an active joint",
    );
  // Use the production emitter and its initialized broadphase/cache fields.
  // The empty world is never queried: no step(), world collector or damage path.
  const sim = new VehicleSimulation(
    { raycast: () => null, querySurfaces: () => [] },
    new Group(),
  );
  const counters = {};
  sim.correctionDiagnostics = counters;
  sim.correctionWorkingSet = sim.correctionGeometry.createTick(counters);
  let pairCounters;
  sim.bodyPairDiagnostics = (phase, diagnostics) => {
    assert.equal(phase, "contacts");
    pairCounters = diagnostics;
  };
  const passes = [];
  let previousRows;
  const start = performance.now();
  for (let pass = 1; pass <= maxPasses; pass++) {
    const passStart = performance.now();
    const beforeCounters = { ...counters };
    const beforeMotion = new Map(bodies.map((body) => [body, motion(body)]));
    const predictStart = performance.now();
    for (const body of bodies) predict(body);
    const predictionCpuMs = performance.now() - predictStart;
    const collectStart = performance.now();
    const contacts = sim.collectBodyContacts(bodies);
    const collectionCpuMs = performance.now() - collectStart;
    const rows = contacts.map(contactRow);
    const encodedRows = JSON.stringify(rows);
    const groups = [];
    const solveStart = performance.now();
    const impacts = contacts.length
      ? resolveContactGroups(
          contacts,
          PHYSICS_STEP,
          joints,
          (contactImpacts, jointImpacts) => {
            groups.push({
              contactRows: contactImpacts.length,
              jointRows: jointImpacts.map(jointRow),
            });
            // Observation only: accept all impulses. No engine mutation callback.
          },
        )
      : [];
    const solverCpuMs = performance.now() - solveStart;
    passes.push({
      pass,
      cpuMs: performance.now() - passStart,
      predictionCpuMs,
      collectionCpuMs,
      solverCpuMs,
      rowCount: rows.length,
      rows,
      rowsSha256: digest(encodedRows),
      identicalRowsToPrevious:
        previousRows === undefined ? null : previousRows === encodedRows,
      positiveContactImpulses: impacts.filter((row) => row.normalImpulse > 0)
        .length,
      impacts: impacts.map((row) => ({
        ...contactRow(row),
        normalImpulse: row.normalImpulse,
        closingSpeed: row.closingSpeed,
        tangentImpulse: row.tangentImpulse.toArray(),
        solverAccepted: row.solverAccepted,
      })),
      groups,
      changedBodies: motionChanges(bodies, beforeMotion),
      cacheWork: Object.fromEntries(
        Object.entries(counters).map(([key, value]) => [
          key,
          value - (beforeCounters[key] ?? 0),
        ]),
      ),
      pairCollection: pairCounters,
      emptyContactExit: contacts.length === 0,
    });
    previousRows = encodedRows;
    if (!contacts.length) break;
  }
  const correctionCpuMs = performance.now() - start;
  const guardCounters = {};
  const guardStart = performance.now();
  const fractions = new BodyTrajectoryGuard().run(
    bodies,
    pathsFor(bodies),
    pairAllowed,
    guardCounters,
  );
  const guardCpuMs = performance.now() - guardStart;
  // Integration and position projection are deliberately not applied.
  for (const body of bodies) {
    const source = sourceRows.get(body.capturedId);
    assert.deepEqual(body.state.position.toArray(), source.state.position);
    assert.deepEqual(
      body.state.orientation.toArray(),
      source.state.orientation,
    );
  }
  return {
    name,
    omittedBodyIds: [...omitted],
    bodies: bodies.length,
    movable: bodies.filter((body) => !body.properties.immovable).length,
    activeJointChildren: joints.map((joint) => joint.child.capturedId),
    correctionCpuMs,
    passes,
    pairGuard: {
      note: "Fresh full-40ms body-pair guard AFTER partial correction; world fractions are 1. No integration/projection. Not a live committed fraction.",
      cpuMs: guardCpuMs,
      diagnostics: guardCounters,
      fractions: bodies.map((body) => ({
        id: body.capturedId,
        fraction: fractions.get(body),
      })),
    },
    finalMotion: bodies.map((body) => ({
      id: body.capturedId,
      ...motion(body),
    })),
  };
}
const report = {
  kind: "partial-body-pair-joint-correction-replay",
  snapshot: values.snapshot,
  snapshotSha256: digest(snapshotText),
  engineAtCapture: snapshot.engine,
  capturedElapsed: snapshot.elapsed,
  physicsStepSeconds: PHYSICS_STEP,
  maxPasses,
  limitations: [
    "Starts from a paused POST-tick snapshot; does not replay the captured preceding tick.",
    "No forces, prepareJointVelocities, initial whole-tick solve, world contacts/guards, moving world, damage/crush/splits/destruction/restarts, pedestrians or rendering.",
    "Each correction round uses production collectBodyContacts, its real correction caches, and resolveContactGroups; all normal/joint/friction impulses are applied to independent clones.",
    "Recorded positions/orientations, properties, hulls and recovery flags are retained. Candidate poses are recomputed each round. No state integration, joint position projection or repair is applied.",
    "Captured body list is treated as active roster; only non-immovable captured joints participate. External dormant NONCAR anchors use distinct constructor-origin identities and are excluded from solves.",
    "Snapshot cannot establish unrecorded shared RigidState identities; the capture has no state-identity IDs. Each recorded body receives its own state.",
    "The counterfactual removes only explicitly named collision bodies from clone collection/guard/joint roster; this is attribution, not a proposed game behavior fix.",
    "One original/counterfactual sample each, serial, at most eight rounds. CPU includes cold/JIT/observer/host-scheduling effects; no warm-up or FPS extrapolation.",
    "A partial result cannot prove full-scene contacts vanish, damage callbacks are safe to skip, a production early exit is exact, or the directional correlation has a unique cause.",
  ],
  omittedBodies: removedIds.map((id) => {
    const row = sourceRows.get(id);
    return { id, name: row.name, type: row.type, owner: row.owner };
  }),
  variants: [],
};
for (const [name, omitted] of [
  ["captured", new Set()],
  ["without-selected-cerby-cluster", new Set(removedIds)],
])
  report.variants.push(replay(name, omitted));
assert.equal(
  JSON.stringify(snapshot),
  JSON.stringify(JSON.parse(snapshotText)),
  "Snapshot mutated",
);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      kind: report.kind,
      output: values.output,
      variants: report.variants.map((variant) => ({
        name: variant.name,
        bodies: variant.bodies,
        correctionCpuMs: variant.correctionCpuMs,
        passes: variant.passes.map((pass) => ({
          pass: pass.pass,
          rows: pass.rowCount,
          positiveImpulses: pass.positiveContactImpulses,
          jointRows: pass.groups.reduce(
            (sum, group) => sum + group.jointRows.length,
            0,
          ),
          changedBodies: pass.changedBodies.map((body) => body.id),
          cacheWork: pass.cacheWork,
          cpuMs: pass.cpuMs,
        })),
        pairGuardCpuMs: variant.pairGuard.cpuMs,
        clippedBodies: variant.pairGuard.fractions.filter(
          (row) => row.fraction < 1,
        ),
      })),
    },
    null,
    2,
  ),
);
