import test from "node:test";
import assert from "node:assert/strict";
import {
  Vector3,
  Group,
  Mesh,
  MeshBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
} from "three";
import { intersectWheelFace } from "../src/physics/wheel-ray.ts";
import { WorldCollision } from "../src/world.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const face = {
  a: v(-1, 0, -1),
  b: v(-1, 0, 1),
  c: v(1, 0, 1),
  normal: v(0, 1, 0),
  twoSided: false,
};
test("C2 wheel face tolerates shallow signed penetration, without an infinite supporting plane", () => {
  const hit = intersectWheelFace(v(-0.25, -0.0005, 0.25), v(0, -0.1, 0), face);
  assert.ok(hit);
  assert.ok(Math.abs(hit.fraction + 0.005) < 1e-12);
  assert.equal(hit.point.y, 0);
  assert.equal(
    intersectWheelFace(v(-0.25, -0.0011, 0.25), v(0, -0.1, 0), face),
    null,
  );
  assert.equal(intersectWheelFace(v(4, 0.01, 0), v(0, -0.1, 0), face), null);
});
test("C2 wheel endpoint slack clamps the original fraction before triangle testing", () => {
  const hit = intersectWheelFace(v(-0.25, 0.102, 0.25), v(0, -0.1, 0), face);
  assert.equal(hit.fraction, 1);
  assert.ok(Math.abs(hit.point.y - 0.002) < 1e-12);
  assert.equal(
    intersectWheelFace(v(-0.25, 0.104, 0.25), v(0, -0.1, 0), face),
    null,
  );
});
test("C2 wheel face keeps winding, segment parallel tolerance and finite barycentric slack", () => {
  assert.equal(
    intersectWheelFace(v(-0.25, -0.1, 0.25), v(0, 0.2, 0), face),
    null,
  );
  const back = intersectWheelFace(v(-0.25, -0.1, 0.25), v(0, 0.2, 0), {
    ...face,
    twoSided: true,
  });
  assert.ok(back.normal.distanceTo(v(0, -1, 0)) < 1e-12);
  assert.equal(intersectWheelFace(v(), v(1, 1e-8, 0), face), null);
  assert.ok(intersectWheelFace(v(-1.0001, 0.01, 0.25), v(0, -0.1, 0), face));
  assert.equal(
    intersectWheelFace(v(-1.001, 0.01, 0.25), v(0, -0.1, 0), face),
    null,
  );
});
test("world wheel rays reach signed contacts while general camera/oil rays remain forward only", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([-1, 0, -1, -1, 0, 1, 1, 0, 1], 3),
  );
  const scene = new Group();
  scene.add(new Mesh(geometry, new MeshBasicMaterial()));
  const world = new WorldCollision(scene);
  const origin = v(-0.25, -0.0005, 0.25),
    direction = v(0, -1, 0);
  assert.equal(world.raycast(origin, direction, 0.1), null);
  const hit = world.wheelRaycast(origin, direction, 0.1);
  assert.ok(Math.abs(hit.distance + 0.0005) < 1e-12);
  assert.deepEqual(hit.normal.toArray(), [0, 1, 0]);
});
test("oblique wheel query broadphase includes the native accepted negative suspension interval", () => {
  const geometry = new BufferGeometry();
  // Surface lives wholly behind the start's XZ cell boundary.
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([3.95, 0, 0, 3.95, 0, 0.2, 3.99, 0, 0.1], 3),
  );
  const scene = new Group();
  scene.add(new Mesh(geometry, new MeshBasicMaterial()));
  const world = new WorldCollision(scene);
  const direction = v(1, -0.02, 0).normalize();
  const hit = world.wheelRaycast(v(4.01, -0.0008, 0.1), direction, 0.1);
  assert.ok(hit);
  assert.ok(hit.distance < -0.005 && hit.distance > -0.5 / 6.9);
  assert.ok(Math.abs(hit.point.x - 3.97) < 1e-9);
});
