import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parseTrackConfig } from "../src/config.ts";

const track = (body) => `START OF OPPONENT PATHS
3 // path nodes
0, 0, 0
1, 0, 0
2, 0, 0
${body}
END OF OPPONENT PATHS`;

test("path sections preserve authored fields with native integer and float casts", () => {
  const parsed = parseTrackConfig(
    track(`2 // path sections
0.9, 1.8, 5.9, 255.99999999, 6.1, 257.2, 1.23456789, 1000.99999999
1, 2, 8.9, 9.9, 10.9, 11.9, 0.75, 2.9
0 // cop starts`),
  );
  assert.deepEqual(parsed.pathSections, [
    {
      nodeIndices: [0, 1],
      minSpeed: [5, 6],
      maxSpeed: [0, 1],
      width: Math.fround(1.23456789),
      type: 1,
      oneWay: true,
    },
    {
      nodeIndices: [1, 2],
      minSpeed: [8, 10],
      maxSpeed: [9, 11],
      width: 0.75,
      type: 2,
      oneWay: false,
    },
  ]);
  assert.deepEqual(parsed.pathEdges, [
    [0, 1],
    [1, 2],
  ]);
});

test("section numeric scalars round to Float32 before native integer casts", () => {
  const boundaryType = parseTrackConfig(
    track(`1\n0, 1, 0, 255, 0, 255, 1, 1000.99999999`),
  ).pathSections[0];
  assert.equal(boundaryType.oneWay, true);
  assert.equal(boundaryType.type, 1);

  // The authored double is just below node index 2, but GetNScalars first
  // rounds it to Float32 2.0; its resulting node reference is out of bounds.
  const nearBoundary = `START OF OPPONENT PATHS
2
0,0,0
1,0,0
1
0,1.99999999,0,255,0,255,1,1
END OF OPPONENT PATHS`;
  assert.throws(() => parseTrackConfig(nearBoundary));

  const roundedNode = parseTrackConfig(
    `START OF OPPONENT PATHS
1
1.23456789,0,0
0
END OF OPPONENT PATHS`,
  );
  assert.deepEqual(roundedNode.pathNodes[0], [Math.fround(1.23456789), 0, 0]);
});

test("absent opponent path blocks retain empty navigation arrays", () => {
  const parsed = parseTrackConfig("VERSION 1\n12,0,4\n90\n");
  assert.deepEqual(parsed.pathNodes, []);
  assert.deepEqual(parsed.pathEdges, []);
  assert.deepEqual(parsed.pathSections, []);
});

test("present path blocks reject invalid counts, truncated rows, and bad references", () => {
  for (const malformed of [
    "1.5\n0,0,0\n0",
    "65537\n0,0,0\n0",
    "1\n0,0\n0",
    "1\n0,0,0\n0.5",
    "1\n0,0,0\n1\n0,0,1,2,3,4,1",
    "1\n0,0,0\n1\n0,3,1,2,3,4,1,1",
    "1\n0,0,0\n1\nNaN,0,1,2,3,4,1,1",
    "1\n0,0,0\n1\n0,0,1,2,3,4,3.5e38,1",
    "1\n3.5e38,0,0\n0",
  ])
    assert.throws(
      () => parseTrackConfig(track(malformed)),
      undefined,
      malformed,
    );
  assert.throws(() => parseTrackConfig(`START OF OPPONENT PATHS\n0\n0\n0`));
});

test("installed Stock and Advanced tracks retain section data", async (t) => {
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original installation is absent");
    return;
  }
  const assets = await createAssetStore();
  for (const [path, first] of [
    ["data/RACES/newcity1/newcity1.txt", [0, 1]],
    ["adv_data/RACES/AcidReign/AcidReign.txt", [0, 34]],
  ]) {
    const bytes = await assets.read(path);
    assert.ok(bytes, `installed track exists: ${path}`);
    const parsed = parseTrackConfig(decodeText(bytes));
    assert.ok(parsed.pathSections.length > 0, path);
    assert.deepEqual(parsed.pathSections[0].nodeIndices, first, path);
    assert.equal(parsed.pathEdges.length, parsed.pathSections.length, path);
    assert.ok(
      parsed.pathSections.every((section) => Number.isFinite(section.width)),
    );
  }
  const advanced = parseTrackConfig(
    decodeText(await assets.read("adv_data/RACES/AcidReign/AcidReign.txt")),
  );
  assert.ok(advanced.pathSections.some((section) => section.oneWay));
});
