import test from "node:test";
import assert from "node:assert/strict";
import { NativePedGroundCachePool } from "../src/ped-ground-cache.ts";

const face = () => ({
  a: [-1, 0, -1],
  b: [-1, 0, 1],
  c: [1, 0, -1],
  normal: [0, 1, 0],
  rawFlags: 0,
});
const request = (owner, capacity = 5, timeMs = 100, previous = null) => ({
  owner,
  capacity,
  timeMs,
  faces: [face()],
  bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
  previous: previous && { identity: previous, capacity: previous.capacity },
  preferredIdentity: previous?.capacity === capacity ? previous : null,
});
test("native ground caches allocate original finite four-bucket capacity and stable order", () => {
  const pool = new NativePedGroundCachePool();
  assert.equal(pool.size, 85);
  for (const [capacity, count] of [
    [5, 40],
    [10, 25],
    [40, 15],
    [75, 5],
  ]) {
    assert.equal(pool.order(capacity).length, count);
    assert.deepEqual(
      pool.order(capacity).map((s) => s.index),
      Array.from({ length: count }, (_, i) => i),
    );
  }
});
test("acquisition rotates only the current head and same-capacity reuse moves its slot to tail", () => {
  const pool = new NativePedGroundCachePool(),
    a = {},
    b = {};
  const first = pool.acquire(request(a)),
    second = pool.acquire(request(b));
  assert.equal(first.index, 0);
  assert.equal(second.index, 1);
  const before = pool.order(5);
  assert.equal(pool.get(a), first);
  assert.deepEqual(
    pool.order(5),
    before,
    "retained lookup does not mark recently used",
  );
  assert.equal(pool.acquire(request(a, 5, 101, first)), first);
  assert.equal(pool.order(5).at(-1), first);
  assert.equal(pool.order(5)[0].index, 2);
  assert.equal(pool.order(5).at(-2), second);
});
test("bucket change clears old owner without moving the old ring and rebinds actual process pointer", () => {
  const pool = new NativePedGroundCachePool(),
    a = {};
  const first = pool.acquire(request(a)),
    before = pool.order(5);
  const second = pool.acquire(request(a, 10, 101, first));
  assert.equal(first.owner, null);
  assert.deepEqual(pool.order(5), before);
  assert.equal(second.capacity, 10);
  assert.equal(pool.get(a), second);
});
test("finite exhaustion evicts actual old owner and records same-time eviction diagnostic", () => {
  const evictions = [],
    pool = new NativePedGroundCachePool((owner, slot) => {
      assert.equal(
        pool.get(owner),
        null,
        "old process pointer cleared before outlet",
      );
      evictions.push([owner, slot]);
    });
  const owners = Array.from({ length: 6 }, () => ({}));
  const first = pool.acquire(request(owners[0], 75, 7));
  for (let i = 1; i < 6; i++) pool.acquire(request(owners[i], 75, 7));
  assert.equal(pool.size, 85);
  assert.equal(pool.get(owners[0]), null);
  assert.equal(pool.get(owners[5]), first);
  assert.deepEqual(evictions, [[owners[0], first]]);
  assert.equal(pool.diagnostics & 1, 1);
});
test("older eviction does not set same-frame bit; release retains face records and ring position", () => {
  const pool = new NativePedGroundCachePool(),
    a = {};
  const first = pool.acquire(request(a, 75, 1));
  for (let i = 0; i < 5; i++) pool.acquire(request({}, 75, 2));
  assert.equal(pool.diagnostics, 0);
  const lastOwner = first.owner,
    before = pool.order(75),
    records = first.faces;
  pool.release(lastOwner);
  assert.equal(pool.get(lastOwner), null);
  assert.equal(first.owner, null);
  assert.equal(first.faces, records);
  assert.deepEqual(pool.order(75), before);
});
test("cache stores actual copied finite face fields and bounds independent of scratch collector", () => {
  const pool = new NativePedGroundCachePool(),
    r = request({});
  const stored = pool.acquire(r);
  r.faces[0].a[0] = 99;
  r.faces[0].normal[1] = 2;
  r.bounds.min[0] = 42;
  r.faces.length = 0;
  assert.equal(stored.faces.length, 1);
  assert.equal(stored.faces[0].a[0], -1);
  assert.equal(stored.faces[0].normal[1], 1);
  assert.equal(stored.bounds.min[0], -1);
});
test("reset restores allocation order and clears owners while retaining source storage identity", () => {
  const pool = new NativePedGroundCachePool(),
    a = {};
  const slot = pool.acquire(request(a)),
    records = slot.faces;
  pool.acquire(request({}, 5));
  pool.reset();
  assert.equal(pool.get(a), null);
  assert.equal(pool.order(5)[0], slot);
  assert.equal(slot.owner, null);
  assert.equal(slot.faces, records);
});
test("stale external cache identity cannot steal another character's current slot", () => {
  const pool = new NativePedGroundCachePool(),
    a = {},
    b = {};
  const other = pool.acquire(request(b));
  assert.throws(() => pool.acquire(request(a, 5, 100, other)), /Stale/);
  assert.equal(pool.get(b), other);
  assert.equal(pool.get(a), null);
});
test("invalid capacity, bound, clock and owner do not mutate the cache ring", () => {
  const pool = new NativePedGroundCachePool(),
    before = pool.order(5);
  for (const mutate of [
    (r) => (r.capacity = 6),
    (r) => (r.faces = Array.from({ length: 6 }, face)),
    (r) => (r.timeMs = -1),
    (r) => (r.timeMs = 1.5),
    (r) => (r.owner = null),
    (r) => (r.bounds.min[0] = 2),
  ]) {
    const r = request({});
    mutate(r);
    assert.throws(() => pool.acquire(r));
  }
  assert.deepEqual(pool.order(5), before);
});
