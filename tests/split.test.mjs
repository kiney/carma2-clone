import test from "node:test";
import assert from "node:assert/strict";
import { Box3, BufferAttribute, BufferGeometry, Matrix4, Vector3 } from "three";
import {
  splitHull,
  splitProperties,
  splitModelGeometry,
  validateSplitPlane,
  findRoofSplitContactCandidate,
} from "../src/physics/split.ts";
import { Quaternion } from "three";
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const bounds = new Box3(new Vector3(-1, -1, -2), new Vector3(1, 1, 2));

test("roof splitting sums all above-cut world impulses and rejects mixed contact heights", () => {
  const body = {
    state: { position: new Vector3(), orientation: new Quaternion() },
    properties: { mass: 1 },
  };
  const contact = (y, impulse) => ({
    a: body,
    point: new Vector3(0, y, 0),
    normalImpulse: impulse,
    sourceType: 1,
  });
  const input = {
    driver: 8,
    objectType: 1,
    snappability: 1,
    softness: 1,
    splitY: 0.1,
    immune: false,
    snapped: false,
  };
  const contacts = [contact(0.2, 1.4), contact(0.1, 1.2)];
  const result = findRoofSplitContactCandidate(contacts, input);
  assert.ok(result);
  assert.deepEqual(result.contactIndices, [0, 1]);
  close(result.totalImpulse, 2.6);
  assert.equal(
    findRoofSplitContactCandidate([...contacts, contact(0, 0.01)], input),
    undefined,
  );
  assert.ok(
    findRoofSplitContactCandidate([...contacts, contact(0, 0.009)], input),
  );
  assert.ok(
    findRoofSplitContactCandidate(
      [...contacts, { ...contact(0, 2), b: body }],
      input,
    ),
  );
  assert.equal(
    findRoofSplitContactCandidate([contact(0.2, 2.5)], input),
    undefined,
    "source compares total strictly greater",
  );
});

test("source split plane preserves driver-facing orientation and rejects end-only cuts", () => {
  const plane = validateSplitPlane({
    normal: new Vector3(0, 0, 1),
    constant: 0,
    bounds,
    modelBounds: bounds,
    driver: new Vector3(0, 0, -1),
  });
  assert.ok(plane);
  assert.ok(plane.normal.z < -0.999);
  close(plane.constant, 0.00003814755473330367);
  assert.equal(
    validateSplitPlane({
      normal: new Vector3(0, 0, 1),
      constant: 1.5,
      bounds,
      modelBounds: bounds,
      driver: new Vector3(),
    }),
    undefined,
  );
  assert.equal(
    validateSplitPlane({
      normal: new Vector3(0, 0, 1),
      constant: 0,
      bounds,
      modelBounds: bounds,
      driver: new Vector3(),
      bent: true,
    }),
    undefined,
  );
});

test("split inertial partition conserves mass, COM and total diagonal inertia", () => {
  const original = {
    mass: 4,
    centerOfMass: new Vector3(0, 0, 0.3),
    inertia: new Vector3(8, 10, 4),
  };
  const { positive, negative } = splitProperties(original, bounds, {
    normal: new Vector3(0, 0, 1),
    constant: 0.5,
  });
  close(positive.mass + negative.mass, 4);
  const center = positive.centerOfMass
    .clone()
    .multiplyScalar(positive.mass)
    .addScaledVector(negative.centerOfMass, negative.mass)
    .divideScalar(4);
  close(center.z, 0.3);
  const orbital =
    positive.mass * (positive.centerOfMass.z - 0.3) ** 2 +
    negative.mass * (negative.centerOfMass.z - 0.3) ** 2;
  close(positive.inertia.x + negative.inertia.x + orbital, 8);
  close(positive.inertia.y + negative.inertia.y + orbital, 10);
  close(positive.inertia.z + negative.inertia.z, 4);
  const flipped = splitProperties(original, bounds, {
    normal: new Vector3(0, 0, -1),
    constant: -0.5,
  });
  close(flipped.negative.mass, positive.mass);
});

test("convex shape crossings create original .1-world-unit gap", () => {
  const vertices = [];
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1]) vertices.push(new Vector3(x, y, z));
  const edges = [];
  for (let i = 0; i < 8; i++)
    for (let j = i + 1; j < 8; j++)
      if (vertices[i].distanceToSquared(vertices[j]) === 4) edges.push([i, j]);
  const halves = splitHull(vertices, edges, {
    normal: new Vector3(0, 0, 1),
    constant: 0,
  });
  assert.equal(halves.positive.length, 8);
  assert.equal(halves.negative.length, 8);
  close(Math.min(...halves.positive.map((p) => p.z)), 0.007246376946568489);
  close(Math.max(...halves.negative.map((p) => p.z)), -0.007246376946568489);
});

test("model clipping keeps winding, material and UV interpolation; seam is shared and open", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0]), 3),
  );
  geometry.setAttribute(
    "uv",
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1]), 2),
  );
  geometry.addGroup(0, 3, 2);
  const halves = splitModelGeometry(
    geometry,
    new Matrix4(),
    { normal: new Vector3(1, 0, 0), constant: 0 },
    () => 0.5,
  );
  assert.equal(halves.positive.getAttribute("position").count, 6);
  assert.equal(halves.negative.getAttribute("position").count, 3);
  for (const half of Object.values(halves)) {
    assert.equal(half.groups[0].materialIndex, 2);
    const p = half.getAttribute("position"),
      uv = half.getAttribute("uv"),
      normal = half.getAttribute("normal");
    for (let i = 0; i < p.count; i++) {
      assert.ok(normal.getZ(i) > 0.99);
      if (Math.abs(p.getX(i)) < 1e-7) close(uv.getX(i), 0.5);
    }
  }
  close(geometry.getAttribute("position").getX(0), -1);
});
