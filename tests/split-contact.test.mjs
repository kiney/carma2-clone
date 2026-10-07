import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import {
  findSplitContactCandidate,
  splitEdgeDistanceSquared,
} from "../src/physics/split-contact.ts";
const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const eligibility = {
  minForcePerTonne: 4,
  snappability: 2,
  softness: 2,
  driver: 7,
  objectType: 1,
  immune: false,
  snapped: false,
};
function impact(overrides = {}) {
  return {
    a: {
      state: {
        position: v(),
        orientation: new Quaternion(),
        velocity: v(),
        angularVelocity: v(),
      },
      properties: {
        mass: 2,
        inertia: v(1, 1, 1),
        centerOfMass: v(),
        worldFriction: 0,
      },
    },
    point: v(0.2, 0.1, 0.3),
    pointB: v(),
    normal: v(0, 0, -1),
    normalImpulse: 2,
    closingSpeed: 1,
    tangentImpulse: v(),
    sourceType: 0,
    ...overrides,
  };
}
const triangle = (a, b, c) => ({
  a,
  b,
  c,
  normal: b.clone().sub(a).cross(c.clone().sub(a)).normalize(),
});
const wedge = [
  triangle(v(0, -1), v(0, 1), v(1)),
  triangle(v(0, 1), v(0, -1), v(0, 0, 1)),
];

test("split wedge emits authored local and horizontal planes at the contact point", () => {
  const result = findSplitContactCandidate([impact()], wedge, eligibility);
  assert.ok(result);
  near(result.threshold, 2);
  near(result.normalLocal.x, -1);
  near(result.normalLocal.y, 0);
  near(result.constantLocal, -0.2);
  near(result.horizontalConstantLocal, -0.2);
  assert.deepEqual(result.edgeIndices, [0, 0]);
  assert.equal(result.triangles[1], wedge[1]);
});
test("split requires world-edge source type and original mass/force/softness threshold", () => {
  for (const overrides of [
    { normalImpulse: 1.999 },
    { sourceType: 1 },
    { sourceType: 2 },
    { b: impact().a },
    { pointB: undefined },
  ]) {
    assert.equal(
      findSplitContactCandidate([impact(overrides)], wedge, eligibility),
      null,
    );
  }
  for (const overrides of [
    { driver: 5 },
    { objectType: 0 },
    { immune: true },
    { snapped: true },
    { snappability: 0 },
  ]) {
    assert.equal(
      findSplitContactCandidate([impact()], wedge, {
        ...eligibility,
        ...overrides,
      }),
      null,
    );
  }
  assert.equal(
    findSplitContactCandidate([impact({ normalImpulse: 0.005 })], wedge, {
      ...eligibility,
      minForcePerTonne: 0,
    }),
    null,
  );
});
test("nearby finite edges use the exact squared-distance gate rather than infinite lines", () => {
  near(splitEdgeDistanceSquared(v(2, 1), v(), v(1)), 2);
  near(splitEdgeDistanceSquared(v(0.5, 1), v(), v(1)), 1);
  assert.equal(
    findSplitContactCandidate(
      [impact({ pointB: v(0, 2) })],
      wedge,
      eligibility,
    ),
    null,
  );
  assert.equal(
    findSplitContactCandidate(
      [impact({ pointB: v(0, 0, 0.0004) })],
      wedge,
      eligibility,
    ),
    null,
  );
  assert.ok(
    findSplitContactCandidate(
      [impact({ pointB: v(0, 0, 0.0003) })],
      wedge,
      eligibility,
    ),
  );
});
test("split uses first two nearby triangles and does not require shared vertex identities", () => {
  assert.equal(
    findSplitContactCandidate(
      [impact()],
      [wedge[0], wedge[0], wedge[1]],
      eligibility,
    ),
    null,
  );
  const shifted = triangle(v(0.0001, 1), v(0.0001, -1), v(0.0001, 0, 1));
  assert.ok(
    findSplitContactCandidate([impact()], [wedge[0], shifted], eligibility),
  );
});
test("split rejects near-parallel normals and predominantly vertical split planes", () => {
  const parallel = {
    ...wedge[1],
    normal: wedge[0].normal.clone().applyAxisAngle(v(0, 1), 0.1),
  };
  assert.equal(
    findSplitContactCandidate([impact()], [wedge[0], parallel], eligibility),
    null,
  );
  const xEdge = [
    triangle(v(-1), v(1), v(0, 1)),
    triangle(v(1), v(-1), v(0, 0, 1)),
  ];
  assert.equal(findSplitContactCandidate([impact()], xEdge, eligibility), null);
});
test("split edge direction uses candidate axes while contact normal retains solver axes", () => {
  const xEdge = [
    triangle(v(-1), v(1), v(0, 1)),
    triangle(v(1), v(-1), v(0, 0, 1)),
  ];
  const contact = impact({ normal: v(0, 1) });
  contact.a.state.predictedOrientation = new Quaternion().setFromAxisAngle(
    v(0, 1),
    Math.PI / 2,
  );
  const result = findSplitContactCandidate([contact], xEdge, eligibility);
  assert.ok(result);
  near(result.normalLocal.x, -1);
  near(result.constantLocal, -0.2);
});
test("split scans only the original forty-contact workspace", () => {
  const contacts = Array.from({ length: 40 }, () => impact({ sourceType: 1 }));
  contacts.push(impact());
  assert.equal(findSplitContactCandidate(contacts, wedge, eligibility), null);
});

test("a rejected split plane continues to the next eligible contact", () => {
  const contacts = [
    impact({ point: v(-0.2, 0.1, 0.3) }),
    impact({ point: v(0.2, 0.1, 0.3) }),
  ];
  const tried = [];
  const result = findSplitContactCandidate(
    contacts,
    wedge,
    eligibility,
    (candidate) => {
      tried.push(candidate.contactIndex);
      return candidate.contactIndex === 1;
    },
  );
  assert.deepEqual(tried, [0, 1]);
  assert.equal(result.contactIndex, 1);
});
