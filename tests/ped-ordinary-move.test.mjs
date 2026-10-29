import assert from "node:assert/strict";
import test from "node:test";
import { NativePedProcessCachePool } from "../src/ped-process-cache.ts";
import { rescanNativePedProximity } from "../src/ped-native-proximity.ts";
import {
  accelerateNativeOrdinaryPed,
  setNativePedXZDirection,
  smoothTurnNativeOrdinaryPed,
  wanderNativeOrdinaryPed,
  avoidNativeOrdinaryPed,
  advanceNativeOrdinaryPedSteering,
  nativePedSafeCross,
} from "../src/ped-ordinary-move.ts";
const f = Math.fround;
const ok = () => ({ status: "complete", requiredProviders: [] });
function fixture() {
  const links = new Map();
  const pool = new NativePedProcessCachePool({
    readCache: (owner) => links.get(owner) ?? null,
    writeCache: (owner, cache) => links.set(owner, cache),
  });
  const process = pool.visit(
    {},
    {
      timeMs: 1000,
      replay: false,
      minTurnIntervalMs: 0,
      maxTurnIntervalMs: 0,
      spurtingPeriodMs: 100,
    },
  ).cache;
  const v = new DataView(
    process.storage.buffer,
    process.storage.byteOffset,
    300,
  );
  const events = [],
    draws = [];
  const input = {
    process,
    character: {
      rootPosition: [0, 0, 0],
      direction: [0, 0, 1],
      up: [0, 1, 0],
      velocity: [0, 0, 1],
      periodMs: 30,
    },
    selectedFloorNormal: [0, 1, 0],
    timeMs: 1000,
    framePeriodMs: 20,
    movement: {
      minTurnIntervalMs: 2000,
      maxTurnIntervalMs: 30000,
      maxRandomAngle: 0x8000,
    },
    action: 0,
    pedestrianSpeedFactor: 1,
    avoidDistanceSquared: 16,
    reachSquared: 0.25,
    suicidal: false,
    blind: false,
    providers: {
      nextCrtInteger: () => {
        events.push("random");
        return draws.shift() ?? 0;
      },
      setCharacterDirection: (direction, up) => {
        events.push(["direction", [...direction], [...up]]);
        const length = Math.hypot(...direction);
        input.character.direction = direction.map((n) => f(n / length));
      },
      setCharacterPeriod: (period, time) => {
        events.push(["period", period, time]);
        input.character.periodMs = period;
      },
      rescanProximity: () => ({ ...ok(), distance: 10000 }),
      scanForObjects: () => {
        events.push("objects");
        return ok();
      },
    },
  };
  const write = (offset, values) =>
    values.forEach((n, i) => v.setFloat32(offset + 4 * i, n, true));
  const read = (offset) => [0, 4, 8].map((n) => v.getFloat32(offset + n, true));
  return { input, process, pool, v, events, draws, write, read };
}

test("acceleration uses actual cache factor, outer period and source period outlet", () => {
  const h = fixture();
  h.process.runSpeed = 100;
  h.process.runFactor = f(0.09);
  h.input.pedestrianSpeedFactor = 2;
  assert.equal(accelerateNativeOrdinaryPed(h.input).status, "complete");
  assert.equal(h.process.runSpeed, 98);
  assert.deepEqual(h.events, [["period", 49, 1000]]);
  h.process.runSpeed = 31;
  accelerateNativeOrdinaryPed(h.input);
  assert.equal(h.process.runSpeed, 0);
  assert.equal(h.input.character.periodMs, 15);
  h.events.length = 0;
  accelerateNativeOrdinaryPed(h.input);
  assert.deepEqual(h.events, []);
});

test("reverse acceleration and unsigned native underflow retain installed branch behavior", () => {
  const h = fixture();
  h.input.reverseReplay = true;
  h.process.runSpeed = 99;
  h.process.runFactor = f(0.09);
  accelerateNativeOrdinaryPed(h.input);
  assert.equal(h.process.runSpeed, 0);
  assert.equal(h.input.character.periodMs, 100);
  h.input.reverseReplay = false;
  h.input.framePeriodMs = 1000;
  h.process.runSpeed = 50;
  h.process.runFactor = 1;
  accelerateNativeOrdinaryPed(h.input);
  assert.equal(h.process.runSpeed, -950 >>> 0);
});

test("direction requires selected floor; smooth projection retains source timestamps and dot guard", () => {
  const h = fixture();
  h.input.selectedFloorNormal = null;
  const old = h.process.storage.slice();
  assert.equal(
    setNativePedXZDirection(h.input, [1, 0, 0], 1).status,
    "provider-required",
  );
  assert.deepEqual(h.process.storage, old);
  h.input.selectedFloorNormal = [0, f(Math.SQRT1_2), f(Math.SQRT1_2)];
  setNativePedXZDirection(h.input, [0, 0, 1], 1);
  assert.deepEqual(h.read(0x48), [0, f(-Math.SQRT1_2), f(Math.SQRT1_2)]);
  assert.equal(h.v.getUint32(0x6c, true), 1000);
  assert.equal(h.v.getUint32(0x70, true), 1500);
  assert.deepEqual(h.read(0x60), [0, 0, 1]);
  h.input.timeMs = 1100;
  setNativePedXZDirection(h.input, [0, 0, 1], 1);
  assert.equal(h.v.getUint32(0x6c, true), 1000);
  h.input.timeMs = 1250;
  smoothTurnNativeOrdinaryPed(h.input);
  assert.deepEqual(h.events.at(-1)[1], [
    0,
    f(-Math.SQRT1_2 / 2),
    f((1 + f(Math.SQRT1_2)) / 2),
  ]);
  h.input.timeMs = 1500;
  smoothTurnNativeOrdinaryPed(h.input);
  assert.equal(h.v.getUint32(0x6c, true), 0);
  assert.deepEqual(h.events.at(-1)[1], h.read(0x48));
});

test("SafeCross uses Y comparison and native least-axis fallback without normalising", () => {
  assert.deepEqual(nativePedSafeCross([0, 2, 0], [0, 3, 0]), [0, 0, -2]);
  assert.deepEqual(nativePedSafeCross([1, 0, 0], [0, 0, 1]), [0, -1, 0]);
});

test("rejected wander restores whole canonical record after next deadline draw", () => {
  const h = fixture();
  h.process.nextTurnTimeMs = 999;
  h.process.storage[0x124] = 77;
  h.input.providers.rescanProximity = () => {
    h.process.storage[0x124] = 99;
    h.v.setUint8(0x18, 2);
    h.v.setUint32(0x90, 98765, true);
    return { ...ok(), distance: 1 };
  };
  wanderNativeOrdinaryPed(h.input);
  assert.equal(h.process.nextTurnTimeMs, 3000);
  assert.equal(h.process.storage[0x124], 77);
  assert.equal(h.v.getUint32(0x90, true), 0);
  assert.equal(h.v.getUint8(0x18), 0);
  assert.equal(h.v.getUint32(0x6c, true), 0);
  assert.equal(h.events.filter((e) => e === "random").length, 3);
  assert.deepEqual(h.events.at(-1), ["direction", [0, 0, 1], [0, 1, 0]]);
});

test("avoidance restores first scan opaque fields when opposite candidate ties", () => {
  const h = fixture();
  h.v.setUint8(0x18, 2);
  h.write(0x3c, [0, 0, 1]);
  h.write(0xa4, [0, 0, -1]);
  let scans = 0;
  h.input.providers.rescanProximity = () => {
    scans++;
    h.v.setUint8(0x18, 2);
    h.process.storage[0x124] = scans;
    return { ...ok(), distance: 3 };
  };
  avoidNativeOrdinaryPed(h.input);
  assert.equal(scans, 2);
  assert.equal(h.process.storage[0x124], 1);
  assert.deepEqual(h.read(0xc), [0, 0, 0]);
});

test("avoidance cooldown still consumes preceding distance draw; running back-wall dismissal draws100 percent", () => {
  const h = fixture();
  h.v.setUint8(0x18, 4);
  h.write(0x3c, [0, 0, 1]);
  h.v.setUint32(0x90, 1001, true);
  avoidNativeOrdinaryPed(h.input);
  assert.deepEqual(h.events, ["random"]);
  h.events.length = 0;
  h.input.action = 1;
  h.v.setUint8(0x18, 1);
  h.write(0x3c, [0, 0, 0.25]);
  avoidNativeOrdinaryPed(h.input);
  assert.equal(h.v.getUint8(0x18), 0);
  assert.deepEqual(h.events, ["random"]);
});

test("source proximity kernel receives actual canonical record during steering", () => {
  const h = fixture();
  const floor = {
    a: [-2, 0, -2],
    b: [2, 0, -2],
    c: [0, 0, 2],
    normal: [0, 1, 0],
    constant: 0,
    material: {},
    materialFlags: 0,
    nativeGroup: 0,
    nativeFace: 0,
  };
  const faceCache = { faces: [], selectedFace: floor };
  h.process.faceCache = faceCache;
  h.write(0x54, [1, 0, 0]);
  h.write(0x60, [0, 0, 1]);
  h.v.setUint32(0x6c, 900, true);
  h.v.setUint32(0x70, 1100, true);
  h.input.providers.rescanProximity = (direction) => {
    h.events.push("scan");
    return rescanNativePedProximity({
      process: h.process,
      rootPosition: h.input.character.rootPosition,
      characterDirection: h.input.character.direction,
      direction,
      personalityBoundsMaxX: 0.1,
      cosMaxSlope: 0.7,
      action: 0,
      suicidal: false,
      exclusionSpec: null,
    });
  };
  assert.equal(advanceNativeOrdinaryPedSteering(h.input).status, "complete");
  assert.deepEqual(h.process.floorNormal, [0, 1, 0]);
  assert.deepEqual(
    h.events.map((e) => (Array.isArray(e) ? e[0] : e)),
    ["direction", "scan", "objects"],
  );
});

test("missing object pointer/CRT provider is explicit before steering mutates state", () => {
  const h = fixture();
  h.process.nextTurnTimeMs = 1;
  delete h.input.providers.scanForObjects;
  const old = h.process.storage.slice();
  assert.deepEqual(advanceNativeOrdinaryPedSteering(h.input), {
    status: "provider-required",
    requiredProviders: ["source-PedScanForObjects-pointer-CRT-provider"],
  });
  assert.deepEqual(h.process.storage, old);
  assert.deepEqual(h.events, []);
});
