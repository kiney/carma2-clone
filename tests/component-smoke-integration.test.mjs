import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { DamageSystem } from "../src/damage.ts";
import { dispatchNativeDamageSmoke } from "../src/component-smoke.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { originalCar } from "./support/original-car.mjs";

async function fixture(t) {
  const simulation = new VehicleSimulation(
    {
      raycast() {
        return null;
      },
      querySurfaces() {
        return [];
      },
    },
    new Group(),
  );
  const cars = [];
  for (const [name, human] of [
    ["EAGLE3", true],
    ["buggy", false],
  ]) {
    let original;
    try {
      original = await originalCar(name);
    } catch (error) {
      if (error.code === "ENOENT") {
        t.skip("Local original car assets absent");
        return;
      }
      throw error;
    }
    const damage = new DamageSystem(
      original.assets,
      original.group,
      original.text,
    );
    await damage.init();
    const car = createSimulatedCar(
      original.group,
      original.text,
      damage,
      new Vector3(),
      0,
      human,
    );
    simulation.add(car);
    cars.push(car);
  }
  t.after(() => simulation.dispose());
  return { simulation, a: cars[0], b: cars[1] };
}

test("original Eagle/Buggy crash smoke reads saved return before attribution cleanup and dispatches original order", async (t) => {
  const f = await fixture(t);
  if (!f) return;
  const { simulation, a, b } = f;
  simulation.crashClock = () => 100;
  a.crashRecord.beginFrame(false, new Vector3());
  b.crashRecord.beginFrame(false, new Vector3());
  a.crashRecord.accumulator = 0.125;
  b.crashRecord.accumulator = 0.25;
  a.damage.componentLevels[0] = 40;
  b.damage.componentLevels[3] = 70;
  // Earnings and smoke baselines occupy distinct native fields.
  a.damage.lastComponentLevels.set(a.damage.componentLevels);
  b.damage.lastComponentLevels.set(b.damage.componentLevels);
  const calls = [],
    requests = [];
  simulation.onDamageSmoke = (car) => {
    calls.push(car);
    assert.equal(
      car.crashRecord.accumulator,
      0,
      "accepted attribution cleanup precedes SortOutSmoke",
    );
    dispatchNativeDamageSmoke({
      driver: car.human ? 8 : 6,
      current: car.damage.componentLevels,
      smokeLast: car.smokeLastComponentLevels,
      setSmoke: (unit, colour) => requests.push([car, unit, colour]),
      shortenExisting() {
        assert.fail("both damaged components retain smoke");
      },
    });
  };
  simulation.attributeCrashPair(a, b, new Set());
  assert.deepEqual(calls, [a, b]);
  assert.deepEqual(requests, [
    [a, 0, 2],
    [b, 3, 2],
  ]);
  assert.deepEqual(a.smokeLastComponentLevels, a.damage.componentLevels);
  assert.deepEqual(b.smokeLastComponentLevels, b.damage.componentLevels);
  assert.notEqual(a.smokeLastComponentLevels, a.damage.lastComponentLevels);
});

test("native world and knackered return gates remain independent of awards and normalized roles", async (t) => {
  const f = await fixture(t);
  if (!f) return;
  const { simulation, a, b } = f;
  const calls = [];
  simulation.onDamageSmoke = (car) => calls.push(car);
  simulation.onCrashAttribution = () =>
    assert.fail("this fixture admits no attacker");
  simulation.crashClock = () => 5000;
  simulation.attributeCrashPair(a, undefined, new Set());
  assert.deepEqual(
    calls,
    [a],
    "expired world path returns1 even with zero accumulator",
  );
  calls.length = 0;
  simulation.crashClock = () => 4999;
  a.crashRecord.accumulator = 0.75;
  simulation.attributeCrashPair(a, undefined, new Set());
  assert.deepEqual(
    calls,
    [],
    "first argument saves an integer rather than float!=0",
  );
  a.crashRecord.frameKnackered = true;
  a.crashRecord.accumulator = 0;
  b.crashRecord.accumulator = 0.01;
  simulation.attributeCrashPair(a, b, new Set());
  assert.deepEqual(
    calls,
    [a, b],
    "knackered selector rejection still uses saved second float",
  );
});

test("native outer-frame baseline resets without inventing columns, and full repair clears only repaired car baseline", async (t) => {
  const f = await fixture(t);
  if (!f) return;
  const { simulation, a, b } = f;
  a.damage.componentLevels[0] = 50;
  b.damage.componentLevels[1] = 60;
  let producer = 0;
  simulation.onDamageSmoke = () => producer++;
  simulation.beginCrashFrame();
  assert.equal(producer, 0);
  assert.deepEqual(a.smokeLastComponentLevels, a.damage.componentLevels);
  assert.deepEqual(b.smokeLastComponentLevels, b.damage.componentLevels);
  let stopped = 0;
  simulation.onFullRepair = (car) => {
    assert.equal(car, a);
    assert.equal(
      car.smokeLastComponentLevels[0],
      50,
      "instant-stop precedes baseline clearing",
    );
    stopped++;
  };
  simulation.repair(a);
  assert.equal(stopped, 1);
  assert.ok(a.smokeLastComponentLevels.every((value) => value === 0));
  assert.equal(b.smokeLastComponentLevels[1], 60);
});

test("CheckDamage starts wreck columns before CrashEarnings component smoke while feedback retains attribution phase", async (t) => {
  const f = await fixture(t);
  if (!f) return;
  const { simulation, a, b } = f;
  const order = [];
  simulation.onKnackeredSmoke = (car) => {
    assert.equal(car.knackered, true);
    assert.equal(
      car.wastedAt,
      undefined,
      "raw CheckDamage producer precedes delayed feedback",
    );
    order.push(["wreck", car]);
  };
  simulation.onDamageSmoke = (car) => order.push(["component", car]);
  simulation.onWasted = (car) => order.push(["feedback", car]);
  a.damage.componentLevels[0] = 99;
  a.damage.onWastageCheck();
  a.damage.onWastageCheck();
  b.damage.componentLevels[0] = 99;
  b.damage.onWastageCheck();
  assert.deepEqual(order, [
    ["wreck", a],
    ["wreck", b],
  ]);
  a.crashRecord.accumulator = 0.5;
  b.crashRecord.accumulator = 0.5;
  simulation.crashClock = () => 100;
  simulation.attributeCrashPair(a, b, new Set());
  assert.deepEqual(order.slice(2), [
    ["component", a],
    ["component", b],
  ]);
  simulation.finishWastage(a);
  simulation.finishWastage(b);
  assert.deepEqual(order.slice(4), [
    ["feedback", a],
    ["feedback", b],
  ]);
  simulation.repair(a);
  a.damage.componentLevels[0] = 99;
  a.damage.onWastageCheck();
  assert.equal(
    order.filter(([phase]) => phase === "wreck").length,
    2,
    "full repair preserves knackered and does not reemit its once-only producer",
  );
});
