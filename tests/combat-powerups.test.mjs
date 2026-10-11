import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Vector3 } from "three";
import {
  repulsionParameters,
  opponentRepulsionImpulse,
  pedestrianRepulsionImpulse,
  selectCombatPedestrians,
  selectNapalmTarget,
  electricRayHits,
  stepNapalmMotion,
  NAPALM_BURN_MS,
} from "../src/combat-powerups.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const ped = (x, extra = {}) => ({
  position: v(x),
  alive: true,
  inSight: true,
  burningOrReserved: false,
  ...extra,
});

test("opponent repulsion uses authored distance radius and mass multiplier, no rigid mass", () => {
  const parameters = repulsionParameters(38, [12, 0.2, 3, 7]);
  const hit = opponentRepulsionImpulse(
    v(),
    v(3.5),
    2,
    parameters,
    100,
    () => 0.5,
  );
  near(hit.deltaVelocity.x, 3);
  near(hit.deltaVelocity.y, 0.6);
  near(hit.deltaVelocity.z, 0);
  assert.equal(hit.networkStateCutoffMs, 140);
  assert.deepEqual(hit.deltaAngularVelocity.toArray(), [0, 0, 0]);
  assert.equal(
    opponentRepulsionImpulse(v(), v(3.5), 1, parameters, 0xfffffff0, () => 0)
      .networkStateCutoffMs,
    24,
  );
  assert.equal(
    opponentRepulsionImpulse(v(), v(7), 1, parameters, 0, () => 0),
    null,
  );
  const coincident = opponentRepulsionImpulse(
    v(),
    v(),
    1,
    parameters,
    0,
    () => 0,
  );
  near(coincident.deltaVelocity.x, 12);
  near(coincident.deltaVelocity.y, 2.4);
  assert.deepEqual(coincident.deltaAngularVelocity.toArray(), [-3, -3, -3]);
});

test("pedestrian repulsion uses squared range, 0.068 conversion, and correct float order", () => {
  const parameters = repulsionParameters(45, [15, 0.25, 5, 10]);
  const hit = pedestrianRepulsionImpulse(
    v(),
    v(2),
    0.068,
    parameters,
    0,
    () => 0,
  );
  near(hit.deltaVelocity.x, 9);
  near(hit.deltaVelocity.y, 45);
  near(hit.deltaAngularVelocity.x, -0.15);
  near(hit.deltaAngularVelocity.y, -0.15);
  near(hit.deltaAngularVelocity.z, -0.15);
  assert.equal(
    pedestrianRepulsionImpulse(
      v(),
      v(Math.sqrt(10)),
      0.068,
      parameters,
      0,
      () => 0,
    ),
    null,
  );
  assert.equal(
    pedestrianRepulsionImpulse(v(), v(4), 0.068, parameters, 0, () => 0),
    null,
  );
  const downward = pedestrianRepulsionImpulse(
    v(),
    v(0, -1),
    0.068,
    parameters,
    0,
    () => 0.5,
  );
  near(downward.deltaVelocity.y, -13.5);
});

test("pedestrian command targets require alive, in-sight and clear segment gates", () => {
  const targets = [
    ped(1),
    ped(2, { alive: false }),
    ped(3, { inSight: false }),
    ped(4),
    ped(6),
  ];
  assert.deepEqual(
    selectCombatPedestrians(v(), targets, 36, false, (_source, target) =>
      target === targets[3] ? 0.999 : 1,
    ),
    [targets[0]],
  );
  assert.deepEqual(
    selectCombatPedestrians(v(), targets, 0, true, () => 1),
    [],
  );
  assert.deepEqual(
    selectCombatPedestrians(v(), [ped(100)], 0, false, () => 1).length,
    1,
  );
});

test("napalm picks nearest unreserved unobstructed dry target and first of five free slots", () => {
  const targets = [
    ped(1, { burningOrReserved: true }),
    ped(2, { specialVolumeGravityMultiplier: 0.5 }),
    ped(30),
    ped(40),
  ];
  const result = selectNapalmTarget(
    v(),
    targets,
    [true, false, false, false, false],
    undefined,
    false,
    () => 1,
  );
  assert.equal(result.target, targets[2]);
  assert.equal(result.slot, 1);
  assert.equal(
    selectNapalmTarget(v(), targets, [false], 0.9, false, () => 1),
    null,
  );
  assert.equal(
    selectNapalmTarget(
      v(),
      targets,
      [true, true, true, true, true, false],
      undefined,
      false,
      () => 1,
    ),
    null,
  );
  assert.equal(NAPALM_BURN_MS, 15000);
});

test("electric scan tests relative velocity line and strict broad phase, without generic radial blast", () => {
  assert.equal(electricRayHits(v(), v(), v(3), v(), 12.25), true);
  assert.equal(electricRayHits(v(), v(), v(3.5), v(), 12.25), false);
  // A car's projected path can pass close although its present range is larger.
  assert.equal(electricRayHits(v(), v(1), v(4, 4, 0), v(), 12.25), true);
  assert.equal(electricRayHits(v(), v(1), v(4, 4, 0), v(), 12.25, true), false);
  assert.equal(electricRayHits(v(), v(1), v(5), v(), 12.25), false);
  assert.equal(electricRayHits(v(), v(1), v(0, 5), v(), 12.25), false);
  assert.equal(electricRayHits(v(), v(1), v(4), v(1), 12.25), false);
  assert.equal(electricRayHits(v(), v(1), v(1), v(), 0), false);
});

test("napalm moves at native factor and component sampling order with first-500ms ascent", () => {
  const bolt = {
    position: v(),
    direction: v(),
    bornAtMs: 100,
    lastDirectionAtMs: 0,
  };
  stepNapalmMotion(bolt, v(10), 200, 40, () => 0);
  near(bolt.direction.x, 0.8);
  near(bolt.direction.y, 0.8);
  near(bolt.position.x, 0.064);
  near(bolt.position.y, 0.064);
  const late = {
    position: v(),
    direction: v(),
    bornAtMs: 0,
    lastDirectionAtMs: 0,
  };
  stepNapalmMotion(late, v(10), 1000, 40, () => 0.5);
  near(late.position.x, 0.082);
  near(late.position.y, 0);
});

const binaryPath = "carma2_orig/carma2_HW.exe";
test(
  "installed native constants match numerical combat conformance evidence",
  {
    skip: !existsSync(binaryPath),
  },
  (context) => {
    const binary = readFileSync(binaryPath);
    if (
      createHash("sha256").update(binary).digest("hex") !==
      "698c2b11865578b6ea2a77324fbc1840080841a8ae4041e9ca14ca5ff027bd6c"
    ) {
      context.skip(
        "Combat addresses refer to a different installed executable revision",
      );
      return;
    }
    const offset = (address) => address - 0x588000 + 0x186c00;
    assert.equal(binary.readDoubleLE(offset(0x589a70)), 0.068);
    assert.equal(binary.readDoubleLE(offset(0x589ca0)), 0.1);
    assert.equal(binary.readDoubleLE(offset(0x589a98)), 0.1);
    assert.equal(binary.readFloatLE(offset(0x5899ec)), 2 ** -22);
    assert.equal(binary.readFloatLE(offset(0x589c30)), 2 ** -22);
    assert.equal(binary.readFloatLE(offset(0x589a50)), 5);
    assert.equal(binary.readFloatLE(offset(0x58a288)), -1 / 32768);
  },
);
