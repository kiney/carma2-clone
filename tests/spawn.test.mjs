import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";
import { WorldCollision } from "../src/world.ts";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import {
  transformHull,
  placementHullsOverlap,
} from "../src/physics/geometry.ts";
import {
  placeCarAtStart,
  startHullIntersectsSurface,
} from "../src/physics/spawn.ts";
import { SafeCarHistory } from "../src/physics/recovery.ts";
import { NativeCrashRecord } from "../src/physics/crash-record.ts";
import {
  applyVehicleForces,
  createMotionContext,
} from "../src/physics/motion.ts";
import { advanceRigidBody } from "../src/physics/integrate.ts";
import { createSimulatedCar } from "../src/physics/simulation.ts";
import { DamageSystem } from "../src/damage.ts";
import { originalCar } from "./support/original-car.mjs";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
function mesh(points) {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      points.flatMap((point) => point.toArray()),
      3,
    ),
  );
  return new Mesh(geometry, new MeshBasicMaterial());
}
function road(slopeX = 0, slopeZ = 0, minX = -8, maxX = 8) {
  const scene = new Group();
  const corner = (x, z) => v(x, slopeX * x + slopeZ * z, z);
  const a = corner(minX, -8),
    b = corner(minX, 8),
    c = corner(maxX, 8),
    d = corner(maxX, -8);
  scene.add(mesh([a, b, c, a, c, d]));
  return { scene, world: new WorldCollision(scene) };
}
function synthetic(position = v(), heading = 0) {
  const state = {
    position,
    heading,
    orientation: new Quaternion().setFromAxisAngle(v(0, 1, 0), heading),
    velocity: v(),
    angularVelocity: v(),
    wheelLengths: [0, 0, 0, 0],
  };
  return {
    state,
    group: new Group(),
    motion: {
      wheelPositions: [
        v(-0.15, 0.05, 0.25),
        v(0.15, 0.05, 0.25),
        v(-0.15, 0.05, -0.25),
        v(0.15, 0.05, -0.25),
      ].map((point) => point.multiplyScalar(6.9)),
      suspensionLength: [0.06 * 6.9, 0.06 * 6.9],
      suspensionBase: { give: [0.01 * 6.9, 0.01 * 6.9] },
    },
    hulls: [buildBoxHull(v(-0.18, 0.04, -0.3), v(0.18, 0.17, 0.3))],
    poseEpoch: 0,
    recoveryHistory: new SafeCarHistory(state),
    crashRecord: new NativeCrashRecord(),
  };
}
function assertClear(car, world) {
  for (const hull of car.hulls.map((local) =>
    transformHull(local, car.state.position, car.state.orientation),
  )) {
    assert.equal(
      world
        .querySurfaces(v(-9, -9, -9), v(9, 9, 9))
        .some((surface) => startHullIntersectsSurface(hull, surface)),
      false,
    );
  }
}

test("start placement samples four sloping contacts, preserves heading/scale and reseeds safe/predicted poses", () => {
  const car = synthetic(v(0, -0.2, 0), 0.7);
  car.group.scale.set(2, 3, 4);
  const { world } = road(0.3, -0.2);
  const result = placeCarAtStart(car, world, [], { searchRadius: 0 });
  assert.equal(result.placed, true);
  assertClear(car, world);
  const up = v(0, 1, 0).applyQuaternion(car.state.orientation);
  assert.ok(up.distanceTo(v(-0.3, 1, 0.2).normalize()) < 1e-6);
  const z = v(0, 0, 1).applyQuaternion(car.state.orientation);
  assert.ok(Math.abs(Math.atan2(z.x, z.z) - 0.7) < 1e-10);
  assert.deepEqual(car.group.scale.toArray(), [2, 3, 4]);
  assert.ok(car.state.predictedPosition.equals(car.state.position));
  assert.ok(car.state.predictedOrientation.equals(car.state.orientation));
  assert.ok(
    car.recoveryHistory.snapshots.every(
      (pose) =>
        pose.position.equals(car.state.position) &&
        pose.orientation.equals(car.state.orientation),
    ),
  );
  for (let i = 0; i < 4; i++)
    assert.ok(car.state.wheelLengths[i] < car.motion.suspensionLength[i >> 1]);
});

test("start placement searches off finite road edges and reserves other authored car hulls", () => {
  const { world } = road(0, 0, 0, 8);
  const first = synthetic(v(0, 0, 0));
  assert.equal(placeCarAtStart(first, world).placed, true);
  assert.ok(first.state.position.x >= 0.15);
  const second = synthetic(first.state.position.clone());
  const result = placeCarAtStart(second, world, [first]);
  assert.equal(result.placed, true);
  assert.ok(result.attempts > 1);
  assertClear(first, world);
  assertClear(second, world);
  assert.equal(
    placementHullsOverlap(
      transformHull(
        first.hulls[0],
        first.state.position,
        first.state.orientation,
      ),
      transformHull(
        second.hulls[0],
        second.state.position,
        second.state.orientation,
      ),
    ),
    false,
  );
});

test("start placement rejects a finite wall inside the hull and leaves an unsupported car unchanged", () => {
  const { scene, world } = road();
  scene.add(mesh([v(0, 0.06, -0.04), v(0, 0.06, 0.04), v(0, 0.14, 0.04)]));
  world.rebuildStatic();
  const car = synthetic();
  assert.equal(
    placeCarAtStart(car, world, [], { searchRadius: 0 }).placed,
    false,
  );
  assert.deepEqual(car.state.position.toArray(), [0, 0, 0]);
  assert.equal(car.poseEpoch, 0);
  assert.equal(placeCarAtStart(car, world).placed, true);
  assertClear(car, world);
  const unsupported = synthetic(v(0, 3, 0));
  const empty = new WorldCollision(new Group());
  assert.equal(placeCarAtStart(unsupported, empty).placed, false);
  assert.deepEqual(unsupported.state.position.toArray(), [0, 3, 0]);
});

test("start placement retains the nearest authored road layer below a bridge", () => {
  const { scene, world } = road();
  const bridge = road().scene.children[0];
  bridge.position.y = 1;
  scene.add(bridge);
  world.rebuildStatic();
  const car = synthetic();
  assert.equal(
    placeCarAtStart(car, world, [], { searchRadius: 0 }).placed,
    true,
  );
  assert.ok(Math.abs(car.state.position.y) < 1e-8);
});

test("start clearance respects surviving edge-only world collision", () => {
  const car = synthetic();
  const hull = car.hulls[0];
  const { scene, world } = road();
  const edge = mesh([v(0, 0.1, -0.1), v(0, 0.1, 0.1), v(0, 0.2, 0.1)]);
  edge.material.name = "?broken";
  scene.add(edge);
  world.rebuildStatic();
  const face = world
    .querySurfaces(v(-1, -1, -1), v(1, 1, 1))
    .find((value) => value.material === "?broken");
  assert.equal(startHullIntersectsSurface(hull, face), true);
  assert.equal(
    startHullIntersectsSurface(hull, { ...face, faceFlags: 7 }),
    false,
  );
});

for (const name of ["EAGLE3", "buggy", "monsterbug", "bigdump"]) {
  test(`original ${name} starts clear on a slope/edge and settles without a damper kick`, async (t) => {
    try {
      await access(`carma2_orig/data/CARS/${name}.TWT`);
    } catch {
      t.skip("Original installation absent");
      return;
    }
    const data = await originalCar(name);
    const damage = new DamageSystem(data.assets, data.group, data.text);
    await damage.init();
    const car = createSimulatedCar(
      data.group,
      data.text,
      damage,
      v(0, -0.05, 0),
      0.4,
      true,
    );
    const { world } = road(0.15, -0.1, 0, 8);
    assert.equal(placeCarAtStart(car, world).placed, true);
    assertClear(car, world);
    const context = createMotionContext();
    const initial = car.state.position.clone();
    const neutral = { throttle: 0, steer: 0, brake: 0, handbrake: false };
    const first = applyVehicleForces(
      car.state,
      neutral,
      0.04,
      car.motion,
      world,
      context,
    );
    assert.equal(car.state.groundedWheelCount, 4);
    assert.ok(
      Math.abs(
        v(0, 1, 0)
          .applyQuaternion(car.state.orientation)
          .dot(car.state.velocity),
      ) < 0.003,
      "No artificial normal launch from inconsistent previous wheel distances",
    );
    advanceRigidBody(car, 0.04);
    for (let tick = 0; tick < 49; tick++) {
      applyVehicleForces(car.state, neutral, 0.04, car.motion, world, context);
      advanceRigidBody(car, 0.04);
      assertClear(car, world);
    }
    assert.ok(
      Math.abs(car.state.position.y - initial.y) < 0.12,
      "Stable spring settling while free to roll downhill",
    );
    assert.ok(Number.isFinite(car.state.velocity.length()));
  });
}
