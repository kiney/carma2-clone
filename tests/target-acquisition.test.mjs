import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { NativeProjectedRoute } from "../src/ai/path-route.ts";
import {
  NativeTargetAcquisition,
  nativeAcquisitionSeedDirection,
} from "../src/ai/target-acquisition.ts";

const point = (x, y = 0, z = 0) => new Vector3(x, y, z);
const section = (a, b) => ({
  nodeIndices: [a, b],
  minSpeed: [0, 0],
  maxSpeed: [255, 255],
  width: 1,
  type: 0,
  oneWay: false,
});
function fixture() {
  const nodes = [point(0), point(10), point(20), point(1000), point(1010)];
  const sections = [section(3, 4), section(1, 2), section(0, 1)];
  return {
    nodes,
    sections,
    route: new NativeProjectedRoute(nodes.length, sections),
    acquisition: new NativeTargetAcquisition(nodes, sections),
    query: {
      nowMs: 100,
      position: point(5),
      velocity: point(0),
      actorRow2: point(1),
      targetPosition: point(15),
      force: false,
      cheating: false,
      strength: 5,
      opponentFlags: 8,
    },
  };
}

test("full native backing route returns before cache refresh or RNG", () => {
  const f = fixture();
  for (let i = 0; i < 12; i++) f.route.append(2, 1);
  const cache = { section: -1, refreshAtMs: 0 };
  const actual = f.acquisition.acquire(f.route, f.query, cache, () => {
    throw new Error("Capacity return must not consume RNG");
  });
  assert.deepEqual(actual, cache);
  assert.equal(f.acquisition.previousTargetSection, -1);
});

test("target cache equality retains its section and strict expiry samples inclusive jitter", () => {
  const f = fixture();
  let calls = 0;
  const query = { ...f.query, targetPosition: point(1005) };
  const atEquality = f.acquisition.acquire(
    f.route,
    query,
    { section: 1, refreshAtMs: 100 },
    () => {
      calls++;
      return 0;
    },
  );
  assert.deepEqual(atEquality, { section: 1, refreshAtMs: 100 });
  assert.equal(calls, 0);
  f.route.clear();
  const expired = f.acquisition.acquire(
    f.route,
    { ...query, nowMs: 101 },
    atEquality,
    () => {
      calls++;
      return 32767 / 32768;
    },
  );
  assert.deepEqual(expired, { section: 0, refreshAtMs: 1201 });
  assert.equal(calls, 1);
});

test("refresh jitter wraps the Uint32 deadline and leaves caller cache unchanged", () => {
  const f = fixture();
  const cache = { section: -1, refreshAtMs: 0 };
  let calls = 0;
  const result = f.acquisition.acquire(
    f.route,
    { ...f.query, nowMs: 0xffffffa0 },
    cache,
    () => {
      calls++;
      return 0;
    },
  );
  assert.deepEqual(result, { section: 1, refreshAtMs: 804 });
  assert.deepEqual(cache, { section: -1, refreshAtMs: 0 });
  assert.equal(calls, 1);
});

test("forced native MOV overwrites section zero of an existing route while preserving direction", () => {
  const f = fixture();
  for (let i = 0; i < 11; i++) f.route.append(1, 0);
  f.acquisition.acquire(
    f.route,
    { ...f.query, force: true },
    { section: 1, refreshAtMs: 1000 },
    () => 0,
  );
  assert.deepEqual(f.route.entries[0], { section: 2, direction: 0 });
  assert.equal(f.route.entries.length, 12);
});

test("fresh seed uses intersection displacement dotted with ACT row2", () => {
  const f = fixture();
  f.acquisition.acquire(
    f.route,
    { ...f.query, position: point(5, 0, 2), actorRow2: point(0, 0, 1) },
    { section: 1, refreshAtMs: 1000 },
    () => 0,
  );
  assert.deepEqual(f.route.entries[0], { section: 2, direction: 0 });
});

test("fresh seed preserves installed X/Z-before-Y cancellation order", () => {
  const delta = point(2 ** 35, -(2 ** 35), -(2 ** -30));
  const row = point(0.5, 0.5, Math.fround(Math.sqrt(0.5)));
  // Verified native operation order rounds the tiny Z term away before the
  // cancelling Y product; generic Vector3.dot instead gives a negative dot.
  assert.equal(nativeAcquisitionSeedDirection(delta, point(0), row), 1);
  assert.ok(delta.dot(row) < 0);
});

test("nearest section zero overwrites every old ID before fresh seeding and retains unused directions", () => {
  const nodes = [point(0), point(10), point(1000), point(1010)];
  const sections = [section(0, 1), section(2, 3)];
  const route = new NativeProjectedRoute(nodes.length, sections);
  for (let i = 0; i < 11; i++) route.append(1, 1);
  const acquisition = new NativeTargetAcquisition(nodes, sections);
  acquisition.acquire(
    route,
    {
      ...fixture().query,
      position: point(5),
      targetPosition: point(1005),
      force: true,
    },
    { section: 1, refreshAtMs: 1000 },
    () => 0,
  );
  assert.equal(route.entries.length, 3);
  assert.deepEqual(route.storedEntry(10), { section: 0, direction: 1 });
});

test("unchanged target preserves existing seed despite changed opponent position", () => {
  const f = fixture();
  const cache = { section: 0, refreshAtMs: 1000 };
  f.acquisition.acquire(f.route, f.query, cache, () => 0);
  f.route.shift(2);
  const retained = f.route.entries[0];
  f.acquisition.acquire(
    f.route,
    { ...f.query, position: point(1005) },
    cache,
    () => 0,
  );
  assert.deepEqual(f.route.entries[0], retained);
});

test("count twelve target read uses adjacent flags and consumes detour request RNG even when full", () => {
  for (const [flags, expectedCalls] of [
    [1, 1],
    [8, 0],
    [0xffff0001, 1],
  ]) {
    const f = fixture();
    for (let i = 0; i < 11; i++) f.route.append(2, 1);
    let calls = 0;
    f.acquisition.acquire(
      f.route,
      { ...f.query, strength: 4, opponentFlags: flags },
      { section: 1, refreshAtMs: 1000 },
      () => {
        calls++;
        return 0;
      },
    );
    assert.equal(f.route.entries.length, 12);
    assert.equal(calls, expectedCalls);
  }
});

test("unreachable target appends bounded strength-specific random fallback", () => {
  for (const [strength, expectedLength] of [
    [4, 5],
    [5, 3],
  ]) {
    const f = fixture();
    f.acquisition.acquire(
      f.route,
      { ...f.query, strength },
      { section: 0, refreshAtMs: 1000 },
      () => 0,
    );
    assert.equal(f.route.entries.length, expectedLength);
    assert.deepEqual(f.route.entries[0], { section: 2, direction: 1 });
  }
});

test("positive lookahead uses global slot metadata and mixed stored endpoint distance", () => {
  const f = fixture();
  f.route.append(2, 1);
  f.route.append(1, 1);
  f.route.append(2, 0);
  // Native slot0 resolves distant authored section0, not overwritten section2.
  // This prevents shifting even though the car's own section endpoint is near.
  f.acquisition.acquire(
    f.route,
    { ...f.query, velocity: point(20), force: true },
    { section: 0, refreshAtMs: 1000 },
    () => 0,
  );
  assert.deepEqual(f.route.entries[0], { section: 2, direction: 1 });
  assert.equal(f.route.entries.length, 5);
});

test("invalid explicit flags and random samples fail with bounded errors", () => {
  const f = fixture();
  assert.throws(
    () =>
      f.acquisition.acquire(
        f.route,
        { ...f.query, opponentFlags: undefined },
        { section: 1, refreshAtMs: 1000 },
      ),
    /Invalid target-acquisition query/,
  );
  assert.throws(
    () =>
      f.acquisition.acquire(
        f.route,
        f.query,
        { section: -1, refreshAtMs: 0 },
        () => 1,
      ),
    /random sample/,
  );
});

test("positive lookahead consumes subsequent stored lengths and retains the selected suffix", () => {
  const f = fixture();
  f.route.append(2, 1);
  f.route.append(1, 1);
  f.route.append(2, 0);
  // The global slot0 endpoint is1005 units from the intersection. Native
  // lookahead at400 model units/s exceeds that plus the next10-unit section.
  // Selecting slot2 keeps its original reversed direction, then fallback2.
  f.acquisition.acquire(
    f.route,
    { ...f.query, velocity: point(400), force: true },
    { section: 0, refreshAtMs: 1000 },
    () => 0,
  );
  assert.deepEqual(f.route.entries[0], { section: 2, direction: 0 });
  assert.equal(f.route.entries.length, 3);
});
