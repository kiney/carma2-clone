import test from "node:test";
import assert from "node:assert/strict";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";
import { DamageSystem } from "../src/damage.ts";
import { WorldCollision } from "../src/world.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import {
  transformHull,
  sweepHullTriangle,
  worldFaceSeparatesHullSweep,
} from "../src/physics/geometry.ts";
import { originalCar } from "./support/original-car.mjs";

const launch = new Vector3(
  1.5254815979504726,
  2.8236296822095572,
  -0.6026382068057459,
);

async function fixture(t, { airborne = false, wall = false } = {}) {
  let source;
  try {
    source = await originalCar("porker2");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip("Local original Porker2 installation absent");
    return;
  }
  const damage = new DamageSystem(source.assets, source.group, source.text);
  await damage.init();
  damage.damageContext.random = () => 0.5;
  const scene = new Group();
  const geometry = new BufferGeometry();
  const vertices = [
    -20, 0, -20, 20, 0, 20, 20, 0, -20, -20, 0, -20, -20, 0, 20, 20, 0, 20,
  ];
  if (wall) vertices.push(0.23, -20, -20, 0.23, 20, -20, 0.23, 0, 20);
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  // Each artificial support triangle has no exposed collision edges.
  geometry.userData.sourceFaceFlags = new Uint8Array(vertices.length / 9).fill(
    7,
  );
  const material = new MeshBasicMaterial({ side: DoubleSide });
  scene.add(new Mesh(geometry, material));
  // Snapshot scenery before adding the car, as production does.
  const world = new WorldCollision(scene);
  const sim = new VehicleSimulation(world, scene);
  scene.add(source.group);
  const car = createSimulatedCar(
    source.group,
    source.text,
    damage,
    new Vector3(0, airborne ? 2 : -0.04, 0),
    0,
    true,
    { immutableHulls: true },
  );
  sim.add(car);
  t.after(() => {
    sim.dispose();
    geometry.dispose();
    material.dispose();
  });

  // Reduce the historical search to its eight deterministic component impacts.
  // No simulation/history loop or direct component-level assignment is needed.
  for (const [axis, sign] of [
    [2, -1],
    [2, 1],
    [0, -1],
    [1, -1],
    [1, -1],
    [1, -1],
    [1, -1],
    [1, -1],
  ]) {
    const point = damage.bounds.getCenter(new Vector3());
    point.setComponent(
      axis,
      (sign < 0 ? damage.bounds.min : damage.bounds.max).getComponent(axis),
    );
    const energy = new Vector3().setComponent(axis, sign * 0.5);
    damage.applyImpact([point], energy, true, false, 0, energy, point);
  }
  assert.deepEqual(
    Array.from(damage.componentLevels),
    [29, 47, 29, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  );
  // Explicit due reservations retain the two real source WAM attachments from
  // the historical case without claiming its unavailable complete pose history.
  for (const index of [6, 7]) damage.runtimeParts[index].state.queuedAt = 0;
  sim.detachParts(car);
  const mass = car.properties.mass;
  car.state.velocity.copy(launch); // Controlled historical launch input.
  damage.damageContext.random = () => 0;
  const spam = sim.spamCar(car, 0.1);
  assert.equal(spam.rays.length, 10);
  assert.ok(spam.splitRequest && damage.snapped);
  const secondary = sim.debris.find((body) => body.part < 0);
  assert.ok(secondary);
  const attachments = sim.debris.filter((body) => [6, 7].includes(body.part));
  assert.equal(attachments.length, 2);
  for (const body of attachments) assert.equal(body.joint?.parent, secondary);
  assert.ok(secondary.state.velocity.distanceTo(launch) < 1e-12);
  assert.equal(sim.phil.getState(secondary), 2);
  assert.ok(
    Math.abs(car.properties.mass + secondary.properties.mass - mass) < 1e-12,
  );
  return { sim, car, secondary, attachments, mass };
}

for (const airborne of [false, true])
  test(`PHY-17 original Porker2 ${airborne ? "airborne" : "ground-touching"} SPAM secondary advances with its real attachments`, async (t) => {
    const setup = await fixture(t, { airborne });
    if (!setup) return;
    const { sim, car, secondary, attachments, mass } = setup;
    const start = secondary.state.position.clone();
    const moments = secondary.properties.inertia.clone();
    const com = secondary.properties.centerOfMass.clone();
    sim.predictHierarchy(sim.allBodies());
    const guarded = sim.advanceWorldContacts(secondary, true);
    assert.equal(
      guarded.fraction,
      1,
      "A separating support touch cannot cap the tree at zero",
    );
    assert.equal(guarded.contacts.length, 0);
    // One full production tick is sufficient; the historical 180-step window
    // obscured whether admission, sleep or commitment first stopped the body.
    sim.step();
    assert.equal(sim.phil.getState(secondary), 2);
    assert.equal(sim.hierarchyQuiet.get(secondary).doNothing, false);
    assert.equal(
      sim.hierarchyQuiet.get(secondary).lastResult.gate,
      "linear-speed",
    );
    assert.ok(secondary.state.position.distanceTo(start) > 0.03);
    if (airborne) assert.ok(secondary.state.position.y > start.y + 0.09);
    assert.ok(secondary.properties.inertia.distanceTo(moments) < 1e-12);
    assert.ok(secondary.properties.centerOfMass.distanceTo(com) < 1e-12);
    assert.ok(
      Math.abs(car.properties.mass + secondary.properties.mass - mass) < 1e-12,
    );
    for (const body of attachments) {
      assert.equal(body.joint?.parent, secondary);
      assert.ok(body.state.position.toArray().every(Number.isFinite));
    }
    sim.repair(car);
    sim.step();
    assert.equal(car.damage.snapped, false);
    assert.equal(car.properties.mass, mass);
    assert.equal(sim.debris.filter((body) => body.owner === car).length, 0);
    assert.equal(sim.phil.getState(secondary), 0);
    assert.equal(sim.hierarchyQuiet.get(secondary), null);
  });

test("PHY-17 support-touch clearance does not exempt an independent new wall", async (t) => {
  const setup = await fixture(t, { wall: true });
  if (!setup) return;
  const { sim, secondary } = setup;
  sim.predictHierarchy(sim.allBodies());
  const guarded = sim.advanceWorldContacts(secondary, true);
  assert.ok(guarded.fraction > 0 && guarded.fraction < 1);
  assert.ok(guarded.contacts.some((row) => row.normal.x < -0.9));
});

test("world support-plane certification preserves entering and old-overlap paths", () => {
  const hull = buildBoxHull(new Vector3(-1, 0, -1), new Vector3(1, 1, 1));
  const at = (y) => transformHull(hull, new Vector3(0, y, 0), new Quaternion());
  const face = {
    a: new Vector3(-10, 0, -10),
    b: new Vector3(10, 0, 10),
    c: new Vector3(10, 0, -10),
  };
  assert.equal(worldFaceSeparatesHullSweep(at(0), at(0.1), face), true);
  assert.equal(worldFaceSeparatesHullSweep(at(0), at(-0.1), face), false);
  assert.equal(worldFaceSeparatesHullSweep(at(-0.01), at(0.1), face), false);
  assert.equal(
    worldFaceSeparatesHullSweep(at(0), at(0.1), { ...face, edgeOnly: true }),
    false,
  );
  assert.equal(
    worldFaceSeparatesHullSweep(at(0), at(0.1), {
      a: new Vector3(),
      b: new Vector3(),
      c: new Vector3(),
    }),
    false,
    "A degenerate face cannot certify a separating plane",
  );
});

test("PHY-17 secant certificate preserves rotating inverse-frame world-vertex contacts and the actual world guard", () => {
  const hull = buildBoxHull(
    new Vector3(-0.01, -1, -0.1),
    new Vector3(0.01, 1, 0.1),
  );
  const position = new Vector3(0, -0.99994, 0);
  const axis = new Vector3(0, 0, 1);
  const rotation = (fraction) =>
    new Quaternion().setFromAxisAngle(axis, -0.025 + fraction * 0.05);
  const old = transformHull(hull, position, rotation(0));
  const next = transformHull(hull, position, rotation(1));
  const face = {
    a: new Vector3(0, 0, 0),
    b: new Vector3(2, 0, 0),
    c: new Vector3(0, 0, 2),
    normal: new Vector3(0, -1, 0),
    twoSided: true,
    faceFlags: 0,
    material: "0",
    modifier: { tyreFriction: 1, wallFriction: 1, bumpiness: 0 },
  };
  assert.ok(Math.max(...old.vertices.map((point) => point.y)) < 0);
  assert.ok(Math.max(...next.vertices.map((point) => point.y)) < 0);
  assert.ok(
    Math.max(
      ...transformHull(hull, position, rotation(0.5)).vertices.map(
        (point) => point.y,
      ),
    ) > 0,
  );
  const qualified = worldFaceSeparatesHullSweep(old, next, face);
  assert.equal(qualified, true);
  const baseline = sweepHullTriangle(old, next, face.a, face.b, face.c, {
    ...face,
    deferReduction: true,
  });
  const guarded = sweepHullTriangle(old, next, face.a, face.b, face.c, {
    ...face,
    deferReduction: true,
    skipMovingHullFeatures: qualified,
  });
  assert.deepEqual(guarded.contactTypes, [2]);
  assert.deepEqual(guarded.pointFractions, baseline.pointFractions);
  assert.ok(Math.abs(guarded.fraction - 0.299967163) < 1e-8);

  const body = {
    hulls: [hull],
    properties: {
      mass: 1,
      inertia: new Vector3(1, 1, 1),
      centerOfMass: new Vector3(),
    },
    state: {
      position,
      orientation: rotation(0),
      velocity: new Vector3(),
      angularVelocity: new Vector3(0, 0, 1.25),
    },
  };
  const sim = new VehicleSimulation(
    { raycast: () => null, querySurfaces: () => [face] },
    new Group(),
  );
  sim.hierarchyMotion = {
    paths: new Map([
      [body, (fraction) => ({ position, orientation: rotation(fraction) })],
    ]),
  };
  const result = sim.advanceWorldContacts(body, true);
  assert.ok(
    result.fraction < 0.5,
    "Rotating into the finite world vertex must remain guarded",
  );
  assert.ok(result.contacts.some((contact) => contact.sourceType === 2));
  sim.dispose();
});
