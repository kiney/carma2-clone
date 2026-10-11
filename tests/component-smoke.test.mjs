import test from "node:test";
import assert from "node:assert/strict";
import {
  dispatchNativeDamageSmoke,
  prepareNativeComponentColumn,
} from "../src/component-smoke.ts";
import { SmokeSystem } from "../src/smoke.ts";
import { Group, Vector3 } from "three";

test("native damage tiers use engine/transmission divisor20 and other units10, with independent smoke baseline", () => {
  const current = new Uint8Array(12),
    smokeLast = new Uint8Array(12),
    requests = [],
    shortened = [];
  const run = () =>
    dispatchNativeDamageSmoke({
      driver: 8,
      current,
      smokeLast,
      setSmoke: (...args) => requests.push(args),
      shortenExisting: () => shortened.push(true),
    });
  current[0] = 40;
  current[1] = 39;
  current[2] = 99;
  current[3] = 70;
  run();
  assert.deepEqual(requests, [
    [0, 2],
    [3, 2],
  ]);
  assert.deepEqual(smokeLast, current);
  run();
  assert.equal(
    requests.length,
    2,
    "unchanged tiers retain smoke without duplicating it",
  );
  current[0] = 59;
  current[3] = 79;
  run();
  assert.equal(
    requests.length,
    2,
    "same quantization interval does not allocate",
  );
  current[0] = 60;
  current[3] = 80;
  run();
  assert.deepEqual(requests.slice(2), [
    [0, 1],
    [3, 1],
  ]);
  current[0] = 80;
  current[3] = 90;
  run();
  assert.deepEqual(requests.slice(4), [
    [0, 0],
    [3, 0],
  ]);
  current.fill(0);
  current[2] = 99;
  run();
  assert.equal(
    shortened.length,
    1,
    "driver damage is not a smoke-retention tier",
  );
});

test("repair/disabled-driver paths do not invent producer calls", () => {
  const current = new Uint8Array(12),
    smokeLast = Uint8Array.from({ length: 12 }, () => 99);
  let calls = 0;
  dispatchNativeDamageSmoke({
    driver: 5,
    current,
    smokeLast,
    setSmoke: () => calls++,
    shortenExisting: () => calls++,
  });
  assert.equal(calls, 0);
  assert.equal(
    smokeLast[0],
    99,
    "native excluded driver returns before baseline copy",
  );
  current[0] = 70;
  dispatchNativeDamageSmoke({
    driver: 8,
    current,
    smokeLast,
    setSmoke: () => assert.fail("repair is not worsening"),
    shortenExisting: () => assert.fail("severe unit retains smoke"),
  });
  assert.equal(smokeLast[0], 70);
  assert.throws(
    () =>
      dispatchNativeDamageSmoke({
        driver: 8,
        current: Uint8Array.of(100),
        smokeLast,
        setSmoke() {},
        shortenExisting() {},
      }),
    /twelve/,
  );
});

test("column quality scan preserves ordered partial lifetime writes and includes inactive matching slots", () => {
  const columns = Array.from({ length: 10 }, () => ({
    active: false,
    matchingCar: false,
    colour: 0,
    remaining: 0,
  }));
  columns[0] = { active: false, matchingCar: true, colour: 2, remaining: 0 };
  columns[1] = { active: true, matchingCar: true, colour: 2, remaining: 50 };
  columns[2] = { active: true, matchingCar: true, colour: 1, remaining: 10000 };
  const writes = [];
  assert.equal(
    prepareNativeComponentColumn({
      driver: 8,
      colour: 1,
      columns,
      writeRemaining: (...args) => writes.push(args),
    }),
    undefined,
  );
  assert.deepEqual(
    writes,
    [
      [0, 2000],
      [1, 2000],
    ],
    "first existing equal/better live slot stops scan after preceding writes",
  );
  columns[2].remaining = 0;
  writes.length = 0;
  assert.equal(
    prepareNativeComponentColumn({
      driver: 8,
      colour: 1,
      columns,
      writeRemaining: (...args) => writes.push(args),
    }),
    1,
  );
  assert.deepEqual(writes, [
    [0, 2000],
    [1, 2000],
    [2, 2000],
  ]);
  writes.length = 0;
  assert.equal(
    prepareNativeComponentColumn({
      driver: 6,
      colour: 0,
      columns,
      writeRemaining: (...args) => writes.push(args),
    }),
    1,
    "ordinary opponents cannot use component fire colour0",
  );
  columns.forEach((column) => (column.active = false));
  writes.length = 0;
  assert.equal(
    prepareNativeComponentColumn({
      driver: 8,
      colour: 0,
      columns,
      writeRemaining: (...args) => writes.push(args),
    }),
    0,
  );
  assert.deepEqual(writes, [], "no active matching owner bypasses scan");
});

test("runtime component columns retain native quality, long lifetime, wet gate and inactive owner storage", () => {
  let draws = 0;
  const smoke = new SmokeSystem(
    { resolve: () => undefined, textures: new Map() },
    {
      random: () => {
        draws++;
        return 0.5;
      },
    },
  );
  const car = { velocity: new Vector3() },
    actor = new Group();
  const source = {
    mode: 1,
    actor,
    car,
    driver: 8,
    knackered: false,
    colour: 2,
    vertex: 4,
    lifetimeMs: 1,
    sampleVertex: (_index, out) => {
      out.set(0, 0, 0);
      return true;
    },
  };
  assert.equal(smoke.spawnComponentColumn(source), 0);
  assert.equal(smoke.snapshot().columns[0].remaining, 10000000);
  assert.equal(smoke.spawnComponentColumn(source), null);
  assert.equal(smoke.spawnComponentColumn({ ...source, colour: 1 }), 1);
  assert.deepEqual(
    smoke
      .snapshot()
      .columns.slice(0, 2)
      .map((column) => column.remaining),
    [2000, 10000000],
  );
  assert.equal(
    smoke.spawnComponentColumn({
      ...source,
      colour: 0,
      volumeGravity: 0.5,
      knackered: true,
    }),
    null,
  );
  assert.deepEqual(
    smoke
      .snapshot()
      .columns.slice(0, 2)
      .map((column) => column.remaining),
    [2000, 2000],
  );
  assert.equal(draws, 0, "wet branch rejects before knackered smudge RNG");
  smoke.expireCarColumns(car);
  smoke.updateColumns(100, 40);
  assert.equal(smoke.snapshot().columns[0].active, false);
  assert.equal(
    smoke.snapshot().columns[0].vertex,
    4,
    "native retired owner/source storage is retained",
  );
  assert.equal(
    smoke.spawnComponentColumn({ ...source, colour: 0, knackered: true }),
    2,
  );
  assert.equal(draws, 1, "dry knackered smudge still consumes its draw");
  smoke.shortenCarColumns(car, 2000);
  assert.equal(smoke.snapshot().columns[2].remaining, 2000);
  smoke.clear();
  assert.equal(
    smoke.snapshot().columns[0].vertex,
    undefined,
    "unload releases retained references",
  );
  smoke.dispose();
});
