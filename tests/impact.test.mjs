import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { scaleImpactVectors, isWasted } from "../src/physics/impact.ts";

const base = {
  human: true,
  hitCar: false,
  attackerHuman: false,
  receiverSoftness: 1,
  attackerSoftness: 1,
};
const close = (a, b) =>
  assert.ok(Math.abs(a - b) < 1e-12, `${a} differs from ${b}`);

test("world human damage receives original .2 impulse scalar and visual .5 without world scaling", () => {
  const raw = new Vector3(1, 2, 3);
  const result = scaleImpactVectors(raw, base);
  close(result.damage.x, 0.2);
  close(result.crush.x, 0.1);
  assert.deepEqual(raw.toArray(), [1, 2, 3]);
  close(scaleImpactVectors(raw, { ...base, protection: 2 }).damage.x, 0.1);
});
test("car impacts include APO receiver armour, attacker offence and attacker softness", () => {
  const result = scaleImpactVectors(new Vector3(1, 0, 0), {
    ...base,
    hitCar: true,
    attackerHuman: true,
    armorLevel: 2,
    offenseLevel: 3,
    protection: 2,
    damageMultiplier: 1.5,
  });
  close(
    result.damage.x,
    (((0.91 ** 2 * 1.2 * 1.06 ** 3 * 1.5 * 0.9) / (1.7 / 0.7)) * 0.2) / 2,
  );
  close(result.crush.x, result.damage.x * 0.5);
});
test("opponent impacts retain distinct world inactivity and opponent-to-opponent multipliers", () => {
  const raw = new Vector3(1, 0, 0);
  close(
    scaleImpactVectors(raw, { ...base, human: false, receiverSoftness: 2 })
      .damage.x,
    0.4,
  );
  const world = scaleImpactVectors(raw, {
    ...base,
    human: false,
    receiverSoftness: 2,
    sinceLastRepairMs: 5001,
  });
  close(world.damage.x, 0.08);
  close(world.crush.x, 0.12);
  close(
    scaleImpactVectors(raw, { ...base, human: false, hitCar: true }).damage.x,
    (0.2 * 0.2) / (1.7 / 0.7),
  );
});
test("wasted requires engine, transmission, driver or all four wheels at99", () => {
  const levels = new Uint8Array(12);
  levels[3] = 99;
  levels[4] = 99;
  assert.equal(isWasted(levels), false);
  levels[8] = levels[9] = levels[10] = 99;
  assert.equal(isWasted(levels), false);
  levels[11] = 99;
  assert.equal(isWasted(levels), true);
  levels.fill(0);
  levels[2] = 99;
  assert.equal(isWasted(levels), true);
});
