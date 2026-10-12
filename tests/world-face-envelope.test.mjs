import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import {
  buildHull,
  hullBounds,
  sweepHullTriangle,
  transformHull,
} from "../src/physics/geometry.ts";
import { worldFaceSweepEnvelope } from "../src/physics/world-face-envelope.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const box = (x = 1, y = 1, z = 1) =>
  buildHull(
    [-x, x].flatMap((a) =>
      [-y, y].flatMap((b) => [-z, z].map((c) => v(a, b, c))),
    ),
  );
const turn = (angle) => new Quaternion().setFromAxisAngle(v(0, 0, 1), angle);
const transformed = (hull, angle = 0, position = v()) =>
  transformHull(hull, position, turn(angle));

for (const [name, radius, height, angle, x] of [
  ["small angular guard sample", 10, 0.001, 0.025, 10.003],
  ["quarter-turn inverse-frame sweep", 1, 0.01, Math.PI / 4, 1.4],
]) {
  test(`world-face envelope retains the ${name} outside endpoint boxes`, () => {
    const hull = box(radius, height, 0.01),
      old = transformed(hull, -angle),
      next = transformed(hull, angle),
      triangle = [v(x), v(x + 0.1, 0, 0.01), v(x + 0.1, 0, -0.01)];
    const endpoint = hullBounds(old)
      .union(hullBounds(next))
      .expandByScalar(0.005);
    assert.ok(triangle.every((point) => !endpoint.containsPoint(point)));
    const hit = sweepHullTriangle(old, next, ...triangle, {
      deferReduction: true,
    });
    assert.ok(hit?.contactTypes.includes(2));
    const envelope = worldFaceSweepEnvelope(old, next);
    assert.ok(envelope?.containsPoint(triangle[0]));
  });
}

test("inverse-frame envelope bounds interpolated local volume with translation", () => {
  const hull = box(2, 0.07, 0.4),
    old = transformed(hull, -0.4, v(-3, 2, 1)),
    next = transformed(hull, 0.8, v(4, -1, 2)),
    envelope = worldFaceSweepEnvelope(old, next);
  assert.ok(envelope);
  // Solve M(t)w=h+(1-t)A p0+t B p1 for a rotation about Z.
  for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const c = (1 - t) * Math.cos(-0.4) + t * Math.cos(0.8),
      s = (1 - t) * Math.sin(-0.4) + t * Math.sin(0.8),
      determinant = c * c + s * s;
    const offset = old.position
      .clone()
      .applyQuaternion(old.orientation.clone().conjugate())
      .multiplyScalar(1 - t)
      .add(
        next.position
          .clone()
          .applyQuaternion(next.orientation.clone().conjugate())
          .multiplyScalar(t),
      );
    for (const point of hull.vertices) {
      const local = point.clone().add(offset);
      const world = v(
        (c * local.x - s * local.y) / determinant,
        (s * local.x + c * local.y) / determinant,
        local.z,
      );
      assert.ok(envelope.containsPoint(world), `${world.toArray()} at ${t}`);
    }
  }
});

test("near-pi, nonunit poses and uncertified plane volumes request legacy candidates", () => {
  const hull = box();
  assert.equal(
    worldFaceSweepEnvelope(
      transformed(hull),
      transformed(hull, Math.PI - 1e-10),
    ),
    null,
  );
  const bad = transformed(hull);
  bad.orientation.set(0, 0, 0, 2);
  assert.equal(worldFaceSweepEnvelope(transformed(hull), bad), null);
  const open = box();
  open.faces = open.faces.filter((face) => face.normal.x < 0.5);
  assert.equal(
    worldFaceSweepEnvelope(transformed(open), transformed(open, 0.1)),
    null,
  );
  const invalid = box();
  invalid.faces[0].constant = NaN;
  assert.equal(
    worldFaceSweepEnvelope(transformed(invalid), transformed(invalid, 0.1)),
    null,
  );
});

test("dual certificate covers sliver planes and the endpoint plane tolerance", () => {
  // A nearly parallel plane pair bounds a volume far beyond the stored vertices.
  const hull = box();
  hull.faces = [
    { normal: v(1), constant: 1, indices: [] },
    { normal: v(-1), constant: 1, indices: [] },
    { normal: v(1, 1e-7), constant: 1, indices: [] },
    { normal: v(-1, -1e-7), constant: 1, indices: [] },
    { normal: v(0, 0, 1), constant: 1, indices: [] },
    { normal: v(0, 0, -1), constant: 1, indices: [] },
  ];
  const envelope = worldFaceSweepEnvelope(
    transformed(hull),
    transformed(hull, 0.05),
  );
  assert.ok(envelope?.containsPoint(v(-1, 2e7 + 100)));
  const ordinary = box(),
    old = transformed(ordinary),
    next = transformed(ordinary, 0.1);
  const tolerant = worldFaceSweepEnvelope(old, next);
  // This source fallback point is 9e-6 outside every positive plane.
  const point = v(1.000009, 1.000009, 1.000009).applyQuaternion(
    next.orientation,
  );
  assert.ok(tolerant?.containsPoint(point));
});

test("radius cache detects in-place plane constants and normal changes", () => {
  const hull = box(),
    initial = worldFaceSweepEnvelope(transformed(hull), transformed(hull, 0.1));
  assert.ok(initial);
  for (const face of hull.faces) face.constant *= 100;
  const enlarged = worldFaceSweepEnvelope(
    transformed(hull),
    transformed(hull, 0.1),
  );
  assert.ok(enlarged?.containsPoint(v(100, 100, 100)));
  assert.ok(enlarged.max.x > initial.max.x * 50);
  const positiveX = hull.faces.find((face) => face.normal.x > 0.5);
  positiveX.normal.set(-1, 0, 0);
  assert.equal(
    worldFaceSweepEnvelope(transformed(hull), transformed(hull, 0.1)),
    null,
  );
});

test("accepted world vertices use the plane volume rather than authored vertex radius", () => {
  const hull = box();
  for (const face of hull.faces) {
    if (Math.abs(face.normal.x) > 0.5) face.constant = 100;
    if (Math.abs(face.normal.y) > 0.5) face.constant = 0.1;
  }
  const old = transformed(hull, -Math.PI / 4),
    next = transformed(hull, Math.PI / 4),
    triangle = [v(140.5), v(140.6, 0, 0.01), v(140.6, 0, -0.01)];
  const contact = sweepHullTriangle(old, next, ...triangle, {
    deferReduction: true,
  });
  assert.ok(contact?.contactTypes.includes(2));
  assert.ok(worldFaceSweepEnvelope(old, next)?.containsPoint(triangle[0]));
});

test("wire features need only endpoint bounds, including long-edge Float32 recovery allowance", () => {
  const wire = {
    nativeType: "WIRE",
    vertices: [v(-1e8), v(1e8)],
    faces: [],
    edges: [[0, 1]],
  };
  const old = transformed(wire),
    next = transformed(wire, Math.PI),
    envelope = worldFaceSweepEnvelope(old, next);
  assert.ok(envelope);
  assert.ok(envelope.max.x >= 1e8 + 2e8 * 2 ** -24);
  assert.ok(envelope.containsPoint(old.vertices[0]));
  assert.ok(envelope.containsPoint(next.vertices[1]));
});

test("localized envelopes exclude a clear distant pool while retaining finite features", () => {
  const hull = box(0.5, 0.3, 0.7),
    old = transformed(hull, -0.02),
    next = transformed(hull, 0.03, v(0.1)),
    envelope = worldFaceSweepEnvelope(old, next);
  assert.ok(envelope);
  assert.ok(envelope.max.x < 2 && envelope.max.y < 2 && envelope.max.z < 2);
  for (let i = 0; i < 40; i++)
    assert.equal(envelope.containsPoint(v(10 + i, 0, 0)), false);
  for (const point of [...old.vertices, ...next.vertices])
    assert.ok(envelope.containsPoint(point));
  const floor = [v(-1, 0.2, -1), v(0, 0.2, 1), v(1, 0.2, -1)];
  const hit = sweepHullTriangle(
    old,
    transformed(hull, 0.03, v(0.1, -0.4)),
    ...floor,
    { deferReduction: true },
  );
  assert.ok(hit);
  const moving = worldFaceSweepEnvelope(
    old,
    transformed(hull, 0.03, v(0.1, -0.4)),
  );
  assert.ok(
    floor.some((point) => moving.containsPoint(point)) ||
      moving.intersectsBox(
        hullBounds({ vertices: floor, faces: [], edges: [] }),
      ),
  );
});
