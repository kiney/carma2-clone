import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parseTrackConfig } from "../src/config.ts";
import { NativeTargetSectionSearch } from "../src/ai/target-search.ts";

const node = (x, y = 0, z = 0) => new Vector3(x, y, z);
const section = (node0, node1, options = {}) => ({
  nodeIndices: [node0, node1],
  minSpeed: [0, 0],
  maxSpeed: [255, 255],
  width: 1,
  type: options.type ?? 0,
  oneWay: options.oneWay ?? false,
});

test("search reports first improving path, then stops on the second improvement even when not globally shortest", () => {
  // The authored first branch is length 5; the second improving branch is 2.
  // A still-shorter branch authored afterward proves the native second-hit stop.
  const nodes = [
    node(0),
    node(1),
    node(6),
    node(1.25),
    node(1.2),
    node(1.01),
    node(1.19),
  ];
  const sections = [
    section(0, 1),
    section(1, 2),
    section(1, 3),
    section(2, 4), // target: first path is long
    section(3, 4), // second route is cheaper
    section(1, 5),
    section(5, 6),
    section(6, 4), // later, shorter path is not searched after hit two
  ];
  const search = new NativeTargetSectionSearch(nodes, sections);
  const result = search.search({ section: 0, direction: 1 }, 3);
  assert.equal(result.improvements, 2);
  assert.deepEqual(result.entries, [
    { section: 0, direction: 1 },
    { section: 2, direction: 1 },
    { section: 4, direction: 1 },
    { section: 3, direction: 0 },
  ]);
  assert.equal(
    result.cost,
    Math.fround(Math.fround(0.25) + Math.fround(0.05) + Math.fround(4.8)),
  );
});

test("first target improvement at current depth returns before later authored siblings", () => {
  const nodes = [node(0), node(1), node(3), node(2), node(1.5)];
  const sections = [
    section(0, 1),
    section(1, 3), // target appears first and costs 2
    section(1, 2),
    section(2, 3), // would provide a shorter target path if root continued
  ];
  const result = new NativeTargetSectionSearch(nodes, sections).search(
    { section: 0, direction: 1 },
    1,
  );
  assert.equal(result.improvements, 1);
  assert.deepEqual(result.entries, [
    { section: 0, direction: 1 },
    { section: 1, direction: 1 },
  ]);
  assert.equal(result.cost, 1);
});

test("seed section is not tested as a target, but its eligible reversal is", () => {
  const search = new NativeTargetSectionSearch(
    [node(0), node(4)],
    [section(0, 1)],
  );
  const result = search.search({ section: 0, direction: 1 }, 0);
  assert.equal(result.improvements, 1);
  assert.deepEqual(result.entries, [
    { section: 0, direction: 1 },
    { section: 0, direction: 0 },
  ]);
  const blocked = new NativeTargetSectionSearch(
    [node(0), node(4)],
    [section(0, 1, { oneWay: true })],
  ).search({ section: 0, direction: 1 }, 0);
  assert.equal(blocked.improvements, 0);
  assert.deepEqual(blocked.entries, []);
});

test("depth is capped at seed plus nine candidates", () => {
  const nodes = Array.from({ length: 12 }, (_, index) => node(index));
  const sections = Array.from({ length: 11 }, (_, index) =>
    section(index, index + 1),
  );
  const search = new NativeTargetSectionSearch(nodes, sections);
  const atLimit = search.search({ section: 0, direction: 1 }, 9);
  assert.equal(atLimit.entries.length, 10);
  assert.equal(atLimit.entries.at(-1).section, 9);
  const beyond = search.search({ section: 0, direction: 1 }, 10);
  assert.deepEqual(beyond.entries, []);
  assert.equal(beyond.cost, 3.4028234663852886e38);
});

test("directional, one-way and type-two restrictions gate candidates, with cheating bypassing type only", () => {
  const nodes = [node(0), node(1), node(2)];
  const sections = [section(0, 1), section(1, 2, { type: 2 })];
  const search = new NativeTargetSectionSearch(nodes, sections);
  assert.equal(search.search({ section: 0, direction: 1 }, 1).improvements, 0);
  const cheat = search.search({ section: 0, direction: 1 }, 1, true);
  assert.deepEqual(cheat.entries, [
    { section: 0, direction: 1 },
    { section: 1, direction: 1 },
  ]);
  const reverseOnly = new NativeTargetSectionSearch(
    [node(0), node(1)],
    [section(0, 1), section(0, 1, { oneWay: true })],
  );
  assert.equal(
    reverseOnly.search({ section: 0, direction: 1 }, 1).improvements,
    0,
  );
});

test("only first eight authored incidences per node participate, including both self-loop slots", () => {
  const nodes = [
    node(0),
    node(1),
    node(2),
    node(3),
    node(4),
    node(5),
    node(6),
    node(7),
    node(8),
    node(9),
  ];
  const sections = [
    section(0, 1),
    ...Array.from({ length: 8 }, (_, index) => section(1, index + 2)),
  ];
  const result = new NativeTargetSectionSearch(nodes, sections).search(
    { section: 0, direction: 1 },
    8,
  );
  assert.equal(result.improvements, 0);
  assert.deepEqual(result.entries, []);

  const selfLoopNodes = Array.from({ length: 10 }, (_, index) => node(index));
  const selfLoopSections = [
    section(0, 1),
    section(1, 1),
    ...Array.from({ length: 6 }, (_, index) => section(1, index + 2)),
  ];
  const withSelfLoop = new NativeTargetSectionSearch(
    selfLoopNodes,
    selfLoopSections,
  ).search({ section: 0, direction: 1 }, 7);
  assert.equal(
    withSelfLoop.improvements,
    0,
    "both self-loop incidences consume slots",
  );
});

test("strict Float32 cumulative cost ties do not create improvements, and each call resets prior DFS marks", () => {
  const nodes = [node(0), node(1), node(2), node(3)];
  const sections = [section(0, 1), section(1, 2), section(1, 3), section(2, 3)];
  const search = new NativeTargetSectionSearch(nodes, sections);
  const tied = search.search({ section: 0, direction: 1 }, 3);
  assert.equal(tied.improvements, 1);
  assert.deepEqual(tied.entries, [
    { section: 0, direction: 1 },
    { section: 1, direction: 1 },
    { section: 3, direction: 1 },
  ]);
  const noPath = search.search({ section: 0, direction: 1 }, 0);
  assert.equal(noPath.improvements, 1);
  assert.deepEqual(noPath.entries, [
    { section: 0, direction: 1 },
    { section: 0, direction: 0 },
  ]);
});

test("cached native lengths use Float32 endpoints and cumulative costs round after each addition", () => {
  const nodes = [node(0), node(0.1), node(0.2), node(0.3)];
  const result = new NativeTargetSectionSearch(nodes, [
    section(0, 1),
    section(1, 2),
    section(2, 3),
  ]).search({ section: 0, direction: 1 }, 2);
  const firstLength = Math.fround(
    Math.sqrt((Math.fround(0.2) - Math.fround(0.1)) ** 2),
  );
  const secondLength = Math.fround(
    Math.sqrt((Math.fround(0.3) - Math.fround(0.2)) ** 2),
  );
  assert.equal(result.cost, Math.fround(firstLength + secondLength));
});

test("malformed section references, invalid seeds and nonfinite nodes are rejected", () => {
  assert.throws(
    () => new NativeTargetSectionSearch([node(0)], [section(0, 1)]),
  );
  assert.throws(() => new NativeTargetSectionSearch([node(NaN)], []));
  const search = new NativeTargetSectionSearch(
    [node(0), node(1)],
    [section(0, 1)],
  );
  assert.throws(() => search.search({ section: 0, direction: 2 }, 0));
  assert.throws(() => search.search({ section: 1, direction: 0 }, 0));
  assert.throws(() => search.search({ section: 0, direction: 1 }, 1));
});

test("installed Stock and Advanced graphs produce bounded directed target routes", async (t) => {
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original installation is absent");
    return;
  }
  const assets = await createAssetStore();
  for (const path of [
    "data/RACES/newcity1/newcity1.txt",
    "adv_data/RACES/AcidReign/AcidReign.txt",
  ]) {
    const bytes = await assets.read(path);
    assert.ok(bytes, path);
    const track = parseTrackConfig(decodeText(bytes));
    const nodes = track.pathNodes.map((point) => new Vector3(...point));
    const search = new NativeTargetSectionSearch(nodes, track.pathSections);
    let found = 0;
    for (const target of [0, 1, Math.min(20, track.pathSections.length - 1)]) {
      const result = search.search({ section: 0, direction: 1 }, target);
      assert.ok(result.entries.length <= 10, path);
      assert.ok(result.improvements <= 2, path);
      if (!result.entries.length) continue;
      found++;
      assert.equal(result.entries.at(-1).section, target, path);
      let finish = track.pathSections[0].nodeIndices[1];
      for (const entry of result.entries.slice(1)) {
        const section = track.pathSections[entry.section];
        assert.equal(section.nodeIndices[1 - entry.direction], finish, path);
        assert.ok(!section.oneWay || entry.direction === 1, path);
        assert.notEqual(section.type, 2, path);
        finish = section.nodeIndices[entry.direction];
      }
      assert.ok(Number.isFinite(result.cost) && result.cost >= 0, path);
    }
    assert.ok(found > 0, `${path}: at least one local target is reachable`);
  }
});
