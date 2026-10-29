import test from "node:test";
import assert from "node:assert/strict";
import { scanNativeOrdinaryPedObjects as scan } from "../src/ped-ordinary-object-scan.ts";
import { NativeRandom } from "../src/native-random.ts";
import {
  nativePedInitialFearHeadSequence as initialHead,
  startNativePedHeadSequence,
  advanceNativePedHeadSequence,
} from "../src/ped-head-sequence.ts";
import { NativePedProcessCachePool } from "../src/ped-process-cache.ts";
import { NativeResourceArena } from "../src/native-resource-arena.ts";

function fixture(action = 0) {
  // Explicit host allocation policy, not a Windows heap or BrMem class claim.
  const arena = new NativeResourceArena({
    classProvider: () => ({
      resolved: true,
      value: { alignment: 4, free: null },
    }),
  });
  const block = arena.allocate({ size: 2 * 0x54, classId: 0xc1 });
  const pedStorage = new Uint8Array(0x54),
    processStorage = new Uint8Array(0x12c);
  const ped = new DataView(pedStorage.buffer),
    process = new DataView(processStorage.buffer);
  ped.setInt8(4, 100);
  ped.setInt32(0x10, action, true);
  const events = [],
    random = new NativeRandom();
  const input = {
    pedAddress: block.address + 0x54,
    pedStorage,
    processStorage,
    timeMs: 20000,
    characterVelocity: [0, 0, 0],
    removedBoneMask: 0,
    walkPeriodBounds: [47, 19],
    objects: [],
    playerObject: null,
    globals: {
      immortal: false,
      suicidal: false,
      blind: false,
      valiumTimeMs: 0,
      playerThreatOverride: false,
    },
    crt: {
      seed(n) {
        events.push(["seed", n]);
        random.seed(n);
      },
      nextInteger() {
        const n = random.nextInteger();
        events.push(["draw", n]);
        return n;
      },
    },
    setDirection: (...args) => {
      events.push(["direction", ...args]);
    },
    rescanProximity: () => {
      events.push(["proximity"]);
    },
    setMove: (request) => {
      events.push(["move", request]);
      ped.setInt32(0x10, request.action, true);
    },
    startHead: (request) => {
      events.push(["head", request]);
    },
    noise: (...args) => {
      events.push(["noise", ...args]);
    },
    electric: (...args) => {
      events.push(["electric", ...args]);
      ped.setInt8(4, 0);
    },
  };
  return { input, ped, process, events, random, arena, block };
}
function object(position = [0, 0, 2], velocity = [0, 0, -2], extra = {}) {
  return {
    body: {},
    actorPosition: position,
    velocity,
    radiusSquared: 0.1,
    typeByte: 0,
    owner: null,
    ...extra,
  };
}
const names = (h) => h.events.map((e) => e[0]);
const vec = (view, offset) =>
  [0, 1, 2].map((i) => view.getFloat32(offset + 4 * i, true));

test("no process returns before flag mutation, CRT seed or object iteration", () => {
  const h = fixture();
  h.input.processStorage = null;
  assert.equal(scan(h.input).status, "complete");
  assert.deepEqual(h.events, []);
});

test("ordinary scan selects first qualifying PHIL object and commits native cache/timestamp order", () => {
  const h = fixture(),
    first = object([0, 0, 3]),
    nearer = object([0, 0, 1]);
  h.process.setUint8(0x18, 4);
  h.input.objects = [
    object([0, 0, 1], [0, 0, -2], { typeByte: 2, owner: {} }),
    first,
    nearer,
  ];
  h.input.startHead = (request) => {
    assert.equal(h.process.getUint32(0x1c, true), 0x65d048);
    assert.equal(h.process.getUint32(0x78, true), 20000);
    assert.equal(h.process.getUint8(0x1a), 0);
    assert.equal(h.ped.getUint32(0x28, true), 0);
    h.events.push(["head", request]);
  };
  const out = scan(h.input);
  assert.equal(out.selected, first);
  assert.equal(out.distanceSquared, 0);
  assert.equal(h.process.getUint8(0x18), 4);
  assert.deepEqual(vec(h.process, 0x30), [0, 0, -2]);
  assert.deepEqual(vec(h.process, 0x3c), [0, 0, 3]);
  assert.deepEqual(vec(h.process, 0xa4), [0, 0, -1]);
  assert.deepEqual(names(h), [
    "seed",
    "draw",
    "seed",
    "draw",
    "direction",
    "proximity",
    "draw",
    "move",
    "noise",
    "head",
  ]);
  assert.equal(h.events[0][1], h.input.pedAddress);
  assert.equal(h.events[2][1], (20000 ^ h.input.pedAddress) >>> 0);
  assert.equal(h.ped.getUint32(0x28, true), 20000);
  assert.equal(h.ped.getUint32(0x2c, true), 20000);
  assert.equal(h.ped.getInt32(0x10, true), 2);
  assert.deepEqual(h.events.find((e) => e[0] === "direction").slice(1), [
    [-0, -0, 1],
    0,
    20000,
  ]);
  assert.equal(h.arena.isLive(h.block), true);
});

test("strict box/corridor/time gates and slow-object cache stores preserve rotation RNG draw without imaginary rotation", () => {
  const h = fixture();
  const slow = object([0, 0, 1], [0, 0, -1]);
  h.input.objects = [object([5, 0, 1]), object([0, 0, -2]), slow];
  const out = scan(h.input);
  assert.equal(out.selected, slow);
  assert.deepEqual(names(h), ["seed", "draw", "seed", "draw"]);
  assert.equal(h.process.getUint8(0x18), 4);
  assert.deepEqual(vec(h.process, 0xa4), [0, 0, -1]);
  assert.equal(h.ped.getUint32(0x28, true), 0);
  assert.equal(h.ped.getUint32(0x2c, true), 0);
  const zero = fixture();
  zero.input.objects = [object([0, 0, 1], [0, 0, 0])];
  assert.equal(scan(zero.input).selected, null);
  assert.deepEqual(names(zero), ["seed", "draw", "seed"]);
});

test("suicidal mode scans nearest full3d distance then directs/rescans without ordinary contact-vector or fear stores", () => {
  const h = fixture(),
    near = object([1, 0, 0]),
    high = object([0, 4, 0]);
  h.input.globals.suicidal = true;
  h.input.objects = [high, near];
  h.process.setFloat32(0xa4, 99, true);
  const out = scan(h.input);
  assert.equal(out.selected, near);
  assert.equal(out.distanceSquared, 1);
  assert.deepEqual(names(h), [
    "seed",
    "draw",
    "seed",
    "direction",
    "proximity",
  ]);
  assert.deepEqual(h.events[3].slice(1), [[1, 0, 0], 0, 20000]);
  assert.equal(h.process.getFloat32(0xa4, true), 99);
  assert.equal(h.ped.getUint32(0x28, true), 0);
});

test("electric rays use actual line distance and driver, stop before reseed, and do not scan later objects", () => {
  const h = fixture(),
    ray = object([0.2, 0, 2], [0, 0, 0], {
      typeByte: 1,
      owner: {},
      driver: 8,
      electricRangeSquared: 5,
    });
  h.input.objects = [ray, object()];
  const out = scan(h.input);
  assert.equal(out.electric, true);
  assert.equal(out.selected, ray);
  assert.ok(Math.abs(out.distanceSquared - Math.fround(4.04)) < 1e-6);
  assert.deepEqual(names(h), ["seed", "draw", "electric"]);
  assert.equal(h.process.getUint8(0x18), 0);
  const otherDriver = fixture();
  otherDriver.input.objects = [
    object([0, 0, 2], [0, 0, -2], { typeByte: 1, owner: {}, driver: 3 }),
  ];
  assert.equal(scan(otherDriver.input).selected, otherDriver.input.objects[0]);
  assert.equal(names(otherDriver).includes("electric"), false);
});

test("player override bypasses reseed/blind/slow-velocity gates while wall shield still applies", () => {
  const h = fixture(),
    player = object([0, 0, 2], [0, 0, 0]);
  h.input.playerObject = player;
  h.input.globals.playerThreatOverride = true;
  h.input.globals.blind = true;
  const out = scan(h.input);
  assert.equal(out.selected, player);
  assert.deepEqual(names(h).slice(0, 3), ["seed", "draw", "draw"]);
  assert.equal(h.events.filter((e) => e[0] === "seed").length, 1);
  assert.equal(names(h).includes("move"), true);
});

test("no threat clears only object bit, reseeds before reversed authored walk-period draw, and starts calm", () => {
  const h = fixture(1);
  h.process.setUint8(0x18, 4);
  const expected = new NativeRandom((20000 ^ h.input.pedAddress) >>> 0);
  const period = 47 + Math.trunc((expected.nextInteger() * (20 - 47)) / 32768);
  scan(h.input);
  assert.deepEqual(names(h), ["seed", "draw", "seed", "draw", "move", "head"]);
  assert.deepEqual(h.events[4][1], {
    id: 30,
    speed: period,
    completion: true,
    action: 0,
    timeMs: 20000,
  });
  assert.equal(h.process.getUint32(0x1c, true), 0x65d054);
  assert.equal(h.ped.getUint32(0x28, true), 0);
  const obstructed = fixture(1);
  obstructed.process.setUint8(0x18, 6);
  scan(obstructed.input);
  assert.equal(obstructed.process.getUint8(0x18), 2);
  assert.equal(names(obstructed).includes("move"), false);
});

test("wall rejection and blind/valium skip threat writes while retaining actual calm gates", () => {
  for (const flag of ["blind", "valiumTimeMs"]) {
    const h = fixture();
    h.input.objects = [object()];
    h.input.globals[flag] = flag === "blind" ? true : 1;
    scan(h.input);
    assert.equal(h.process.getUint8(0x18), 0);
    assert.equal(names(h).includes("direction"), false);
  }
  const h = fixture();
  h.input.objects = [object([1, 0, 2], [0, 0, -2], { radiusSquared: 1 })];
  h.process.setUint8(0x18, 2);
  h.process.setFloat32(0xbc, 4, true);
  scan(h.input);
  assert.equal(h.process.getUint8(0x18), 2); // ratio exactly .25 rejects
  assert.deepEqual(names(h), ["seed", "draw", "seed"]);
});

test("repeated fear starts infinite sequence before selection; initial epoch is not reset", () => {
  const h = fixture(1);
  h.input.objects = [object()];
  h.ped.setUint32(0x2c, 9000, true);
  h.input.crt.nextInteger = () => {
    h.events.push(["draw", 20000]);
    return 20000;
  };
  scan(h.input); // repeated index5 -> move13, noise10 forced; no turn
  assert.deepEqual(names(h), [
    "seed",
    "draw",
    "seed",
    "draw",
    "head",
    "draw",
    "move",
    "noise",
  ]);
  assert.deepEqual(h.events.at(-1), ["noise", 10, true]);
  assert.equal(h.events.find((e) => e[0] === "move")[1].id, 13);
  assert.equal(h.process.getUint32(0x1c, true), 0x65d050);
  assert.equal(h.ped.getUint32(0x28, true), 20000);
  assert.equal(h.ped.getUint32(0x2c, true), 9000);
});

test("missing source continuation is explicit after ordered prior stores; unknown electric fields are not zero guesses", () => {
  const h = fixture();
  h.input.objects = [object()];
  delete h.input.setDirection;
  const out = scan(h.input);
  assert.equal(out.status, "provider-required");
  assert.deepEqual(out.requiredProviders, [
    "source-ped-scan-SetPedXZDirection-owner",
  ]);
  assert.equal(h.process.getUint8(0x18), 4);
  assert.deepEqual(vec(h.process, 0x30), [0, 0, -2]);
  assert.equal(h.ped.getUint32(0x28, true), 0);
  const ray = fixture();
  ray.input.objects = [
    object([0, 0, 2], [0, 0, -2], { typeByte: 1, owner: {}, driver: 8 }),
  ];
  assert.deepEqual(scan(ray.input).requiredProviders, [
    "source-ped-scan-electric-range-owner",
  ]);
});

test("finite initial-fear head sequence ends at99 and canonical process supports its actual pointer", () => {
  const caches = new Map(),
    pool = new NativePedProcessCachePool({
      readCache: (o) => caches.get(o) ?? null,
      writeCache: (o, cache) => caches.set(o, cache),
    });
  const owner = {},
    acquired = pool.visit(owner, {
      timeMs: 100,
      replay: false,
      minTurnIntervalMs: 0,
      maxTurnIntervalMs: 0,
      spurtingPeriodMs: 0,
    });
  acquired.cache.headSequence.address = initialHead.address;
  assert.equal(acquired.cache.headSequence.address, 0x65d048);
  const state = { sequence: null, index: 0, lastChangeTimeMs: 0 },
    poses = [];
  const providers = {
    setModels: (request) => {
      poses.push(request.poseIndex);
      return {
        status: "complete",
        requiredProviders: [],
        nativeModelReturn: 1,
      };
    },
  };
  const input = {
    hitPoints: 100,
    renderSlot: 0,
    headBone: 1,
    timeMs: 100,
    replay: false,
  };
  startNativePedHeadSequence(state, initialHead, input, providers);
  for (const timeMs of [226, 352, 478])
    advanceNativePedHeadSequence(state, { ...input, timeMs }, providers);
  assert.deepEqual(poses, [1, 2, 1]);
  assert.equal(state.sequence, null);
  assert.equal(state.index, 3);
});
