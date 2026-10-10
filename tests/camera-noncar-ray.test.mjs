import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { cameraNoncarRay } from "../src/camera/noncar-ray.ts";

const box = () =>
  buildBoxHull(new Vector3(-0.4, -0.4, -0.4), new Vector3(0.4, 0.4, 0.4));
const shape = (
  position = new Vector3(),
  orientation = new Quaternion(),
  hulls = [box()],
) => ({
  position,
  orientation,
  hulls,
});
const worldPoint = (local, position, orientation) =>
  local.clone().applyQuaternion(orientation).add(position);
const assertVectorClose = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) =>
    assert.ok(Math.abs(value - expected[index]) < 1e-12),
  );
};

test("near-probe overlap gates a COM ray and replaces only a farther world hit", () => {
  const body = shape();
  const worldCOM = new Vector3(0, 0, 1);
  const nearProbe = new Vector3(0, 0, 0.8);
  const extendedEnd = new Vector3(0, 0, -1);
  const fartherWorldHit = {
    fraction: 0.5,
    normal: new Vector3(1, 0, 0),
  };
  const nearer = cameraNoncarRay(
    worldCOM,
    nearProbe,
    extendedEnd,
    [body],
    fartherWorldHit,
  );
  assert.equal(nearer.collided, true);
  assert.ok(nearer.hit.fraction < fartherWorldHit.fraction);
  assertVectorClose(nearer.hit.normal.toArray(), [0, 0, -1]);

  const closerWorldHit = {
    fraction: 0.2,
    normal: new Vector3(1, 0, 0),
  };
  const kept = cameraNoncarRay(
    worldCOM,
    nearProbe,
    extendedEnd,
    [body],
    closerWorldHit,
  );
  assert.equal(kept.collided, true);
  assert.equal(kept.hit, closerWorldHit);
});

test("translated rotated noncar returns the positive COM ray's local inward normal", () => {
  const position = new Vector3(3, -2, 5);
  const orientation = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    Math.PI / 2,
  );
  const worldCOM = worldPoint(new Vector3(0, 0, 1), position, orientation);
  const nearProbe = worldPoint(new Vector3(0, 0, 0.8), position, orientation);
  const extendedEnd = worldPoint(new Vector3(0, 0, -1), position, orientation);
  const result = cameraNoncarRay(worldCOM, nearProbe, extendedEnd, [
    shape(position, orientation),
  ]);
  assert.equal(result.collided, true);
  assert.ok(Math.abs(result.hit.fraction - 0.3) < 1e-12);
  assertVectorClose(result.hit.normal.toArray(), [0, 0, -1]);
  assert.notDeepEqual(
    result.hit.normal.toArray(),
    new Vector3(0, 0, -1).applyQuaternion(orientation).toArray(),
    "the source caller consumes the transformed shape's local normal as-is",
  );
});

test("first ray inside still permits a valid positive COM-to-end boundary hit", () => {
  const result = cameraNoncarRay(
    new Vector3(0, 0, -1),
    new Vector3(0, 0, 0),
    new Vector3(0, 0, 1),
    [shape()],
  );
  assert.equal(result.collided, true);
  assert.ok(result.hit);
  assert.ok(Math.abs(result.hit.fraction - 0.3) < 1e-12);
  assertVectorClose(result.hit.normal.toArray(), [0, 0, 1]);
});

test("second ray starting inside flags overlap without inventing hit fraction", () => {
  const worldHit = { fraction: 0.1, normal: new Vector3(1, 0, 0) };
  const result = cameraNoncarRay(
    new Vector3(0, 0, 0),
    new Vector3(0, 0, 0.1),
    new Vector3(0, 0, 1),
    [shape()],
    worldHit,
  );
  assert.equal(result.collided, true);
  assert.equal(result.hit, worldHit);

  const noPriorHit = cameraNoncarRay(
    new Vector3(0, 0, 0),
    new Vector3(0, 0, 0.1),
    new Vector3(0, 0, 1),
    [shape()],
  );
  assert.equal(noPriorHit.collided, true);
  assert.equal(noPriorHit.hit, undefined);
});

test("the caller supplies only the head shape; a near-probe miss means no collision", () => {
  const headAway = shape(new Vector3(10, 0, 0));
  const miss = cameraNoncarRay(
    new Vector3(0, 0, 1),
    new Vector3(0, 0, 0.8),
    new Vector3(0, 0, -1),
    [headAway],
  );
  assert.deepEqual(miss, { hit: undefined, collided: false });

  const head = shape();
  const headHit = cameraNoncarRay(
    new Vector3(0, 0, 1),
    new Vector3(0, 0, 0.8),
    new Vector3(0, 0, -1),
    [head],
  );
  assert.equal(headHit.collided, true);
  assert.ok(headHit.hit);
});

test("a strict equal fraction leaves the previously selected world hit", () => {
  const selected = { fraction: 0.3, normal: new Vector3(1, 0, 0) };
  const result = cameraNoncarRay(
    new Vector3(0, 0, 1),
    new Vector3(0, 0, 0.8),
    new Vector3(0, 0, -1),
    [shape()],
    selected,
  );
  assert.equal(result.collided, true);
  assert.equal(result.hit, selected);
});
