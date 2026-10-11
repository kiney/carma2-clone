import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { findNativeTrailSection } from "../src/ai/trail-nearest.ts";

const v = (x, y = 0, z = 0) => new Vector3(x, y, z);
const section = (a, b) => ({
  nodeIndices: [a, b],
  width: 0.5,
  minSpeed: [0, 0],
  maxSpeed: [255, 255],
  type: 0,
  oneWay: false,
});

test("native trail endpoint winner copies the opposite endpoint node", () => {
  const trail = [v(0), v(10)];
  // No projection is eligible outside the segment; global metadata is unused.
  const after = findNativeTrailSection(trail, v(11), [], []);
  assert.equal(after.section, 15000);
  assert.deepEqual(after.intersection.toArray(), [0, 0, 0]);
  assert.equal(after.distance, 11);
  const before = findNativeTrailSection(trail, v(-1), [], []);
  assert.deepEqual(before.intersection.toArray(), [10, 0, 0]);
  assert.equal(before.distance, 11);
});

test("projection selects trail geometry but finalizes against the global start node", () => {
  const result = findNativeTrailSection(
    [v(0), v(10)],
    v(5),
    [v(100), v(200)],
    [section(0, 1)],
  );
  assert.equal(result.sectionSlot, 0);
  assert.deepEqual(result.intersection.toArray(), [105, 0, 0]);
  assert.equal(result.distance, 100);
  // Stored score equality chooses projection, even at the trail endpoint.
  const tie = findNativeTrailSection(
    [v(0), v(10)],
    v(0),
    [v(100), v(200)],
    [section(0, 1)],
  );
  assert.deepEqual(tie.intersection.toArray(), [100, 0, 0]);
});

test("final distance is stored Float32 before the pursuit 20-unit gate", () => {
  const actor = v(0, Math.fround(0.0001));
  const result = findNativeTrailSection(
    [v(0), v(10)],
    actor,
    [v(20), v(30)],
    [section(0, 1)],
  );
  assert.ok(actor.distanceTo(result.intersection) > 20);
  assert.equal(result.distance, 20);
});

test("missing global projection metadata is rejected rather than replaced by trail nodes", () => {
  assert.throws(
    () => findNativeTrailSection([v(0), v(10)], v(5), [], []),
    /global section metadata/,
  );
  assert.throws(
    () => findNativeTrailSection([v(0), v(10)], v(5), [v(0)], [section(0, 9)]),
    /global section metadata/,
  );
  assert.throws(
    () => findNativeTrailSection([v(0)], v(0), [], []),
    /node count/,
  );
  assert.throws(
    () => findNativeTrailSection([v(0), v(3.5e38)], v(0), [], []),
    /geometry/,
  );
});
