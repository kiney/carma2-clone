import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import {
  NativeCrashRecord,
  nativeCrashDirection,
  nativeCrashHeadOn,
  nativeCrashSpeedCache,
  nativeCrashViewerDirection,
} from "../src/physics/crash-record.ts";

const near = (actual, expected, tolerance = 1e-7) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );

function frontRecord({
  speed = 0.01,
  z = 0,
  direction = new Vector3(0, 0, -1),
} = {}) {
  const record = new NativeCrashRecord();
  record.firstContactFace = 0;
  record.normalizedContactZ = z;
  record.preSpeed = Math.fround(speed);
  record.preDirection.copy(direction);
  return record;
}

test("first cached movement stores epsilon, then later movement stores its horizontal norm", () => {
  const record = new NativeCrashRecord();
  const small = new Vector3(0.08, 100, 0.08);
  const trueHorizontal = Math.fround(Math.hypot(small.x, small.z) * 0.001);

  record.finishFrame(small);
  assert.equal(record.cachedSpeed, Math.fround(0.0001));
  near(record.cachedDirection.x, 0);
  near(record.cachedDirection.y, 0);
  near(record.cachedDirection.z, -1);

  record.finishFrame(small);
  assert.equal(record.cachedSpeed, trueHorizontal);
  assert.ok(record.cachedSpeed > Math.fround(0.0001));
  assert.deepEqual(
    record.cachedDirection.toArray(),
    nativeCrashDirection(small).toArray(),
  );
  assert.equal(nativeCrashSpeedCache(0, small), Math.fround(0.0001));
  assert.equal(
    nativeCrashSpeedCache(record.cachedSpeed, small),
    trueHorizontal,
  );
});

test("stationary rotated cars keep the prior forward hemisphere", () => {
  const record = new NativeCrashRecord();
  const orientation = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    Math.PI / 2,
  );
  const actorK = new Vector3(0, 0, 1).applyQuaternion(orientation);
  record.cachedDirection.copy(actorK);

  record.finishFrame(new Vector3(), orientation);

  near(record.cachedDirection.x, actorK.x);
  near(record.cachedDirection.z, actorK.z);
});

test("outer-frame snapshot copies the prior cached direction before resetting contact state", () => {
  const record = new NativeCrashRecord();
  record.cachedSpeed = 0.125;
  record.cachedDirection.set(0.6, 0, -0.8);
  record.firstContactFace = 2;
  record.accumulator = 7;

  record.beginFrame(false, new Vector3(2, 3, 4));

  assert.equal(record.preSpeed, Math.fround(0.125));
  assert.deepEqual(record.preDirection.toArray(), [0.6, 0, -0.8]);
  assert.deepEqual(record.localVelocity.toArray(), [2, 3, 4]);
  assert.equal(record.firstContactFace, 7);
  assert.equal(record.accumulator, 0);
});

test("viewer direction uses live interpolation arithmetic and Float32 normalized stores", () => {
  const original = new Vector3(1.0000001, 2, -3);
  const current = new Vector3(-0.25, 4, 1);
  const deltaMs = 37;
  const dt = deltaMs * Math.fround(0.025);
  const interpolated = new Vector3(
    (Math.fround(original.x) - Math.fround(current.x)) * dt +
      Math.fround(current.x),
    (Math.fround(original.y) - Math.fround(current.y)) * dt +
      Math.fround(current.y),
    (Math.fround(original.z) - Math.fround(current.z)) * dt +
      Math.fround(current.z),
  ).normalize();
  const expected = interpolated.toArray().map(Math.fround);
  assert.deepEqual(
    nativeCrashViewerDirection(original, current, deltaMs).toArray(),
    expected,
  );
  // An intermediate Float32 vector store changes Z by one ULP in this case.
  assert.deepEqual(
    expected,
    [0.25396230816841125, 0.6025035381317139, -0.756632387638092],
  );
  assert.deepEqual(
    nativeCrashViewerDirection(new Vector3(), new Vector3(), 12).toArray(),
    [1, 0, 0],
  );
});

test("head-on requires front faces, speeds strictly above Float32 .001 and dot strictly below Float32 -.7", () => {
  const a = frontRecord({ z: Math.fround(0.24999997) });
  const b = frontRecord({
    z: Math.fround(0.24999997),
    direction: new Vector3(0, 0, 1),
  });
  assert.equal(nativeCrashHeadOn(a, b), true);

  a.normalizedContactZ = Math.fround(0.25);
  b.normalizedContactZ = Math.fround(0.25);
  assert.equal(nativeCrashHeadOn(a, b), false, "Z=.25 keeps raw side face");
  a.normalizedContactZ = Math.fround(0.24999997);
  b.normalizedContactZ = Math.fround(0.24999997);

  a.preSpeed = Math.fround(0.001);
  assert.equal(nativeCrashHeadOn(a, b), false, "speed equality is rejected");
  a.preSpeed = Math.fround(0.01);
  a.preDirection.set(1, 0, 0);
  b.preDirection.set(-0.7, Math.sqrt(1 - 0.7 ** 2), 0);
  assert.equal(
    nativeCrashHeadOn(a, b),
    false,
    "Float32 dot equality is rejected",
  );
  b.preDirection.set(-0.7000001, 0, 0);
  assert.equal(nativeCrashHeadOn(a, b), true);
});
