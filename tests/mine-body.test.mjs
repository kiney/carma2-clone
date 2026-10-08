import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { Box3, Group, Quaternion, Vector3 } from "three";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText, parseDat } from "../src/formats.ts";
import { createMineBody } from "../src/physics/mine-body.ts";
import { hullBounds } from "../src/physics/geometry.ts";
import {
  MineRuntime,
  MINE_MODEL_PATH,
  hitMineReaction,
  mineComponentDamage,
  mineParameters,
  parseMineMass,
} from "../src/physics/mines.ts";
import { parseDamagePrograms } from "../src/damage-program.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const near = (a, b, tolerance = 1e-10) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const parameters = mineParameters([5, 2, 10, 2, 2, 0.7, 0.5, 0.6]);
const bounds = new Box3(v(-0.1, -0.2, -0.3), v(0.1, 0.2, 0.3));
function spawn() {
  return new MineRuntime().spawn(
    { victim: "owner", driver: 8, mass: 2, maxDamage: 0.7 },
    {
      position: v(1, 2, 3),
      orientation: new Quaternion(),
      velocity: v(4, 5, 6),
      bounds,
    },
    parameters,
    0,
  );
}

test("mine solver shares the native pose and keeps source sphere dimensions", () => {
  const mine = spawn(),
    actor = new Group();
  const body = createMineBody(mine, actor, bounds, 0.3);
  assert.equal(body.kind, "mine");
  assert.equal(body.mine, mine);
  assert.equal(body.state, mine);
  for (const key of ["position", "orientation", "velocity", "angularVelocity"])
    assert.equal(body.state[key], mine[key]);
  body.state.velocity.add(v(7, 8, 9));
  assert.deepEqual(mine.velocity.toArray(), [11, 13.5, 15.6]);
  mine.position.x = 20;
  assert.equal(body.state.position.x, 20);
  assert.deepEqual(actor.position.toArray(), [1, 2.2, 3.45]);
  near(body.properties.radius, 0.2);
  near(body.properties.inertia.x, (0.2 ** 2 * 0.3) / 6);
  assert.deepEqual(body.properties.centerOfMass.toArray(), [0, 0, 0]);
  assert.deepEqual(body.properties.forceOffset.toArray(), [0, -0.05797102, 0]);
  assert.equal(body.properties.worldFriction, 0);
  assert.equal(body.properties.objectFriction, 0);
  assert.equal(body.hulls.length, 1);
  const sampledBounds = hullBounds(body.hulls[0]);
  for (let axis = 0; axis < 3; axis++) {
    near(sampledBounds.min.getComponent(axis), -0.2, 1e-7);
    near(sampledBounds.max.getComponent(axis), 0.2, 1e-7);
  }
  assert.ok(
    body.hulls[0].faces.length > 6,
    "convex sphere fallback, not a box",
  );
  assert.ok(body.overlapRecovery && body.worldRecovery);
  assert.ok(!body.overlapDetected && !body.worldOverlapDetected);
  assert.equal(actor.userData.dynamicBody, true);
});

test("native water cache inheritance copies plane and volume pointers, not owner depth", () => {
  const water = { viscosityMultiplier: 10 };
  const previous = {
    volume: water,
    automatic: water,
    depth: 0.6,
    waterDistance: 12,
    waterNormal: v(0, 1, 0),
  };
  const body = createMineBody(spawn(), new Group(), bounds, 0.3, previous);
  assert.notEqual(body.specialVolume, previous);
  assert.equal(body.specialVolume.volume, water);
  assert.equal(body.specialVolume.automatic, water);
  assert.equal(body.specialVolume.waterDistance, 12);
  assert.equal(body.specialVolume.depth, 0);
  assert.notEqual(body.specialVolume.waterNormal, previous.waterNormal);
  body.specialVolume.waterNormal.x = 0.2;
  body.specialVolume.waterDistance = 8;
  body.specialVolume.automatic = null;
  assert.deepEqual(previous.waterNormal.toArray(), [0, 1, 0]);
  assert.equal(previous.waterDistance, 12);
  assert.equal(previous.automatic, water);
  assert.equal(
    createMineBody(spawn(), new Group(), bounds, 0.3).specialVolume,
    undefined,
  );
});

test("mine body rejects invalid source sphere properties", () => {
  for (const mass of [0, -1, NaN, Infinity])
    assert.throws(
      () => createMineBody(spawn(), new Group(), bounds, mass),
      /Invalid mine/,
    );
  for (const box of [
    new Box3(),
    new Box3(v(), v()),
    new Box3(v(), v(Infinity, 1, 1)),
  ])
    assert.throws(
      () => createMineBody(spawn(), new Group(), box, 0.3),
      /Invalid mine/,
    );
});

test("installed action30 direct damage differs from DoDamage immunity and magnitude thresholds", () => {
  // Native413ce0 only checks positive increment; action30 itself gates noDamage.
  assert.equal(
    mineComponentDamage(90, { unit: 2, magnitude: 1 }, "direct", 8),
    91,
  );
  assert.equal(
    mineComponentDamage(98, { unit: 0, magnitude: 1 }, "direct", 8),
    99,
  );
  assert.equal(
    mineComponentDamage(98, { unit: 0, magnitude: 4 }, "filtered", 6),
    98,
  );
  assert.equal(
    mineComponentDamage(94, { unit: 0, magnitude: 5 }, "filtered", 6),
    94,
  );
  assert.equal(
    mineComponentDamage(90, { unit: 0, magnitude: 9 }, "filtered", 6),
    90,
  );
  assert.equal(
    mineComponentDamage(90, { unit: 0, magnitude: 10 }, "filtered", 6),
    99,
  );
  assert.equal(
    mineComponentDamage(0, { unit: 2, magnitude: 50 }, "filtered", 7),
    0,
  );
  assert.equal(
    mineComponentDamage(0, { unit: 2, magnitude: 50 }, "filtered", 6),
    50,
  );
  const base = { victim: "car", driver: 8, mass: 2, maxDamage: 0.7 };
  const run = (values) =>
    hitMineReaction({ ...base, ...values }, [2, 10, 2, 2], () => 0.5);
  assert.deepEqual(run({ protection: 1.00001 }), []);
  assert.deepEqual(run({ networkProtected: true }), []);
  const immune = run({ noDamage: true });
  assert.equal(immune[0].kind, "reaction");
  assert.equal(immune[1].kind, "crush");
  assert.deepEqual(immune[0].components, []);
  const noCrush = run({ noCrush: true });
  assert.equal(noCrush.length, 1);
  assert.equal(noCrush[0].kind, "reaction");
  assert.equal(noCrush[0].components.length, 12);
  near(noCrush[0].maxDamage, 1);
});

test(
  "original MINE and GENERAL supply 0.3 tonne mass and native radius/inertia; car header supplies softness",
  {
    skip: !existsSync("carma2_orig/data/MINE.TWT"),
  },
  async () => {
    const store = await createAssetStore();
    const mass = parseMineMass(
      decodeText(await store.read("data/general.txt")),
    );
    const model = parseDat(await store.read(MINE_MODEL_PATH))[0];
    const modelBounds = new Box3();
    for (let i = 0; i < model.positions.length; i += 3)
      modelBounds.expandByPoint(v(...model.positions.slice(i, i + 3)));
    const body = createMineBody(spawn(), new Group(), modelBounds, mass);
    assert.equal(body.properties.mass, 0.3);
    near(body.properties.radius, 0.05894560987750689);
    near(body.properties.inertia.x, (body.properties.radius ** 2 * 0.3) / 6);
    const programs = parseDamagePrograms(
      decodeText(await store.read("data/CARS/EAGLE3/EAGLE3.TXT")),
    );
    assert.equal(programs.softness, 0.7);
    // Native loader489352 writes this header scalar to car18d0; mine contacts
    // and action30 multiply18d0 by10/7 to derive their max_damage request.
    const reaction = hitMineReaction(
      { victim: "eagle", driver: 8, mass: 2, maxDamage: programs.softness },
      [2, 10, 2, 2],
      () => 0.5,
    );
    near(reaction[0].maxDamage, 1);
    near(reaction[1].strength, 0.1);
    assert.ok(
      reaction[0].components.every(({ magnitude }) => magnitude === 13),
    );
  },
);
