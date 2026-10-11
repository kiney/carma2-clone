import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { nativePointVisible } from "../src/world-visibility.ts";
const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const camera = { position: v(), backwards: v(0, 0, 1), yon: 10 };
test("native GROOVE constant range is strict and uses only camera half-space", () => {
  assert.equal(nativePointVisible(v(0, 0, -6), 36, { camera }), false);
  assert.equal(nativePointVisible(v(0, 0, -5.99), 36, { camera }), true);
  assert.equal(nativePointVisible(v(0, 0, 1), 36, { camera }), false);
  assert.equal(nativePointVisible(v(1, 0, 0), 36, { camera }), false);
  // No horizontal field-of-view gate exists in PointOutOfSight.
  assert.equal(nativePointVisible(v(5, 0, -0.1), 36, { camera }), true);
});
test("zero max distance selects camera yon squared and explicit range overrides it", () => {
  assert.equal(nativePointVisible(v(0, 0, -9), 0, { camera }), true);
  assert.equal(nativePointVisible(v(0, 0, -10), 0, { camera }), false);
  assert.equal(nativePointVisible(v(0, 0, -11), 144, { camera }), true);
});
test("rearview and extra-render cameras preserve native distinct direction rules", () => {
  const mirror = { ...camera, backwards: v(0, 0, -1) };
  assert.equal(nativePointVisible(v(0, 0, 2), 36, { camera, mirror }), true);
  assert.equal(nativePointVisible(v(5, 0, 0), 36, { camera, mirror }), false);
  assert.equal(
    nativePointVisible(v(0, 0, 2), 36, { camera, extraRenders: [camera] }),
    true,
  );
  assert.equal(
    nativePointVisible(v(0, 0, 6), 36, { camera, extraRenders: [camera] }),
    false,
  );
});
test("native point visibility rejects nonfinite stored values", () => {
  assert.throws(
    () => nativePointVisible(v(Infinity), 36, { camera }),
    /vector/,
  );
  assert.throws(() => nativePointVisible(v(), Infinity, { camera }), /range/);
  assert.throws(
    () => nativePointVisible(v(), 0, { camera: { ...camera, yon: NaN } }),
    /yon/,
  );
});
