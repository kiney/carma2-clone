import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  nativeRematerializationRetry as retry,
  nativeRematerializationVelocity as velocity,
} from "../src/ai/rematerialization.ts";

const position = new Vector3(1, 2, 3);
const row = new Vector3(0, 0, 1);
test("native placement retry order includes four repeated origins then signed forward/lateral offsets", () => {
  for (let i = 0; i < 4; i++)
    assert.deepEqual(retry(position, row, i).toArray(), [1, 2, 3]);
  assert.deepEqual(retry(position, row, 4).toArray(), [1, 2, 2.5]);
  assert.deepEqual(retry(position, row, 5).toArray(), [1, 2, 3.5]);
  assert.deepEqual(retry(position, row, 6).toArray(), [
    Math.fround(1 - Math.fround(0.1)),
    2,
    3,
  ]);
  assert.deepEqual(retry(position, row, 7).toArray(), [
    Math.fround(1 + Math.fround(0.1)),
    2,
    3,
  ]);
  assert.deepEqual(retry(position, row, 20).toArray(), [1, 2, 0.5]);
  assert.deepEqual(retry(position, row, 21).toArray(), [1, 4, 3]);
  assert.deepEqual(retry(position, row, 22).toArray(), [1, 6, 3]);
  assert.deepEqual(position.toArray(), [1, 2, 3]);
  assert.deepEqual(row.toArray(), [0, 0, 1]);
  assert.throws(() => retry(position, row, 23), /retry index/);
});

test("retry keeps normalized components live through the saved-position addition", () => {
  const result = retry(new Vector3(), new Vector3(1, 0, 6), 20);
  assert.equal(result.x, -0.4109974801540375);
  assert.notEqual(result.x, Math.fround(Math.fround(-1 / Math.sqrt(37)) * 2.5));
  assert.deepEqual(
    retry(new Vector3(), new Vector3(), 4).toArray(),
    [0.5, 0, 0],
  );
});

test("rematerialized model velocity preserves its upper-only cap and Float32 normalization boundary", () => {
  assert.deepEqual(velocity(row, 30).toArray(), [-0, -0, -10]);
  assert.deepEqual(velocity(row, -3).toArray(), [0, 0, 3]);
  assert.deepEqual(
    velocity(new Vector3(1, 2, 3), 7).toArray(),
    [-1.870828628540039, -3.741657257080078, -5.612486362457275],
  );
  assert.deepEqual(
    velocity(new Vector3(0, 0, 2 ** -22), 4).toArray(),
    [4, 0, 0],
  );
  assert.throws(() => velocity(row, Infinity), /speed/);
  assert.throws(() => retry(position, new Vector3(3.5e38, 0, 0), 4), /vector/);
});
