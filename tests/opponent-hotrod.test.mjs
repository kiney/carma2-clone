import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { Vector3 } from "three";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parsePowerups } from "../src/powerups.ts";
import { applyOpponentHotrod } from "../src/physics/opponent-hotrod.ts";

const parameters = [8, 2.2, 1, 1.5, 0, 0.15, 1.5];
const close = (actual, expected, tolerance = 1e-10) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );

function makeBody() {
  const motion = {
    mass: 100,
    centerOfMass: new Vector3(0, 0, 0),
    wheelPositions: [
      new Vector3(0, 0, 3),
      new Vector3(0, 0, 3),
      new Vector3(0, 0, -2),
      new Vector3(0, 0, -2),
    ],
    suspensionBase: {
      give: [2, 4],
      damping: 0.5,
      rideHeight: 10,
    },
    spring: [11, 22],
    damper: [33, 44],
    suspensionLength: [5, 6],
  };
  return {
    state: { engineFactor: 1.25, tyreGripFactor: 0.8 },
    motion,
    suspensionPowerup: undefined,
  };
}

test("Hot rod applies authored engine, grip, spring, damper, and ride values", () => {
  const body = makeBody();
  const returned = applyOpponentHotrod([{ id: 29, body }], parameters, true);
  assert.equal(returned, body);
  assert.equal(body.state.engineFactor, 8);
  close(body.state.tyreGripFactor, 2.2);
  assert.deepEqual(body.suspensionPowerup, {
    frontGiveMultiplier: 1,
    rearGiveMultiplier: 1.5,
    frontExtraLength: 0,
    rearExtraLength: 0.15,
    dampingMultiplier: 1.5,
  });

  // Ratio 3/2 gives axle masses 40 rear and 60 front; 0x41fc80's
  // spring/damper equations operate on authored axle give and damping.
  close(body.motion.spring[0], (40 * 5) / 3);
  close(body.motion.spring[1], (60 * 5) / 4);
  close(body.motion.damper[0], 40 * Math.sqrt(5 / 3) * 0.5 * 1.5);
  close(body.motion.damper[1], 60 * Math.sqrt(5 / 4) * 0.5 * 1.5);
  close(body.motion.suspensionLength[0], 10 + 3 + 0.15);
  close(body.motion.suspensionLength[1], 10 + 4);
});

test("active Hot rod still applies while opponent speed factor is zero", () => {
  const body = makeBody();
  const freezeFactor = 0;
  assert.equal(freezeFactor, 0);
  assert.equal(applyOpponentHotrod([{ id: 29, body }], parameters, true), body);
  assert.equal(body.state.engineFactor, 8);
  close(body.state.tyreGripFactor, 2.2);
  close(body.motion.spring[0], (40 * 5) / 3);
});

test("only the first opponent with catalog id 29 is changed", () => {
  const first = makeBody();
  const second = makeBody();
  const unrelated = makeBody();
  const returned = applyOpponentHotrod(
    [
      { id: 7, body: unrelated },
      { id: 29, body: first },
      { id: 29, body: second },
    ],
    parameters,
    true,
  );
  assert.equal(returned, first);
  assert.equal(first.state.engineFactor, 8);
  assert.equal(second.state.engineFactor, 1.25);
  assert.equal(unrelated.state.engineFactor, 1.25);
});

test("reset restores temporary factors and all authored suspension baselines", () => {
  const body = makeBody();
  applyOpponentHotrod([{ id: 29, body }], parameters, true);
  assert.equal(
    applyOpponentHotrod([{ id: 29, body }], parameters, false),
    body,
  );
  assert.equal(body.state.engineFactor, 1);
  assert.equal(body.state.tyreGripFactor, 1);
  assert.deepEqual(body.suspensionPowerup, {
    frontGiveMultiplier: 1,
    rearGiveMultiplier: 1,
    frontExtraLength: 0,
    rearExtraLength: 0,
    dampingMultiplier: 1,
  });
  close(body.motion.spring[0], 100);
  close(body.motion.spring[1], 75);
  close(body.motion.damper[0], 40 * Math.sqrt(5 / 2) * 0.5);
  close(body.motion.damper[1], 60 * Math.sqrt(5 / 4) * 0.5);
  close(body.motion.suspensionLength[0], 12);
  close(body.motion.suspensionLength[1], 14);
});

test("missing catalog id 29 returns cleanly without reading parameters", () => {
  assert.equal(
    applyOpponentHotrod([{ id: 3, body: makeBody() }], [], true),
    undefined,
  );
  assert.equal(applyOpponentHotrod([], [], false), undefined);
});

test("Stock and Advanced catalogs provide the native Hot rod parameter row", async (t) => {
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original installation is absent");
    return;
  }
  const assets = await createAssetStore();
  for (const path of ["data/powerup.txt", "adv_data/Powerup.txt"]) {
    const bytes = await assets.read(path);
    assert.ok(bytes, `installed power-up table exists: ${path}`);
    const definitions = parsePowerups(decodeText(bytes));
    const hotrod = definitions[5];
    assert.equal(hotrod.index, 5, path);
    assert.equal(hotrod.action, 9, path);
    assert.deepEqual(hotrod.floatParams, parameters, path);
  }
});
