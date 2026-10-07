import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { moveShapeToSensiblePlace } from "../src/physics/shape-swap.ts";
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("source sensible-shape movement doubles repeated direction and converts only at world boundary", () => {
  const position = new Vector3();
  let probes = 0;
  const result = moveShapeToSensiblePlace(
    position,
    () => (++probes < 4 ? new Vector3(1, 0, 0) : undefined),
    6.9,
  );
  assert.equal(result.accepted, true);
  assert.equal(result.attempts, 3);
  assert.equal(probes, 4);
  close(position.x, 0.007246377 * 7 * 6.9);
});
test("source sensible-shape direction change resets the step", () => {
  const position = new Vector3();
  const directions = [
    new Vector3(1, 0, 0),
    new Vector3(1, 0, 0),
    new Vector3(0, 1, 0),
  ];
  assert.equal(
    moveShapeToSensiblePlace(position, () => directions.shift()).accepted,
    true,
  );
  close(position.x, 0.007246377 * 3);
  close(position.y, 0.007246377);
});
test("ten failed probes roll back position for deferred hull-swap retry", () => {
  const position = new Vector3(3, 2, 1),
    original = position.clone();
  let probes = 0;
  const result = moveShapeToSensiblePlace(position, () => {
    probes++;
    return new Vector3(1, 0, 0);
  });
  assert.equal(result.accepted, false);
  assert.equal(probes, 10);
  assert.deepEqual(position, original);
  assert.equal(result.displacement.length(), 0);
});
