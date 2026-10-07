import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { detachedChildCenterOfMass } from "../src/physics/detached-com.ts";
const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const transform = (position = v(), orientation = new Quaternion()) => ({
  position,
  orientation,
});
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test("detached COM shifts one quarter width toward the nearest car side", () => {
  const result = detachedChildCenterOfMass(
    v(-0.2, -0.2, -0.2),
    v(0.2, 0.2, 0.2),
    transform(v(1.8)),
    v(-2, -1, -3),
    v(2, 1, 3),
    transform(),
  );
  assert.equal(result.side, 1);
  near(result.centerOfMass.x, 0.1);
  near(result.centerOfMass.y, 0);
});
test("detached COM skips car bottom even when it is the nearest side", () => {
  const result = detachedChildCenterOfMass(
    v(-0.2, -0.2, -0.2),
    v(0.2, 0.2, 0.2),
    transform(),
    v(-1, -0.01, -3),
    v(1, 2, 3),
    transform(),
  );
  assert.equal(result.side, 0);
  near(result.centerOfMass.x, -0.1);
  near(result.centerOfMass.y, 0);
});
test("detached COM nearest-side search transforms the part center into car space", () => {
  const q = new Quaternion().setFromAxisAngle(v(0, 1), 0.7),
    parent = transform(v(10, 2, -3), q);
  const child = transform(v(1.6).applyQuaternion(q).add(parent.position), q);
  const result = detachedChildCenterOfMass(
    v(0, -0.2, -0.2),
    v(0.4, 0.2, 0.2),
    child,
    v(-2, -1, -3),
    v(2, 1, 3),
    parent,
  );
  assert.equal(result.side, 1);
  near(result.centerOfMass.x, 0.3);
});
