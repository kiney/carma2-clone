import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  createMotionParameters,
  setMotionSuspension,
} from "../src/physics/motion.ts";
import {
  resetSuspensionPowerup,
  resetTemporaryMotionPowerup,
  setSuspensionPowerup,
  setTemporaryMotionPowerup,
} from "../src/physics/upgrades.ts";
import { parseCarMechanics } from "../src/mechanics.ts";

const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

test("SetSuspension maps native five-argument order and reset defaults", () => {
  assert.deepEqual(setSuspensionPowerup([1.25, 0.75, 0.04, 0.06, 1.4]), {
    frontGiveMultiplier: 1.25,
    rearGiveMultiplier: 0.75,
    frontExtraLength: 0.04,
    rearExtraLength: 0.06,
    dampingMultiplier: 1.4,
  });
  assert.deepEqual(resetSuspensionPowerup(), {
    frontGiveMultiplier: 1,
    rearGiveMultiplier: 1,
    frontExtraLength: 0,
    rearExtraLength: 0,
    dampingMultiplier: 1,
  });
});

test("SetSuspension rejects a wrong argument count and every non-finite value", () => {
  assert.throws(() => setSuspensionPowerup([1, 1, 0, 0]), /Missing source/);
  assert.throws(
    () => setSuspensionPowerup([1, 1, 0, 0, 1, 2]),
    /Missing source/,
  );
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.throws(
      () => setSuspensionPowerup([1, 1, 0, invalid, 1]),
      /Missing source/,
    );
  }
});

test("engine-factor suspension parameter ordering remains unchanged", () => {
  const target = { engineFactor: 1, tyreGripFactor: 1 };
  assert.deepEqual(
    setTemporaryMotionPowerup(target, 9, [2, 3, 4, 5, 0.2, 0.3, 1.5]),
    {
      frontGiveMultiplier: 4,
      rearGiveMultiplier: 5,
      frontExtraLength: 0.2,
      rearExtraLength: 0.3,
      dampingMultiplier: 1.5,
    },
  );
  assert.deepEqual(target, { engineFactor: 2, tyreGripFactor: 3 });
  assert.deepEqual(
    resetTemporaryMotionPowerup(target, 9),
    resetSuspensionPowerup(),
  );
});

test("SetSuspension affects and resets two stock car motion models", async (t) => {
  const { originalCar } = await import("./support/original-car.mjs");
  const archives = [
    { name: "EAGLE3", file: "EAGLE3.TWT" },
    { name: "buggy", file: "buggy.TWT" },
  ];
  if (
    !archives.some((archive) =>
      existsSync(`carma2_orig/data/CARS/${archive.file}`),
    )
  ) {
    t.skip("Original car assets unavailable");
    return;
  }

  let checked = 0;
  for (const archive of archives) {
    if (!existsSync(`carma2_orig/data/CARS/${archive.file}`)) continue;
    const { name } = archive;
    const data = await originalCar(name);
    const parameters = createMotionParameters(parseCarMechanics(data.text));
    const base = {
      spring: [...parameters.spring],
      damper: [...parameters.damper],
      length: [...parameters.suspensionLength],
    };
    setMotionSuspension(
      parameters,
      setSuspensionPowerup([1.25, 0.75, 0.04, 0.06, 1.4]),
    );
    assert.ok(
      parameters.spring.some((value, i) => value !== base.spring[i]),
      `${name}: temporary suspension changes axle springs`,
    );
    assert.ok(
      parameters.suspensionLength.some((value, i) => value !== base.length[i]),
      `${name}: temporary suspension changes ride lengths`,
    );
    assert.ok(
      [
        ...parameters.spring,
        ...parameters.damper,
        ...parameters.suspensionLength,
      ].every(Number.isFinite),
    );

    setMotionSuspension(parameters, resetSuspensionPowerup());
    for (let axle = 0; axle < 2; axle++) {
      near(parameters.spring[axle], base.spring[axle]);
      near(parameters.damper[axle], base.damper[axle]);
      near(parameters.suspensionLength[axle], base.length[axle]);
    }
    checked++;
  }
  assert.equal(checked, 2, "both stock car models were exercised");
});
