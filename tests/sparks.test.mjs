import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { SparkSystem } from "../src/sparks.ts";
import { NativeRandom } from "../src/native-random.ts";

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const f = Math.fround;
const close = (a, b, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const source = (extra = {}) => ({
  position: v(),
  velocity: v(0, 2, 0),
  force: v(1, 0, 0),
  sparkiness: 1,
  car: new THREE.Object3D(),
  ...extra,
});
const samples = (values, fallback = 0.5) => {
  let at = 0;
  return () => values[at++] ?? fallback;
};

test("world force normal and negative-dot velocity correction are native source values", () => {
  const sparks = new SparkSystem({ random: () => 0.5 });
  const input = source({ force: v(2, 0, 0), velocity: v(-1, 3, 0) });
  const result = sparks.spawnWorld(input);
  assert.equal(result.worldCount, 1);
  assert.equal(result.attachedCount, 0);
  close(input.velocity.x, f(0.1));
  assert.equal(input.velocity.y, 3);
  const record = sparks.snapshot().records[0];
  assert.deepEqual(record.normal.toArray(), [1, 0, 0]);
  close(record.velocity.x, f(f(0.1) * (0.5 + (f(0.9) - 0.5) * 0.5)));
  close(record.velocity.y, f(3 * (0.5 + (f(0.9) - 0.5) * 0.5)));
  assert.equal(record.life, 1000);
  assert.equal(sparks.stats.randomDraws, 4);
  sparks.dispose();
});

test("first count uses the positive speed term and component factors draw X Y Z", () => {
  const rng = samples([0.99, 0, 0.25, 0.75]);
  const sparks = new SparkSystem({ random: rng });
  const input = source({ velocity: v(0, 1, 1) });
  const result = sparks.spawnWorld(input);
  assert.equal(result.worldCount, 1);
  const record = sparks.snapshot().records[0];
  close(record.velocity.x, f(f(0.1) * 0.5));
  close(record.velocity.y, f(0.5 + (f(0.9) - 0.5) * 0.25));
  close(record.velocity.z, f(0.5 + (f(0.9) - 0.5) * 0.75));
  sparks.dispose();
});

test("force product equality ten allocates four attached tangent sparks and an explicit outlet", () => {
  const seen = [];
  const sparks = new SparkSystem({
    random: samples([0, 0.75, 0.25, 0.625]),
    shrapnelOutlet: (packet) => {
      seen.push(packet);
      packet.random();
    },
  });
  const result = sparks.spawnWorld(source({ force: v(10, 0, 0) }));
  assert.equal(result.worldCount, 0);
  assert.equal(result.attachedCount, 4);
  assert.equal(result.shrapnelRequested, true);
  const record = sparks.snapshot().records[0];
  assert.deepEqual(record.position.toArray(), [f(0.01), 0, 0]);
  assert.equal(record.velocity.x, 0);
  close(record.velocity.y, f(f(-0.2) + (1 - f(-0.2)) * 0.25));
  assert.equal(record.velocity.z, 0.5);
  assert.equal(seen[0].nativeAddress, 0x4f8590);
  assert.equal(seen[0].forceLength, 10);
  assert.equal(sparks.stats.randomDraws, 14);
  assert.equal(sparks.capabilities.shrapnelAllocator, false);
  sparks.dispose();
  const below = new SparkSystem({ random: () => 0 });
  assert.equal(
    below.spawnWorld(source({ force: v(9.999, 0, 0) })).attachedCount,
    0,
  );
  below.dispose();
});

test("missing shrapnel outlet is exposed instead of inventing its random draws", () => {
  const sparks = new SparkSystem({ random: () => 0.5 });
  sparks.spawnWorld(source({ force: v(10, 0, 0) }));
  assert.match(sparks.diagnostics.join(), /shrapnel.*RNG side effects/);
  assert.equal(sparks.stats.shrapnelOutletProvided, false);
  assert.equal(sparks.stats.randomDraws, 13);
  sparks.dispose();
});

test("render projection precedes movement, tail and original gravity/drag", () => {
  const sparks = new SparkSystem({ random: samples([0.9]) });
  sparks.spawnWorld(source());
  const initial = sparks.snapshot().records[0].velocity.y;
  sparks.update(40, 40);
  const record = sparks.snapshot().records[0];
  assert.equal(record.life, 960);
  assert.equal(record.position.x, 0);
  close(record.position.y, f(initial * 40 * f(0.001)));
  close(record.tail.y, f(-initial * 40 * f(0.001)));
  const gravity = f(40 / 690),
    beforeDrag = f(initial - gravity);
  const expected = f(
    beforeDrag *
      Math.max(f(0.1), 1 - Math.abs(beforeDrag) * f(1 / 1.4) * 40 * f(0.001)),
  );
  close(record.velocity.y, expected);
  assert.deepEqual(record.vertices.slice(0, 3), [0, 0, 0]);
  close(record.vertices[4], record.position.y);
  assert.equal(sparks.stats.randomDraws, 7);
  sparks.dispose();
});

test("physics sync is a duration; positive overshoot leaves the native forward tail", () => {
  const sparks = new SparkSystem({ random: samples([0.9]) });
  sparks.spawnWorld(source({ timeSyncMs: 80 }));
  const initial = sparks.snapshot().records[0].velocity.y;
  sparks.update(123456, 40);
  const record = sparks.snapshot().records[0];
  assert.equal(record.life, 1040);
  assert.equal(record.sync, 0);
  close(record.position.y, f(initial * 80 * f(0.001)));
  close(record.tail.y, f(initial * 40 * f(0.001)));
  sparks.dispose();
});

test("expired slot clears its flag but draws and consumes random values for one final iteration", () => {
  const sparks = new SparkSystem({ random: samples([0.9]) });
  sparks.spawnWorld(source());
  sparks.update(1000, 1000);
  assert.equal(sparks.stats.active, 1);
  assert.equal(sparks.stats.visible, 1);
  const before = sparks.stats.randomDraws;
  sparks.update(1000, 0);
  assert.equal(sparks.stats.active, 0);
  assert.equal(sparks.stats.visible, 1);
  assert.equal(sparks.stats.randomDraws, before + 3);
  sparks.update(1000, 0);
  assert.equal(sparks.stats.visible, 0);
  assert.equal(sparks.stats.randomDraws, before + 3);
  sparks.dispose();
});

test("attached positions and normals use rigid inverse, then follow the live car pose", () => {
  const car = new THREE.Object3D();
  car.position.set(10, 20, 30);
  car.rotation.z = Math.PI / 2;
  const sparks = new SparkSystem({ random: () => 0 });
  sparks.spawnWorld(
    source({ car, position: v(10, 21, 30), force: v(0, 10, 0) }),
  );
  const initial = sparks.snapshot().records[0];
  close(initial.position.x, f(1.01));
  close(initial.position.y, 0);
  close(initial.normal.x, 1);
  close(initial.velocity.dot(initial.normal), 0);
  car.position.x = 100;
  sparks.update(0, 0);
  const record = sparks.snapshot().records[0];
  close(record.vertices[3], 100);
  close(record.vertices[4], f(21.01));
  close(record.velocity.dot(record.normal), f(-0.1));
  sparks.dispose();
});

test("world and attached batch counts cap at ten; thirty-two slots overwrite circularly", () => {
  const sparks = new SparkSystem({
    random: () => 0.99,
    shrapnelOutlet: () => {},
  });
  const make = () => source({ sparkiness: 100, force: v(100, 0, 0) });
  const first = sparks.spawnWorld(make());
  assert.equal(first.worldCount, 10);
  assert.equal(first.attachedCount, 10);
  const second = sparks.spawnWorld(make());
  assert.deepEqual(
    second.ids,
    [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 0, 1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(sparks.stats.active, 32);
  assert.equal(sparks.stats.overwritten, 8);
  sparks.clear();
  assert.equal(sparks.stats.cursor, 8);
  assert.equal(sparks.stats.active, 0);
  assert.equal(sparks.spawnWorld(make()).ids[0], 8);
  sparks.dispose();
});

test("shared CRT sequence is injectable, render axis noise draws Z Y X", () => {
  const rng = new NativeRandom(17);
  const sparks = new SparkSystem({
    random: rng.random,
    shrapnelOutlet: () => {},
  });
  sparks.spawnWorld(source({ force: v(10, 0, 0) }));
  assert.ok(sparks.stats.active > 0);
  const clone = new NativeRandom(17);
  for (let i = 0; i < sparks.stats.randomDraws; i++) clone.random();
  assert.equal(rng.state, clone.state);
  sparks.dispose();
  const noise = new SparkSystem({
    random: samples([0.9, 0.5, 0.5, 0.5, 0, 0.25, 0.75]),
  });
  noise.spawnWorld(source());
  noise.update(0, 0);
  const record = noise.snapshot().records[0];
  close(record.velocity.x, f(0.05));
  close(record.velocity.z, f(-0.1));
  noise.dispose();
});

test("finite source bounds, zero force diagnostic, ownership and disposal", () => {
  const sparks = new SparkSystem({ random: () => 0.5 });
  assert.equal(sparks.spawnWorld(source({ force: v() })).ids.length, 0);
  assert.match(sparks.diagnostics.join(), /Zero native spark force/);
  assert.throws(
    () => sparks.spawnWorld(source({ force: v(Infinity, 0, 0) })),
    /Invalid spark/,
  );
  assert.throws(() => sparks.spawnWorld(source({ timeSyncMs: -1 })), /clock/);
  assert.throws(() => sparks.update(0, NaN), /clock/);
  assert.equal(sparks.group.children.length, 32);
  assert.deepEqual(
    Array.from(sparks.group.children[0].geometry.getAttribute("color").array),
    [1, 0, 0, 1, 1, 0],
  );
  sparks.dispose();
  assert.equal(sparks.group.children.length, 0);
  assert.equal(sparks.spawnWorld(source()).ids.length, 0);
});
