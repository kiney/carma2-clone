import test from "node:test";
import assert from "node:assert/strict";
import { planNativeOpponentInitialization } from "../src/ai/startup-plan.ts";
import { NativeRandom } from "../src/native-random.ts";

test("installed five-opponent seed1 initialization consumes instance draws before quotas", () => {
  const random = new NativeRandom(1);
  let draws = 0;
  const plan = planNativeOpponentInitialization(5, 1, [2, 4], () => {
    draws++;
    return random.random();
  });
  // Independent CRT recurrence and installed draw bounds give these values.
  assert.deepEqual(plan.instances, [
    { repairIntervalMs: 120000, visibilityDelayMs: 507 },
    { repairIntervalMs: 120000, visibilityDelayMs: 728 },
    { repairIntervalMs: 180000, visibilityDelayMs: 432 },
    { repairIntervalMs: 180000, visibilityDelayMs: 807 },
    { repairIntervalMs: 240000, visibilityDelayMs: 672 },
  ]);
  assert.deepEqual(plan.personalities, [2, 1, 2, 2, 0]);
  assert.equal(draws, 14);
  assert.equal(random.state, 0xc1bbb05f);
});

test("eleven-opponent initialization retains the source slot and quota chronology", () => {
  const random = new NativeRandom(1);
  const plan = planNativeOpponentInitialization(11, 9.5, [2, 4], random.random);
  assert.deepEqual(
    plan.instances.map((instance) => instance.visibilityDelayMs),
    [507, 728, 432, 807, 672, 773, 462, 13, 328, 149, 401],
  );
  assert.deepEqual(plan.personalities, [2, 2, 2, 2, 2, 2, 1, 1, 0, 0, 0]);
  assert.equal(
    random.state,
    0x4db793af,
    "thirty CRT draws, including eight quotas",
  );
});

test("high nastiness still draws twice per instance and consumes no quota draws", () => {
  for (const level of [10, 12, 10 - 2 ** -22]) {
    let draws = 0;
    const plan = planNativeOpponentInitialization(15, level, [3, 3], () => {
      draws++;
      return 32767 / 32768;
    });
    assert.deepEqual(plan.personalities, Array(15).fill(3));
    assert.ok(
      plan.instances.every((instance) => instance.repairIntervalMs === 180000),
    );
    assert.ok(
      plan.instances.every((instance) => instance.visibilityDelayMs === 900),
    );
    assert.equal(draws, 30, "equal repair limits still consume native draws");
  }
});

test("zero opponents consume no random samples", () => {
  assert.deepEqual(
    planNativeOpponentInitialization(0, 1, [0, 0], () => {
      assert.fail("empty native population must not draw");
    }),
    { instances: [], personalities: [] },
  );
});

test("startup bounds quantize continuous callbacks to 15 bits and retain unsigned intervals", () => {
  const plan = planNativeOpponentInitialization(1, 10, [0, 2], () => 1 / 3);
  assert.deepEqual(plan.instances, [
    { repairIntervalMs: 0, visibilityDelayMs: 300 },
  ]);
  assert.deepEqual(
    planNativeOpponentInitialization(1, 10, [100000, 100000], () => 0)
      .instances,
    [{ repairIntervalMs: 1705032704, visibilityDelayMs: 0 }],
    "60000 multiplier wraps the native unsigned32 interval",
  );
  assert.deepEqual(
    planNativeOpponentInitialization(
      1,
      10,
      [0, 0x7fffffff],
      () => 32767 / 32768,
    ).instances,
    [{ repairIntervalMs: 362807296, visibilityDelayMs: 900 }],
    "native integer bound multiplication wraps signed32 before truncation",
  );
});

test("invalid startup metadata is rejected before consuming any RNG", () => {
  let draws = 0;
  const random = () => {
    draws++;
    return 0;
  };
  for (const count of [-1, 16, 1.5, NaN])
    assert.throws(() =>
      planNativeOpponentInitialization(count, 1, [0, 1], random),
    );
  for (const level of [NaN, Infinity, -Infinity, Number.MAX_VALUE])
    assert.throws(() =>
      planNativeOpponentInitialization(1, level, [0, 1], random),
    );
  for (const limits of [
    null,
    [],
    [1],
    [0, 1, 2],
    [-1, 1],
    [2, 1],
    [0, 1.5],
    [0, Infinity],
    [0, 0x80000000],
    Array(2),
    [0, NaN],
  ])
    assert.throws(() => planNativeOpponentInitialization(1, 1, limits, random));
  assert.throws(
    () => planNativeOpponentInitialization(0, 1, [0, 1], null),
    /callback/,
  );
  assert.equal(draws, 0);
});

test("invalid callback values fail in repair, visibility and personality draw positions", () => {
  for (const bad of [NaN, Infinity, -0.1, 1]) {
    for (const badIndex of [0, 1, 4]) {
      let draws = 0;
      assert.throws(
        () =>
          planNativeOpponentInitialization(2, 1, [0, 1], () =>
            draws++ === badIndex ? bad : 0,
          ),
        /sample.*\[0, 1\)/,
      );
      assert.equal(draws, badIndex + 1);
    }
  }
});

test("reserved and ordinary repair initialization agree at native signed multiplication overflow", async () => {
  const { NativeOpponentRepairState } = await import("../src/ai/repair.ts");
  const random = () => 32767 / 32768;
  const plan = planNativeOpponentInitialization(1, 10, [0, 100000], random);
  assert.equal(
    new NativeOpponentRepairState(0, 0, 100000, random).snapshot
      .repairIntervalMs,
    plan.instances[0].repairIntervalMs,
  );
});
