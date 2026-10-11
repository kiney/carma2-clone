import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parseNonCarMechanics } from "../src/noncars.ts";
import { createNonCarBody } from "../src/physics/noncar-body.ts";
import { hullsBounds } from "../src/physics/geometry.ts";
import { canSleepNativeQuietGroup } from "../src/physics/quiet-state.ts";
import {
  createState,
  finish,
  prepare,
  sleep,
  support,
  wake,
} from "../src/physics/noncar-quiet.ts";

const f = Math.fround;
function adjacent(value, step) {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value);
  view.setUint32(0, view.getUint32(0) + step);
  return view.getFloat32(0);
}
function makeBody({
  mass = 1,
  bounds = "-1,-2,-3\n2,3,4",
  keywords = "",
} = {}) {
  const actor = new Group();
  actor.name = "&07!0001.ACT";
  actor.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
  const mechanics = parseNonCarMechanics(
    `101\n7\n0.1,0.2,0.3\n0,0,0\n1\nbox\n${bounds}\n${mass},${mass}\n2,3,4\n0\n0\n0\n${keywords}\nEND`,
  );
  return createNonCarBody(actor, mechanics);
}

test("support is explicit, excludes only unsupported mechanics, and ignores motor sleep", () => {
  const body = makeBody();
  body.motor.sleeping = true;
  assert.deepEqual(support(body), { supported: true, reasons: [] });
  const state = createState(body);
  assert.equal(state.doNothing, false);
  assert.equal(state.quietState, 0);
  assert.equal(state.inertiaScale, 1);
  assert.equal("timer" in state, false);
  body.attached = true;
  assert.deepEqual(support(body), {
    supported: false,
    reasons: ["attached-body"],
  });
  assert.throws(() => prepare(body, state, new Vector3()), /attached-body/);
});

test("prepare snapshots post-force world and local velocities and spills retained inertia times 50", () => {
  const body = makeBody({ mass: 2 });
  body.properties.inertia.set(0.125, 0.25, 0.375);
  body.state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  body.state.velocity.set(0.25, -0.05, 0.5);
  body.state.angularVelocity.set(0, 0.002, 0);
  const state = createState(body);
  state.quietState = 3;
  const gravity = new Vector3(0, f(-0.05681159420289855), 0);
  prepare(body, state, gravity);
  assert.deepEqual(state.beforeWorldV.toArray(), [0.25, -0.05, 0.5]);
  assert.ok(state.beforeLocalOmega.distanceTo(new Vector3(0, 0.002, 0)) < 1e-8);
  assert.ok(
    state.localVelocity.distanceTo(new Vector3(-0.5, -0.05, 0.25)) < 1e-7,
  );
  assert.deepEqual(state.gravityIncrement.toArray(), gravity.toArray());
  assert.deepEqual(body.properties.inertia.toArray(), [
    f(0.125 * 50),
    f(0.25 * 50),
    f(0.375 * 50),
  ]);
  assert.equal(state.inertiaScale, 50);
  // Contacts update the solver's local +1a8 cache independently of world V.
  state.localVelocity.set(0, 0, 0);
  body.state.velocity.set(0, 0, 0);
  body.state.angularVelocity.set(0, 0, 0);
  const result = finish(body, state, false);
  assert.equal(result.quietEligible, true);
  assert.deepEqual(body.properties.inertia.toArray(), [
    f(f(0.125 * 50) / 50),
    f(f(0.25 * 50) / 50),
    f(f(0.375 * 50) / 50),
  ]);
  assert.equal(state.inertiaScale, 1);
});

test("finish preserves exact strict linear and angular gates after restoring moments", () => {
  const body = makeBody();
  const state = createState(body);
  state.quietState = 3;
  body.state.angularVelocity.set(1, 0, 0);
  body.properties.inertia.set(adjacent(f(0.00009), -1), 1, 1);
  prepare(body, state, new Vector3());
  body.state.angularVelocity.set(0, 0, 0);
  state.localVelocity.set(0, 0, 0);
  body.state.velocity.set(0, 0, 0);
  body.collisionFlags = 1;
  assert.equal(finish(body, state, false).quietEligible, true);

  state.quietState = 3;
  body.properties.inertia.set(f(0.00009), 1, 1);
  body.state.angularVelocity.set(1, 0, 0);
  prepare(body, state, new Vector3());
  body.state.angularVelocity.set(0, 0, 0);
  assert.equal(finish(body, state, false).gate, "angular-energy");

  state.quietState = 3;
  body.properties.inertia.set(1, 1, 1);
  body.state.angularVelocity.set(0, 0, 0);
  prepare(body, state, new Vector3());
  const below = f(Math.sqrt(0.001));
  body.state.velocity.set(below, 0, 0);
  state.localVelocity.set(below, 0, 0);
  assert.equal(finish(body, state, false).quietEligible, true);

  state.quietState = 3;
  body.state.velocity.set(0, 0, 0);
  prepare(body, state, new Vector3());
  const above = adjacent(below, 1);
  body.state.velocity.set(above, 0, 0);
  state.localVelocity.set(above, 0, 0);
  assert.equal(finish(body, state, false).gate, "linear-speed");
});

test("disconnected props use the explicit singleton path; sleep/wake have no timer or motor inference", () => {
  const body = makeBody();
  const state = createState(body);
  body.motor.sleeping = false;
  body.state.velocity.set(0, 0, 0);
  prepare(body, state, new Vector3());
  const isolated = finish(body, state, true);
  assert.equal(isolated.quietEligible, true);
  assert.equal(isolated.gravityComparisonUnordered, true);
  assert.equal(state.quietState, 3);
  const neighboringRingState = 0;
  if (canSleepNativeQuietGroup([state.quietState, neighboringRingState]))
    sleep(body, state);
  assert.equal(state.doNothing, false);
  if (canSleepNativeQuietGroup([state.quietState, 3])) sleep(body, state);
  // Group ownership checks all members before invoking this leaf operation.
  assert.equal(state.doNothing, true);
  assert.equal(state.quietState, 0);
  assert.equal(body.properties.immovable, true);
  assert.equal(body.motor.sleeping, false);
  wake(body, state);
  assert.equal(state.doNothing, false);
  assert.equal(state.quietState, 0);
  assert.equal(body.properties.immovable, false);
  assert.equal(body.motor.sleeping, false);
  assert.equal("timer" in state, false);
});

test("bounds passed to the leaf evaluator come from the actual compact local hull points", () => {
  const body = makeBody({ bounds: "-0.7,-0.4,-0.3\n0.8,0.9,1.1" });
  const state = createState(body);
  const bounds = hullsBounds(body.hulls);
  assert.deepEqual(state.bounds, {
    min: bounds.min.toArray().map(f),
    max: bounds.max.toArray().map(f),
  });
  assert.notDeepEqual(state.bounds, {
    min: [-1, -1, -1],
    max: [1, 1, 1],
  });
});

let originalAssetsAvailable = true;
try {
  await access(new URL("../carma2_orig/data.twt", import.meta.url));
} catch {
  originalAssetsAvailable = false;
}
test(
  "original pet pump and carrier gun mechanics are valid free simple quiet bodies",
  { skip: !originalAssetsAvailable },
  async () => {
    const assets = await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
    for (const [filename, index] of [
      ["99petpump.txt", 99],
      ["50GUN01_DEBRIS1.txt", 50],
    ]) {
      const text = decodeText(await assets.read(`data/NONCARS/${filename}`));
      const mechanics = parseNonCarMechanics(text, filename);
      const actor = new Group();
      actor.name = `&${index}!0001.ACT`;
      actor.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
      const body = createNonCarBody(actor, mechanics);
      assert.equal(support(body).supported, true, filename);
      const state = createState(body);
      const actual = hullsBounds(body.hulls);
      assert.deepEqual(state.bounds.min, actual.min.toArray().map(f));
      assert.deepEqual(state.bounds.max, actual.max.toArray().map(f));
      assert.ok(body.properties.mass > 0);
      assert.ok(body.properties.inertia.toArray().every((value) => value > 0));
    }
  },
);
