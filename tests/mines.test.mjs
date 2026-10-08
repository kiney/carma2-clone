import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { Box3, Quaternion, Vector3 } from "three";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText, parseDat } from "../src/formats.ts";
import {
  MineRuntime,
  MINE_CAPACITY,
  MINE_FLAGS,
  MINE_MODEL_PATH,
  mineParameters,
  mineLaunchPose,
  mineRandomInteger,
  mineRandomFloat,
  mineComponentDamage,
  hitMineReaction,
  mineSphereProperties,
  parseMineMass,
} from "../src/physics/mines.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const nearVector = (a, b) => a.toArray().forEach((x, i) => near(x, b[i]));
const params = mineParameters([5, 2, 10, 2, 2, 0.7, 0.5, 0.6]);
const car = (victim = "owner", values = {}) => ({
  victim,
  driver: 8,
  mass: 2,
  maxDamage: 7,
  ...values,
});
const body = () => ({
  position: v(10, 20, 30),
  orientation: new Quaternion(),
  velocity: v(1, 2, 3),
  bounds: new Box3(v(-1, -2, -3), v(2, 4, 5)),
});
const spawn = (runtime, owner = car(), time = 0, parameters = params) =>
  runtime.spawn(owner, body(), parameters, time, 52);

test("mine normal/mortar placement inherits full orientation and exact velocity factors", () => {
  const b = body();
  const normal = mineLaunchPose(b, params);
  nearVector(normal.position, [10, 23, 35.15]);
  nearVector(normal.velocity, [1, 2.5, 3.6]);
  nearVector(normal.angularVelocity, [0, 0, 0]);
  b.orientation.setFromAxisAngle(v(0, 1, 0), Math.PI / 2);
  const mortarParams = mineParameters([5, 2, 10, 2, 2, 0.7, 0.5, -3], [1]);
  const mortar = mineLaunchPose(b, mortarParams);
  nearVector(mortar.position, [6.85, 23, 30]);
  nearVector(mortar.velocity, [-1, 4.5, 6]);
  assert.ok(mortar.orientation.equals(b.orientation));
  assert.notEqual(mortar.orientation, b.orientation);
  assert.throws(() => mineParameters([1, 2]), /eight/);
});

test("source RNG uses 15-bit floats and inclusive integer scaling", () => {
  near(
    mineRandomFloat(() => 0.5, 2, 10),
    6,
  );
  near(
    mineRandomFloat(() => 1, -2, 2),
    2 - 4 / 32768,
  );
  assert.equal(
    mineRandomInteger(() => 1, 0, 250),
    250,
  );
  assert.equal(
    mineRandomInteger(() => 0.5, 0, 9),
    5,
  );
  assert.equal(
    mineRandomInteger(() => 0, 2, 10),
    2,
  );
});

test("contact defers victim damage and processing emits crush before RNG reaction and explosion", () => {
  let sample = 0.5;
  const runtime = new MineRuntime({ random: () => sample });
  const mine = spawn(runtime),
    victim = car("victim");
  assert.deepEqual(runtime.contact(mine, { kind: "car", car: victim }, 0), []);
  assert.equal(mine.flags & 0xa0, 0xa0);
  near(mine.maxDamage, 10);
  const events = runtime.process(25, (event) => {
    if (event.kind === "crush") sample = 0.25;
  });
  assert.deepEqual(
    events.map((e) => e.kind),
    ["crush", "reaction", "explode"],
  );
  near(events[0].strength, 1);
  nearVector(events[1].deltaVelocity, [0, 4 / (2 * 6.9), 0]);
  nearVector(events[1].deltaAngularVelocity, [-Math.PI, 0, -Math.PI]);
  assert.equal(events[1].wakeUntilMs, 65);
  assert.equal(events[1].damageMode, "filtered");
  assert.equal(events[1].creditOwner, "owner");
  assert.equal(events[1].components.length, 12);
  assert.equal(events[1].components[0].magnitude, 62);
  assert.equal(mine.flags & MINE_FLAGS.pendingDamage, 0);
  assert.deepEqual(runtime.process(26), []);
  assert.deepEqual(
    runtime.contact(mine, { kind: "car", car: victim }, 100),
    [],
  );
});

test("timed explosions have strict deadlines, 1600ms cleanup and no victim scan", () => {
  const runtime = new MineRuntime();
  const mine = spawn(runtime);
  assert.deepEqual(runtime.process(5000), []);
  const events = runtime.process(5001);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["explode"],
  );
  assert.equal(mine.nextThinkTime, 6601);
  assert.deepEqual(runtime.process(6601), []);
  assert.deepEqual(
    runtime.process(6602).map((e) => e.kind),
    ["release"],
  );
  assert.equal(mine.flags & 3, 0);
  assert.equal(mine.flags & MINE_FLAGS.timed, MINE_FLAGS.timed);
});

test("20-slot pool replaces only an earlier eligible deadline and rejects stale contacts", () => {
  const runtime = new MineRuntime();
  const old = Array.from({ length: MINE_CAPACITY }, () => spawn(runtime));
  assert.equal(runtime.mines.length, 20);
  assert.equal(spawn(runtime), null); // source strict remaining < new lifetime
  const replacement = spawn(runtime, car(), 1);
  assert.equal(replacement.slot, 0);
  assert.equal(replacement.generation, 2);
  assert.deepEqual(
    runtime.contact(old[0], { kind: "car", car: car("victim") }, 1),
    [],
  );
  assert.equal(replacement.victim, null);
  runtime.clear();
  assert.equal(runtime.mines.filter(Boolean).length, 0);
});

test("force threshold, low-force sound, other mine asymmetry and noncar contact match callback", () => {
  const runtime = new MineRuntime();
  const first = spawn(runtime),
    second = spawn(runtime);
  assert.deepEqual(runtime.contact(first, null, 0.025), []);
  assert.equal(runtime.contact(first, null, 0.7)[0].sound, 5403);
  runtime.contact(first, { kind: "mine", mine: second }, 0);
  assert.equal(first.flags & MINE_FLAGS.pendingExplosion, 0);
  assert.ok(second.flags & MINE_FLAGS.pendingExplosion);
  const other = runtime.contact(first, { kind: "other", object: "ped" }, 0);
  assert.equal(other[0].kind, "nonCarContact");
  assert.deepEqual(
    runtime.process(1).map((e) => e.kind),
    ["explode", "explode"],
  );
  const suppressed = new MineRuntime({ suppressForceExplosion: true });
  const suppressedMine = spawn(suppressed);
  assert.equal(
    suppressed.contact(suppressedMine, null, 100)[0].kind,
    "impactSound",
  );
  assert.deepEqual(suppressed.process(1), []);
  const flagged = new MineRuntime(),
    flaggedMine = spawn(flagged);
  flagged.contact(
    flaggedMine,
    { kind: "car", car: car("split", { driver: 3, flags: 0x10000 }) },
    0.01,
  );
  assert.deepEqual(flagged.process(1), []);
});

test("physical mine vulnerability rechecks protections and host owns impulses", () => {
  for (const noCrush of [true, false]) {
    const runtime = new MineRuntime({ random: () => 0.5 });
    const victim = car("victim", { noCrush }),
      mine = spawn(runtime);
    runtime.contact(mine, { kind: "car", car: victim }, 1);
    assert.deepEqual(
      runtime.process(1).map((e) => e.kind),
      noCrush ? ["explode"] : ["crush", "reaction", "explode"],
    );
  }
  const runtime = new MineRuntime({ networkMode: 1 }),
    mine = spawn(runtime);
  runtime.contact(mine, { kind: "car", car: car("victim") }, 1);
  assert.deepEqual(
    runtime.process(1).map((e) => e.kind),
    ["crush", "explode"],
  );
  const noDamage = new MineRuntime(),
    protectedMine = spawn(noDamage),
    victim = car("victim");
  noDamage.contact(protectedMine, { kind: "car", car: victim }, 1);
  victim.protection = 2;
  assert.deepEqual(
    noDamage.process(1).map((e) => e.kind),
    ["explode"],
  );
  assert.equal(spawn(new MineRuntime({ networkMode: 3 })), null);
});

test("direct HitMine bypasses filtered brake/minimum/near-failure damage rules", () => {
  const events = hitMineReaction(car(), [8, 15, 4, 4], () => 0.5);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["reaction", "crush"],
  );
  assert.equal(events[0].damageMode, "direct");
  nearVector(events[0].deltaVelocity, [0, 11.5 / (2 * 6.9), 0]);
  assert.equal(events[0].components[0].magnitude, 125);
  const brake = { unit: 2, magnitude: 8 };
  assert.equal(mineComponentDamage(0, brake, "direct", 8), 8);
  assert.equal(mineComponentDamage(0, brake, "filtered", 8), 0);
  assert.equal(
    mineComponentDamage(95, { unit: 0, magnitude: 6 }, "filtered", 8),
    95,
  );
  assert.equal(
    mineComponentDamage(95, { unit: 0, magnitude: 10 }, "filtered", 8),
    99,
  );
  assert.equal(
    mineComponentDamage(0, { unit: 0, magnitude: 4 }, "filtered", 6),
    0,
  );
  assert.deepEqual(
    hitMineReaction(car("car", { protection: 2 }), [8, 15, 4, 4]),
    [],
  );
  assert.deepEqual(
    hitMineReaction(car("car", { noCrush: true }), [8, 15, 4, 4]).map(
      (e) => e.kind,
    ),
    ["reaction"],
  );
});

test("launch obstruction callback and sensible-path cached-face backoff preserve self contact", () => {
  const runtime = new MineRuntime(),
    mine = spawn(runtime);
  runtime.resolveLaunchContact(mine, {
    sensible: true,
    displacement: v(0, 1, 5),
    faceFraction: null,
  });
  assert.deepEqual(runtime.process(1), []);
  const before = mine.position.clone();
  runtime.resolveLaunchContact(mine, {
    sensible: true,
    displacement: v(0, 1, 5),
    faceFraction: 0.5,
  });
  nearVector(mine.position.clone().sub(before), [0, -0.6, -3]);
  const events = runtime.process(2);
  assert.equal(events[1].victim, "owner");
  assert.equal(events[1].creditOwner, null);
  const floorMine = spawn(runtime);
  runtime.resolveLaunchContact(floorMine, { sensible: false, other: null });
  assert.deepEqual(
    runtime.process(3).map((e) => e.kind),
    ["explode"],
  );
});

test(
  "source mine uses GENERAL mass and sphere generated from supplied model bounds",
  { skip: !existsSync("carma2_orig/data/MINE.TWT") },
  async () => {
    const store = await createAssetStore();
    const mass = parseMineMass(
      decodeText(await store.read("data/general.txt")),
    );
    assert.equal(mass, 0.3);
    const model = parseDat(await store.read(MINE_MODEL_PATH))[0];
    const bounds = new Box3();
    for (let i = 0; i < model.positions.length; i += 3)
      bounds.expandByPoint(v(...model.positions.slice(i, i + 3)));
    const sphere = mineSphereProperties(bounds, mass);
    near(sphere.radius, 0.05894560987750689);
    near(sphere.inertia.x, (sphere.radius ** 2 * mass) / 6);
    assert.equal(model.name, "shitmine.act");
    assert.equal(model.faces.length, 48);
    nearVector(sphere.center, [0, 0, 0]);
    assert.equal(parseMineMass("missing"), null);
  },
);
