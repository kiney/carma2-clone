import test from "node:test";
import assert from "node:assert/strict";
import { evaluateNativePedRetainedJoint } from "../src/physics/ped-retained-joint.ts";

const bits = (values) =>
  Array.from(new Uint32Array(Float32Array.from(values).buffer));
const evaluate = (friction, localOmega, inertia) =>
  evaluateNativePedRetainedJoint({
    joint: { friction },
    localOmega,
    inertia,
  });

// Fixed outputs were independently evaluated from the installed instruction
// order with x87 CW027f in /tmp/ped11-joint-oracle.c. No generated fixture.
test("source joint2 friction caps BODY angular momentum, preserving anisotropic inertia", () => {
  for (const [inertia, expected] of [
    [
      [1, 1, 1],
      [0x4019999a, 0x404ccccd, 0],
    ],
    [
      [2, 1, 0.5],
      [0x40255fd8, 0x405c7fcb, 0],
    ],
    [
      [-2, 1, -0.5],
      [0x40255fd8, 0x405c7fcb, 0],
    ],
  ]) {
    const r = evaluate(25, [3, 4, 0], inertia);
    assert.equal(r.status, "complete");
    assert.equal(r.applied, true);
    assert.equal(r.clamped, true);
    assert.deepEqual(bits(r.localOmega), expected);
  }
});

test("source negative friction has the same squared cap; zero and absent joint skip inertia divisions", () => {
  assert.deepEqual(
    evaluate(-25, [3, 4, 0], [2, 1, 0.5]),
    evaluate(25, [3, 4, 0], [2, 1, 0.5]),
  );
  for (const joint of [null, { friction: 0 }, { friction: -0 }]) {
    const r = evaluateNativePedRetainedJoint({
      joint,
      localOmega: [3, 4, 0],
      inertia: [0, 0, 0],
    });
    assert.equal(r.status, "complete");
    assert.equal(r.applied, false);
    assert.equal(r.clamped, false);
    assert.deepEqual(r.localOmega, [3, 4, 0]);
  }
});

test("unclamped momentum still spills Float32 before division and retains source cancellation residual", () => {
  const r = evaluate(25, [0.1, 0.2, 0.3], [0.3, 0.7, 1.1]);
  assert.equal(r.clamped, false);
  assert.deepEqual(bits(r.localOmega), [0x30cccccd, 0xb0af8af9, 0x31df6b0e]);
  const same = evaluate(
    25,
    [0.33333334, 0.33333334, 0.33333334],
    [0.33333334, 0.33333334, 0.33333334],
  );
  assert.deepEqual(bits(same.localOmega), [0xb1aaaaaa, 0xb1aaaaaa, 0xb1aaaaaa]);
});

test("friction25 cap remains live at53-bit precision instead of rounding to1 before comparison", () => {
  const r = evaluate(25, [1, 0, 0], [1, 1, 1]);
  assert.equal(r.clamped, true);
  assert.deepEqual(r.localOmega, [0, 0, 0]);
  assert.deepEqual(evaluate(25, [0, 0, 0], [1, 2, 3]).localOmega, [0, 0, 0]);
});

test("source small friction preserves mixed-axis stored momentum and division outputs", () => {
  const r = evaluate(1, [1.234567, -2.345678, 3.456789], [0.001, 0.017, 1.123]);
  assert.equal(r.clamped, true);
  assert.deepEqual(bits(r.localOmega), [0x3f9c6579, 0xc014939c, 0x405af47b]);
});

test("source nonfinite zero-inertia and Float32-overflow cases require a bounded provider with no partial output", () => {
  for (const [localOmega, inertia] of [
    [
      [1, 2, 3],
      [1, 0, 1],
    ],
    [
      [0, 0, 0],
      [0, 1, 1],
    ],
    [
      [3.4e38, 0, 0],
      [3.4e38, 1, 1],
    ],
  ]) {
    const r = evaluate(25, localOmega, inertia);
    assert.equal(r.status, "provider-required");
    assert.deepEqual(r.localOmega, Array.from(Float32Array.from(localOmega)));
    assert.ok(r.requiredProviders.length);
    assert.equal(r.applied, false);
  }
});
