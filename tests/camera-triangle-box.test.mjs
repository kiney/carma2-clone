import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { cameraTriangleInBox } from "../src/camera/triangle-box.ts";
const v = (x, y, z = 0) => new Vector3(x, y, z);
const min = v(-1, -1, -1),
  max = v(1, 1, 1);
test("camera box picking clips real triangle rather than accepting its AABB", () => {
  assert.equal(
    cameraTriangleInBox([v(0, 0), v(0.5, 0), v(0, 0.5)], min, max),
    true,
  );
  assert.equal(
    cameraTriangleInBox([v(0, 3), v(3, 0), v(3, 3)], min, max),
    false,
  );
  assert.equal(
    cameraTriangleInBox([v(-3, 0), v(3, 0), v(0, 3)], min, max),
    true,
  );
  assert.equal(
    cameraTriangleInBox([v(-3, 0, 2), v(3, 0, 2), v(0, 3, 2)], min, max),
    false,
  );
  assert.equal(
    cameraTriangleInBox([v(-1, -1, 1), v(1, -1, 1), v(0, 1, 1)], min, max),
    true,
  );
});
test("camera triangle box picker rejects malformed binary-derived coordinates", () => {
  assert.throws(
    () => cameraTriangleInBox([v(0, 0), v(0, 1), v(NaN, 0)], min, max),
    /finite/,
  );
  assert.throws(
    () => cameraTriangleInBox([v(0, 0), v(0, 1), v(1, 0)], max, min),
    /bounds/,
  );
});

test("camera query preserves installed minimum/maximum tangent asymmetry", () => {
  assert.equal(
    cameraTriangleInBox([v(-1, 0), v(0, 0), v(0, 1)], v(0, -1, -1), max),
    false,
  );
  assert.equal(
    cameraTriangleInBox([v(1, 0), v(0, 0), v(0, 1)], min, v(0, 1, 1)),
    true,
  );
});
