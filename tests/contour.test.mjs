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
import { originalCar } from "./support/original-car.mjs";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { WorldCollision } from "../src/world.ts";
import { advanceRigidBody } from "../src/physics/integrate.ts";
import { transformHull } from "../src/physics/geometry.ts";

async function setup(t, name, slope) {
  let data;
  try {
    data = await originalCar(name);
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local original data absent");
      return;
    }
    throw error;
  }
  const damage = new DamageSystem(data.assets, data.group, data.text);
  await damage.init();
  const car = createSimulatedCar(
    data.group,
    data.text,
    damage,
    new Vector3(),
    0,
    true,
  );
  const scene = new Group(),
    geo = new BufferGeometry();
  const vertices =
    slope === undefined
      ? [-20, 0, -20, 20, 0, 20, 20, 0, -20, -20, 0, -20, -20, 0, 20, 20, 0, 20]
      : [
          [20, 0, 0, 0],
          [0, -4, 0, 4 * slope],
          [-4, -200, 4 * slope, 4 * slope],
        ].flatMap(([z0, z1, y0, y1]) => [
          -20,
          y0,
          z0,
          20,
          y1,
          z1,
          20,
          y0,
          z0,
          -20,
          y0,
          z0,
          -20,
          y1,
          z1,
          20,
          y1,
          z1,
        ]);
  geo.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geo.userData.sourceFaceFlags = Uint8Array.from(
    { length: vertices.length / 9 },
    () => 7,
  );
  const mat = new MeshBasicMaterial({ side: DoubleSide });
  mat.userData.c2Flags = 4096;
  scene.add(new Mesh(geo, mat));
  const world = new WorldCollision(scene);
  scene.add(car.group);
  const sim = new VehicleSimulation(world, scene);
  sim.add(car);
  return { car, sim };
}
for (const name of ["EAGLE3", "monsterbug"]) {
  test(`${name}: a blocked contour sweep preserves its proven safe tangent displacement`, async (t) => {
    const loaded = await setup(t, name);
    if (!loaded) return;
    const { car, sim } = loaded;
    const bottom = Math.min(
      ...car.hulls.flatMap((h) => h.vertices).map((p) => p.y),
    );
    car.state.position.y = 0.01 - bottom;
    car.state.velocity.set(1, -0.5, 0);
    car.state.angularVelocity.set(0, 0, 0);
    // Ten mm clearance and 20 mm downward displacement give a geometric
    // crossing at fraction .5. Native contact margins stop somewhat earlier.
    const coarse = sim.advanceWorldContacts(car);
    assert.equal(
      coarse.fraction,
      0,
      "former one-sample guard discards all movement",
    );
    const refined = sim.advanceWorldContacts(car, true);
    assert.ok(
      refined.fraction > 0.3 && refined.fraction <= 0.5,
      `${refined.fraction}`,
    );
    assert.equal(
      refined.contacts.length,
      coarse.contacts.length,
      "preserve source impulse rows",
    );
    advanceRigidBody(car, 0.04 * refined.fraction);
    assert.ok(car.state.position.x > 0.012, "measured safe lateral progress");
    const vertices = car.hulls.flatMap(
      (h) =>
        transformHull(h, car.state.position, car.state.orientation).vertices,
    );
    assert.ok(
      Math.min(...vertices.map((v) => v.y)) > 0,
      "finite road remains unpenetrated",
    );
    sim.dispose();
  });
  for (const slope of [0.15, 0.3])
    test(`${name}: drives and reverses across finite ${slope * 100}% ramp contours`, async (t) => {
      const loaded = await setup(t, name, slope);
      if (!loaded) return;
      const { car, sim } = loaded;
      car.state.position.set(0, 0, 1);
      car.damage.damageContext.random = () => 0.5;
      car.damage.damageContext.invulnerable = true;
      for (let i = 0; i < 190; i++) {
        car.input.throttle = i < 50 ? 0 : 1;
        sim.step();
      }
      assert.ok(
        car.state.position.z < -4,
        "crossed both original-shape suspension transitions to plateau",
      );
      for (let i = 0; i < 360 && car.state.position.z <= 3; i++) {
        car.input.throttle = -1;
        sim.step();
      }
      car.input.throttle = 0;
      car.input.handbrake = true;
      // Deferred friction no longer adds tangential damping before this tick's
      // pose integration. Give the original suspension a bounded4.8s settling
      // window; require restored wheel support and upright state below.
      for (let i = 0; i < 120; i++) sim.step();
      assert.ok(
        car.state.position.z > 0,
        `reverse leaves plateau and crosses the ramp seam again: ${JSON.stringify({ position: car.state.position.toArray(), velocity: car.state.velocity.toArray(), speed: car.state.speed, gear: car.state.gear, wheels: car.state.groundedWheelCount, up: new Vector3(0, 1, 0).applyQuaternion(car.state.orientation).toArray(), split: car.damage.snapped, knackered: car.knackered })}`,
      );
      assert.equal(
        car.state.groundedWheelCount,
        4,
        "temporary crest flight ends with restored original wheel contacts",
      );
      assert.ok(
        new Vector3(0, 1, 0).applyQuaternion(car.state.orientation).y > 0.99,
      );
      assert.ok(car.state.position.toArray().every(Number.isFinite));
      sim.dispose();
    });
}
