import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import { SafeCarHistory } from "../src/physics/recovery.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { DamageSystem } from "../src/damage.ts";
import { originalCar } from "./support/original-car.mjs";

const pose = (x = 0) => ({
  position: new Vector3(x, 0, 0),
  orientation: new Quaternion(),
});
const safe = () => ({
  wheelLengths: [0.1, 0.1, 0.1, 0.1],
  suspensionLengths: [0.2, 0.2],
  roadFrictions: [0.1, 0.1, 0.1, 0.1],
});
test("native safe history stores twenty independent complete spawn poses", () => {
  const initial = pose();
  initial.orientation.setFromAxisAngle(new Vector3(1, 0, 0), 0.2);
  const history = new SafeCarHistory(initial);
  initial.position.x = 99;
  const snapshots = history.snapshots;
  assert.equal(snapshots.length, 20);
  assert.equal(snapshots[0].position.x, 0);
  assert.ok(snapshots[19].orientation.angleTo(initial.orientation) < 1e-7);
  snapshots[0].position.x = 42;
  assert.equal(history.snapshots[0].position.x, 0);
});
test("native history samples at five seconds and retries rejected poses after one second", () => {
  const history = new SafeCarHistory(pose());
  const candidate = pose(3);
  const unsupported = safe();
  unsupported.wheelLengths[0] = 0.2;
  assert.equal(history.remember(4999, candidate, safe()), false);
  assert.equal(history.remember(1, candidate, unsupported), false);
  assert.equal(history.remember(999, candidate, safe()), false);
  assert.equal(history.remember(1, candidate, safe()), true);
  assert.equal(history.snapshots[0].position.x, 3);
  assert.equal(history.remember(4999, pose(6), safe()), false);
  assert.equal(history.remember(1, pose(6), safe()), true);
});
test("native safe-pose gates exclude splits, unsuitable gravity/grip, dynamic supports and tilted poses", () => {
  for (const override of [
    { disabled: true },
    { split: true },
    { volumeGravity: 0.9 },
    { dynamicSupport: true },
    { roadFrictions: [1, 1, 1, 0.099] },
  ]) {
    const history = new SafeCarHistory(pose());
    assert.equal(
      history.remember(5000, pose(3), { ...safe(), ...override }),
      false,
    );
  }
  const history = new SafeCarHistory(pose()),
    tilted = pose(3);
  tilted.orientation.setFromAxisAngle(new Vector3(0, 0, 1), Math.acos(0.79));
  assert.equal(history.remember(5000, tilted, safe()), false);
  assert.equal(history.remember(1000, pose(3), safe()), true);
});
test("native last-five spacing and FlipUpCar history selection/consumption use distinct squared thresholds", () => {
  const history = new SafeCarHistory(pose());
  assert.equal(
    history.remember(
      5000,
      pose(Math.sqrt(Math.fround(8.4015961)) - 1e-6),
      safe(),
    ),
    false,
  );
  assert.equal(history.remember(1000, pose(3), safe()), true);
  assert.equal(history.remember(5000, pose(6), safe()), true);
  assert.equal(history.remember(5000, pose(9), safe()), true);
  const selected = history.next(new Vector3(9, 0, 0), true);
  assert.equal(selected.selectedIndex, 1);
  assert.equal(selected.position.x, 6);
  assert.equal(history.snapshots[0].position.x, 3);
  const distant = history.next(new Vector3(100, 0, 0), true);
  assert.equal(distant.selectedIndex, 0);
  assert.equal(distant.position.x, 3);
});

for (const name of ["EAGLE3", "monsterbug"])
  test(`${name}: native recovery restores full safe orientation, keeps damage and resets the drivetrain`, async (t) => {
    let data;
    try {
      data = await originalCar(name);
    } catch (e) {
      if (e.code === "ENOENT") return t.skip("Local original data absent");
      throw e;
    }
    const damage = new DamageSystem(data.assets, data.group, data.text);
    await damage.init();
    const car = createSimulatedCar(
      data.group,
      data.text,
      damage,
      new Vector3(0, 1, 0),
      0.3,
      true,
    );
    const initial = car.state.orientation.clone();
    const scene = new Group();
    const world = {
      raycast() {
        return null;
      },
      querySurfaces() {
        return [];
      },
    };
    const simulation = new VehicleSimulation(world, scene);
    simulation.add(car);
    car.state.position.set(10, 0, 10);
    car.state.heading = 1.7;
    car.state.orientation.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
    car.state.angularVelocity.set(2, 3, 4);
    car.state.rpm = 5000;
    car.state.gear = 4;
    car.state.wheelLengths = [10, 10, 10, 10];
    car.damage.componentLevels[0] = 42;
    simulation.recover(car);
    assert.ok(car.state.orientation.angleTo(initial) < 1e-7);
    assert.ok(Math.abs(car.state.heading - 0.3) < 1e-12);
    assert.deepEqual(car.state.position.toArray(), [
      0,
      1 + 0.28985506296157837,
      0,
    ]);
    assert.ok(
      car.state.velocity.distanceTo(
        new Vector3(0, 0, -Math.fround(0.0002)).applyQuaternion(initial),
      ) < 1e-12,
    );
    assert.equal(car.state.angularVelocity.lengthSq(), 0);
    assert.equal(car.state.gear, 0);
    assert.equal(car.state.rpm, 0);
    assert.equal(car.damage.componentLevels[0], 42);
    assert.ok(
      car.state.wheelLengths.every(
        (length) => length === car.motion.suspensionBase.rideHeight,
      ),
    );
    assert.equal(car.poseEpoch, 1);
    simulation.dispose();
  });
