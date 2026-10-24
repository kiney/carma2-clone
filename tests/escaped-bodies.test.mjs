import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Vector3 } from "three";
import { escapedBodyReason } from "../src/physics/escaped-bodies.ts";

const world = (min = [0, 0, 0], max = [100, 40, 100]) =>
  new Box3(new Vector3(...min), new Vector3(...max));
const point = (x, y, z) => new Vector3(x, y, z);

test("ordinary and extreme-speed motion inside the world remains active", () => {
  assert.equal(escapedBodyReason(world(), point(50, 20, 50), 3), undefined);
  // The policy intentionally does not infer escape from velocity or spin.
  assert.equal(escapedBodyReason(world(), point(99, 39, 2), 1), undefined);
});

test("a body far beyond either horizontal world axis is escaped", () => {
  assert.equal(
    escapedBodyReason(world(), point(100_000, 20, 50), 2),
    "far-horizontal",
  );
  assert.equal(
    escapedBodyReason(world(), point(50, 20, -100_000), 2),
    "far-horizontal",
  );
});

test("high flight remains playable while a body wholly below the padded minimum falls", () => {
  assert.equal(
    escapedBodyReason(world(), point(50, 1_000_000, 50), 2),
    undefined,
  );
  assert.equal(
    escapedBodyReason(world(), point(50, -1_000_000, 50), 2),
    "fallen",
  );
});

test("a large body that still spans the padded world boundary is retained", () => {
  const bounds = world();
  const padding = Math.max(32, Math.hypot(100, 40, 100) * 0.25);
  const bodyRadius = 100;
  const centerX = bounds.min.x - padding - bodyRadius + 1;
  assert.equal(
    escapedBodyReason(bounds, point(centerX, 20, 50), bodyRadius),
    undefined,
  );
});

test("invalid or unknown world bounds and invalid radii fail closed", () => {
  assert.equal(escapedBodyReason(new Box3(), point(1e9, 0, 0), 1), undefined);
  assert.equal(
    escapedBodyReason(world([10, 0, 0], [0, 40, 100]), point(1e9, 0, 0), 1),
    undefined,
  );
  assert.equal(escapedBodyReason(world(), point(1e9, 0, 0), -1), undefined);
  assert.equal(
    escapedBodyReason(world(), point(1e9, 0, 0), Infinity),
    undefined,
  );
});

test("a nonfinite position is quarantinable only with valid bounds and radius", () => {
  assert.equal(escapedBodyReason(world(), point(NaN, 0, 0), 1), "nonfinite");
  assert.equal(escapedBodyReason(new Box3(), point(NaN, 0, 0), 1), undefined);
  assert.equal(escapedBodyReason(world(), point(NaN, 0, 0), NaN), undefined);
});
