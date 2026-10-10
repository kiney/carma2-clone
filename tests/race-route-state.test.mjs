import test from "node:test";
import assert from "node:assert/strict";
import { NativeRaceRouteState } from "../src/ai/race-route-state.ts";

const section = (node0, node1, options = {}) => ({
  nodeIndices: [node0, node1],
  minSpeed: [0, 0],
  maxSpeed: [255, 255],
  width: 1,
  type: options.type ?? 0,
  oneWay: options.oneWay ?? false,
});

const ring = (count, firstIsRace = false) =>
  Array.from({ length: count }, (_, index) =>
    section(index, (index + 1) % count, {
      type: firstIsRace && index === 0 ? 1 : 0,
    }),
  );

test("start clears prior state and builds a fresh route from the nearest section", () => {
  const race = new NativeRaceRouteState(3, [
    section(0, 1),
    section(1, 2),
    section(2, 0, { type: 1 }),
  ]);
  race.start(0);
  const restarted = race.start(2);
  assert.equal(restarted[0].section, 2);
  assert.equal(restarted[0].direction, 1);
  const prepared = race.prepare(0);
  assert.equal(prepared.foundRaceSection, true);
  assert.equal(prepared.finished, false);

  const missing = new NativeRaceRouteState(1, [section(0, 0)]);
  assert.deepEqual(missing.start(undefined), []);
  assert.deepEqual(missing.prepare(0), {
    sectionSlot: 0,
    entries: [],
    foundRaceSection: false,
    finished: false,
    needsGetNearPlayer: true,
  });
});

test("count eleven does not replenish after a one-entry shift", () => {
  let randomCalls = 0;
  const race = new NativeRaceRouteState(11, ring(11, true), () => {
    randomCalls++;
    return 0;
  });
  assert.equal(race.start(0).length, 12);
  randomCalls = 0;
  const prepared = race.prepare(1);
  assert.equal(prepared.sectionSlot, 0);
  assert.equal(prepared.entries.length, 11);
  assert.equal(prepared.foundRaceSection, true);
  assert.equal(prepared.finished, false);
  assert.equal(randomCalls, 0, "count 11 is above the refill threshold");
});

test("count ten replenishes to twelve while preserving race-found state", () => {
  let randomCalls = 0;
  const race = new NativeRaceRouteState(11, ring(11, true), () => {
    randomCalls++;
    return 0;
  });
  race.start(0);
  randomCalls = 0;
  const prepared = race.prepare(2);
  assert.equal(prepared.sectionSlot, 0);
  assert.equal(prepared.entries.length, 12);
  assert.equal(prepared.foundRaceSection, true);
  assert.equal(prepared.finished, false);
  assert.equal(randomCalls, 2);
});

test("finished routes do not refill and refused large shifts reset the cursor only", () => {
  let randomCalls = 0;
  const race = new NativeRaceRouteState(2, [section(0, 1, { type: 1 })], () => {
    randomCalls++;
    return 0;
  });
  const started = race.start(0);
  assert.deepEqual(started, [{ section: 0, direction: 1 }]);
  randomCalls = 0;

  const prepared = race.prepare(5);
  assert.equal(prepared.sectionSlot, 0);
  assert.deepEqual(prepared.entries, [{ section: 0, direction: 1 }]);
  assert.equal(prepared.foundRaceSection, true);
  assert.equal(prepared.finished, true);
  assert.equal(prepared.needsGetNearPlayer, false);
  assert.equal(randomCalls, 0);
});

test("ordinary nonempty shifts preserve flags and report the current route", () => {
  const race = new NativeRaceRouteState(8, ring(8, true), () => 0);
  race.start(0);
  const before = race.prepare(0);
  assert.equal(before.foundRaceSection, true);
  assert.equal(before.finished, false);

  const shifted = race.prepare(3);
  assert.equal(shifted.sectionSlot, 0);
  assert.equal(shifted.entries.length, 12);
  assert.equal(shifted.foundRaceSection, true);
  assert.equal(shifted.finished, false);
});

test("follow cursor validation rejects negative and fractional shifts", () => {
  const race = new NativeRaceRouteState(1, [section(0, 0)]);
  race.start(0);
  assert.throws(() => race.prepare(-1));
  assert.throws(() => race.prepare(0.5));
});
