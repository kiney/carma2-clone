import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateNativeQuietLeaf,
  foldNativeQuietHierarchy,
  canSleepNativeQuietGroup,
  collectNativeCollisionFlags,
} from "../src/physics/quiet-state.ts";

const f = Math.fround;
function adjacent(value, step) {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value);
  view.setUint32(0, view.getUint32(0) + step);
  return view.getFloat32(0);
}
const base = {
  previousQuietState: 0,
  singleton: true,
  collisionFlags: 1,
  doNothing: false,
  beforeWorldVelocity: [0, -0.05, 0],
  worldVelocity: [0, 0, 0],
  beforeLocalOmega: [0, 0, 0],
  localOmega: [0, 0, 0],
  localVelocity: [0, 0, 0],
  gravityIncrement: [0, -0.05, 0],
  mass: 1,
  inertia: [1, 1, 1],
  bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
  centreOfMass: [0, 0, 0],
  jointInfoOrientationY: null,
};
const retained = { ...base, previousQuietState: 3, singleton: false };

test("fresh grounded leaf zeros only source velocity fields without mutating input", () => {
  const result = evaluateNativeQuietLeaf(base);
  assert.equal(result.quietEligible, true);
  assert.equal(result.quietState, 3);
  assert.deepEqual(result.zeroVelocities, {
    worldVelocity: [0, 0, 0],
    localOmega: [0, 0, 0],
    auxiliaryLocalOmega: [0, 0, 0],
  });
  assert.deepEqual(base.beforeWorldVelocity, [0, -0.05, 0]);
  const rejected = evaluateNativeQuietLeaf({
    ...base,
    beforeWorldVelocity: [0, 0, 0],
  });
  assert.equal(rejected.gate, "gravity-response");
  assert.equal(rejected.zeroVelocities, null);
});
test("linear squared speed uses strict double .001 boundary", () => {
  const below = f(Math.sqrt(0.001));
  assert.equal(
    evaluateNativeQuietLeaf({ ...retained, worldVelocity: [below, 0, 0] })
      .quietEligible,
    true,
  );
  assert.equal(
    evaluateNativeQuietLeaf({
      ...retained,
      worldVelocity: [adjacent(below, 1), 0, 0],
    }).gate,
    "linear-speed",
  );
});
test("angular gate uses before-plus-after, inertia/mass and strict double .00009", () => {
  const below = adjacent(f(0.00009), -1);
  assert.equal(
    evaluateNativeQuietLeaf({
      ...retained,
      inertia: [below, 1, 1],
      beforeLocalOmega: [1, 0, 0],
    }).quietEligible,
    true,
  );
  assert.equal(
    evaluateNativeQuietLeaf({
      ...retained,
      inertia: [f(0.00009), 1, 1],
      beforeLocalOmega: [1, 0, 0],
    }).gate,
    "angular-energy",
  );
  const cancelled = evaluateNativeQuietLeaf({
    ...retained,
    beforeLocalOmega: [-1, 0, 0],
    localOmega: [1, 0, 0],
  });
  assert.equal(cancelled.angularEnergy, 0);
  assert.equal(cancelled.quietEligible, true);
  assert.equal(
    evaluateNativeQuietLeaf({ ...retained, localOmega: [0.012, 0, 0] }).gate,
    "angular-energy",
  );
  assert.equal(
    evaluateNativeQuietLeaf({ ...retained, mass: 2, localOmega: [0.012, 0, 0] })
      .quietEligible,
    true,
  );
});
test("upward speed is strictly below f32 .012", () => {
  assert.equal(
    evaluateNativeQuietLeaf({
      ...base,
      worldVelocity: [0, adjacent(f(0.012), -1), 0],
    }).quietEligible,
    true,
  );
  assert.equal(
    evaluateNativeQuietLeaf({ ...base, worldVelocity: [0, f(0.012), 0] }).gate,
    "upward-speed",
  );
});
test("gravity response is strictly greater than f32 .9 times stored magnitude", () => {
  const before = f(0.09),
    input = { ...base, gravityIncrement: [0, -0.1, 0] };
  assert.equal(
    evaluateNativeQuietLeaf({ ...input, beforeWorldVelocity: [0, -before, 0] })
      .quietEligible,
    true,
  );
  assert.equal(
    evaluateNativeQuietLeaf({
      ...input,
      beforeWorldVelocity: [0, -adjacent(before, -1), 0],
    }).gate,
    "gravity-response",
  );
  // Normal is derived from the supplied vector; it is not hard-coded world Y.
  assert.equal(
    evaluateNativeQuietLeaf({
      ...base,
      gravityIncrement: [-0.05, 0, 0],
      beforeWorldVelocity: [-0.05, 0, 0],
    }).quietEligible,
    true,
  );
});
test("all-corner squared speed uses f32 .0004 and preserves the plus-COM expression", () => {
  assert.equal(
    evaluateNativeQuietLeaf({ ...base, localVelocity: [0, f(0.02), 0] })
      .quietEligible,
    true,
  );
  assert.equal(
    evaluateNativeQuietLeaf({
      ...base,
      localVelocity: [0, adjacent(f(0.02), 1), 0],
    }).gate,
    "corner-speed",
  );
  const offCentre = {
    ...base,
    inertia: [0.01, 0.01, 0.01],
    localOmega: [0, 0, 0.008],
    centreOfMass: [1, 0, 0],
    bounds: { min: [1, 0, -1], max: [2, 1, 1] },
  };
  const reject = evaluateNativeQuietLeaf(offCentre);
  assert.equal(reject.gate, "corner-speed");
  assert.equal(reject.rejectedCorner, 0); // max/max/max is evaluated first.
  assert.equal(
    evaluateNativeQuietLeaf({ ...offCentre, localVelocity: [0, -f(0.008), 0] })
      .quietEligible,
    true,
  );
});
test("retained quiet state bypasses fresh checks but singleton and collision flag differ", () => {
  const moving = {
    ...retained,
    collisionFlags: 0,
    worldVelocity: [2, 0, 0],
    beforeWorldVelocity: [0, 0, 0],
    localVelocity: [5, 0, 0],
  };
  const result = evaluateNativeQuietLeaf(moving);
  assert.equal(result.quietEligible, true);
  assert.equal(result.linearSpeedSquared, 0);
  assert.equal(
    evaluateNativeQuietLeaf({ ...moving, singleton: true }).gate,
    "linear-speed",
  );
  assert.equal(
    evaluateNativeQuietLeaf({ ...moving, collisionFlags: 1 }).gate,
    "linear-speed",
  );
  assert.equal(
    evaluateNativeQuietLeaf({ ...moving, localOmega: [1, 0, 0] }).gate,
    "angular-energy",
  );
});
test("zero gravity's unordered x87 comparisons pass only the two gravity gates", () => {
  const zeroG = {
    ...base,
    gravityIncrement: [0, 0, 0],
    beforeWorldVelocity: [0, 0, 0],
  };
  const result = evaluateNativeQuietLeaf(zeroG);
  assert.equal(result.gravityComparisonUnordered, true);
  assert.equal(result.quietEligible, true);
  assert.equal(
    evaluateNativeQuietLeaf({ ...zeroG, localVelocity: [0, 0.03, 0] }).gate,
    "corner-speed",
  );
  assert.equal(
    evaluateNativeQuietLeaf({
      ...zeroG,
      collisionFlags: 0,
      jointInfoOrientationY: 0.9,
    }).gate,
    "joint-without-contact",
  );
});
test("joint-info orientation gate is separate from intact simple pedestrian state", () => {
  const input = { ...retained, collisionFlags: 0 };
  assert.equal(
    evaluateNativeQuietLeaf({ ...input, jointInfoOrientationY: 0.9989 }).gate,
    "joint-without-contact",
  );
  assert.equal(
    evaluateNativeQuietLeaf({ ...input, jointInfoOrientationY: f(0.999) })
      .quietEligible,
    true,
  );
  assert.equal(
    evaluateNativeQuietLeaf({
      ...input,
      jointInfoOrientationY: 0.9,
      collisionFlags: 2,
    }).quietEligible,
    true,
  );
  const dormant = evaluateNativeQuietLeaf({ ...retained, doNothing: true });
  assert.equal(dormant.gate, "already-do-nothing");
  assert.equal(dormant.quietState, 9); // native leaf byte multiplication is retained.
  assert.equal(dormant.zeroVelocities, null);
});
test("hierarchy and whole contact-ring folds require every descendant/member", () => {
  assert.equal(foldNativeQuietHierarchy(1, null), 3);
  assert.equal(foldNativeQuietHierarchy(1, [3, 3]), 3);
  assert.equal(foldNativeQuietHierarchy(1, [3, 1]), 1);
  assert.equal(foldNativeQuietHierarchy(0, [3, 3]), 0);
  assert.equal(foldNativeQuietHierarchy(255, null), 253);
  assert.equal(canSleepNativeQuietGroup([3, 3]), true);
  assert.equal(canSleepNativeQuietGroup([3, 1]), false);
  assert.equal(canSleepNativeQuietGroup([]), false);
});
test("friction flags use native row gates, type14 routing, nonzero signed lambda and capacity50", () => {
  const result = collectNativeCollisionFlags([
    { a: "zero", b: null, lambda: 0, sourceType: 1 },
    { a: "disabled", b: "B", lambda: 1, sourceType: 9 },
    { a: "joint11", b: "B", lambda: 1, sourceType: 11 },
    { a: "A", b: "B", lambda: 1, sourceType: 5 },
    { a: "A", b: null, lambda: 1, sourceType: 1 },
    { a: "joint14", b: "other14", lambda: -1, sourceType: 14 },
  ]);
  assert.equal(result.queuedCount, 3);
  assert.deepEqual(
    [...result.flags],
    [
      ["A", 3],
      ["B", 2],
      ["joint14", 1],
    ],
  );
  const capped = collectNativeCollisionFlags(
    Array.from({ length: 51 }, (_, a) => ({
      a,
      b: null,
      lambda: 1,
      sourceType: 1,
    })),
  );
  assert.equal(capped.queuedCount, 50);
  assert.equal(capped.droppedCount, 1);
  assert.equal(capped.flags.has(50), false);
});
test("invalid source packets cannot return non-finite state", () => {
  for (const patch of [
    { mass: 0 },
    { inertia: [0, 1, 1] },
    { worldVelocity: [NaN, 0, 0] },
    { previousQuietState: 256 },
    { collisionFlags: -1 },
    { bounds: { min: [0, 0, 0], max: [0, 1, 1] } },
  ])
    assert.throws(() => evaluateNativeQuietLeaf({ ...base, ...patch }));
  assert.throws(() => foldNativeQuietHierarchy(1, [256]));
  assert.throws(() =>
    collectNativeCollisionFlags([
      { a: 1, b: null, lambda: NaN, sourceType: 1 },
    ]),
  );
});
