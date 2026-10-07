import test from "node:test";
import assert from "node:assert/strict";
import { applyUpgradePickup } from "../src/physics/upgrade-pickup.ts";

const bunch = (values, network = Array(8).fill(0)) => ({
  skill: values,
  network,
});
const settings = {
  maximum: [bunch([4, 5, 6]), bunch([4, 5, 6]), bunch([4, 5, 6])],
  substitution: bunch([11, 22, 33], Array(8).fill(44)),
  potentialSubstitution: bunch([55, 66, 77], Array(8).fill(88)),
};
const context = { skill: 0 };
const state = (levels, potential = [4, 4, 4]) => ({
  levels,
  potential,
  credits: 100,
});

test("single full APO type tries neighbours in the sampled direction without billing", () => {
  const car = state([4, 4, 1]);
  let samples = 0;
  const result = applyUpgradePickup(
    car,
    settings,
    context,
    46,
    [2, 0, 0],
    () => {
      samples++;
      return 0;
    },
  );
  assert.deepEqual(car.levels, [4, 4, 3]);
  assert.deepEqual(result.gained, [0, 0, 2]);
  assert.equal(result.selectedType, 2);
  assert.equal(samples, 1);
  assert.equal(car.credits, 100);
  const reverse = state([4, 0, 0]);
  assert.equal(
    applyUpgradePickup(reverse, settings, context, 46, [1, 0, 0], () => 0.9)
      .selectedType,
    2,
  );
});

test("negative APO amount fills available slots and all-type requests do not redirect", () => {
  const car = state([2, 4, 0]);
  const result = applyUpgradePickup(
    car,
    settings,
    context,
    46,
    [-1, -1, -1],
    () => {
      throw new Error("Unexpected random fallback");
    },
  );
  assert.deepEqual(car.levels, [4, 4, 4]);
  assert.deepEqual(result.gained, [2, 0, 4]);
  assert.equal(result.creditsAwarded, 0);
});

test("APO potential clamps to skill maximum and redirects only an entirely full request", () => {
  const car = state([0, 0, 0], [4, 3, 4]);
  assert.deepEqual(
    applyUpgradePickup(car, settings, context, 47, [3, 0, 0], () => 0).gained,
    [0, 1, 0],
  );
  assert.deepEqual(car.potential, [4, 4, 4]);
  assert.equal(car.credits, 100);
});

test("unchanged level or potential grants pay their distinct source compensation once", () => {
  const car = state([4, 4, 4]);
  assert.equal(
    applyUpgradePickup(car, settings, context, 46, [2, 2, 2]).creditsAwarded,
    11,
  );
  assert.equal(
    applyUpgradePickup(car, settings, context, 47, [3, 0, 0], () => 0)
      .creditsAwarded,
    55,
  );
  assert.equal(car.credits, 166);
  const net = state([0, 0, 0], [0, 0, 0]);
  assert.equal(
    applyUpgradePickup(
      net,
      settings,
      { skill: 2, networkType: 3 },
      46,
      [1, 0, 0],
      () => 0,
    ).creditsAwarded,
    44,
  );
  assert.equal(
    applyUpgradePickup(
      net,
      settings,
      { skill: 2, networkType: 3 },
      47,
      [1, 1, 1],
    ).creditsAwarded,
    88,
  );
});

test("partial all-type grants receive no compensation for their full columns", () => {
  const car = state([4, 3, 4]);
  const result = applyUpgradePickup(car, settings, context, 46, [2, 2, 2]);
  assert.deepEqual(result.gained, [0, 1, 0]);
  assert.equal(result.creditsAwarded, 0);
  assert.equal(car.credits, 100);
});
