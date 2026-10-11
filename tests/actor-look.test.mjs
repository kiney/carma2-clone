import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { nativeActorLookUp } from "../src/ai/actor-look.ts";

const closeVector = (actual, expected, epsilon = 1e-6) => {
  assert.ok(actual.distanceTo(expected) <= epsilon, `${actual} != ${expected}`);
};

test("PointActorAlongThisBloodyVector points local +Z opposite the look vector", () => {
  const position = new Vector3(12.25, -3.5, 8.75);
  const alongX = nativeActorLookUp(new Vector3(1, 0, 0), position);
  closeVector(alongX.z, new Vector3(-1, 0, 0));
  closeVector(alongX.x, new Vector3(0, 0, 1));
  closeVector(alongX.y, new Vector3(0, 1, 0));
  closeVector(new Vector3().setFromMatrixPosition(alongX.matrix), position);

  const alongZ = nativeActorLookUp(new Vector3(0, 0, 1), position);
  closeVector(alongZ.z, new Vector3(0, 0, -1));
  closeVector(alongZ.x, new Vector3(-1, 0, 0));
  closeVector(alongZ.y, new Vector3(0, 1, 0));
});

test("oblique look produces an orthonormal right-handed basis", () => {
  const result = nativeActorLookUp(
    new Vector3(3, 4, -2),
    new Vector3(0.1, 0.2, 0.3),
  );
  for (const axis of [result.x, result.y, result.z])
    assert.ok(Math.abs(axis.length() - 1) < 2e-7);
  assert.ok(Math.abs(result.x.dot(result.y)) < 2e-7);
  assert.ok(Math.abs(result.y.dot(result.z)) < 2e-7);
  assert.ok(Math.abs(result.z.dot(result.x)) < 2e-7);
  closeVector(new Vector3().crossVectors(result.x, result.y), result.z);
  assert.ok(Math.abs(result.quaternion.length() - 1) < 2e-7);
});

test("zero and vertical look vectors follow native normalization fallbacks", () => {
  const zero = nativeActorLookUp(new Vector3(), new Vector3());
  closeVector(zero.z, new Vector3(-1, 0, 0));
  closeVector(zero.x, new Vector3(0, 0, 1));
  closeVector(zero.y, new Vector3(0, 1, 0));

  const vertical = nativeActorLookUp(
    new Vector3(0, 1, 0),
    new Vector3(1, 2, 3),
  );
  closeVector(vertical.z, new Vector3(0, -1, 0));
  closeVector(vertical.x, new Vector3(1, 0, 0));
  closeVector(vertical.y, new Vector3(0, 0, 1));
});

test("2^-22 normalization threshold is inclusive and inputs remain unchanged", () => {
  const boundary = 2 ** -22;
  const look = new Vector3(0, boundary, 0);
  const originalLook = look.clone();
  const exact = nativeActorLookUp(look, new Vector3());
  closeVector(exact.z, new Vector3(-1, 0, 0));
  closeVector(look, originalLook, 0);

  const above = nativeActorLookUp(
    new Vector3(0, Math.fround(boundary * (1 + 2 ** -23)), 0),
    new Vector3(),
  );
  closeVector(above.z, new Vector3(0, -1, 0));
  closeVector(above.x, new Vector3(1, 0, 0));
});

test("nonfinite vectors are rejected", () => {
  assert.throws(
    () => nativeActorLookUp(new Vector3(Number.NaN, 0, 0), new Vector3()),
    /Invalid actor look transform/,
  );
  assert.throws(
    () => nativeActorLookUp(new Vector3(1, 0, 0), new Vector3(0, Infinity, 0)),
    /Invalid actor look transform/,
  );
  assert.throws(
    () => nativeActorLookUp(new Vector3(3.5e38, 0, 0), new Vector3()),
    /Float32 bounds/,
  );
  assert.throws(
    () => nativeActorLookUp(new Vector3(1, 0, 0), new Vector3(0, 3.5e38, 0)),
    /Float32 bounds/,
  );
});

test("LOOK_UP cross-axis normalization reloads the Float32 length", () => {
  const result = nativeActorLookUp(
    new Vector3(0.21511998772621155, -0.9364566802978516, 0.5226872563362122),
    new Vector3(),
  );
  // Installed53105e stores the cross length before reciprocal. A generic
  // live-length normalizer differs by one ULP in both nonzero components.
  assert.deepEqual(
    result.x.toArray(),
    [-0.9247429370880127, 0, 0.3805921971797943],
  );
});
