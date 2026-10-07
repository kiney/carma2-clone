import test from "node:test";
import assert from "node:assert/strict";
import {
  Group,
  Vector3,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  DoubleSide,
} from "three";
import { WorldCollision } from "../src/world.ts";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { originalCar } from "./support/original-car.mjs";
async function stock(t, name, position = new Vector3()) {
  let data;
  try {
    data = await originalCar(name);
  } catch (e) {
    if (e.code === "ENOENT") {
      t.skip("Local original data absent");
      return;
    }
    throw e;
  }
  const damage = new DamageSystem(data.assets, data.group, data.text);
  await damage.init();
  const body = createSimulatedCar(
    data.group,
    data.text,
    damage,
    position,
    0,
    true,
  );
  return body;
}
const emptyWorld = {
  raycast() {
    return null;
  },
  querySurfaces() {
    return [];
  },
};
test("original stock cars enter the fixed simulation using authored mass, inertia, wheelbase and hulls", async (t) => {
  const scene = new Group(),
    sim = new VehicleSimulation(emptyWorld, scene),
    cars = [];
  for (const [i, name] of ["EAGLE3", "buggy", "bigdump"].entries()) {
    const car = await stock(t, name, new Vector3(i * 5, 0, 0));
    if (!car) return;
    scene.add(car.group);
    sim.add(car);
    cars.push(car);
  }
  assert.equal(new Set(cars.map((c) => c.properties.mass)).size, 3);
  assert.equal(new Set(cars.map((c) => c.motion.spring[0])).size, 3);
  assert.equal(
    new Set(cars.map((c) => c.hulls[0].vertices.length)).size >= 1,
    true,
  );
  sim.update(0.039);
  assert.equal(sim.elapsed, 0);
  sim.update(0.001);
  assert.equal(sim.elapsed, 0.04);
  for (const car of cars) {
    const vy = (-10 / 6.9) * 0.04;
    assert.ok(
      Math.abs(
        car.state.velocity.y -
          vy *
            (1 -
              (Math.abs(vy) * 0.04 * 0.0005000000237487257 * 6.9) /
                car.properties.mass),
      ) < 1e-12,
    );
    assert.ok(car.state.orientation.toArray().every(Number.isFinite));
    assert.ok(
      car.shapeVertices.flat().every((p) => p.toArray().every(Number.isFinite)),
    );
  }
});
test("original localized crush is persistent, changes eligible authored shape vertices, and repair restores both representations", async (t) => {
  const car = await stock(t, "EAGLE3");
  if (!car) return;
  const originals = car.shapeVertices.map((v) => v.map((p) => p.clone()));
  const saved = [];
  car.group.traverse((o) => {
    if (o.isMesh)
      saved.push([o, Float32Array.from(o.geometry.attributes.position.array)]);
  });
  const minZ = Math.min(...car.shapeVertices.flat().map((p) => p.z));
  const contacts = [new Vector3(-0.16, 0.06, minZ)];
  const energy = new Vector3(0, 0, 3);
  car.damage.applyImpact(
    contacts,
    energy,
    false,
    true,
    40,
    energy.clone().multiplyScalar(0.5),
  );
  const first = saved.reduce(
    (sum, [o, a]) =>
      sum +
      Array.from(o.geometry.attributes.position.array).reduce(
        (x, v, i) => x + Math.abs(v - a[i]),
        0,
      ),
    0,
  );
  assert.ok(first > 0, "Original WAM-linked geometry dents");
  const left = saved.reduce(
    (sum, [o, a]) =>
      sum +
      Array.from(o.geometry.attributes.position.array).reduce(
        (x, v, i) =>
          x + (a[Math.floor(i / 3) * 3] < 0 ? Math.abs(v - a[i]) : 0),
        0,
      ),
    0,
  );
  const right = first - left;
  assert.ok(left > right, "Corner contact stays localized to impacted side");
  car.damage.applyImpact(
    contacts,
    energy,
    false,
    true,
    80,
    energy.clone().multiplyScalar(0.5),
  );
  const repeated = saved.reduce(
    (sum, [o, a]) =>
      sum +
      Array.from(o.geometry.attributes.position.array).reduce(
        (x, v, i) => x + Math.abs(v - a[i]),
        0,
      ),
    0,
  );
  assert.ok(repeated >= first, "Permanent repeated crush accumulates");
  assert.ok(
    car.shapeVertices.some((v, s) =>
      v.some((p, i) => p.distanceTo(originals[s][i]) > 1e-7),
    ),
    "Version4 physical shape is crushed",
  );
  car.damage.repair();
  for (const [o, a] of saved) {
    const repaired = o.geometry.attributes.position.array;
    assert.equal(repaired.length, a.length);
    // C2 stores visual repair targets as U16 over[-10,+10]; physical shape
    // snapshots remain exact. The half-quantum bound follows that format.
    assert.ok(
      Array.from(repaired).every(
        (v, i) => Math.abs(v - a[i]) <= 10 / 65535 + 1e-6,
      ),
    );
  }
  for (let s = 0; s < originals.length; s++)
    for (let i = 0; i < originals[s].length; i++)
      assert.equal(car.shapeVertices[s][i].distanceTo(originals[s][i]), 0);
  assert.equal(
    car.damage.componentLevels.reduce((a, b) => a + b, 0),
    0,
  );
  assert.ok(
    car.damage.runtimeParts.every(
      (p) => p.state.phase === 0 && p.state.accumulatedForce === 0,
    ),
  );
});
test("equal original cars exchange momentum head-on and corner contacts create angular velocity", async (t) => {
  for (const offset of [0, 0.14]) {
    const a = await stock(t, "EAGLE3", new Vector3(0, 0, 0.41)),
      b = await stock(t, "EAGLE3", new Vector3(offset, 0, -0.41));
    if (!a || !b) return;
    b.state.heading = Math.PI;
    b.state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
    a.state.velocity.z = -4;
    b.state.velocity.z = 4;
    const sim = new VehicleSimulation(emptyWorld, new Group());
    sim.add(a);
    sim.add(b);
    sim.step();
    assert.ok(
      sim.lastImpacts.some((i) => i.b),
      "Authored hulls create car-car contacts",
    );
    const momentum = a.state.velocity
      .clone()
      .multiplyScalar(a.properties.mass)
      .addScaledVector(b.state.velocity, b.properties.mass);
    assert.ok(
      Math.abs(momentum.x) < 1e-7 && Math.abs(momentum.z) < 1e-7,
      "Normal/friction impulses exchange equal momentum",
    );
    assert.ok(
      a.state.velocity.z > -4 && b.state.velocity.z < 4,
      "Both cars change speed",
    );
    if (offset)
      assert.ok(
        Math.abs(a.state.angularVelocity.y) > 1e-3,
        "Off-center crash produces yaw",
      );
    else
      assert.ok(
        Math.abs(a.state.angularVelocity.y) < 1e-5,
        "Symmetric front crash produces no yaw",
      );
  }
});

test("original Eagle splits at a scenery edge before impulse application and full repair reunites both physical halves", async (t) => {
  const car = await stock(t, "EAGLE3", new Vector3(0, 0, 0.55));
  if (!car) return;
  car.damage.damageContext.random = () => 0.5;
  const originalMass = car.properties.mass,
    originalI = car.properties.inertia.clone(),
    originalCOM = car.properties.centerOfMass.clone();
  const scene = new Group(),
    geo = new BufferGeometry();
  // Independently authored perpendicular/oblique faces share a vertical edge;
  // the source contact gate requires two nearby edges with differing normals.
  geo.setAttribute(
    "position",
    new Float32BufferAttribute(
      [0, -1, 0, 0, 1, 0, 1, 1, 0, 0, -1, 0, -1, 1, -1, 0, 1, 0],
      3,
    ),
  );
  geo.userData.sourceFaceFlags = Uint8Array.from([6, 3]); // Only the shared vertical edge participates.
  const material = new MeshBasicMaterial({ side: DoubleSide });
  material.userData.c2Flags = 4096;
  scene.add(new Mesh(geo, material));
  const world = new WorldCollision(scene);
  scene.add(car.group);
  const simulation = new VehicleSimulation(world, scene);
  simulation.add(car);
  car.state.velocity.z = -8;
  simulation.step();
  assert.ok(
    car.damage.snapped,
    "Source type0 world-edge force passes original split threshold",
  );
  const child = simulation.debris.find(
    (body) => body.splitRevision !== undefined,
  );
  assert.ok(child, "Secondary half is a persistent independent rigid body");
  assert.ok(
    Math.abs(car.properties.mass + child.properties.mass - originalMass) <
      1e-12,
    "Source partition conserves mass",
  );
  assert.ok(car.properties.mass > 0 && child.properties.mass > 0);
  assert.ok(
    simulation.lastImpacts.some((impact) => impact.sourceType === 9),
    "Pre-split impulses are disabled before recollection",
  );
  assert.ok(
    simulation.lastImpacts.some((impact) => impact.sourceType !== 9),
    "New halves are collision-tested in the same tick",
  );
  for (const body of [car, child])
    assert.ok(
      [
        ...body.state.velocity.toArray(),
        ...body.state.angularVelocity.toArray(),
      ].every(Number.isFinite),
    );
  assert.equal(
    car.damage.repairStep(40).bodyworkRepair,
    0,
    "Held repair cannot heal a snapped body",
  );
  car.damage.repair();
  car.state.position.z = 2;
  car.state.velocity.set(0, 0, 0);
  simulation.step();
  assert.equal(car.damage.snapped, false);
  assert.equal(simulation.debris.length, 0);
  assert.equal(car.properties.mass, originalMass);
  assert.deepEqual(car.properties.inertia, originalI);
  assert.deepEqual(car.properties.centerOfMass, originalCOM);
  assert.ok(car.damage.runtimeParts.every((part) => part.state.phase === 0));
});

test("original Volvo roof configuration rejects splitting when authored snappability is zero", async (t) => {
  const car = await stock(t, "volvo");
  if (!car) return;
  car.damage.damageContext.random = () => 0.5;
  const originalMass = car.properties.mass,
    scene = new Group(),
    geo = new BufferGeometry();
  geo.setAttribute(
    "position",
    new Float32BufferAttribute(
      [-3, 0.8, -3, 3, 0.8, -3, 3, 0.8, 3, -3, 0.8, -3, 3, 0.8, 3, -3, 0.8, 3],
      3,
    ),
  );
  geo.userData.sourceFaceFlags = Uint8Array.from([7, 7]); // Face contact alone, no wedge-edge split.
  const material = new MeshBasicMaterial({ side: DoubleSide });
  material.userData.c2Flags = 4096;
  scene.add(new Mesh(geo, material));
  const world = new WorldCollision(scene),
    simulation = new VehicleSimulation(world, scene);
  scene.add(car.group);
  simulation.add(car);
  car.state.velocity.y = 8;
  simulation.step();
  assert.equal(car.damage.wam.snappability, 0);
  assert.equal(
    car.damage.snapped,
    false,
    "Zero snappability makes the original roof threshold infinite",
  );
  assert.ok(
    simulation.lastImpacts.some(
      (i) => i.sourceType === 1 && i.normalImpulse > 0,
    ),
    "Overhead face collision still exchanges momentum",
  );
  assert.ok(car.state.velocity.y < 8);
  simulation.dispose();
});

test("source knackered state and ten-second countdown survive a late full model repair", async (t) => {
  const car = await stock(t, "EAGLE3");
  if (!car) return;
  const sim = new VehicleSimulation(emptyWorld, new Group());
  sim.add(car);
  car.damage.componentLevels[0] = 99;
  sim.step();
  assert.equal(car.knackered, true);
  const wastedAt = car.wastedAt;
  car.damage.repair();
  car.repairing = true;
  let bills = 0;
  sim.onRepair = () => bills++;
  sim.step();
  assert.equal(car.wastedAt, wastedAt);
  assert.equal(car.knackered, true);
  assert.equal(bills, 0);
});

test("original Porker roof cut creates independent halves from a face impact while retaining wheel forces", async (t) => {
  const car = await stock(t, "porker2");
  if (!car) return;
  car.damage.damageContext.random = () => 0.5;
  const originalSpring = [...car.motion.spring],
    originalDamper = [...car.motion.damper];
  const originalMass = car.properties.mass,
    scene = new Group(),
    geo = new BufferGeometry();
  geo.setAttribute(
    "position",
    new Float32BufferAttribute(
      [
        -3, 0.54, -3, 3, 0.54, -3, 3, 0.54, 3, -3, 0.54, -3, 3, 0.54, 3, -3,
        0.54, 3,
      ],
      3,
    ),
  );
  geo.userData.sourceFaceFlags = Uint8Array.from([7, 7]);
  const material = new MeshBasicMaterial({ side: DoubleSide });
  material.userData.c2Flags = 4096;
  scene.add(new Mesh(geo, material));
  const world = new WorldCollision(scene),
    sim = new VehicleSimulation(world, scene);
  scene.add(car.group);
  sim.add(car);
  car.state.velocity.y = 8;
  sim.step();
  assert.ok(
    car.damage.snapped,
    "Original positive snappability and qualifying above-cut impulses trigger roof split",
  );
  assert.equal(car.damage.splitRuntime.disableMotion, false);
  assert.ok(Math.abs(car.damage.splitRuntime.plane.normal.y) > 0.707107);
  const child = sim.debris.find((b) => b.part < 0);
  assert.ok(child);
  assert.ok(
    Math.abs(car.properties.mass + child.properties.mass - originalMass) <
      1e-10,
  );
  assert.ok(sim.lastImpacts.some((i) => i.sourceType === 9));
  assert.deepEqual(
    car.motion.spring,
    originalSpring,
    "Source splitting preserves stiffness despite mass partition",
  );
  assert.deepEqual(car.motion.damper, originalDamper);
  assert.ok(
    car.state.wheelLengths.every(
      (length) => length === car.motion.suspensionBase.rideHeight,
    ),
  );
  sim.dispose();
  assert.equal(sim.debris.length, 0);
});
