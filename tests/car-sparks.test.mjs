import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CarSparkAllocator } from "../src/car-sparks.ts";
import { NativeRandom } from "../src/native-random.ts";

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const f = Math.fround;
const close = (a, b, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const participant = (driver = 6, extra = {}) => ({
  actor: new THREE.Object3D(),
  driver,
  ...extra,
});
const source = (extra = {}) => ({
  position: v(1, 2, 3),
  velocity: v(2, 3, 4),
  force: v(10, 0, 0),
  cars: [participant(), participant()],
  ...extra,
});
function harness(options = {}) {
  const records = [],
    events = [];
  let cursor = 0;
  const allocator = new CarSparkAllocator({
    random: () => 0.5,
    shrapnelOutlet: () => events.push("shrapnel"),
    ...options,
    allocateNative: (record) => {
      events.push("spark");
      const id = cursor;
      cursor = (cursor + 1) % 32;
      records.push({ ...record, id });
      return id;
    },
  });
  return { allocator, records, events };
}

test("force threshold precedes shrapnel, RNG and caller-vector mutation", () => {
  const { allocator, records, events } = harness();
  const input = source({ force: v(9.99, 0, 0) });
  const original = [input.position, input.velocity, input.force].map((x) =>
    x.toArray(),
  );
  assert.deepEqual(allocator.spawn(input), {
    ids: [],
    count: 0,
    shrapnelRequested: false,
  });
  assert.deepEqual(
    [input.position, input.velocity, input.force].map((x) => x.toArray()),
    original,
  );
  assert.equal(records.length, 0);
  assert.equal(events.length, 0);
  assert.equal(allocator.stats.randomDraws, 0);
  assert.equal(allocator.spawn(source()).count, 4);
});

test("shrapnel is before driver eligibility and uses the shared RNG stream", () => {
  const seen = [];
  const { allocator, events } = harness({
    shrapnelOutlet: (packet) => {
      seen.push(packet);
      packet.random();
      packet.random();
    },
  });
  const input = source({ cars: [participant(5), participant(2)] });
  const result = allocator.spawn(input);
  assert.equal(result.count, 0);
  assert.equal(result.shrapnelRequested, true);
  assert.deepEqual(input.velocity.toArray(), [2, 3, 4]);
  assert.equal(allocator.stats.randomDraws, 2);
  assert.equal(events.length, 0);
  assert.equal(seen[0].forceLength, 10);
  assert.deepEqual(seen[0].normal.toArray(), [1, 0, 0]);
  assert.equal(seen[0].trailingArguments[0], input.cars[0].actor);
  assert.equal(seen[0].trailingArguments[1], input.cars[1].actor);
  assert.deepEqual(seen[0].trailingArguments.slice(2), [0, 0]);
});

test("SPARKY on either participant qualifies without changing owner selection", () => {
  for (const at of [0, 1]) {
    const { allocator, records, events } = harness();
    const cars = [participant(2), participant(4)];
    cars[at].sparky = true;
    const input = source({ cars });
    assert.equal(allocator.spawn(input).count, 4);
    assert.equal(records[0].car, cars[1].actor);
    assert.deepEqual(events, ["shrapnel", "spark", "spark", "spark", "spark"]);
  }
});

test("owner driver-eight exception and primary velocity frame are preserved", () => {
  const { allocator, records } = harness();
  const primary = participant(6),
    secondary = participant(6);
  primary.actor.rotation.z = Math.PI / 2;
  secondary.actor.position.set(5, 1, 2);
  const input = source({ cars: [primary, secondary] });
  allocator.spawn(input);
  assert.equal(records[0].car, secondary.actor);
  assert.deepEqual(input.position.toArray(), [-4, 1, 1]);
  assert.deepEqual(input.force.toArray(), [10, 0, 0]);
  close(input.velocity.x, 3);
  close(input.velocity.y, 0);
  close(input.velocity.z, 4);
  close(records[0].velocity.x, 3);
  close(records[0].velocity.y, f(f(-0.2) + (1 - f(-0.2)) * 0.5));
  assert.equal(records[0].velocity.z, 4);

  primary.driver = 8;
  const owned = source({ cars: [primary, secondary] });
  allocator.spawn(owned);
  assert.equal(records[4].car, primary.actor);
  close(owned.position.x, 2);
  close(owned.position.y, -1);
  close(owned.force.x, 0);
  close(owned.force.y, -10);
});

test("raw local-force projection uses squared length and Z Y X draws", () => {
  let at = 0;
  const draws = [0.75, 0.25, 0.125];
  const { allocator, records } = harness({
    random: () => draws[at++] ?? 0.5,
  });
  const input = source({ force: v(6, 8, 0), velocity: v(3, 4, 2) });
  allocator.spawn(input);
  assert.deepEqual(input.force.toArray(), [6, 8, 0]);
  assert.deepEqual(input.velocity.toArray(), [0, 0, 2]);
  const raw = v(-0.75, f(f(-0.2) + (1 - f(-0.2)) * 0.25), 0.5);
  const factor = -(6 * raw.x + 8 * raw.y) / 100;
  close(records[0].velocity.x, f(raw.x + 6 * factor));
  close(records[0].velocity.y, f(raw.y + 8 * factor));
  assert.equal(records[0].velocity.z, 2.5);
  assert.deepEqual(records[0].normal.toArray(), [0, 0, 0]);
  assert.equal(allocator.stats.randomDraws, 12);
});

test("twenty-record cap feeds one injected ring and preserves clocks/lifetimes", () => {
  const { allocator, records } = harness({ timeSyncMs: () => 67 });
  const first = allocator.spawn(source({ force: v(1000, 0, 0) }));
  const second = allocator.spawn(
    source({ force: v(1000, 0, 0), timeSyncMs: 27 }),
  );
  assert.equal(first.count, 20);
  assert.deepEqual(
    second.ids,
    [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 0, 1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(records[0].timeSyncMs, 67);
  assert.equal(records[20].timeSyncMs, 27);
  assert.ok(records.every((r) => r.lifetimeMs === 1000 && r.colour === 0));
  assert.equal(allocator.stats.created, 40);
  assert.equal(allocator.stats.randomDraws, 120);
});

test("CRT stream consumed by preceding shrapnel determines first scatter", () => {
  const rng = new NativeRandom(123),
    expected = new NativeRandom(123);
  const { allocator, records } = harness({
    random: rng.random,
    shrapnelOutlet: (request) => {
      for (let i = 0; i < 7; i++) request.random();
    },
  });
  for (let i = 0; i < 7; i++) expected.random();
  const z = f(-1 + 2 * expected.random()),
    y = f(f(-0.2) + (1 - f(-0.2)) * expected.random());
  expected.random();
  allocator.spawn(source({ velocity: v() }));
  assert.deepEqual(records[0].velocity.toArray(), [0, y, z]);
  assert.equal(allocator.stats.randomDraws, 19);
});

test("missing provider and invalid numeric input are explicit", () => {
  const { allocator } = harness({ shrapnelOutlet: undefined });
  allocator.spawn(source());
  assert.match(
    allocator.diagnostics.join(),
    /RNG side effects remain unresolved/,
  );
  assert.equal(allocator.stats.shrapnelOutletProvided, false);
  assert.throws(
    () => allocator.spawn(source({ force: v(NaN, 0, 0) })),
    /scalar/,
  );
  assert.throws(() => allocator.spawn(source({ timeSyncMs: -1 })), /clock/);
  assert.throws(
    () => new CarSparkAllocator({ allocateNative: () => 32 }).spawn(source()),
    /invalid slot/,
  );
});
