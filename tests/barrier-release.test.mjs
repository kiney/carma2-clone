import test from "node:test";
import assert from "node:assert/strict";
import {
  Group,
  Vector3,
  Quaternion,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  DoubleSide,
} from "three";
import {
  buildHull,
  transformHull,
  recoverShallowWorldContacts,
} from "../src/physics/geometry.ts";
import { advanceRigidBody } from "../src/physics/integrate.ts";
import { originalCar } from "./support/original-car.mjs";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { WorldCollision } from "../src/world.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const q = new Quaternion();
const cube = buildHull(
  [-0.1, 0.1].flatMap((x) =>
    [-0.1, 0.1].flatMap((y) => [-0.1, 0.1].map((z) => v(x, y, z))),
  ),
);
const face = { a: v(-1, 0, -1), b: v(1, 0, 1), c: v(1, 0, -1), twoSided: true };
for (const depth of [0.00001, 0.0005, 0.001, 0.002, 0.003]) {
  test(`shallow finite-face recovery ${depth}: outward/tangent drift stays free, inward stays blocked`, () => {
    const center = v(0.25, 0.1 - depth, -0.25),
      old = transformHull(cube, center, q);
    for (const [drift, blocked] of [
      [v(0, 0.004), false],
      [v(0, 0, -0.02), false],
      [v(0, -0.004), true],
    ]) {
      const next = transformHull(cube, center.clone().add(drift), q);
      const recovery = recoverShallowWorldContacts(old, next, face, center);
      assert.ok(
        recovery?.overlapDetected,
        "finite authored edges prove the old overlap",
      );
      assert.equal(recovery.contacts.length > 0, blocked);
      for (const contact of recovery.contacts)
        assert.ok(contact.normal.y > 0.99);
    }
  });
}
test("shallow recovery rejects deep overlap, mere clearance, remote triangles, wire and edge-only shapes", () => {
  for (const y of [0.095, 0.101, 0]) {
    const center = v(0.25, y, -0.25),
      old = transformHull(cube, center, q);
    assert.equal(
      recoverShallowWorldContacts(old, old, face, center),
      undefined,
    );
  }
  const center = v(0.25, 0.099, -0.25),
    old = transformHull(cube, center, q);
  assert.equal(
    recoverShallowWorldContacts(
      old,
      old,
      { ...face, a: v(10, 0, 10), b: v(12, 0, 12), c: v(12, 0, 10) },
      center,
    ),
    undefined,
  );
  for (const special of [
    { edgeOnly: true },
    { materialIdentifier: "!water" },
    { materialIdentifier: "?wire" },
  ])
    assert.equal(
      recoverShallowWorldContacts(old, old, { ...face, ...special }, center),
      undefined,
    );
  assert.equal(
    recoverShallowWorldContacts({ ...old, faces: [] }, old, face, center),
    undefined,
  );
});

async function setup(t, withWall = false) {
  let data;
  try {
    data = await originalCar("EAGLE3");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local original data absent");
      return;
    }
    throw error;
  }
  const damage = new DamageSystem(data.assets, data.group, data.text);
  await damage.init();
  const car = createSimulatedCar(data.group, data.text, damage, v(), 0, true);
  const scene = new Group(),
    geo = new BufferGeometry();
  // Independent finite wedge top y=.1+.25*x. Collision flags hide triangle seams.
  const vertices = [
    -1, -0.15, -2, 1, 0.35, 2, 1, 0.35, -2, -1, -0.15, -2, -1, -0.15, 2, 1,
    0.35, 2,
  ];
  if (withWall)
    vertices.push(
      -1,
      -1,
      -0.48,
      1,
      1,
      -0.48,
      1,
      -1,
      -0.48,
      -1,
      -1,
      -0.48,
      -1,
      1,
      -0.48,
      1,
      1,
      -0.48,
    );
  geo.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geo.userData.sourceFaceFlags = Uint8Array.from(
    { length: vertices.length / 9 },
    () => 7,
  );
  const mat = new MeshBasicMaterial({ side: DoubleSide });
  mat.userData.c2Flags = 4096;
  scene.add(new Mesh(geo, mat));
  const world = new WorldCollision(scene),
    sim = new VehicleSimulation(world, scene);
  sim.add(car);
  const normal = v(-0.25, 1).normalize();
  const clearance = (
    position = car.state.position,
    rotation = car.state.orientation,
  ) =>
    Math.min(
      ...car.hulls
        .flatMap((h) => transformHull(h, position, rotation).vertices)
        .map((p) => normal.dot(p) - 0.1 * normal.y),
    );
  car.state.orientation.setFromAxisAngle(v(0, 0, 1), (-20 * Math.PI) / 180);
  car.state.position.y = (-0.001 - clearance()) / normal.y;
  car.damage.damageContext.invulnerable = true;
  return { car, sim, clearance };
}
test("rolled stock Eagle wedge guard allows separation and tangent motion without altering native prior flags", async (t) => {
  const loaded = await setup(t);
  if (!loaded) return;
  const { car, sim, clearance } = loaded;
  try {
    assert.ok(Math.abs(clearance() + 0.001) < 1e-7);
    for (const [velocity, expected] of [
      [[-0.2, 0, -1], 1],
      [[0, 0, -1], 1],
      [[0.2, -0.1, -1], 0],
    ]) {
      car.state.velocity.fromArray(velocity);
      car.state.angularVelocity.set(0, 0, 0);
      const before = car.state.position.clone(),
        speed = car.state.velocity.clone();
      const guarded = sim.advanceWorldContacts(car, true);
      assert.equal(guarded.fraction, expected, JSON.stringify(velocity));
      assert.ok(car.state.position.equals(before));
      assert.ok(car.state.velocity.equals(speed));
      assert.equal(car.worldRecovery, false);
      assert.equal(car.worldOverlapDetected, false);
    }
    car.state.velocity.set(-0.2, 0, -1);
    advanceRigidBody(car, 0.04, true);
    const native = sim.worldContacts(car, car.hulls);
    assert.ok(
      native.length > 0 && native.some((c) => c.normal.y < -0.9),
      "source unflagged underside contact semantics remain intact",
    );
  } finally {
    sim.dispose();
  }
});
test("old shallow wedge overlap cannot suppress a new perpendicular wall collision", async (t) => {
  const loaded = await setup(t, true);
  if (!loaded) return;
  const { car, sim } = loaded;
  try {
    car.state.velocity.set(-0.2, 0, -5);
    car.state.angularVelocity.set(0, 0, 0);
    const guarded = sim.advanceWorldContacts(car, true);
    assert.ok(guarded.fraction < 1);
    assert.ok(
      guarded.contacts.some((c) => c.normal.z > 0.99),
      "new wall keeps its opposing contact",
    );
  } finally {
    sim.dispose();
  }
});
test("rolled stock Eagle clears shallow wedge and reverses using unchanged source forces", async (t) => {
  const loaded = await setup(t);
  if (!loaded) return;
  const { car, sim, clearance } = loaded;
  try {
    const start = car.state.position.clone();
    car.state.velocity.set(-0.2, 0, -1);
    car.state.angularVelocity.set(0, 0, 0);
    car.input.throttle = -1;
    for (let i = 0; i < 20; i++) sim.step();
    assert.ok(clearance() > 0.02, `corner clears wedge: ${clearance()}`);
    for (let i = 20; i < 50; i++) sim.step();
    assert.ok(
      car.state.position.z - start.z > 0.5,
      "reverse restores meaningful motion rather than a positional push",
    );
    assert.ok(car.state.position.toArray().every(Number.isFinite));
    assert.ok(car.damage.componentLevels.every((x) => x === 0));
  } finally {
    sim.dispose();
  }
});
