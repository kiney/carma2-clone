import test from "node:test";
import assert from "node:assert/strict";
import { nativeTyreSkidRequests } from "../src/physics/tyre-skid.ts";

const f = Math.fround;

test("both over-capacity wheels request skid at the selected threshold", () => {
  assert.deepEqual(nativeTyreSkidRequests(21, 1, 1, 0.8, true), [true, true]);
  assert.deepEqual(nativeTyreSkidRequests(21, 1, 1, 0.8, false), [
    false,
    false,
  ]);
  assert.deepEqual(nativeTyreSkidRequests(61, 1, 1, 0.8, false), [true, true]);
});

test("the both-wheel quotient uses a live comparison and equality requests", () => {
  const demand = f(636.9285278320312);
  const cap0 = f(42.51016616821289);
  const cap1 = f(18.149690628051758);
  const liveQ = (demand + demand - cap0 - cap1) / f(cap0 + cap1);
  const storedNumerator = f(demand + demand - cap0 - cap1);
  const storedQ = storedNumerator / f(cap0 + cap1);
  assert.ok(liveQ >= 20);
  assert.ok(storedQ < 20);
  assert.deepEqual(nativeTyreSkidRequests(demand, cap0, cap1, 0.8, true), [
    true,
    true,
  ]);
});

test("exact quotient equality at 20 qualifies; demand equality does not", () => {
  assert.deepEqual(nativeTyreSkidRequests(21, 1, 1, 0.8, true), [true, true]);
  assert.deepEqual(nativeTyreSkidRequests(1, 1, 0.1, 0.8, true), [
    false,
    false,
  ]);
});

test("one-capacity cascade can request only the unsaturated partner", () => {
  const d = 9;
  const c0 = f(0.25),
    c1 = f(9.5),
    reduction = f(0.8);
  const first = f(reduction * c0);
  const residualLive = f(d) - first + f(d);
  const residualStored = f(residualLive);
  assert.ok(residualLive > c1);
  assert.ok(residualStored > c1);
  // In this asymmetric branch the quotient is below the native 20/60 gate.
  assert.deepEqual(nativeTyreSkidRequests(d, c0, c1, reduction, true), [
    false,
    false,
  ]);
  assert.deepEqual(nativeTyreSkidRequests(d, c0, c1, reduction, false), [
    false,
    false,
  ]);
});

test("asymmetric capacity selection mirrors the cascade to the other wheel", () => {
  const d = 9,
    c0 = f(9.5),
    c1 = f(0.25),
    reduction = f(0.8);
  const first = f(reduction * c1);
  const residualLive = f(d) - first + f(d);
  assert.ok(residualLive > c0);
  assert.deepEqual(nativeTyreSkidRequests(d, c0, c1, reduction, true), [
    false,
    false,
  ]);
});

test("both branch marks only capacities strictly above double 0.1", () => {
  const justOverDouble = f(0.1);
  assert.ok(justOverDouble > 0.1);
  assert.deepEqual(nativeTyreSkidRequests(100, 0, 1, 0.8, true), [false, true]);
  assert.deepEqual(nativeTyreSkidRequests(100, 0.1, 1, 0.8, true), [
    true,
    true,
  ]);
  assert.deepEqual(nativeTyreSkidRequests(100, 0, 0, 0.8, true), [
    false,
    false,
  ]);
});

test("stored residual rounds before its partner quotient", () => {
  const d = f(695.7943725585938);
  const firstCap = f(89.85733032226562),
    secondCap = f(1334.4501953125);
  const reduction = f(0.635880708694458);
  const allocated = f(reduction * firstCap);
  const residualLive = d - allocated + d;
  const residualStored = f(residualLive);
  assert.equal(residualStored, secondCap);
  assert.ok(residualLive > secondCap);
  assert.ok(residualLive <= secondCap * (1 + 1 / 1000));
  assert.deepEqual(
    nativeTyreSkidRequests(d, firstCap, secondCap, reduction, true),
    [false, false],
  );
});

test("input stores reject negative, nonfinite, and Float32-overflow values", () => {
  for (const args of [
    [-1, 1, 1, 0.8, true],
    [1, NaN, 1, 0.8, true],
    [1, 1, 1, Infinity, false],
    [Number.MAX_VALUE, 1, 1, 0.8, false],
  ])
    assert.throws(() => nativeTyreSkidRequests(...args));
});

test("a stored quotient at20 cannot replace a strictly smaller live quotient", () => {
  const cap0 = 1,
    cap1 = 1 + 2 ** -23;
  const live = (21 + 21 - cap0 - cap1) / f(cap0 + cap1);
  assert.ok(live < 20);
  assert.equal(f(live), 20);
  assert.deepEqual(nativeTyreSkidRequests(21, cap0, cap1, 0.8, true), [
    false,
    false,
  ]);
});

test("the adjacent Float32 capacity below double0.1 remains ineligible", () => {
  const below = f(0.1) - 2 ** -27;
  assert.ok(below < 0.1);
  assert.equal(f(below), below);
  assert.deepEqual(nativeTyreSkidRequests(100, below, f(0.1), 0.8, true), [
    false,
    true,
  ]);
});
