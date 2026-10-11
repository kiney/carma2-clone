import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  NativeCrashRecord,
  nativeCrashSpeedCache,
} from "../src/physics/crash-record.ts";

test("native speed cache guards first movement sample and ignores vertical/forward sign", () => {
  const velocity = new Vector3(3, 100, -4);
  const first = nativeCrashSpeedCache(0, velocity);
  assert.equal(first, Math.fround(0.0001));
  assert.equal(
    nativeCrashSpeedCache(first, velocity),
    Math.fround(5 * Math.fround(0.001)),
  );
  assert.equal(nativeCrashSpeedCache(1, new Vector3(0, 100, 0)), 0);
  assert.equal(
    nativeCrashSpeedCache(1, new Vector3(-3, 0, 4)),
    nativeCrashSpeedCache(1, velocity),
  );
});

test("speed cache threshold equality is strict and snapshot retains the previous completed frame", () => {
  const record = new NativeCrashRecord();
  record.cachedSpeed = Math.fround(0.0001);
  record.beginFrame(false, new Vector3(1, 2, 3));
  assert.equal(record.preSpeed, Math.fround(0.0001));
  record.finishFrame(new Vector3(0, 0, 10));
  assert.equal(record.preSpeed, Math.fround(0.0001));
  assert.equal(record.cachedSpeed, Math.fround(10 * Math.fround(0.001)));
  record.beginFrame(true, new Vector3(4, 5, 6));
  assert.equal(record.preSpeed, Math.fround(10 * Math.fround(0.001)));
  assert.equal(record.frameKnackered, true);
  assert.deepEqual(record.localVelocity.toArray(), [4, 5, 6]);
});

test("damage cleanup preserves first contact across substeps, frame reset preserves stale normalized Z", () => {
  const record = new NativeCrashRecord();
  const bounds = { min: [-1, -1, -1], max: [1, 1, 1] };
  record.beginFrame(false, new Vector3());
  record.recordCarContact(new Vector3(1, 0, 0.5), bounds);
  assert.equal(record.firstContactFace, 3);
  assert.equal(record.normalizedContactZ, 0.75);
  record.accumulate(new Vector3(0.2, 0.4, 0.6), false);
  assert.ok(record.accumulator > 0.55 && record.accumulator < 0.57);
  record.clearAcceptedDamage();
  record.recordCarContact(new Vector3(0, 0, -1), bounds);
  assert.equal(record.firstContactFace, 3);
  record.beginFrame(false, new Vector3());
  assert.equal(record.firstContactFace, 7);
  assert.equal(record.normalizedContactZ, 0.75);
  record.recordCarContact(new Vector3(0, 0, -1), bounds);
  assert.equal(record.firstContactFace, 4);
  assert.equal(record.normalizedContactZ, 1);
});

test("invulnerability bypasses accumulator, cumulative damage crosses Float32 stores", () => {
  const record = new NativeCrashRecord();
  record.accumulate(new Vector3(100, 100, 100), true);
  assert.equal(record.accumulator, 0);
  record.accumulate(new Vector3(1, 2, 3), false);
  record.accumulate(new Vector3(4, 5, 6), false);
  assert.equal(record.accumulator, 91);
  assert.throws(() => nativeCrashSpeedCache(-1, new Vector3()), /cache/);
  assert.throws(
    () => record.beginFrame(false, new Vector3(Infinity, 0, 0)),
    /Float32/,
  );
});

test("native accumulation rounds squared magnitude before adding the old accumulator", () => {
  const record = new NativeCrashRecord();
  record.accumulator = 2 ** -24;
  record.accumulate(new Vector3(1, 2 ** -12, 0), false);
  assert.equal(record.accumulator, 1);
  assert.notEqual(record.accumulator, Math.fround(2 ** -24 + 1 + 2 ** -24));
  record.accumulator = 2.657595634460449;
  record.accumulate(
    new Vector3(0.6828692555427551, 0.22434328496456146, 0.2378229796886444),
    false,
  );
  assert.equal(record.accumulator, 3.2307958602905273);
});
