import test from "node:test";
import assert from "node:assert/strict";
import {
  NativePedProcessCachePool,
  selectNativePedProcessCacheIndex,
  NATIVE_PED_PROCESS_CACHE_CAPACITY,
  NATIVE_PED_PROCESS_CACHE_BYTES,
} from "../src/ped-process-cache.ts";
import { NativeRandom } from "../src/native-random.ts";
import { pedRandomInteger, parsePedSettings } from "../src/ped-rules.ts";
import { decodeText } from "../src/formats.ts";
import { createAssetStore } from "../server/assets.mjs";

const input = (overrides = {}) => ({
  timeMs: 1000,
  replay: false,
  minTurnIntervalMs: 0,
  maxTurnIntervalMs: 0,
  spurtingPeriodMs: 150,
  ...overrides,
});
function hostFixture(overrides = {}) {
  const links = new Map(),
    events = [],
    random = new NativeRandom(1);
  const host = {
    readCache: (owner) => links.get(owner) ?? null,
    writeCache: (owner, cache) => {
      events.push(["write", owner, cache]);
      links.set(owner, cache);
    },
    randomTurnInterval: (min, max) => {
      events.push(["turn", min, max]);
      return pedRandomInteger(random.random, min, max);
    },
    releaseFaceCache: (face, cache, owner) => {
      events.push(["face", face, cache, owner]);
      face.owner = null;
    },
    ...overrides,
  };
  return {
    host,
    links,
    events,
    random,
    pool: new NativePedProcessCachePool(host),
  };
}
function filled(host) {
  const owners = Array.from({ length: 100 }, () => ({}));
  owners.forEach((owner, i) =>
    host.pool.visit(owner, input({ timeMs: 1000 + i })),
  );
  host.events.length = 0;
  return owners;
}

test("native pool preallocates exactly100 stable300-byte process records plus one replay singleton", () => {
  const h = hostFixture();
  assert.equal(NATIVE_PED_PROCESS_CACHE_CAPACITY, 100);
  assert.equal(NATIVE_PED_PROCESS_CACHE_BYTES, 300);
  assert.equal(h.pool.slots.length, 100);
  assert.equal(h.pool.replayCache.index, -1);
  assert.equal(new Set(h.pool.slots).size, 100);
  for (const [i, cache] of h.pool.slots.entries()) {
    assert.equal(cache.index, i);
    assert.equal(cache.storage.length, 300);
    assert.equal(cache.stumpCounters.length, 32);
    assert.equal(cache.owner, null);
    assert.equal(cache.faceCache, null);
    assert.equal(cache.killer, null);
    assert.deepEqual(cache.floorNormal, [0, 0, 0]);
    assert.deepEqual(cache.retainedDirection, [0, 0, 0]);
    assert.equal(cache.headSequence.address, null);
    assert.equal(cache.headSequence.index, 0);
    assert.equal(cache.runFactor, 0);
  }
  assert.ok(Object.isFrozen(h.pool.slots));
});

test("animal stump indices alias native flags/vectors while Init clears only ten counter bytes", () => {
  const h = hostFixture(),
    slot = h.pool.slots[0];
  slot.storage.fill(0xa5);
  const { cache } = h.pool.visit({}, input());
  assert.equal(cache, slot);
  assert.equal(cache.stumpCounters.length, 32);
  assert.deepEqual([...cache.stumpCounters.subarray(0, 10)], Array(10).fill(0));
  assert.equal(cache.stumpCounters[10], 0xa5, "source retains opaque+2d");
  assert.equal(cache.stumpCounters[15], 0xa5, "source retains vector+30 bytes");
  assert.equal(cache.stumpCounters[31], 0xa5, "no full-view initialization");
  cache.stumpCounters[15] = 42;
  assert.equal(cache.storage[0x32], 42);
  cache.stumpCounters[11] = 0x80;
  assert.equal(cache.flags, 0x80, "actual source byte aliases flags WORD+2e");
  cache.flags = 0x1234;
  assert.equal(cache.stumpCounters[11], 0x34);
  assert.equal(cache.stumpCounters[12], 0x12);
});

test("first free array slot wins even when an earlier occupied record has an older timestamp", () => {
  const slots = Array.from({ length: 100 }, () => ({
    owner: {},
    lastUsedTimeMs: 500,
  }));
  slots[0].lastUsedTimeMs = 0;
  slots[7].owner = null;
  slots[8].owner = null;
  assert.equal(selectNativePedProcessCacheIndex(slots, 1000), 7);
  const h = hostFixture(),
    owners = filled(h),
    slot = h.pool.slots[7];
  slot.owner = null;
  h.links.set(owners[7], null);
  const newcomer = {},
    visit = h.pool.visit(newcomer, input({ timeMs: 2000 }));
  assert.equal(visit.cache, slot);
  assert.equal(visit.evictedOwner, null);
  assert.equal(visit.initialized, true);
  assert.equal(h.pool.slots[0].owner, owners[0]);
});

test("selection is unsigned absolute timestamp, strict first tie and(now+1)wrap rather than elapsed-age LRU", () => {
  const slots = Array.from({ length: 100 }, () => ({
    owner: {},
    lastUsedTimeMs: 500,
  }));
  slots[8].lastUsedTimeMs = 20;
  slots[9].lastUsedTimeMs = 20;
  assert.equal(selectNativePedProcessCacheIndex(slots, 1000), 8);
  slots[30].lastUsedTimeMs = 0xffffffff;
  assert.equal(selectNativePedProcessCacheIndex(slots, 0xffffffff), 0); // initialoldest wraps0.
  assert.equal(selectNativePedProcessCacheIndex(slots, 0), 0); // no timestamp<1 here.
  slots[42].lastUsedTimeMs = 0;
  assert.equal(selectNativePedProcessCacheIndex(slots, 0), 42);
  assert.equal(selectNativePedProcessCacheIndex(slots, 0xffffffff), 0); // even an actualzero cannotbe<0.
});

test("full pool evicts one source record; new pointer then old pointer clear precedes face release and turn draw", () => {
  const h = hostFixture(),
    owners = filled(h),
    old = owners[0],
    cache = h.pool.slots[0],
    face = { owner: old },
    fresh = {};
  cache.faceCache = face;
  cache.retryCount = 9;
  cache.directionInterpolationMs = 73;
  cache.processFlags = 0xffffffff;
  h.host.randomTurnInterval = (min, max) => {
    h.events.push(["turn", min, max]);
    assert.equal(h.links.get(fresh), cache);
    assert.equal(h.links.get(old), null);
    assert.equal(face.owner, null);
    assert.equal(cache.faceCache, null);
    assert.equal(cache.owner, old);
    assert.equal(cache.retryCount, 9); // sourceowner/resetstores occur later.
    return 300;
  };
  const visit = h.pool.visit(
    fresh,
    input({ timeMs: 2000, minTurnIntervalMs: 100, maxTurnIntervalMs: 500 }),
  );
  assert.equal(visit.cache, cache);
  assert.equal(visit.evictedOwner, old);
  assert.equal(visit.randomDrawCalls, 1);
  assert.deepEqual(
    h.events.map((e) => e[0]),
    ["write", "write", "face", "turn"],
  );
  assert.equal(h.events[0][1], fresh);
  assert.equal(h.events[1][1], old);
  assert.equal(h.events[2][3], old);
  assert.equal(cache.owner, fresh);
  assert.equal(cache.nextTurnTimeMs, 2300);
  assert.equal(cache.retryCount, 0);
  assert.equal(cache.lastUsedTimeMs, 2000);
  assert.equal(cache.processFlags, 0xfffffffc);
});

test("Init clears only installed byte/word/DWORD stores and preserves every other byte", () => {
  const h = hostFixture(),
    cache = h.pool.slots[0],
    face = { owner: {} };
  for (let i = 0; i < 300; i++) cache.storage[i] = (0x53 + 29 * i) & 255;
  cache.faceCache = face;
  cache.killer = {};
  const before = cache.storage.slice();
  const visit = h.pool.visit(
    {},
    input({ timeMs: 0x12345678, spurtingPeriodMs: 0xaabbccdd }),
  );
  assert.equal(visit.cache, cache);
  const expected = before.slice(),
    view = new DataView(expected.buffer);
  // Safe numerical installed-store fixture; no asset/cache content is copied.
  for (const offset of [0x18, 0x19, 0x21]) view.setUint8(offset, 0);
  for (const offset of [
    0x1c, 0x6c, 0x7c, 0x80, 0x88, 0x8c, 0x90, 0x94, 0x98, 0x9c, 0xb0, 0xc0,
  ])
    view.setUint32(offset, 0, true);
  view.setUint16(0x2e, 0, true);
  expected.fill(0, 0x23, 0x2d);
  view.setUint32(0x74, 0x12345678, true);
  view.setUint32(0x84, 0xaabbccdd, true);
  view.setInt32(0xa0, -1, true);
  view.setUint32(0xc4, (view.getUint32(0xc4, true) & ~3) >>> 0, true);
  assert.deepEqual(cache.storage, expected);
  assert.equal(cache.killer, null);
  assert.equal(face.owner, null);
  for (const offset of [
    0, 0xc, 0x1a, 0x1b, 0x20, 0x22, 0x2d, 0x78, 0xb8, 0x128,
  ])
    assert.equal(cache.storage[offset], before[offset]);
});

test("recycled record retains floor/direction, head scalar timer/index and runFactor; it does not invent +Y", () => {
  const h = hostFixture();
  filled(h);
  const cache = h.pool.slots[0];
  cache.floorNormal = [0.1, 0.8, -0.2];
  cache.retainedDirection = [0, 0, -1];
  cache.headSequence = { address: 0x65d050, startTimeMs: 9876, index: 255 };
  cache.runFactor = 0.09;
  const beforeFloor = cache.floorNormal,
    head = cache.headSequence;
  h.pool.visit({}, input({ timeMs: 2000 }));
  assert.deepEqual(cache.floorNormal, beforeFloor);
  assert.deepEqual(cache.retainedDirection, [0, 0, -1]);
  assert.equal(cache.headSequence, head);
  assert.equal(head.address, null);
  assert.equal(head.index, 255);
  assert.equal(head.startTimeMs, 9876);
  assert.equal(cache.runFactor, Math.fround(0.09));
});

test("retained visits perform no Init, release or CRT calls; owner/time and c4bit2 are the only stores", () => {
  const h = hostFixture(),
    owner = {},
    cache = h.pool.visit(owner, input()).cache;
  cache.faceCache = { owner };
  cache.retryCount = 4;
  cache.flags = 0x1234;
  cache.processFlags = 0xff;
  cache.killer = {};
  cache.headSequence.address = 0x65d050;
  const before = cache.storage.slice();
  h.events.length = 0;
  const visit = h.pool.visit(
    owner,
    input({ timeMs: 1100, maxTurnIntervalMs: 500, minTurnIntervalMs: 100 }),
  );
  assert.equal(visit.initialized, false);
  assert.equal(visit.randomDrawCalls, 0);
  assert.equal(visit.cache, cache);
  assert.deepEqual(h.events, []);
  const expected = before.slice(),
    view = new DataView(expected.buffer);
  view.setUint32(0x74, 1100, true);
  view.setUint32(0xc4, 0xfd, true);
  assert.deepEqual(cache.storage, expected);
  assert.equal(cache.retryCount, 4);
  assert.equal(cache.flags, 0x1234);
  assert.equal(cache.headSequence.address, 0x65d050);
});

test("replay NULL chooses shared singleton, reinitializes each singleton visit, and keeps other shared aliases", () => {
  const h = hostFixture(),
    a = {},
    b = {};
  const first = h.pool.visit(a, input({ replay: true }));
  assert.equal(first.cache, h.pool.replayCache);
  assert.equal(first.initialized, true);
  first.cache.retryCount = 7;
  first.cache.headSequence.index = 2;
  first.cache.headSequence.startTimeMs = 800;
  const second = h.pool.visit(b, input({ replay: true, timeMs: 1100 }));
  assert.equal(second.cache, first.cache);
  assert.equal(first.cache.retryCount, 0);
  assert.equal(first.cache.owner, b);
  assert.equal(h.links.get(a), first.cache);
  assert.equal(first.cache.headSequence.index, 2);
  assert.equal(first.cache.headSequence.startTimeMs, 800);
  first.cache.retryCount = 9;
  const third = h.pool.visit(a, input({ replay: true, timeMs: 1200 }));
  assert.equal(third.initialized, true);
  assert.equal(first.cache.retryCount, 0);
  assert.equal(first.cache.owner, a);
  assert.ok(h.pool.slots.every((c) => c.owner === null));
});

test("existing normal cache stays normal in replay; leaving singleton acquires a normal record", () => {
  const h = hostFixture(),
    a = {},
    b = {},
    normal = h.pool.visit(a, input()).cache;
  normal.retryCount = 8;
  assert.equal(
    h.pool.visit(a, input({ replay: true, timeMs: 1050 })).initialized,
    false,
  );
  assert.equal(h.links.get(a), normal);
  assert.equal(normal.retryCount, 8);
  h.pool.visit(b, input({ replay: true }));
  const leaving = h.pool.visit(b, input({ replay: false, timeMs: 1100 }));
  assert.equal(leaving.initialized, true);
  assert.equal(leaving.cache, h.pool.slots[1]);
  assert.equal(h.pool.replayCache.owner, b); // source doesnotfree/reinitialize singleton on this transition.
});

test("missing face/turn providers preflight before eviction, pointer writes, reset stores or RNG", () => {
  const h = hostFixture({
      releaseFaceCache: undefined,
      randomTurnInterval: undefined,
    }),
    owners = filled(h),
    cache = h.pool.slots[0],
    fresh = {};
  cache.faceCache = { owner: owners[0] };
  cache.retryCount = 12;
  const before = cache.storage.slice();
  const result = h.pool.visit(
    fresh,
    input({ timeMs: 2000, minTurnIntervalMs: 100, maxTurnIntervalMs: 500 }),
  );
  assert.equal(result.status, "provider-required");
  assert.deepEqual(result.requiredProviders, [
    "native-process-borrowed-face-release-owner",
    "native-process-next-turn-CRT-owner",
  ]);
  assert.equal(result.cache, null);
  assert.equal(h.links.get(owners[0]), cache);
  assert.equal(cache.owner, owners[0]);
  assert.equal(h.links.has(fresh), false);
  assert.deepEqual(cache.storage, before);
  assert.deepEqual(h.events, []);
});

test("maxTurn0 consumes no draw; shared CRT interval is inclusive and deadline addition wraps uint32", () => {
  const h = hostFixture(),
    a = {},
    b = {};
  h.pool.visit(a, input({ timeMs: 0xffffffff }));
  assert.equal(h.random.state, 1);
  const expectedRng = new NativeRandom(1),
    expected = pedRandomInteger(expectedRng.random, 100, 500);
  const result = h.pool.visit(
    b,
    input({
      timeMs: 0xfffffff0,
      minTurnIntervalMs: 100,
      maxTurnIntervalMs: 500,
    }),
  );
  assert.equal(result.cache.nextTurnTimeMs, (0xfffffff0 + expected) >>> 0);
  assert.equal(h.random.state, expectedRng.state);
  assert.equal(result.randomDrawCalls, 1);
  const overflow = hostFixture({ randomTurnInterval: () => -1 }).pool.visit(
    {},
    input({ timeMs: 0, maxTurnIntervalMs: 0x7fffffff }),
  );
  assert.equal(overflow.cache.nextTurnTimeMs, 0xffffffff); // native IRandomBetween signedIMUL can overflow.
});

test("stale/foreign caches, inconsistent displaced links and invalid source stores are explicit errors", () => {
  const h = hostFixture(),
    a = {},
    foreign = hostFixture().pool.slots[0];
  h.links.set(a, foreign);
  assert.throws(() => h.pool.visit(a, input()), /foreign/);
  h.links.set(a, h.pool.slots[0]);
  assert.throws(() => h.pool.visit(a, input()), /Stale/);
  const full = hostFixture(),
    owners = filled(full);
  full.links.set(owners[0], null);
  assert.throws(
    () => full.pool.visit({}, input({ timeMs: 2000 })),
    /inconsistent/,
  );
  assert.throws(() => selectNativePedProcessCacheIndex([], 0), /exactly/);
  assert.throws(() => h.pool.visit({}, input({ timeMs: -1 })), /integer/);
  const cache = h.pool.slots[0];
  assert.throws(() => {
    cache.retryCount = 256;
  }, /integer/);
  assert.throws(() => {
    cache.flags = 65536;
  }, /integer/);
  assert.throws(() => {
    cache.runFactor = 1e50;
  }, /float/);
  assert.throws(() => {
    cache.headSequence.address = 0x1234;
  }, /sequence/);
  cache.napalmDeadlineMs = -1;
  assert.equal(cache.napalmDeadlineMs, -1);
});

for (const dataRoot of ["data", "adv_data"])
  test(`original ${dataRoot} movement settings drive exact initial source turn interval and retained cache`, async (t) => {
    const root =
      process.env.CARMA2_ROOT ||
      new URL("../carma2_orig/", import.meta.url).pathname;
    let store;
    try {
      store = await createAssetStore(root);
    } catch (error) {
      if (
        error?.code === "ENOENT" ||
        /Original installation/.test(String(error))
      ) {
        t.skip("Original installation unavailable");
        return;
      }
      throw error;
    }
    const bytes = await store.read(`${dataRoot}/PEDS/settings.txt`);
    assert.ok(bytes);
    const text = decodeText(bytes),
      settings = parsePedSettings(text);
    const marker = /\/\/\s*SPURTING STUMP GIBLETS\s*:/i.exec(text);
    assert.ok(marker);
    const stumpRows = text
      .slice(marker.index + marker[0].length)
      .split(/\r?\n/)
      .map((line) => line.split("//")[0].trim())
      .filter(Boolean);
    const spurtingPeriodMs = Number(stumpRows[1]);
    assert.equal(spurtingPeriodMs, 100);
    const h = hostFixture(),
      expectedRandom = new NativeRandom(1);
    for (const movement of settings.movements) {
      const owner = {},
        timeMs = 2000;
      const result = h.pool.visit(
        owner,
        input({
          timeMs,
          minTurnIntervalMs: movement.minTurnMs,
          maxTurnIntervalMs: movement.maxTurnMs,
          spurtingPeriodMs,
        }),
      );
      assert.equal(result.status, "complete");
      const interval = movement.maxTurnMs
        ? pedRandomInteger(
            expectedRandom.random,
            movement.minTurnMs,
            movement.maxTurnMs,
          )
        : 0;
      assert.equal(
        result.cache.nextTurnTimeMs,
        movement.maxTurnMs ? (timeMs + interval) >>> 0 : 0,
      );
      assert.equal(h.random.state, expectedRandom.state);
      const identity = result.cache;
      assert.equal(
        h.pool.visit(owner, input({ timeMs: 2050 })).cache,
        identity,
      );
      assert.deepEqual(identity.floorNormal, [0, 0, 0]);
    }
  });
