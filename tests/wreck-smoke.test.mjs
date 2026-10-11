import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { createNativeWreckColumns } from "../src/wreck-smoke.ts";
import { SmokeSystem } from "../src/smoke.ts";

function collect(samples, overrides = {}) {
  const events = [];
  let draws = 0;
  createNativeWreckColumns({
    networkMode: 0,
    knackered: true,
    random: () => {
      assert.ok(draws < samples.length, "all native draws are accounted for");
      return samples[draws++];
    },
    shortenExisting: (maximum) => events.push(["shorten", maximum]),
    spawn: (packet) => events.push(packet),
    ...overrides,
  });
  return { draws, events };
}

test("CheckDamage emits long fire, optional short fire and pre-creation no-op smudge draws in native order", () => {
  assert.deepEqual(collect([0, 0.5, 0.9]), {
    draws: 3,
    events: [{ mode: 1, colour: 0, vertex: 6, lifetimeMs: 180000 }],
  });
  assert.deepEqual(collect([0.5, 0, 0.7, 0.99, 0.1]), {
    draws: 5,
    events: [
      ["shorten", 2000],
      { mode: 1, colour: 0, vertex: 0, lifetimeMs: 20000 },
      { mode: 1, colour: 0, vertex: 11, lifetimeMs: 180000 },
    ],
  });
});

test("wet-volume wrapper rejects after the caller draws, while exactly-one gravity and dry wrappers retain their own draws", () => {
  assert.deepEqual(collect([0.5, 0.5, 0.9], { volumeGravity: 0.5 }), {
    draws: 3,
    events: [["shorten", 2000]],
  });
  assert.equal(collect([0, 0.5, 0.9], { volumeGravity: 1 }).draws, 3);
  assert.equal(collect([0, 0.5], { knackered: false }).draws, 2);
  assert.equal(collect([], { networkMode: 1 }).draws, 0);
  assert.equal(collect([], { networkMode: 3 }).draws, 0);
});

test("StopCarSmoking shortens matching active sources without deleting other cars or mode-two columns", () => {
  const smoke = new SmokeSystem(
    { resolve: () => undefined, textures: new Map() },
    { random: () => 0.5 },
  );
  const actor = new Group();
  const car = { velocity: new Vector3() };
  const otherCar = { velocity: new Vector3() };
  smoke.spawnColumn({
    mode: 1,
    actor,
    car,
    colour: 0,
    vertex: 0,
    lifetimeMs: 180000,
  });
  smoke.spawnColumn({
    mode: 1,
    actor,
    car: otherCar,
    colour: 0,
    vertex: 0,
    lifetimeMs: 20000,
  });
  smoke.spawnColumn({
    mode: 2,
    actor,
    colour: 0,
    vertex: 0,
    lifetimeMs: 25000,
  });
  const before = smoke.stats;
  smoke.shortenCarColumns(car, 2000);
  const after = smoke.snapshot();
  assert.deepEqual(
    after.columns.slice(0, 3).map((column) => column.remaining),
    [2000, 20000, 25000],
  );
  assert.equal(smoke.stats.columnCursor, before.columnCursor);
  assert.equal(after.columns.filter((column) => column.active).length, 3);
  assert.throws(() => smoke.shortenCarColumns(car, -1), /lifetime/);
  smoke.expireCarColumns(car);
  const repaired = smoke.snapshot();
  assert.deepEqual(
    repaired.columns.slice(0, 3).map((column) => column.remaining),
    [0, 20000, 25000],
  );
  assert.equal(
    repaired.columns[0].active,
    true,
    "native retirement happens in the column pass",
  );
  assert.equal(smoke.stats.columnCursor, before.columnCursor);
  smoke.dispose();
});
