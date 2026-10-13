import test from "node:test";
import assert from "node:assert/strict";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { originalCar } from "./support/original-car.mjs";
import { WorldCollision } from "../src/world.ts";
import { sharedNativeRandom } from "../src/native-random.ts";
import { sharedMotionContext } from "../src/physics/motion.ts";
import { parseNonCarMechanics } from "../src/noncars.ts";
import { createNonCarBody } from "../src/physics/noncar-body.ts";

function roadCorner() {
  const scene = new Group(),
    material = new MeshBasicMaterial({ side: DoubleSide });
  material.userData.c2Flags = 4096;
  for (const vertices of [
    [-20, 0, -20, 20, 0, 20, 20, 0, -20, -20, 0, -20, -20, 0, 20, 20, 0, 20],
    [-20, -20, 0, 20, 20, 0, 20, -20, 0, -20, -20, 0, -20, 20, 0, 20, 20, 0],
  ]) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    geometry.userData.sourceFaceFlags = Uint8Array.from([7, 7]);
    scene.add(new Mesh(geometry, material));
  }
  return scene;
}

/** Existing source-edge split fixture from split-lifecycle.test.mjs. */
function splitEdge() {
  const scene = new Group(),
    geometry = new BufferGeometry(),
    material = new MeshBasicMaterial({ side: DoubleSide });
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      [0, -1, 0, 0, 1, 0, 1, 1, 0, 0, -1, 0, -1, 1, -1, 0, 1, 0],
      3,
    ),
  );
  geometry.userData.sourceFaceFlags = Uint8Array.from([6, 3]);
  material.userData.c2Flags = 4096;
  scene.add(new Mesh(geometry, material));
  return scene;
}

function prop(x, velocity) {
  const actor = new Group();
  actor.name = "&07c0001.ACT";
  actor.position.set(x, 1, 0);
  const mechanics = parseNonCarMechanics(
    "101\n7\n0,0,0\n0,-.1,0\n1\nbox\n-.1,-.1,-.1\n.1,.1,.1\n.1,2\n.2,.2,.2\n0\n0\n0\nINFINITE_I\nOBJECT_FRICTION\n0\nIGNORE_WORLD_COLLISIONS\nEND",
  );
  const body = createNonCarBody(actor, mechanics);
  body.motor.sleeping = false;
  body.properties.immovable = false;
  body.state.velocity.x = velocity;
  return body;
}

async function stock(name, x) {
  const data = await originalCar(name),
    damage = new DamageSystem(data.assets, data.group, data.text);
  await damage.init();
  damage.damageContext.random = () => 0.5;
  return createSimulatedCar(
    data.group,
    data.text,
    damage,
    new Vector3(x, 0, 0),
    0,
    true,
  );
}

const vector = (value) => value.toArray();
function runSnapshot(sim, cars) {
  const bodies = [...cars, ...sim.debris, ...sim.noncars],
    index = new Map(bodies.map((body, i) => [body, i]));
  return {
    bodies: bodies.map((body) => ({
      kind: body.kind ?? "car",
      part: body.part ?? null,
      position: vector(body.state.position),
      orientation: body.state.orientation.toArray(),
      velocity: vector(body.state.velocity),
      angularVelocity: vector(body.state.angularVelocity),
      mass: body.properties.mass,
      inertia: vector(body.properties.inertia),
      centerOfMass: vector(body.properties.centerOfMass),
      hullVertices: body.hulls.map((hull) => hull.vertices.map(vector)),
      compactVertexOrder: body.hulls.map(
        (hull) => hull.vertexOrder?.slice() ?? null,
      ),
      deformationRevision: body.damage?.deformationRevision ?? null,
      splitRevision: body.damage?.splitRevision ?? null,
      snapped: body.damage?.snapped ?? null,
      damage: body.damage ? Array.from(body.damage.componentLevels) : null,
      overlapRecovery: body.overlapRecovery,
      overlapDetected: body.overlapDetected,
      worldRecovery: body.worldRecovery,
      worldOverlapDetected: body.worldOverlapDetected,
      jointParent: body.joint ? (index.get(body.joint.parent) ?? -1) : null,
    })),
    impacts: sim.lastImpacts.map((impact) => ({
      a: index.get(impact.a),
      b: impact.b ? index.get(impact.b) : null,
      point: vector(impact.point),
      pointB: impact.pointB ? vector(impact.pointB) : null,
      normal: vector(impact.normal),
      sourceType: impact.sourceType ?? null,
      normalImpulse: impact.normalImpulse,
      closingSpeed: impact.closingSpeed,
      tangentImpulse: vector(impact.tangentImpulse),
      solverAccepted: impact.solverAccepted ?? null,
    })),
    debrisCount: sim.debris.length,
  };
}

/** Capture public collection decisions, not implementation cache calls. Empty
 * collections retain overlap evidence; guard hits must retain endpoint writes. */
function traceCollections(sim, cars) {
  const events = [],
    ids = new Map(
      [...cars, ...sim.debris, ...sim.noncars].map((body, i) => [body, i]),
    );
  let phase = "impact";
  const id = (body) => {
    if (!body) return null;
    if (!ids.has(body)) ids.set(body, ids.size);
    return ids.get(body);
  };
  const flags = () =>
    sim.allBodies().map((body) => ({
      body: id(body),
      overlapRecovery: body.overlapRecovery,
      overlapDetected: body.overlapDetected,
      worldRecovery: body.worldRecovery,
      worldOverlapDetected: body.worldOverlapDetected,
    }));
  const rows = (contacts) =>
    contacts.map((contact) => ({
      a: id(contact.a),
      b: id(contact.b),
      point: vector(contact.point),
      pointB: contact.pointB ? vector(contact.pointB) : null,
      normal: vector(contact.normal),
      sourceType: contact.sourceType ?? null,
      penetration: contact.penetration ?? null,
      faceFriction: contact.faceFriction ?? null,
      surface: contact.sourceSurface
        ? {
            a: vector(contact.sourceSurface.a),
            b: vector(contact.sourceSurface.b),
            c: vector(contact.sourceSurface.c),
            material: contact.sourceSurface.material,
            faceIndex: contact.sourceSurface.faceIndex ?? null,
            faceFlags: contact.sourceSurface.faceFlags,
            materialFlags: contact.sourceSurface.materialFlags,
          }
        : null,
    }));
  for (const name of ["collectContacts", "collectBodyContacts"]) {
    const original = sim[name];
    sim[name] = function (bodies) {
      const before = flags(),
        result = original.call(this, bodies);
      events.push({
        method: name,
        phase,
        elapsed: sim.elapsed,
        bodies: bodies.map(id),
        before,
        after: flags(),
        rows: rows(result),
      });
      return result;
    };
  }
  const original = sim.advanceWorldContacts;
  sim.advanceWorldContacts = function (body, refine = false) {
    const result = original.call(this, body, refine);
    events.push({
      method: "advanceWorldContacts",
      phase,
      elapsed: sim.elapsed,
      body: id(body),
      refine,
      fraction: result.fraction,
      crossingFraction: result.crossingFraction ?? null,
      rows: rows(result.contacts),
      position: body.state.predictedPosition?.toArray() ?? null,
      orientation: body.state.predictedOrientation?.toArray() ?? null,
      after: flags(),
    });
    return result;
  };
  return {
    events,
    mark: (name) => {
      phase = name;
    },
  };
}

async function scenario(reuse, t, randomState, stopTimer, mode) {
  let cars;
  try {
    cars = await Promise.all([
      stock("EAGLE3", 0),
      stock("buggy", 0),
      stock("bigdump", 40),
    ]);
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local original Eagle, Buggy, and Bigdump data absent");
      return undefined;
    }
    throw error;
  }
  const scene =
      mode === "road"
        ? roadCorner()
        : mode === "split"
          ? splitEdge()
          : new Group(),
    sim = new VehicleSimulation(new WorldCollision(scene), scene);
  if (mode === "road") {
    cars[0].state.position.set(0, 0.15, 0.6);
    cars[0].state.velocity.set(0, -8, -32);
    cars[0].state.angularVelocity.set(180, 0, 0);
    cars[1].state.position.set(30, 4, 30);
    cars[2].state.position.set(40, 4, 40);
    const jointPart = cars[0].damage.runtimeParts.find(
      (part) => part.state.phase === 0 && part.state.type !== 2,
    );
    assert.ok(jointPart, "stock Eagle has an ordinarily jointed part");
    jointPart.state.queuedAt = 0;
  } else if (mode === "split") {
    cars[0].state.position.set(0, 0, 0.55);
    cars[0].state.velocity.set(0, 0, -8);
    cars[1].state.position.set(30, 4, 30);
    cars[2].state.position.set(40, 4, 40);
  } else {
    cars[0].state.position.x = -0.25;
    cars[1].state.position.x = 0.25;
    cars[0].overlapRecovery = true;
    cars[1].overlapRecovery = true;
    cars[0].state.velocity.set(8, 0, 0);
    cars[1].state.velocity.set(-8, 0, 0);
    const props = [prop(-0.25, 4), prop(0.25, -4)];
    for (const body of props) {
      scene.add(body.actor);
      sim.addNonCar(body);
    }
  }
  for (const car of cars) {
    scene.add(car.group);
    sim.add(car);
  }
  sim.correctionReuse = reuse;
  sim.correctionDiagnostics = {};
  sharedNativeRandom.seed(randomState);
  sharedMotionContext.stopTimer = stopTimer;
  const tracing = traceCollections(sim, cars),
    checkpoints = [];
  try {
    sim.step();
    if (mode === "split") {
      assert.ok(
        cars[0].damage.snapped,
        "qualifying source edge splits the Eagle",
      );
      assert.ok(sim.debris.some((body) => body.part < 0));
      checkpoints.push({ phase: "split", state: runSnapshot(sim, cars) });
      tracing.mark("repair-reset");
      sim.repair(cars[0]);
      cars[0].state.position.set(0, 3, 5);
      cars[0].state.velocity.set(0, 0, 0);
      sim.reset(cars[0]);
      checkpoints.push({
        phase: "repair-reset",
        state: runSnapshot(sim, cars),
      });
      tracing.mark("after-repair-step");
      sim.step();
      assert.equal(cars[0].damage.snapped, false);
      assert.equal(sim.debris.filter((body) => body.part < 0).length, 0);
      checkpoints.push({
        phase: "after-repair-step",
        state: runSnapshot(sim, cars),
      });
    }
    return {
      ...runSnapshot(sim, cars),
      decisions: tracing.events,
      checkpoints,
      diagnostics: structuredClone(sim.correctionDiagnostics),
    };
  } finally {
    sim.dispose();
  }
}

async function compareModes(t, mode) {
  const randomState = sharedNativeRandom.state,
    stopTimer = sharedMotionContext.stopTimer;
  t.after(() => {
    sharedNativeRandom.seed(randomState);
    sharedMotionContext.stopTimer = stopTimer;
  });
  const uncached = await scenario(false, t, randomState, stopTimer, mode);
  if (!uncached) return;
  const cached = await scenario(true, t, randomState, stopTimer, mode);
  if (!cached) return;
  const { diagnostics: uncachedDiagnostics, ...uncachedState } = uncached,
    { diagnostics: cachedDiagnostics, ...cachedState } = cached;
  assert.deepEqual(cachedState, uncachedState);
  assert.ok(cachedDiagnostics, "simulation exposes correction diagnostics");
  assert.ok(
    cachedDiagnostics.correctionPasses >= 1,
    `expected at least one correction pass: ${JSON.stringify(cachedDiagnostics)}`,
  );
  assert.ok(
    cached.decisions.filter((event) => event.method === "collectBodyContacts")
      .length >= 2,
    "ordered comparison includes initial and iterative body collections",
  );
  assert.ok(
    cached.decisions.some((event) => event.method === "advanceWorldContacts"),
    "ordered comparison includes safe world fractions and candidate endpoints",
  );
  assert.ok(
    (cachedDiagnostics.geometryHits ?? 0) + (cachedDiagnostics.pairHits ?? 0) >
      0,
    `expected unchanged work reuse: ${JSON.stringify(cachedDiagnostics)}`,
  );
  assert.ok(
    cachedDiagnostics.contactCollections <=
      uncachedDiagnostics.contactCollections,
    "reuse retains or reduces collection work without changing results",
  );
  return cached;
}

test("stock Eagle, Buggy, and distant Bigdump match uncached correction decisions", async (t) => {
  const result = await compareModes(t, "pair");
  if (!result) return;
  assert.ok(
    result.bodies[2].position[0] === 40,
    "distant Bigdump remains outside the coupled collision group",
  );
  const distantGuards = result.decisions.filter(
    (event) => event.method === "advanceWorldContacts" && event.body === 2,
  );
  assert.ok(distantGuards.length > 0);
  assert.ok(
    distantGuards.every((event) => event.fraction === 1 && !event.rows.length),
    "the unrelated Bigdump retains its clear guarded trajectory while other groups solve",
  );
  assert.ok(
    result.impacts.some(
      (impact) =>
        (impact.a === 0 && impact.b === 1) ||
        (impact.a === 1 && impact.b === 0),
    ),
    `crossing stock cars exchange an impulse: ${JSON.stringify(result.impacts)}`,
  );
  assert.ok(
    result.impacts.some(
      (impact) =>
        (impact.a === 3 && impact.b === 4) ||
        (impact.a === 4 && impact.b === 3),
    ),
    "the two moving props exchange a body-pair impulse",
  );
});

test("stock Eagle road and wall contact survives a full-turn correction path", async (t) => {
  const result = await compareModes(t, "road");
  if (!result) return;
  assert.ok(
    result.impacts.some((impact) => impact.b === null),
    "finite road or wall scenery contacts the Eagle",
  );
  assert.ok(
    result.diagnostics.correctionPasses >= 1,
    "the case traverses the correction loop",
  );
  assert.ok(
    result.bodies.some((body) => body.jointParent === 0),
    "the source detached part retains its parent joint during correction",
  );
});

test("source-edge Eagle split, full repair and reset retain exact correction decisions", async (t) => {
  const result = await compareModes(t, "split");
  if (!result) return;
  assert.deepEqual(
    result.checkpoints.map((checkpoint) => checkpoint.phase),
    ["split", "repair-reset", "after-repair-step"],
  );
  assert.equal(result.checkpoints[0].state.bodies[0].snapped, true);
  assert.equal(result.checkpoints[1].state.bodies[0].snapped, false);
  assert.ok(
    result.decisions.some(
      (event) =>
        event.phase === "impact" &&
        event.method === "collectContacts" &&
        event.bodies.includes(3),
    ),
    "the split secondary participates in immediate changed-group recollection",
  );
  assert.ok(
    result.decisions.some(
      (event) =>
        event.phase === "after-repair-step" &&
        event.method === "collectContacts",
    ),
    "the next tick recollects repaired and reset geometry",
  );
});
