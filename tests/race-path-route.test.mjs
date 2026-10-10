import test from "node:test";
import assert from "node:assert/strict";
import { NativeProjectedRoute } from "../src/ai/path-route.ts";

const section = (node0, node1, options = {}) => ({
  nodeIndices: [node0, node1],
  minSpeed: [0, 0],
  maxSpeed: [255, 255],
  width: 1,
  type: options.type ?? 0,
  oneWay: options.oneWay ?? false,
});

test("empty race route seeds nearest section forward and missing seed resets state", () => {
  const route = new NativeProjectedRoute(2, [section(0, 1, { type: 1 })]);
  const result = route.extendRace(
    { foundRaceSection: true, finished: true },
    0,
    () => assert.fail("dead end requires no random choice"),
  );
  assert.deepEqual(route.entries, [{ section: 0, direction: 1 }]);
  assert.deepEqual(result, { foundRaceSection: true, finished: true });

  route.clear();
  assert.deepEqual(
    route.extendRace({ foundRaceSection: true, finished: true }, undefined),
    { foundRaceSection: false, finished: false },
  );
  assert.deepEqual(route.entries, []);
  assert.throws(() =>
    route.extendRace({ foundRaceSection: false, finished: false }, -1),
  );
});

test("forward race-path tier beats forward other and reverse, sampling singleton", () => {
  const route = new NativeProjectedRoute(6, [
    section(0, 1),
    section(1, 2, { type: 2 }),
    section(5, 1),
    section(1, 3, { type: 1 }),
  ]);
  route.append(0, 1);
  let randomCalls = 0;
  const state = route.extendRace(
    { foundRaceSection: false, finished: false },
    undefined,
    () => {
      randomCalls++;
      return 0;
    },
  );
  assert.deepEqual(route.entries, [
    { section: 0, direction: 1 },
    { section: 3, direction: 1 },
  ]);
  assert.deepEqual(state, { foundRaceSection: true, finished: true });
  assert.equal(randomCalls, 1, "a singleton race tier still consumes RNG");
});

test("forward other tier, including type 2, beats an eligible reverse tier", () => {
  const route = new NativeProjectedRoute(6, [
    section(0, 1),
    section(1, 2, { type: 2 }),
    section(5, 1),
    section(2, 3, { type: 1 }),
  ]);
  route.append(0, 1);
  let randomCalls = 0;
  const state = route.extendRace(
    { foundRaceSection: false, finished: false },
    undefined,
    () => {
      randomCalls++;
      return 0;
    },
  );
  assert.deepEqual(route.entries, [
    { section: 0, direction: 1 },
    { section: 1, direction: 1 },
    { section: 3, direction: 1 },
  ]);
  assert.deepEqual(state, { foundRaceSection: true, finished: true });
  assert.equal(randomCalls, 2);
});

test("reverse tier appends direction zero and samples a singleton", () => {
  const route = new NativeProjectedRoute(4, [
    section(0, 1),
    section(2, 1),
    section(2, 3, { type: 1, oneWay: true }),
  ]);
  route.append(0, 1);
  let randomCalls = 0;
  const state = route.extendRace(
    { foundRaceSection: false, finished: false },
    undefined,
    () => {
      randomCalls++;
      return 0;
    },
  );
  assert.deepEqual(route.entries, [
    { section: 0, direction: 1 },
    { section: 1, direction: 0 },
    { section: 2, direction: 1 },
  ]);
  assert.deepEqual(state, { foundRaceSection: true, finished: true });
  assert.equal(randomCalls, 2);
});

test("before a race section a dead end reverses even a one-way previous section", () => {
  const route = new NativeProjectedRoute(2, [section(0, 1, { oneWay: true })]);
  let randomCalls = 0;
  const state = route.extendRace(
    { foundRaceSection: false, finished: false },
    0,
    () => {
      randomCalls++;
      return 0;
    },
  );
  assert.deepEqual(
    route.entries
      .slice(0, 4)
      .map(({ section: id, direction }) => [id, direction]),
    [
      [0, 1],
      [0, 0],
      [0, 1],
      [0, 0],
    ],
  );
  assert.equal(route.entries.length, 12);
  assert.deepEqual(state, { foundRaceSection: false, finished: false });
  assert.equal(randomCalls, 0);
});

test("after finding a race section a dead end marks finished without appending", () => {
  const route = new NativeProjectedRoute(2, [section(0, 1, { type: 1 })]);
  route.append(0, 1);
  const state = route.extendRace(
    { foundRaceSection: true, finished: false },
    undefined,
    () => assert.fail("finished branch does not choose a section"),
  );
  assert.deepEqual(route.entries, [{ section: 0, direction: 1 }]);
  assert.deepEqual(state, { foundRaceSection: true, finished: true });
});

test("route state survives a nonempty shift and full routes preserve capacity", () => {
  const route = new NativeProjectedRoute(3, [
    section(0, 1, { type: 1 }),
    section(1, 2),
  ]);
  route.append(0, 1);
  route.append(1, 1);
  assert.equal(route.shift(1), true);
  const state = route.extendRace(
    { foundRaceSection: true, finished: false },
    undefined,
    () => assert.fail("found-race dead end finishes without random selection"),
  );
  assert.deepEqual(route.entries, [{ section: 1, direction: 1 }]);
  assert.deepEqual(state, { foundRaceSection: true, finished: true });

  const full = new NativeProjectedRoute(2, [section(0, 1)]);
  for (let index = 0; index < 12; index++) full.append(0, index % 2);
  const fullState = { foundRaceSection: true, finished: false };
  assert.deepEqual(full.extendRace(fullState, undefined), fullState);
  assert.equal(full.entries.length, 12);
});

test("race-route tier selection uses the native 15-bit bucket mapping", () => {
  const candidates = [
    section(0, 1),
    section(1, 2, { type: 1 }),
    section(1, 3, { type: 1 }),
    section(1, 4, { type: 1 }),
  ];
  const choose = (sample) => {
    const route = new NativeProjectedRoute(5, candidates);
    route.append(0, 1);
    route.extendRace(
      { foundRaceSection: false, finished: false },
      undefined,
      () => sample,
    );
    return route.entries[1].section;
  };
  assert.equal(choose(0), 1);
  assert.equal(choose(10923 / 32768), 2);
  assert.equal(choose(21846 / 32768), 3);
  assert.equal(choose(32767 / 32768), 3);
  assert.throws(() => choose(1));
  assert.throws(() => choose(-0.01));
});
