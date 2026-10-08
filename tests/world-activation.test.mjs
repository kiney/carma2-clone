import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { Group, Matrix4, Vector3 } from "three";
import {
  WorldActivationRuntime,
  nonCarInitialMovement,
} from "../src/world-activation.ts";
import { parseNonCarMechanics } from "../src/noncars.ts";
import { createNonCarBody } from "../src/physics/noncar-body.ts";
import { NONCAR_FLAGS } from "../src/physics/noncar-motion.ts";
import { parseTrackSmashables } from "../src/world-smash.ts";
import { decodeText } from "../src/formats.ts";
import { createAssetStore } from "../server/assets.mjs";

const close = (actual, expected, tolerance = 1e-10) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );
const zeros = () => ({
  towards: [0, 0],
  impacteeVelocityFactor: 0,
  randomVelocityMax: 0,
  randomUpVelocityMax: 0,
  randomNormalVelocityMax: 0,
  randomSpinRateMax: 0,
});
const activation = (changes = {}) => ({
  delaySeconds: [1, 2],
  coordinates: "absolute",
  nonCarType: 7,
  min: [-2, -2, -2],
  max: [2, 2, 2],
  speed: zeros(),
  ...changes,
});
function mechanics(lift = false, index = 7) {
  return parseNonCarMechanics(
    `101\n${index}\n0,0,0\n0,0,0\n1\nbox\n-1,-1,-1\n1,1,1\n2,4\n2,2,2\n0\n0\n0\n${lift ? "WORLD_TRANSLATION_JOINT\n0,0,0\n0,1,0\n3\n4\n2\n1\n2\n1000\nNUMBER_OF_PUSHES\n3\n" : ""}END`,
  );
}
function body(position = new Vector3(), lift = false, name = "&07?0000") {
  const actor = new Group();
  actor.name = name;
  actor.position.copy(position);
  return createNonCarBody(actor, mechanics(lift));
}
const event = (changes = {}) => ({
  actor: new Group(),
  normalImpulse: 2,
  kind: "body",
  timeMs: 100,
  ...changes,
});

test("cuboid snapshots actors and gives each its own inclusive integer delay", () => {
  const first = body(new Vector3(1, 0, 0)),
    second = body(new Vector3(-1, 0, 0));
  const outside = body(new Vector3(8, 0, 0)),
    wrongType = body(new Vector3(), false, "&08?0000");
  let values = [0, 0.99999];
  const runtime = new WorldActivationRuntime(
    [first, second, outside, wrongType],
    { random: () => values.shift() ?? 0.5 },
  );
  assert.equal(runtime.enqueue(activation(), event()), 2);
  first.state.position.x = 20;
  outside.state.position.x = 0;
  assert.equal(runtime.update(1099).length, 0);
  assert.deepEqual(runtime.update(1100), [first]);
  assert.equal(first.motor.sleeping, false);
  assert.equal(first.properties.immovable, false);
  assert.equal(first.actor.userData.noncarPulled, true);
  assert.equal(outside.motor.sleeping, true);
  assert.equal(runtime.update(2099).length, 0);
  assert.deepEqual(runtime.update(2100), [second]);
  assert.equal(runtime.pendingCount, 0);
});

test("relative cuboid uses impactee physics transform and the two source corners", () => {
  const impactee = new Group();
  impactee.position.set(10, 0, 0);
  impactee.rotation.z = Math.PI / 4;
  const first = body(new Vector3(10, 0.7, 0)),
    cornerOnly = body(new Vector3(10.6, 0.7, 0));
  const runtime = new WorldActivationRuntime([first, cornerOnly], {
    random: () => 0.5,
  });
  const def = activation({
    coordinates: "relative",
    min: [0, 0, -1],
    max: [1, 1, 1],
  });
  assert.equal(runtime.enqueue(def, event({ bodyActor: impactee })), 1);
  impactee.position.set(100, 0, 0);
  assert.deepEqual(runtime.update(1600), [first]);
  assert.equal(cornerOnly.properties.immovable, true);
  assert.equal(runtime.enqueue(def, event({ timeMs: 1600 })), 0);
  assert.match(runtime.diagnostics.at(-1), /physics transform/);
});

test("numeric smash uses noncar actor ancestry rather than the other body transform", () => {
  const parent = new Group();
  parent.name = "&80?0000";
  parent.position.x = 5;
  const mesh = new Group();
  mesh.position.x = 3;
  parent.add(mesh);
  const other = new Group();
  other.position.x = 50;
  const lift = body(new Vector3(5, 0, 0), true);
  const runtime = new WorldActivationRuntime([lift], { random: () => 0 });
  assert.equal(
    runtime.enqueue(
      activation({ coordinates: "relative", delaySeconds: [0, 0] }),
      event({ actor: mesh, bodyActor: other }),
    ),
    1,
  );
  assert.deepEqual(runtime.update(100), [lift]);
  assert.equal(lift.motor.flags & 0xff, 1);
  assert.equal(
    lift.motor.flags & NONCAR_FLAGS.translation,
    NONCAR_FLAGS.translation,
  );
  assert.equal(lift.state.velocity.length(), 0);
});

test("delayed action skips props pulled before due and wildcards obey source actor bounds", () => {
  const first = body(),
    second = body(new Vector3(2, 2, 2), false, "&99?0000");
  const active = body();
  active.properties.immovable = false;
  const runtime = new WorldActivationRuntime([first, second, active], {
    random: () => 0.5,
  });
  assert.equal(runtime.enqueue(activation({ nonCarType: -1 }), event()), 3);
  first.actor.userData.noncarPulled = true;
  assert.deepEqual(runtime.update(1600), [second]);
  assert.equal(first.properties.immovable, true);
  assert.equal(active.state.velocity.length(), 0);
  assert.equal(runtime.pendingCount, 0);
});

test("initial movement preserves native component samples, normal fallback and spin units", () => {
  const values = [
    0,
    0.5,
    0.75,
    0,
    0.5,
    1 - 1e-8,
    0.5,
    0.5,
    0.5,
    0.5,
    0.25,
    0.25,
    0.25,
    0.75,
    0.25,
    0.5,
  ];
  const s = {
    towards: [2, 4],
    impacteeVelocityFactor: 2,
    randomVelocityMax: 2,
    randomUpVelocityMax: 4,
    randomNormalVelocityMax: 8,
    randomSpinRateMax: 100,
  };
  const movement = nonCarInitialMovement(
    s,
    new Vector3(1, 2, 3),
    new Vector3(3, 0, 0),
    new Vector3(),
    () => values.shift(),
  );
  close(movement.velocity.x, (2 + 2 - 2 + 2) / 6.9);
  close(movement.velocity.y, (4 + (4 * (32767 / 32768) - 2) + 2) / 6.9);
  close(movement.velocity.z, 6 / 6.9);
  close(movement.angularVelocity.x, (5 * 0.09587379924285257) / Math.sqrt(3));
  close(movement.angularVelocity.y, (-5 * 0.09587379924285257) / Math.sqrt(3));
  close(movement.angularVelocity.z, 0);
  assert.equal(values.length, 0);
  const endpointZero = nonCarInitialMovement(
    { ...zeros(), towards: [0, 10], impacteeVelocityFactor: 1 },
    new Vector3(6.9, 0, 0),
    new Vector3(10, 0, 0),
    new Vector3(),
    () => 0.5,
  );
  close(endpointZero.velocity.x, 1);
  assert.throws(
    () =>
      nonCarInitialMovement(
        { ...zeros(), towards: [1, 1] },
        new Vector3(),
        new Vector3(),
        new Vector3(),
      ),
    /Coincident/,
  );
});

test("movement quantizes nonexact unit samples to installed15-bit rand before FRandomBetween", () => {
  const input = 0.123456;
  const q = Math.floor(input * 32768) / 32768;
  const movement = nonCarInitialMovement(
    { ...zeros(), randomVelocityMax: 10 },
    new Vector3(),
    new Vector3(),
    new Vector3(),
    () => input,
  );
  const expected = (-10 + 20 * q) / 6.9;
  for (const value of movement.velocity.toArray()) close(value, expected);
  assert.ok(Math.abs(movement.velocity.x - (-10 + 20 * input) / 6.9) > 1e-5);
  assert.equal(movement.angularVelocity.length(), 0);
});

test("activation snapshots velocity, authored movement and explicit transform", () => {
  const prop = body(new Vector3(12, 0, 0));
  const velocity = new Vector3(6.9, 0, 0),
    matrix = new Matrix4().makeTranslation(10, 0, 0);
  const def = activation({
    coordinates: "relative",
    speed: { ...zeros(), impacteeVelocityFactor: 1 },
  });
  const runtime = new WorldActivationRuntime([prop], { random: () => 0.5 });
  runtime.enqueue(
    def,
    event({ impacteeVelocity: velocity, impacteeTransform: matrix }),
  );
  velocity.x = 999;
  matrix.setPosition(900, 0, 0);
  def.speed.impacteeVelocityFactor = 99;
  assert.deepEqual(runtime.update(1600), [prop]);
  close(prop.state.velocity.x, 1);
});

test("native queue bounds20 cuboids and20 actors; invalid inputs cannot inject NaN", () => {
  const props = Array.from({ length: 21 }, () => body());
  const runtime = new WorldActivationRuntime(props, { random: () => 0.5 });
  assert.equal(runtime.enqueue(activation(), event()), 20);
  assert.match(runtime.diagnostics[0], /actor limit20/);
  for (let i = 1; i < 20; i++) runtime.enqueue(activation(), event());
  assert.equal(runtime.pendingCount, 400);
  assert.equal(runtime.enqueue(activation(), event()), 0);
  assert.match(runtime.diagnostics.at(-1), /limit20 cuboids/);
  runtime.dispose();
  assert.equal(runtime.pendingCount, 0);
  assert.throws(() => runtime.update(NaN), /time/);
  assert.throws(
    () => runtime.enqueue(activation({ min: [NaN, 0, 0] }), event()),
    /Invalid/,
  );
  assert.throws(
    () => runtime.enqueue(activation({ delaySeconds: [0.1, 1] }), event()),
    /Invalid/,
  );
  assert.throws(
    () =>
      new WorldActivationRuntime(props, { random: () => 1 }).enqueue(
        activation(),
        event(),
      ),
    /random/,
  );
});

test("stock cuboid activation metadata drives installed lift state when assets are available", async (t) => {
  try {
    await access("carma2_orig/data.twt");
  } catch {
    t.skip("Original local assets absent");
    return;
  }
  const store = await createAssetStore("carma2_orig");
  let count = 0;
  for (const { path } of store.manifest.filter(({ path }) =>
    /DATA\/RACES\/.*\.TXT$/i.test(path),
  )) {
    const text = decodeText(await store.read(path));
    if (!/\/\/\s*Smashable environment specs/i.test(text)) continue;
    for (const spec of parseTrackSmashables(text, path)) {
      const defs = [
        spec.connotations,
        ...spec.levels.map((level) => level.connotations),
      ].flatMap((data) => data?.activations ?? []);
      for (const def of defs) {
        const type = def.nonCarType < 0 ? 7 : def.nonCarType;
        const center = new Vector3(...def.min)
          .add(new Vector3(...def.max))
          .multiplyScalar(0.5);
        const lift = body(
          center,
          true,
          `&${String(type).padStart(2, "0")}?0000`,
        );
        const root = new Group();
        root.name = "&80?0000";
        const runtime = new WorldActivationRuntime([lift], {
          random: () => 0.5,
        });
        assert.equal(
          runtime.enqueue(def, event({ actor: root, bodyActor: root })),
          1,
          path,
        );
        runtime.update(100 + Math.max(...def.delaySeconds) * 1000 + 65536);
        assert.equal(lift.motor.flags & 0xff, 1, path);
        count++;
      }
    }
  }
  assert.ok(count > 0, "stock authored noncar cuboids were exercised");
});
