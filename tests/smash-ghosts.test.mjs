import test from "node:test";
import assert from "node:assert/strict";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { NativeRandom } from "../src/native-random.ts";
import { ShardRuntime } from "../src/smash-shards.ts";

function geometry() {
  const geo = new BufferGeometry();
  geo.setAttribute(
    "position",
    new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  return geo;
}
const speed = {
  towards: [0, 0],
  impacteeVelocityFactor: 1,
  randomVelocityMax: 0,
  randomUpVelocityMax: 0,
  randomNormalVelocityMax: 0,
  randomSpinRateMax: 0,
};
function setup(seed = 1) {
  const scene = new Group(),
    material = new MeshBasicMaterial(),
    rng = new NativeRandom(seed);
  const runtime = new ShardRuntime(scene, new Map([["GLASS.MAT", material]]), {
    random: rng.random,
    seed: rng.seed,
    gravity: 1,
  });
  return { scene, material, rng, runtime };
}
const spec = (changes = {}) => ({
  kind: "ghostparts",
  position: { kind: "actorbased" },
  speed,
  lifetimeSeconds: [1, 3],
  amount: [-1],
  ...changes,
});
function source(material, changes = {}) {
  return {
    templates: [
      {
        geometry: geometry(),
        material,
        name: "PANEL.ACT",
        matrix: new Matrix4().makeTranslation(1, 2, 3),
      },
    ],
    frame: new Matrix4(),
    point: new Vector3(),
    impacteeVelocity: new Vector3(6.9, 0, 0),
    timeMs: 100,
    seed: 99,
    visible: true,
    ...changes,
  };
}
const close = (a, b, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

test("native clock regression below birth retains and moves a live ghost group", () => {
  const { runtime, material } = setup();
  runtime.update(90);
  runtime.spawnGhosts(spec(), source(material));
  runtime.update(110); // Birth suppresses one movement pass, not expiry.
  const before = runtime.snapshot().fragments[0];
  runtime.update(80);
  const after = runtime.snapshot().fragments[0];
  assert.equal(runtime.snapshot().active, 1);
  const dt = Math.fround(Math.fround(-30) * Math.fround(0.001));
  close(
    after.position[0],
    Math.fround(before.position[0] + (Math.fround(6.9) * dt) / 6.9),
  );
  close(after.velocity[1], Math.fround(-dt * 9.8));
  assert.ok(after.position[0] < before.position[0]);
  runtime.update(after.endMs);
  assert.equal(runtime.snapshot().active, 0);
  runtime.dispose();
});

test("ordered negative ghost amount emits each authored model once and restores a rand output", () => {
  const { runtime, material, rng } = setup(17),
    expected = new NativeRandom(17);
  const saved = expected.nextInteger();
  const packet = source(material);
  packet.templates.push({
    ...packet.templates[0],
    name: "SECOND.ACT",
    matrix: new Matrix4().makeTranslation(4, 5, 6),
  });
  assert.equal(runtime.spawnGhosts(spec(), packet).created, 2);
  const fragments = runtime.snapshot().fragments;
  assert.deepEqual(
    fragments.map((f) => f.position),
    [
      [1, 2, 3],
      [4, 5, 6],
    ],
  );
  assert.deepEqual(
    fragments.map((f) => [f.slot, f.priority]),
    [
      [0, 4],
      [1, 4],
    ],
  );
  assert.equal(rng.state, saved);
  assert.deepEqual(fragments[0].velocity, [Math.fround(6.9), 0, 0]);
  assert.equal(fragments[0].groupId, fragments[1].groupId);
  runtime.dispose();
});

test("actor-based composition retains source shear through movement and native rotation", () => {
  const { runtime, material } = setup();
  runtime.update(1);
  const frame = new Matrix4().set(
    1,
    0.5,
    0,
    10,
    0,
    1,
    0,
    20,
    0,
    0,
    1,
    30,
    0,
    0,
    0,
    1,
  );
  runtime.spawnGhosts(
    spec({ lifetimeSeconds: [10, 10] }),
    source(material, { frame }),
  );
  const ghost = runtime.fragments[0];
  assert.deepEqual(
    ghost.mesh.matrix.elements,
    [1, 0, 0, 0, 0.5, 1, 0, 0, 0, 0, 1, 0, 12, 22, 33, 1],
  );
  runtime.update(100);
  ghost.spin.set(0, 0, 1);
  runtime.update(600);
  const after = runtime.snapshot().fragments[0];
  close(after.position[0], 12.5);
  close(after.position[1], 22 - (4.9 * 0.25) / 6.9);
  const angle = (Math.trunc(0.5 * 10430.378350470453) * 2 * Math.PI) / 65536;
  close(after.matrix[0], Math.cos(angle));
  close(after.matrix[1], Math.sin(angle));
  close(after.matrix[4], 0.5 * Math.cos(angle) - Math.sin(angle));
  close(after.matrix[5], 0.5 * Math.sin(angle) + Math.cos(angle));
  // A quaternion/scale decomposition would alter this retained shear dot.
  close(
    after.matrix[0] * after.matrix[4] + after.matrix[1] * after.matrix[5],
    0.5,
  );
  assert.equal(ghost.mesh.matrixAutoUpdate, false);
  runtime.dispose();
});

test("priority4 ghosts evict first minimum-priority shards in the shared 200 physical records", () => {
  const { runtime, material } = setup();
  const shard = {
    kind: "shards",
    speed,
    lifetimeSeconds: [10, 10],
    shard: { scalar: 100, integer: 0, material: "GLASS.MAT" },
  };
  const shardSource = {
    geometry: geometry(),
    matrixWorld: new Matrix4(),
    impacteeVelocity: new Vector3(),
    timeMs: 100,
  };
  for (let i = 0; i < 200; i++)
    assert.equal(runtime.spawn(shard, shardSource).created, 1);
  assert.equal(runtime.spawnGhosts(spec(), source(material)).created, 1);
  assert.equal(runtime.spawnGhosts(spec(), source(material)).created, 1);
  const pool = runtime.snapshot();
  assert.equal(pool.active, 200);
  assert.deepEqual(
    pool.fragments.slice(0, 3).map((f) => [f.slot, f.priority]),
    [
      [0, 4],
      [1, 4],
      [2, 3],
    ],
  );
  assert.equal(runtime.spawn(shard, shardSource).reason, "pool-full");
  runtime.dispose();
});

test("equal-priority ghosts cannot replace one another and pool exhaustion restores RNG", () => {
  const { runtime, material, rng } = setup();
  const packet = source(material);
  for (let i = 0; i < 200; i++)
    assert.equal(runtime.spawnGhosts(spec(), packet).created, 1);
  const expected = new NativeRandom(rng.state),
    saved = expected.nextInteger();
  assert.equal(runtime.spawnGhosts(spec(), packet).reason, "pool-full");
  assert.equal(rng.state, saved);
  assert.equal(runtime.snapshot().active, 200);
  runtime.dispose();
});

test("inactive physical slot is reused before any active lower priority record", () => {
  const { runtime, material } = setup();
  runtime.update(1);
  runtime.spawnGhosts(
    spec({ lifetimeSeconds: [10, 10] }),
    source(material, { groupId: 1 }),
  );
  runtime.spawnGhosts(
    spec({ lifetimeSeconds: [0.1, 0.1] }),
    source(material, { groupId: 2 }),
  );
  runtime.spawnGhosts(
    spec({ lifetimeSeconds: [10, 10] }),
    source(material, { groupId: 3 }),
  );
  runtime.update(100);
  runtime.update(200);
  assert.deepEqual(
    runtime.snapshot().fragments.map((f) => f.slot),
    [0, 2],
  );
  runtime.spawnGhosts(spec(), source(material, { timeMs: 200 }));
  assert.deepEqual(
    runtime.snapshot().fragments.map((f) => f.slot),
    [0, 1, 2],
  );
  runtime.dispose();
});

test("ghost group expiry and disposal leave borrowed model and material resources intact", () => {
  const { runtime, material, scene } = setup();
  const packet = source(material, { groupId: 9 }),
    geo = packet.templates[0].geometry;
  let disposedGeometry = 0,
    disposedMaterial = 0;
  geo.addEventListener("dispose", () => disposedGeometry++);
  material.addEventListener("dispose", () => disposedMaterial++);
  runtime.update(1);
  runtime.spawnGhosts(spec({ lifetimeSeconds: [0.1, 0.1] }), packet);
  runtime.spawnGhosts(spec({ lifetimeSeconds: [10, 10] }), packet);
  runtime.update(100);
  runtime.update(200);
  assert.equal(runtime.snapshot().active, 0);
  assert.equal(scene.children.length, 0);
  runtime.spawnGhosts(spec(), source(material));
  runtime.clear();
  runtime.dispose();
  assert.equal(disposedGeometry, 0);
  assert.equal(disposedMaterial, 0);
});

test("visibility gate precedes every draw; invalid source providers fail explicitly", () => {
  const { runtime, material, rng } = setup(3);
  assert.equal(
    runtime.spawnGhosts(spec(), source(material, { visible: false })).reason,
    "not-visible",
  );
  assert.equal(rng.state, 3);
  assert.throws(
    () => runtime.spawnGhosts(spec(), source(material, { seed: NaN })),
    /Invalid native ghost/,
  );
  assert.equal(rng.state, 3);
  assert.equal(
    runtime.spawnGhosts(
      spec({
        position: { kind: "sphereclumped", radius: 1, center: "impact" },
      }),
      source(material),
    ).reason,
    "unsupported",
  );
  runtime.dispose();
});
