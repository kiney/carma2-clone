import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  attributeNativePedContact,
  createNativePedContactAttribution,
} from "../src/ped-contact-attribution.ts";
import { NativePedAwardCounter } from "../src/ped-awards.ts";
import { originalCar } from "./support/original-car.mjs";
import { DamageSystem } from "../src/damage.ts";
import { createSimulatedCar } from "../src/physics/simulation.ts";

const player = { name: "player" },
  opponent = { name: "opponent" },
  prop = { name: "prop wrapper" },
  part = { name: "free-part wrapper" };
const drivers = new Map([
  [player, 8],
  [opponent, 6],
  [prop, 4],
  [part, 2],
]);
const culprits = new Map([
  [prop, player],
  [part, opponent],
]);
const providers = {
  readCarDriver: (car) => drivers.get(car),
  readCarCulprit: (car) => culprits.get(car),
};
const cache = (killer = null, flags = 0) => ({ killer, flags });
const other = (owner = player, overrides = {}) => ({
  typeByte: 1,
  owner,
  parentPresent: false,
  ...overrides,
});

test("direct driver>5 replaces the killer while preserving ordinary cause WORD", () => {
  const state = cache(player, 0x8420);
  assert.equal(
    attributeNativePedContact(state, other(opponent), providers).route,
    "direct",
  );
  assert.deepEqual(state, { killer: opponent, flags: 0x8420 });
  const below = cache();
  attributeNativePedContact(below, other(prop), providers);
  assert.deepEqual(below, { killer: player, flags: 1 });
  for (const driver of [5, -1, -0x80000000]) {
    const result = cache();
    attributeNativePedContact(result, other(prop), {
      readCarDriver: () => driver,
      readCarCulprit: () => null,
    });
    assert.deepEqual(result, { killer: null, flags: 1 });
  }
});

test("indirect culprit is sticky and is not the latest contacted wrapper", () => {
  const state = cache(null, 0xa420);
  attributeNativePedContact(state, other(prop), providers);
  attributeNativePedContact(state, other(part), providers);
  assert.deepEqual(state, { killer: player, flags: 0xa421 });
  const noCulprit = cache(null, 0x8000);
  attributeNativePedContact(noCulprit, other(prop), {
    ...providers,
    readCarCulprit: () => null,
  });
  assert.deepEqual(noCulprit, { killer: null, flags: 0x8001 });
  // A direct AI contact can replace this earlier indirect human attribution.
  attributeNativePedContact(state, other(opponent), providers);
  assert.equal(state.killer, opponent);
  assert.equal(state.flags, 0xa421);
});

test("Object+228 parent forces direct low-driver ownership, not culprit inheritance", () => {
  const state = cache(player, 0x20);
  attributeNativePedContact(
    state,
    other(part, { parentPresent: true }),
    providers,
  );
  assert.deepEqual(state, { killer: part, flags: 0x20 });
  const mine = { name: "mine" };
  attributeNativePedContact(
    state,
    other(mine, { typeByte: 0x40, mineCar: null, parentPresent: true }),
    providers,
  );
  assert.deepEqual(state, { killer: null, flags: 0x40 });
  // Type1 with NULL owner fails the earlier type gate despite a parent.
  const nullOwner = cache(player, 7);
  attributeNativePedContact(
    nullOwner,
    other(null, { parentPresent: true }),
    providers,
  );
  assert.deepEqual(nullOwner, { killer: player, flags: 7 });
});

test("type2..4 character cache inheritance writes no cause and preserves prior owner", () => {
  for (const typeByte of [2, 3, 4]) {
    const state = cache(null, 0x8220);
    const snapshot = other(
      {},
      { typeByte, characterCache: { killer: player } },
    );
    const result = attributeNativePedContact(state, snapshot, providers);
    assert.equal(result.route, "character");
    assert.deepEqual(state, { killer: player, flags: 0x8220 });
    snapshot.characterCache.killer = opponent;
    attributeNativePedContact(state, snapshot, providers);
    assert.equal(state.killer, player);
    for (const characterCache of [null, { killer: null }]) {
      const empty = cache();
      attributeNativePedContact(
        empty,
        { ...snapshot, characterCache },
        providers,
      );
      assert.deepEqual(empty, { killer: null, flags: 0 });
    }
  }
});

test("tail unsigned elapsed<7500 gate wraps and mode2 bypasses the clock", () => {
  const start = 0xfffffff0;
  for (const mode of [0, 1, 3]) {
    for (const elapsed of [7499, 7500, 0xffffffff]) {
      const state = cache(opponent, 0x8220);
      const result = attributeNativePedContact(
        state,
        other(player, { typeByte: 0x20 }),
        {
          ...providers,
          readTailState: () => ({
            mode,
            startedAtMs: start,
            nowMs: (start + elapsed) >>> 0,
          }),
        },
      );
      assert.equal(result.route, elapsed < 7500 ? "direct" : "unchanged");
      assert.equal(state.killer, elapsed < 7500 ? player : opponent);
      assert.equal(
        state.flags,
        elapsed < 7500 ? 0x8228 | (mode === 1 ? 0x10 : 0) : 0x8220,
      );
    }
  }
  const noClock = cache(null, 0x8000);
  attributeNativePedContact(noClock, other(player, { typeByte: 0x20 }), {
    ...providers,
    readTailState: () => ({ mode: 2 }),
  });
  assert.deepEqual(noClock, { killer: player, flags: 0x8008 });
});

test("mine and drone use distinct owner links and replace all sixteen cause bits", () => {
  for (const [typeByte, field, expected] of [
    [0x40, "mineCar", 0x40],
    [0x10, "droneCar", 1],
  ]) {
    const state = cache(opponent, 0xffff);
    attributeNativePedContact(
      state,
      other({}, { typeByte, [field]: player }),
      providers,
    );
    assert.deepEqual(state, { killer: player, flags: expected });
    // An indirect specialized owner uses its culprit and OR1, not the direct
    // mine/drone replacement; the native branch returns through4cddd1.
    const indirect = cache(null, 0xff20);
    attributeNativePedContact(
      indirect,
      other({}, { typeByte, [field]: prop }),
      providers,
    );
    assert.deepEqual(indirect, { killer: player, flags: 0xff21 });
  }
});

test("NULL cache/world and unsupported type do not consult car, tail or culprit providers", () => {
  const forbidden = {
    readCarDriver: () => assert.fail("driver read"),
    readCarCulprit: () => assert.fail("culprit read"),
    readTailState: () => assert.fail("tail read"),
  };
  assert.equal(
    attributeNativePedContact(null, other(), forbidden).route,
    "unchanged",
  );
  const state = cache(player, 0x1234);
  attributeNativePedContact(state, null, forbidden);
  for (const typeByte of [0, 5, 0xff])
    attributeNativePedContact(state, other({}, { typeByte }), forbidden);
  assert.deepEqual(state, { killer: player, flags: 0x1234 });
});

test("unknown providers are diagnosed separately from native NULL; invalid numerics fail", () => {
  for (const snapshot of [
    other({}, { typeByte: 2 }),
    other({}, { typeByte: 0x40 }),
    other({}, { typeByte: 0x10 }),
    other(null, { typeByte: 0x40, mineCar: null }),
    other(player, { typeByte: 0x20 }),
    other({}),
  ]) {
    const state = cache(null, 0x20);
    const result = attributeNativePedContact(state, snapshot, providers);
    assert.equal(result.route, "provider-required");
    assert.equal(result.diagnostics.length, 1);
    assert.deepEqual(state, { killer: null, flags: 0x20 });
  }
  assert.throws(
    () =>
      attributeNativePedContact(cache(), other(prop), {
        readCarDriver: () => NaN,
      }),
    /driver/,
  );
  for (const typeByte of [-1, 256, 1.5, NaN])
    assert.throws(
      () =>
        attributeNativePedContact(
          cache(),
          other(player, { typeByte }),
          providers,
        ),
      /type BYTE/,
    );
  assert.throws(
    () => attributeNativePedContact(cache(null, 0x10000), other(), providers),
    /cause WORD/,
  );
  assert.throws(
    () =>
      attributeNativePedContact(cache(), other(player, { typeByte: 0x20 }), {
        ...providers,
        readTailState: () => ({ mode: 0, nowMs: 1.1, startedAtMs: 0 }),
      }),
    /current time/,
  );
});

test("gameplay outlet accepts passive/active zero-lambda dispatch and clears stale human metadata", () => {
  const body = {},
    snapshots = new Map([[body, other(player)]]);
  const outlet = createNativePedContactAttribution({
    ...providers,
    readOther: (_ctx, dispatch) => snapshots.get(dispatch.other),
  });
  const state = { cache: { killer: null, killerDriver: 8, flags: 0x20 } };
  for (const phase of ["passive", "active"]) {
    assert.deepEqual(
      outlet({}, { phase, other: body, totalLambda: 0, firstLambda: 0 }, state),
      [],
    );
    assert.deepEqual(state.cache, {
      killer: player,
      killerDriver: 8,
      flags: 0x20,
    });
  }
  state.cache.killer = null;
  outlet({}, { phase: "active", other: undefined }, state);
  assert.equal("killerDriver" in state.cache, false);
  const awards = new NativePedAwardCounter();
  assert.equal(
    awards.score(100, { points: [300, 200, 150], time: [15, 10, 5] }, 0, {
      cachePresent: true,
      killerDriver: state.cache.killerDriver,
      cacheFlags: state.cache.flags,
    }),
    undefined,
  );
  state.cache.killer = player;
  state.cache.killerDriver = 6;
  outlet({}, { phase: "passive", other: undefined }, state);
  assert.equal(
    state.cache.killerDriver,
    8,
    "current driver comes from the retained pointer",
  );
});

test("gameplay outlet diagnoses unavailable native descriptors and refreshes current owner metadata", () => {
  const state = { cache: { killer: player, killerDriver: 8, flags: 0 } };
  const outlet = createNativePedContactAttribution({
    readOther: () => undefined,
    readCarDriver: () => undefined,
  });
  assert.deepEqual(outlet({}, { phase: "active", other: {} }, state), [
    "ped-contact-attribution:other-provider-required",
    "ped-contact-attribution:killer-driver-provider-required",
  ]);
  assert.equal(state.cache.killer, player);
  assert.equal("killerDriver" in state.cache, false);
});

test("original Eagle/Buggy dispatches preserve physical state and sticky wrapper ownership across world contacts", async (t) => {
  const cars = [];
  for (const name of ["EAGLE3", "buggy"]) {
    let data;
    try {
      data = await originalCar(name);
    } catch (error) {
      if (error.code === "ENOENT") {
        t.skip("Local original Eagle/Buggy assets absent");
        return;
      }
      throw error;
    }
    const damage = new DamageSystem(data.assets, data.group, data.text);
    await damage.init();
    const car = createSimulatedCar(
      data.group,
      data.text,
      damage,
      new Vector3(1, 2, 3),
      0,
      name === "EAGLE3",
    );
    car.state.velocity.set(0.21, -0.31, 0.41);
    car.state.angularVelocity.set(1, 2, 3);
    cars.push(car);
  }
  const [eagle, buggy] = cars;
  const wrapper = { name: "independent noncar wrapper" };
  const physicalProp = {
    state: {
      ...eagle.state,
      velocity: eagle.state.velocity.clone(),
      angularVelocity: eagle.state.angularVelocity.clone(),
    },
    properties: eagle.properties,
  };
  const descriptors = new Map([
    [eagle, other(eagle)],
    [buggy, other(buggy)],
    [physicalProp, other(wrapper)],
  ]);
  const ownerDrivers = new Map([
    [eagle, 8],
    [buggy, 6],
    [wrapper, 4],
  ]);
  let culprit = eagle;
  const outlet = createNativePedContactAttribution({
    readOther: (_ctx, dispatch) => descriptors.get(dispatch.other),
    readCarDriver: (owner) => ownerDrivers.get(owner),
    readCarCulprit: (owner) => (owner === wrapper ? culprit : undefined),
  });
  const state = {
    cache: { killer: null, flags: 0x20, napalmDeadlineMs: 9000 },
  };
  const before = cars.map((car) => ({
    position: car.state.position.toArray(),
    velocity: car.state.velocity.toArray(),
    omega: car.state.angularVelocity.toArray(),
  }));
  outlet({}, { phase: "passive", other: physicalProp, firstLambda: 0 }, state);
  assert.equal(state.cache.killer, eagle);
  culprit = buggy;
  outlet({}, { phase: "active", other: physicalProp, totalLambda: 0 }, state);
  outlet({}, { phase: "active", other: undefined }, state);
  assert.equal(state.cache.killer, eagle);
  assert.equal(state.cache.killerDriver, 8);
  assert.equal(state.cache.flags, 0x21);
  outlet({}, { phase: "passive", other: buggy }, state);
  assert.equal(state.cache.killer, buggy);
  assert.equal(state.cache.killerDriver, 6);
  assert.equal(state.cache.napalmDeadlineMs, 9000);
  assert.deepEqual(
    cars.map((car) => ({
      position: car.state.position.toArray(),
      velocity: car.state.velocity.toArray(),
      omega: car.state.angularVelocity.toArray(),
    })),
    before,
  );
  assert.ok(eagle.properties.mass > 0 && buggy.properties.mass > 0);
});
