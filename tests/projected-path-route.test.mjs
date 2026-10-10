import test from "node:test";
import assert from "node:assert/strict";
import {
  NativeProjectedRoute,
  nextProjectedPathSlot,
} from "../src/ai/path-route.ts";

const section = (node0, node1, options = {}) => ({
  nodeIndices: [node0, node1],
  minSpeed: [options.min0 ?? 0, options.min1 ?? 0],
  maxSpeed: [options.max0 ?? 255, options.max1 ?? 255],
  width: options.width ?? 1,
  type: options.type ?? 0,
  oneWay: options.oneWay ?? false,
});

test("GetNext checks global metadata by projected slot, not actual section ID", () => {
  const sections = [section(0, 1), section(1, 2), section(2, 3, { type: 2 })];

  // The next route entry points to authored section 2 (type 2), but native
  // indexes metadata[slot 1], which is ordinary, and advances.
  assert.equal(
    nextProjectedPathSlot(
      sections,
      [
        { section: 0, direction: 1 },
        { section: 2, direction: 1 },
      ],
      0,
    ),
    1,
  );

  // Conversely metadata[slot 1] is type 2 even though the entry points to
  // ordinary section 0, so the native check stops.
  assert.equal(
    nextProjectedPathSlot(
      [section(0, 1), section(1, 2, { type: 2 }), section(2, 3)],
      [
        { section: 2, direction: 1 },
        { section: 0, direction: 1 },
      ],
      0,
    ),
    -1,
  );
});

test("GetNext bypasses metadata for cheating and returns at route end first", () => {
  const route = [
    { section: 0, direction: 1 },
    { section: 99, direction: 1 },
  ];
  assert.equal(nextProjectedPathSlot([], route, 0, true), 1);
  assert.equal(nextProjectedPathSlot([], route.slice(0, 1), 0), -1);
});

test("GetNext rejects invalid cursors and missing non-cheat slot metadata", () => {
  const route = [
    { section: 0, direction: 1 },
    { section: 0, direction: 1 },
  ];
  assert.throws(() => nextProjectedPathSlot([], route, -1));
  assert.throws(() => nextProjectedPathSlot([], route, 2));
  assert.throws(() => nextProjectedPathSlot([section(0, 1)], route, 0));
});

test("projected route keeps twelve entries, shifts safely, and snapshots are copies", () => {
  const route = new NativeProjectedRoute(2, [section(0, 1)]);
  for (let i = 0; i < 12; i++) assert.equal(route.append(0, i % 2), true);
  assert.equal(route.entries.length, 12);
  assert.equal(route.append(0, 1), false);

  const snapshot = route.entries;
  snapshot[0].section = 500;
  snapshot.pop();
  assert.equal(route.entries.length, 12);
  assert.equal(route.entries[0].section, 0);

  assert.equal(route.shift(0), true);
  assert.equal(route.entries.length, 12);
  assert.equal(route.shift(2), true);
  assert.equal(route.entries.length, 10);
  const before = route.entries;
  assert.equal(route.shift(10), false);
  assert.deepEqual(route.entries, before);
  assert.throws(() => route.shift(-1));

  route.clear();
  assert.deepEqual(route.entries, []);
  assert.equal(route.shift(0), false);
});

test("route directions map authored endpoint order in forward and reverse", () => {
  const route = new NativeProjectedRoute(3, [section(0, 1), section(1, 2)]);
  assert.equal(route.append(0, 1), true);
  assert.deepEqual(route.endpoints(route.entries[0]), [0, 1]);
  assert.equal(route.append(1, 0), true);
  assert.deepEqual(route.endpoints(route.entries[1]), [2, 1]);
  assert.equal(route.append(1, 1), true);
  assert.deepEqual(route.endpoints(route.entries[2]), [1, 2]);
});

test("native backing storage starts zeroed and clear preserves unused records", () => {
  const route = new NativeProjectedRoute(3, [section(0, 1), section(1, 2)]);
  for (let slot = 0; slot < 12; slot++)
    assert.deepEqual(route.storedEntry(slot), { section: 0, direction: 0 });
  route.append(1, 1);
  route.clear();
  assert.deepEqual(route.entries, []);
  assert.deepEqual(route.storedEntry(0), { section: 1, direction: 1 });
  const snapshot = route.storedEntry(0);
  snapshot.section = 0;
  assert.equal(route.storedEntry(0).section, 1);
  assert.throws(() => route.storedEntry(12));
  assert.throws(() => route.storedEntry(-1));
  assert.throws(() => route.storedEntry(0.5));
});

test("native shift copies unused backing records without clearing trailing slots", () => {
  const route = new NativeProjectedRoute(3, [section(0, 1), section(1, 2)]);
  for (let slot = 0; slot < 12; slot++) route.append(slot % 2, slot % 2);
  route.clear();
  route.append(0, 1);
  route.append(1, 0);
  const before = Array.from({ length: 12 }, (_, slot) =>
    route.storedEntry(slot),
  );
  assert.equal(route.shift(1), true);
  assert.deepEqual(route.entries, [before[1]]);
  for (let slot = 0; slot < 11; slot++)
    assert.deepEqual(route.storedEntry(slot), before[slot + 1]);
  assert.deepEqual(route.storedEntry(11), before[11]);
});

test("acquisition ID overwrite preserves directions and logical count", () => {
  const route = new NativeProjectedRoute(3, [section(0, 1), section(1, 2)]);
  route.append(0, 1);
  route.overwriteStoredSection(0, 1);
  route.overwriteStoredSection(11, 1);
  assert.deepEqual(route.entries, [{ section: 1, direction: 1 }]);
  assert.deepEqual(route.storedEntry(11), { section: 1, direction: 0 });
  assert.throws(() => route.overwriteStoredSection(12, 0));
  assert.throws(() => route.overwriteStoredSection(0, 2));
});

test("random top-up fills twelve for negative requests and adds bounded positive counts", () => {
  const ring = Array.from({ length: 14 }, (_, i) => section(i, (i + 1) % 14));
  const negative = new NativeProjectedRoute(14, ring);
  negative.append(0, 1);
  negative.topUpRandom(-5, false, () => 0);
  assert.equal(negative.entries.length, 12);
  assert.deepEqual(
    negative.entries.map(({ section: index, direction }) => [index, direction]),
    Array.from({ length: 12 }, (_, i) => [i, 1]),
  );

  const positive = new NativeProjectedRoute(14, ring);
  positive.append(0, 1);
  positive.topUpRandom(3, false, () => 0);
  assert.deepEqual(
    positive.entries.map(({ section: index, direction }) => [index, direction]),
    [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ],
  );
  positive.topUpRandom(99, false, () => 0);
  assert.equal(positive.entries.length, 12);
  assert.throws(() => positive.topUpRandom(0, false, () => 0));
  assert.throws(() => new NativeProjectedRoute(2, []).topUpRandom(-1, false));
});

test("top-up uses ordered incidences, excludes the prior section, and honors one-way/type-2 rules", () => {
  const sections = [
    section(1, 0), // seed, arrives at node 0
    section(3, 0, { oneWay: true }), // one-way points away from node 0
    section(0, 4, { oneWay: true }), // legal one-way exit
    section(0, 5, { type: 2 }), // cheat-only path
    section(0, 6, { type: 1 }), // ordinary path
  ];
  const ordinary = new NativeProjectedRoute(7, sections);
  ordinary.append(0, 1);
  ordinary.topUpRandom(1, false, () => 0);
  assert.deepEqual(ordinary.entries[1], { section: 2, direction: 1 });

  const cheating = new NativeProjectedRoute(7, sections);
  cheating.append(0, 1);
  cheating.topUpRandom(1, true, () => 0.5);
  assert.deepEqual(cheating.entries[1], { section: 3, direction: 1 });

  const priorOnly = new NativeProjectedRoute(2, [section(1, 0)]);
  priorOnly.append(0, 1);
  priorOnly.topUpRandom(1, false, () => 0);
  assert.deepEqual(priorOnly.entries[1], { section: 0, direction: 0 });
});

test("authored node incidence keeps first eight entries including self-loop duplicates", () => {
  const sections = [
    section(1, 0),
    section(0, 0), // contributes two ordered incidences at node 0
    section(0, 2),
    section(0, 3),
    section(0, 4),
    section(0, 5),
    section(0, 6),
    section(0, 7), // ninth incidence, omitted by native eight-slot storage
  ];
  const route = new NativeProjectedRoute(8, sections);
  route.append(0, 1);
  route.topUpRandom(1, false, () => 0.99999);
  assert.deepEqual(route.entries[1], { section: 6, direction: 1 });
});

test("selection follows the installed 15-bit inclusive random bucket mapping", () => {
  const sections = [section(1, 0), section(0, 2), section(0, 3), section(0, 4)];
  const choose = (sample) => {
    const route = new NativeProjectedRoute(5, sections);
    route.append(0, 1);
    route.topUpRandom(1, false, () => sample);
    return route.entries[1].section;
  };
  assert.equal(choose(0), 1);
  assert.equal(choose(10923 / 32768), 2);
  assert.equal(choose(21846 / 32768), 3);
  assert.equal(choose(32767 / 32768), 3);
  assert.throws(() => choose(1));
  assert.throws(() => choose(-0.01));
});

test("dead-end escape reverses an authored one-way section without rerolling", () => {
  const route = new NativeProjectedRoute(2, [section(0, 1, { oneWay: true })]);
  route.append(0, 1);
  let randomCalls = 0;
  route.topUpRandom(2, false, () => {
    randomCalls++;
    return 0;
  });
  assert.deepEqual(
    route.entries.map(({ section: index, direction }) => [index, direction]),
    [
      [0, 1],
      [0, 0],
      [0, 1],
    ],
  );
  assert.equal(randomCalls, 0);
});

test("native route quirks skip sole-choice RNG and special-case self-loops", () => {
  const soleChoice = new NativeProjectedRoute(3, [
    section(1, 0),
    section(0, 2),
  ]);
  soleChoice.append(0, 1);
  soleChoice.topUpRandom(1, false, () => {
    throw new Error("native does not sample a sole eligible section");
  });
  assert.deepEqual(soleChoice.entries[1], { section: 1, direction: 1 });

  const oneWayLoop = new NativeProjectedRoute(2, [
    section(1, 0),
    section(0, 0, { oneWay: true }),
  ]);
  oneWayLoop.append(0, 1);
  oneWayLoop.topUpRandom(1, false, () => {
    throw new Error("one-way self-loop is rejected as a departure");
  });
  assert.deepEqual(oneWayLoop.entries[1], { section: 0, direction: 0 });

  const bidirectionalLoop = new NativeProjectedRoute(2, [
    section(1, 0),
    section(0, 0),
  ]);
  bidirectionalLoop.append(0, 1);
  bidirectionalLoop.topUpRandom(1, false, () => 0);
  assert.deepEqual(bidirectionalLoop.entries[1], {
    section: 1,
    direction: 0,
  });
});

test("constructor and route entries reject invalid source structure", () => {
  assert.throws(() => new NativeProjectedRoute(-1, []));
  assert.throws(() => new NativeProjectedRoute(1.5, []));
  assert.throws(() => new NativeProjectedRoute(2, [section(0, 2)]));
  const route = new NativeProjectedRoute(2, [section(0, 1)]);
  assert.throws(() => route.append(-1, 1));
  assert.throws(() => route.append(0, 2));
  assert.throws(() => route.endpoints({ section: 0, direction: 2 }));
});
