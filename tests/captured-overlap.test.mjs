/** Ignored captures are optional evidence, never checked-in original fixtures.
 * These are small partial pair/joint windows, with no forces, world collision,
 * damage callbacks or complete correction/restart loop. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Group } from "three";
import {
  hydrateCapturedBodies,
  capturedBodyIdentifier,
} from "./support/captured-bodies.mjs";
import { VehicleSimulation, PHYSICS_STEP } from "../src/physics/simulation.ts";
import { prepareJointVelocities } from "../src/physics/joint.ts";
import { resolveContactGroups } from "../src/physics/contact.ts";
import { createHierarchyMotionPhase } from "../src/physics/hierarchy-motion.ts";
import { BodyTrajectoryGuard } from "../src/physics/pair-guard.ts";
import {
  hullPenetration,
  nativeHullRecoveryOverlap,
  transformHull,
} from "../src/physics/geometry.ts";

const pairAllowed = (a, b) =>
  (((a.filterA ?? 0) & (b.filterB ?? 0)) |
    ((b.filterA ?? 0) & (a.filterB ?? 0))) ===
  0;
const nearVector = (actual, expected, tolerance = 1e-8) =>
  assert.ok(actual.distanceTo(expected) < tolerance);
const worldCOM = (body) =>
  body.properties.centerOfMass
    .clone()
    .applyQuaternion(body.state.orientation)
    .add(body.state.position);
const anchor = (body, local) =>
  local
    .clone()
    .applyQuaternion(body.state.orientation)
    .add(body.state.position);
function bareSimulation(t) {
  const sim = new VehicleSimulation(
    {
      raycast() {
        throw new Error("Partial capture test queried the world");
      },
      querySurfaces() {
        throw new Error("Partial capture test collected world faces");
      },
    },
    new Group(),
  );
  t.after(() => sim.dispose());
  return sim;
}
async function capture(t, path, ids) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Optional ignored local capture absent");
      return null;
    }
    throw error;
  }
  const source = JSON.parse(text);
  const hydrated = hydrateCapturedBodies(source);
  const bodies = ids.map((id) => {
    assert.ok(hydrated.byId.has(id), `Capture lacks expected body ${id}`);
    return hydrated.byId.get(id);
  });
  const selected = new Set(bodies);
  const joints = hydrated.joints.filter((joint) => selected.has(joint.child));
  assert.ok(
    joints.every((joint) => selected.has(joint.parent)),
    "Selected capture cuts a physical ancestor",
  );
  return {
    source,
    hydrated,
    bodies,
    joints,
    unchanged: JSON.stringify(source),
  };
}
function qualifiedOldPairs(bodies) {
  const result = [];
  for (let a = 0; a < bodies.length; a++)
    for (let b = a + 1; b < bodies.length; b++) {
      const bodyA = bodies[a],
        bodyB = bodies[b];
      if (!bodyA.overlapRecovery && !bodyB.overlapRecovery) continue;
      if (bodyA.joint?.parent === bodyB || bodyB.joint?.parent === bodyA)
        continue;
      for (let i = 0; i < bodyA.hulls.length; i++)
        for (let j = 0; j < bodyB.hulls.length; j++) {
          const hullA = transformHull(
            bodyA.hulls[i],
            bodyA.state.position,
            bodyA.state.orientation,
          );
          const hullB = transformHull(
            bodyB.hulls[j],
            bodyB.state.position,
            bodyB.state.orientation,
          );
          const depth = hullPenetration(hullA, hullB);
          if (depth > 1e-6 && nativeHullRecoveryOverlap(hullA, hullB))
            result.push({ a: bodyA, b: bodyB, hullA: i, hullB: j, depth });
        }
    }
  return result;
}
function pairDepth(pair) {
  return hullPenetration(
    transformHull(
      pair.a.hulls[pair.hullA],
      pair.a.state.position,
      pair.a.state.orientation,
    ),
    transformHull(
      pair.b.hulls[pair.hullB],
      pair.b.state.position,
      pair.b.state.orientation,
    ),
  );
}
function partialWindow(sim, bodies, joints, guard) {
  prepareJointVelocities(joints);
  for (const body of bodies) body.overlapDetected = false;
  const incoming = createHierarchyMotionPhase(bodies, joints, PHYSICS_STEP);
  incoming.writeCandidates(bodies);
  sim.correctionWorkingSet = undefined;
  const contacts = sim.collectBodyContacts(bodies);
  const beforeSolve = bodies.map((body) => [
    body.state.velocity.clone(),
    body.state.angularVelocity.clone(),
  ]);
  const jointImpulses = [];
  const impacts = resolveContactGroups(
    contacts,
    PHYSICS_STEP,
    joints,
    (_, rows) => {
      jointImpulses.push(...rows);
      // Observe, then accept all native contact/joint/friction impulses on clones.
    },
  );
  const afterSolve = bodies.map((body) => [
    body.state.velocity.clone(),
    body.state.angularVelocity.clone(),
  ]);
  const outgoing = createHierarchyMotionPhase(bodies, joints, PHYSICS_STEP);
  const diagnostics = {};
  const fractions = guard.run(bodies, outgoing.paths, pairAllowed, diagnostics);
  outgoing.commit(bodies, fractions);
  for (const body of bodies) body.overlapRecovery = body.overlapDetected;
  return {
    contacts,
    impacts,
    jointImpulses,
    beforeSolve,
    afterSolve,
    outgoing,
    fractions,
    diagnostics,
  };
}

test("captured player/wing native containment has zero rows but admits actual movement without changing authored data", async (t) => {
  const fixture = await capture(
    t,
    "artifacts/perf01-user-stuck-state.json",
    [0, 5],
  );
  if (!fixture) return;
  const { source, hydrated, bodies } = fixture;
  const [player, wing] = bodies;
  assert.equal(
    wing.capturedType,
    "part",
    "Serialized kind:'car' must not erase recorded detached ownership",
  );
  assert.equal(wing.owner, player);
  assert.equal(wing.joint, undefined);
  for (const body of bodies) {
    const recorded = hydrated.rowsById.get(body.capturedId);
    assert.equal(body.properties.mass, recorded.properties.mass);
    assert.deepEqual(
      body.properties.inertia.toArray(),
      recorded.properties.inertia,
    );
    assert.deepEqual(
      body.properties.centerOfMass.toArray(),
      recorded.properties.centerOfMass,
    );
    assert.deepEqual(body.state.velocity.toArray(), recorded.state.velocity);
    assert.deepEqual(
      body.state.angularVelocity.toArray(),
      recorded.state.angularVelocity,
    );
    assert.deepEqual(
      body.hulls.map((hull) => hull.vertices.map((point) => point.toArray())),
      recorded.hulls.map((hull) => hull.vertices),
    );
  }
  const oldPairs = qualifiedOldPairs(bodies);
  assert.ok(
    oldPairs.length,
    "Original transformed hulls must qualify through native OLD overlap and positive SAT depth",
  );
  const oldCOM = bodies.map(worldCOM);
  const oldVelocity = bodies.map((body) => body.state.velocity.clone());
  const sim = bareSimulation(t);
  const result = partialWindow(sim, bodies, [], new BodyTrajectoryGuard());
  assert.equal(
    result.contacts.length,
    0,
    "Captured native feature gates deliberately emit no recovery row for this containment",
  );
  assert.ok(result.diagnostics.recoveryHullAdmissions > 0);
  bodies.forEach((body, i) => {
    assert.equal(result.fractions.get(body), 1);
    assert.ok(worldCOM(body).distanceTo(oldCOM[i]) > 1e-3);
    nearVector(body.state.velocity, oldVelocity[i]);
    nearVector(body.state.position, result.outgoing.pose(body, 1).position);
    assert.equal(
      body.properties.mass,
      hydrated.rowsById.get(body.capturedId).properties.mass,
    );
  });
  assert.equal(JSON.stringify(source), fixture.unchanged);
});

test("captured Cerby recovery retains real type6 and joint impulses before hierarchy commitment", async (t) => {
  const fixture = await capture(
    t,
    "artifacts/perf01-directional-body-snapshot.json",
    [6, 10, 11, 12, 14],
  );
  if (!fixture) return;
  const { source, bodies, joints } = fixture;
  assert.ok(joints.length);
  assert.ok(qualifiedOldPairs(bodies).length);
  const sim = bareSimulation(t);
  const result = partialWindow(sim, bodies, joints, new BodyTrajectoryGuard());
  assert.ok(result.contacts.some((contact) => contact.sourceType === 6));
  assert.ok(
    result.impacts.some(
      (impact) =>
        impact.sourceType === 6 &&
        impact.normalImpulse > 0 &&
        impact.solverAccepted,
    ),
  );
  assert.ok(
    result.jointImpulses.some(
      (impact) => impact.sourceType !== 9 && impact.normalImpulse !== 0,
    ),
    "Real coupled joint responses cannot be omitted as repeated-looking contacts",
  );
  assert.ok(
    bodies.some(
      (_, i) =>
        result.afterSolve[i][0].distanceTo(result.beforeSolve[i][0]) > 1e-10 ||
        result.afterSolve[i][1].distanceTo(result.beforeSolve[i][1]) > 1e-10,
    ),
  );
  for (const body of bodies) assert.equal(result.fractions.get(body), 1);
  for (const joint of joints)
    nearVector(
      anchor(joint.child, joint.childAnchor),
      anchor(joint.parent, joint.parentAnchor),
    );
  assert.ok(result.diagnostics.recoveryHullAdmissions > 0);
  assert.equal(JSON.stringify(source), fixture.unchanged);
});

for (const scenario of [
  {
    name: "player/wing",
    path: "artifacts/perf01-user-stuck-state.json",
    ids: [0, 5],
  },
  {
    name: "Cerby own-debris",
    path: "artifacts/perf01-directional-body-snapshot.json",
    ids: [6, 10, 11, 12, 14],
  },
])
  test(`${scenario.name} avoids indefinite zero-prefix storage in eight partial captured windows`, async (t) => {
    const fixture = await capture(t, scenario.path, scenario.ids);
    if (!fixture) return;
    const { bodies, joints, source } = fixture;
    const sim = bareSimulation(t);
    const initial = bodies.map(worldCOM);
    const initialPairs = qualifiedOldPairs(bodies);
    assert.ok(initialPairs.length);
    const guard = new BodyTrajectoryGuard();
    const fractions = [];
    for (let window = 0; window < 8; window++) {
      const result = partialWindow(sim, bodies, joints, guard);
      fractions.push(
        Math.min(...bodies.map((body) => result.fractions.get(body))),
      );
      for (const body of bodies) {
        assert.ok(body.state.position.toArray().every(Number.isFinite));
        assert.ok(body.state.velocity.toArray().every(Number.isFinite));
        assert.ok(body.state.angularVelocity.toArray().every(Number.isFinite));
        assert.ok(
          result.fractions.get(body) >= 0 && result.fractions.get(body) <= 1,
        );
      }
      if (fractions.at(-1) > 0)
        for (const joint of joints)
          nearVector(
            anchor(joint.child, joint.childAnchor),
            anchor(joint.parent, joint.parentAnchor),
          );
    }
    assert.equal(fractions[0], 1);
    assert.ok(fractions.some((fraction) => fraction > 0.1));
    assert.ok(
      bodies.every((body, i) => worldCOM(body).distanceTo(initial[i]) > 1e-3),
      "The captured overlap cannot retain all velocity with essentially zero physical progress",
    );
    assert.ok(
      initialPairs.some((pair) => pairDepth(pair) <= 1e-6),
      "At least one captured OLD hull overlap actually clears in the bounded partial replay",
    );
    assert.equal(JSON.stringify(source), fixture.unchanged);
  });

function syntheticBody(id) {
  return {
    id,
    kind: "noncar",
    properties: {
      mass: 1,
      inertia: [1, 1, 1],
      centerOfMass: [0, 0, 0],
      immovable: true,
    },
    state: {
      position: [0, 0, 0],
      orientation: [0, 0, 0, 1],
      velocity: [0, 0, 0],
      angularVelocity: [0, 0, 0],
    },
    hulls: [
      {
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
        faces: [{ normal: [1, 0, 0], constant: 1, indices: [1, 2, 3] }],
        edges: [[0, 1]],
      },
    ],
    joint: {
      fields: {
        type: "ball",
        childAnchor: [0, 0, 0],
        parentAnchor: [0, 0, 0],
        planeLimits: [],
      },
    },
  };
}
test("hydration owns its geometry and preserves distinct constructor-origin external anchor identities", () => {
  const source = { bodies: [syntheticBody(0), syntheticBody(1)] };
  const original = JSON.stringify(source);
  const a = hydrateCapturedBodies(source);
  const b = hydrateCapturedBodies(source);
  assert.notEqual(a.byId.get(0).state, b.byId.get(0).state);
  assert.notEqual(a.byId.get(0).hulls, b.byId.get(0).hulls);
  assert.equal(a.externalAnchors.length, 2);
  assert.notEqual(a.joints[0].parent, a.joints[1].parent);
  assert.notEqual(
    capturedBodyIdentifier(a.joints[0].parent),
    capturedBodyIdentifier(a.joints[1].parent),
  );
  assert.ok(a.externalAnchors.every((body) => body.properties.immovable));
  a.byId.get(0).state.velocity.set(1, 2, 3);
  assert.deepEqual(b.byId.get(0).state.velocity.toArray(), [0, 0, 0]);
  assert.equal(JSON.stringify(source), original);
});

for (const malformed of [
  {
    name: "duplicate body identity",
    pattern: /duplicate/,
    change: (data) => data.bodies.push(syntheticBody(0)),
  },
  {
    name: "out-of-range source edge index",
    pattern: /vertex index/,
    change: (data) => {
      data.bodies[0].hulls[0].edges[0][1] = 4;
    },
  },
  {
    name: "out-of-range source face index",
    pattern: /vertex index/,
    change: (data) => {
      data.bodies[0].hulls[0].faces[0].indices[0] = -1;
    },
  },
  {
    name: "nonfinite motion",
    pattern: /state/,
    change: (data) => {
      data.bodies[0].state.position[0] = Infinity;
    },
  },
  {
    name: "zero orientation",
    pattern: /zero quaternion/,
    change: (data) => {
      data.bodies[0].state.orientation = [0, 0, 0, 0];
    },
  },
  {
    name: "nonpositive authored inertia",
    pattern: /positive mass\/inertia/,
    change: (data) => {
      data.bodies[0].properties.inertia[1] = 0;
    },
  },
  {
    name: "unrecorded logical owner",
    pattern: /unknown owner/,
    change: (data) => {
      data.bodies[0].owner = 99;
    },
  },
  {
    name: "unrecorded active world anchor",
    pattern: /active external anchor/,
    change: (data) => {
      data.bodies[0].properties.immovable = false;
    },
  },
  {
    name: "mismatched physical child",
    pattern: /inconsistent joint child/,
    change: (data) => {
      data.bodies[0].joint.child = 1;
    },
  },
  {
    name: "cyclic physical ancestry",
    pattern: /cyclic/,
    change: (data) => {
      data.bodies.push(syntheticBody(1));
      data.bodies[0].joint.parent = 1;
      data.bodies[1].joint.parent = 0;
    },
  },
  {
    name: "excessive body count",
    pattern: /bodies/,
    change: (data) => {
      data.bodies = Array(8193).fill(data.bodies[0]);
    },
  },
  {
    name: "excessive hull vertex count",
    pattern: /vertices/,
    change: (data) => {
      data.bodies[0].hulls[0].vertices = Array(4097).fill([0, 0, 0]);
    },
  },
])
  test(`hydration rejects ${malformed.name} before simulation`, () => {
    const data = { bodies: [syntheticBody(0)] };
    malformed.change(data);
    assert.throws(() => hydrateCapturedBodies(data), malformed.pattern);
  });
