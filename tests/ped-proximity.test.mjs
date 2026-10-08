import assert from "node:assert/strict";
import test from "node:test";
import { Vector3 } from "three";
import {
  emptyPedProximity,
  pedFaceCacheBox,
  pedFaceInsideCache,
  pedExcludedFaceIntersection,
  scanPedProximity,
  selectPedAvoidanceDirection,
} from "../src/ped-proximity.ts";
const spec = {
  material: "walk",
  density: 1,
  movement: 0,
  group: 0,
  exclusions: ["road"],
  exclusionFlags: [1],
  exceptions: ["fence"],
};
const v = (x, y, z) => new Vector3(x, y, z),
  origin = v(0, 0.15, 0),
  up = v(0, 1, 0),
  floor = v(0, 0, 0),
  dir = v(1, 0, 0);
const face = (a, b, c, normal, material = "brick", materialFlags = 0) => ({
  a,
  b,
  c,
  normal,
  material,
  materialFlags,
  minY: Math.min(a.y, b.y, c.y),
  maxY: Math.max(a.y, b.y, c.y),
  enabled: true,
});
const scan = (faces, running = false, direction = dir) =>
  scanPedProximity(
    origin,
    direction,
    floor,
    up,
    0.065,
    25,
    spec,
    running,
    faces,
  );
test("native projected body strip sees finite offset wall corners missed by a center ray", () => {
  const corner = face(
    v(0.3, 0, 0.06),
    v(0.3, 0.3, 0.06),
    v(0.3, 0, 0.2),
    v(-1, 0, 0),
  );
  const hit = scan([corner]);
  assert.equal(hit.flags, 2);
  assert.equal(hit.distance, 0.3);
  assert.deepEqual(hit.position.toArray(), [0.3, 0.15, 0]);
  const outside = face(
    v(0.3, 0, 0.09),
    v(0.3, 0.3, 0.09),
    v(0.3, 0, 0.2),
    v(-1, 0, 0),
  );
  assert.equal(
    scan([outside]).flags,
    0,
    "authored bb.max.x times1.3 gives half width.0845",
  );
  assert.equal(scan([{ ...corner, material: "fence" }]).flags, 0);
});
test("native wall direction, double sided material flag and ground sidedness determine scan bits", () => {
  const wall = face(
    v(0.3, 0, -0.1),
    v(0.3, 0.3, 0),
    v(0.3, 0, 0.1),
    v(1, 0, 0),
  );
  assert.equal(scan([wall]).flags, 1);
  const twoSided = scan([{ ...wall, materialFlags: 0x1000 }]);
  assert.equal(twoSided.flags, 2);
  assert.equal(twoSided.normal.x, -1);
  assert.equal(Math.abs(twoSided.normal.y), 0);
  assert.equal(Math.abs(twoSided.normal.z), 0);
  assert.equal(
    scan([
      face(v(0.3, -0.3, -0.1), v(0.3, -0.1, 0), v(0.3, -0.3, 0.1), v(-1, 0, 0)),
    ]).flags,
    0,
    "a front wall wholly below its ground plane is ignored",
  );
  assert.equal(
    scan([face(v(-0.3, 0, -0.1), v(-0.3, 0.3, 0), v(-0.3, 0, 0.1), v(1, 0, 0))])
      .flags,
    0,
    "negative plane intersection is behind pedestrian",
  );
});
test("native floor clipping uses flagged exclusions and preserves installed edge algebra", () => {
  const road = face(v(1, 0, -1), v(1, 0, 1), v(2, 0, 0), up, "road");
  const walking = scan([road]);
  assert.equal(walking.flags, 8);
  assert.equal(walking.distance, 1);
  assert.deepEqual(walking.normal.toArray(), [0, 0, -1]);
  assert.equal(scan([road], true).flags, 0);
  const translated = face(v(2, 0, 2), v(2, 0, 4), v(4, 0, 3), up, "road");
  const source = pedExcludedFaceIntersection(
    v(3, 0, 0),
    v(0, 0, 1),
    translated,
  );
  assert.equal(
    source.distance,
    3.5,
    "0x4d0643/0x4d06b6 reuse A/B determinant4; replacing it by C/A determinant2 gives incorrect2.5",
  );
  assert.deepEqual(source.normal.toArray(), [-2, 0, 1]);
  const tie = face(v(0, 0, 0), v(1, 0, 1), v(0, 0, 2), up, "road");
  assert.equal(
    pedExcludedFaceIntersection(v(0, 0, 0), v(0, 0, 1), tie).distance,
    Infinity,
    "equal first/second zero intersections fall through to third parallel edge",
  );
});
test("native face cache uses original oriented3/2/10m bounds and finite triangle overlap", () => {
  const cache = pedFaceCacheBox(origin, dir, up, 0);
  assert.ok(Math.abs(cache.local.min.x + 3 / 6.9) < 1e-12);
  assert.ok(Math.abs(cache.local.max.z - 10 / 6.9) < 1e-12);
  const inside = face(
    v(0.3, 0, 0.06),
    v(0.3, 0.3, 0.06),
    v(0.3, 0, 0.2),
    v(-1, 0, 0),
  );
  assert.equal(pedFaceInsideCache(inside, cache), true);
  const above = face(
    v(0.3, 1, 0.06),
    v(0.3, 2, 0.06),
    v(0.3, 1, 0.2),
    v(-1, 0, 0),
  );
  assert.equal(pedFaceInsideCache(above, cache), false);
  assert.equal(
    pedFaceInsideCache(above, pedFaceCacheBox(origin, dir, up, 2)),
    true,
  );
});
test("opposite tangent rescans finite faces and must rank strictly farther, retaining ties", () => {
  const near = face(
      v(0.3, 0, -0.1),
      v(0.3, 0.3, 0),
      v(0.3, 0, 0.1),
      v(-1, 0, 0),
    ),
    far = face(v(-0.5, 0, -0.1), v(-0.5, 0.3, 0), v(-0.5, 0, 0.1), v(1, 0, 0));
  const opposite = selectPedAvoidanceDirection(dir, (d) =>
    scan([near, far], false, d),
  );
  assert.equal(opposite.direction.x, -1);
  assert.equal(opposite.scan.distance, 0.5);
  const equal = {
    ...far,
    a: v(-0.3, 0, -0.1),
    b: v(-0.3, 0.3, 0),
    c: v(-0.3, 0, 0.1),
  };
  assert.equal(
    selectPedAvoidanceDirection(dir, (d) => scan([near, equal], false, d))
      .direction.x,
    1,
  );
  let calls = 0;
  const clear = selectPedAvoidanceDirection(dir, () => {
    calls++;
    return emptyPedProximity();
  });
  assert.equal(clear.direction, dir);
  assert.equal(calls, 1);
  calls = 0;
  const coincident = selectPedAvoidanceDirection(
    dir,
    (d) => {
      calls++;
      return scan([near, far], false, d);
    },
    false,
  );
  assert.equal(coincident.direction, dir);
  assert.equal(
    calls,
    1,
    "native coincident contact does not try the opposite tangent",
  );
});
