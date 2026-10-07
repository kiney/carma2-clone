import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import {
  buildHull,
  transformHull,
  collideHulls,
  sweepHullTriangle,
  reduceWorldContacts,
  finalizeWorldContacts,
  sweepMovingEdges,
  sweepHulls,
  recoverHullOverlap,
  recoverWorldContacts,
  worldPlacementContacts,
  worldPlacementDirection,
  placementHullsOverlap,
} from "../src/physics/geometry.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const near = (a, b, epsilon = 1e-7) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const cube = buildHull(
  [-0.5, 0.5].flatMap((x) =>
    [-0.5, 0.5].flatMap((y) => [-0.5, 0.5].map((z) => v(x, y, z))),
  ),
);
const at = (position, quaternion = new Quaternion()) =>
  transformHull(cube, position, quaternion);
const floor = [v(-5, 0, -5), v(0, 0, 5), v(5, 0, -5)];

test("authored convex hull topology excludes triangulation diagonals", () => {
  assert.equal(cube.vertices.length, 8);
  assert.equal(cube.faces.length, 6);
  assert.equal(cube.edges.length, 12);
  assert.ok(cube.faces.every((face) => face.indices.length === 4));
});

test("hull SAT normal pushes A away from B and detects separated cars", () => {
  const a = at(v(-0.45)),
    b = at(v(0.45));
  const impact = collideHulls(a, b);
  assert.ok(impact);
  near(impact.normal.x, -1);
  near(impact.penetration, 0.1);
  assert.ok(impact.points.length >= 1 && impact.points.length <= 4);
  assert.equal(collideHulls(at(v(-1)), at(v(1))), null);
  const swapped = collideHulls(b, a);
  near(swapped.normal.dot(impact.normal), -1);
});

test("object-pair CCD keeps first-touch front normals through deep candidate overlap", () => {
  const thin = buildHull(
    [-0.3, 0.3].flatMap((x) =>
      [-0.06, 0.06].flatMap((y) => [-0.4, 0.4].map((z) => v(x, y, z))),
    ),
  );
  const t = (z) => transformHull(thin, v(0, 0, z), new Quaternion());
  const impact = sweepHulls(t(-0.41), t(-0.25), t(0.41), t(0.25));
  assert.ok(impact);
  assert.equal(impact.points.length, 4);
  for (let i = 0; i < impact.points.length; i++) {
    near(impact.pointNormals[i].z, -1);
    near(impact.pointNormals[i].y, 0);
    near(impact.points[i].z, -0.01);
    near(impact.pointsB[i].z, 0.01);
    near(impact.pointFractions[i], 0.0625);
  }
});

test("object-pair CCD detects tunnelling and is covariant under scene transforms", () => {
  const impact = sweepHulls(at(v(-2)), at(v(2)), at(v()), at(v()));
  assert.ok(impact);
  near(impact.normal.x, -1);
  near(impact.fraction, 0.25);
  const q = new Quaternion().setFromAxisAngle(v(0, 1), 0.7),
    offset = v(7, 2, -3);
  const transformed = (x) =>
    transformHull(cube, v(x).applyQuaternion(q).add(offset), q);
  const moved = sweepHulls(
    transformed(-2),
    transformed(2),
    transformed(0),
    transformed(0),
  );
  assert.ok(moved);
  near(moved.normal.distanceTo(impact.normal.clone().applyQuaternion(q)), 0);
  near(moved.fraction, 0.25);
  assert.equal(sweepHulls(at(v(-2)), at(v(-3)), at(v()), at(v())), null);
});

test("float-stored feature ties preserve authored front contacts on a sloping car hull", () => {
  const hull = buildHull(
    [
      [-0.2, 0.043, -0.38],
      [0.2, 0.043, -0.38],
      [0.2, 0.161, -0.38],
      [-0.2, 0.161, -0.38],
      [-0.2, 0.043, 0.4],
      [0.2, 0.043, 0.4],
      [0.2, 0.243, 0.4],
      [-0.2, 0.243, 0.4],
    ].map((point) => v(...point)),
  );
  const reversed = new Quaternion().setFromAxisAngle(v(0, 1), Math.PI);
  const t = (z, q = new Quaternion()) => transformHull(hull, v(0, 0, z), q);
  const impact = sweepHulls(
    t(0.41),
    t(0.250058887),
    t(-0.41, reversed),
    t(-0.250058887, reversed),
  );
  assert.ok(impact);
  assert.equal(impact.points.length, 4);
  near(
    impact.points.reduce((sum, p) => sum + p.x, 0),
    0,
  );
  for (const normal of impact.pointNormals) {
    near(normal.z, 1);
    near(normal.y, 0);
  }
});

test("initial overlap recovery uses old edge/face levers and closing velocity", () => {
  const oldA = at(v(-0.45)),
    oldB = at(v(0.45));
  const body = (hull, velocity) => ({
    state: {
      position: hull.position,
      orientation: hull.orientation,
      velocity,
      angularVelocity: v(),
    },
    properties: {
      mass: 1,
      inertia: v(1, 1, 1),
      centerOfMass: v(),
      worldFriction: 0,
    },
  });
  const a = body(oldA, v(1)),
    b = body(oldB, v(-1));
  const recovered = recoverHullOverlap(oldA, oldB, { a, b });
  assert.equal(recovered.overlap, true);
  assert.ok(recovered.contact);
  assert.equal(recovered.contact.points.length, 4);
  assert.ok(recovered.contact.contactTypes.every((type) => type === 6));
  for (let i = 0; i < 4; i++) {
    near(recovered.contact.pointNormals[i].x, -1);
    near(
      recovered.contact.points[i].distanceTo(recovered.contact.pointsB[i]),
      0,
    );
  }
  a.state.velocity.x = -1;
  b.state.velocity.x = 1;
  assert.equal(recoverHullOverlap(oldA, oldB, { a, b }).contact, null);
  a.state.velocity.x = 1;
  b.state.velocity.x = -1;
  assert.equal(
    recoverHullOverlap(oldA, oldB, { a, b, sameAttachmentGroup: true }).contact,
    null,
  );
  let marked = false;
  const result = sweepHulls(oldA, at(v(-0.4)), oldB, at(v(0.4)), {
    recovery: { a, b },
    onOverlap() {
      marked = true;
    },
  });
  assert.equal(marked, true);
  assert.ok(result);
});

test("moving-vertex world contacts retain old lever and original sweep extension", () => {
  const result = sweepHullTriangle(at(v(0, 1)), at(v()), ...floor);
  assert.ok(result);
  near(result.normal.y, 1);
  assert.equal(result.points.length, 4);
  assert.ok(result.contactTypes.every((type) => type === 1));
  assert.ok(result.points.every((point) => Math.abs(point.y - 0.5) < 1e-8));
  near(result.fraction, 0.5 / (1 + 0.0010434782598167658));
  assert.ok(
    result.measures.every((value) => Math.abs(value - result.fraction) < 1e-7),
  );
});

test("original material prefixes suppress contact and material flags control sides", () => {
  for (const prefix of ["!water", ">noncontact"]) {
    assert.equal(
      sweepHullTriangle(at(v(0, 1)), at(v()), ...floor, {
        materialIdentifier: prefix,
      }),
      null,
    );
  }
  assert.equal(
    sweepHullTriangle(at(v(0, -1)), at(v()), ...floor, { materialFlags: 0 }),
    null,
  );
  for (const flag of [0x800, 0x1000]) {
    const result = sweepHullTriangle(at(v(0, -1)), at(v()), ...floor, {
      materialFlags: flag,
    });
    assert.ok(result);
    near(result.normal.y, -1);
  }
  // '?' is conditional on a game global in C2; it is not unconditionally removed.
  assert.ok(
    sweepHullTriangle(at(v(0, 1)), at(v()), ...floor, {
      materialIdentifier: "?special",
      materialFlags: 0,
    }),
  );
});

test("finite triangle tests reject crossings outside world geometry", () => {
  assert.equal(sweepHullTriangle(at(v(20, 1)), at(v(20, -1)), ...floor), null);
  assert.equal(sweepHullTriangle(at(v(0, 2)), at(v(0, 3)), ...floor), null);
});

test("small world triangle crosses a moving hull face without any hull vertex hit", () => {
  const small = [v(-0.1, 0, -0.1), v(0, 0, 0.1), v(0.1, 0, -0.1)];
  const result = sweepHullTriangle(at(v(0, 1)), at(v()), ...small);
  assert.ok(result);
  assert.ok(result.points.length >= 1);
  assert.ok(result.contactTypes.includes(2));
  for (const point of result.points) {
    near(point.y, 0.5, 1e-5);
    assert.ok(Math.abs(point.x) <= 0.100001 && Math.abs(point.z) <= 0.100001);
  }
  near(result.normal.y, 1);
  near(result.fraction, 0.5);
});

test("coplanar face bits suppress world edges and their unavailable endpoints", () => {
  const small = [v(-0.1, 0, -0.1), v(0, 0, 0.1), v(0.1, 0, -0.1)];
  assert.equal(
    sweepHullTriangle(at(v(0, 1)), at(v()), ...small, { faceFlags: 7 }),
    null,
  );
  const result = sweepHullTriangle(at(v(0, 1)), at(v()), ...small, {
    faceFlags: 3,
    deferReduction: true,
  });
  assert.ok(result);
  const vertexPoints = result.points.filter(
    (_, index) => result.contactTypes[index] === 2,
  );
  assert.equal(vertexPoints.length, 2);
  assert.ok(vertexPoints.every((point) => point.z < 0));
});

test("coplanar edge flags preserve moving body-vertex face crossings", () => {
  const result = sweepHullTriangle(at(v(0, 1)), at(v()), ...floor, {
    faceFlags: 7,
  });
  assert.ok(result);
  assert.equal(result.points.length, 4);
  assert.ok(result.contactTypes.every((type) => type === 1));
});

test("old hull/world recovery selects floor edge intersections and suppressed endpoints", () => {
  const old = at(v(0, 0.25)),
    predicted = at(v(0, 0.15));
  const result = recoverWorldContacts(
    old,
    predicted,
    [
      {
        a: floor[0],
        b: floor[1],
        c: floor[2],
        materialFlags: 0,
        faceFriction: 0.7,
      },
    ],
    v(0, 0.25),
  );
  assert.equal(result.overlapDetected, true);
  assert.equal(result.contacts.length, 4);
  assert.equal(result.suppressedVertices.size, 4);
  for (const index of result.suppressedVertices)
    near(old.vertices[index].y, -0.25);
  for (const contact of result.contacts) {
    near(contact.points[0].y, 0);
    near(contact.normal.y, 1);
    near(contact.measures[0], 0);
    assert.equal(contact.contactTypes[0], 1);
    near(contact.faceFriction, 0.7);
  }
});

test("world recovery detection persists without an inward drift impulse", () => {
  const old = at(v(0, 0.25));
  const surfaces = [
    { a: floor[0], b: floor[1], c: floor[2], materialFlags: 0 },
  ];
  for (const candidate of [old, at(v(0, 0.35))]) {
    const result = recoverWorldContacts(old, candidate, surfaces, v(0, 0.25));
    assert.equal(result.overlapDetected, true);
    assert.equal(result.contacts.length, 0);
    assert.equal(result.suppressedVertices.size, 4);
  }
  const away = recoverWorldContacts(
    at(v(0, 1)),
    at(v(0, 0.9)),
    surfaces,
    v(0, 1),
  );
  assert.equal(away.overlapDetected, false);
});

test("world recovery respects material prefixes and authored one-sided normals", () => {
  const old = at(v(0, 0.25)),
    predicted = at(v(0, 0.15));
  for (const materialIdentifier of ["!water", ">ghost"])
    assert.equal(
      recoverWorldContacts(
        old,
        predicted,
        [
          {
            a: floor[0],
            b: floor[1],
            c: floor[2],
            materialIdentifier,
          },
        ],
        v(0, 0.25),
      ).overlapDetected,
      false,
    );
  const opposite = [
    { a: floor[2], b: floor[1], c: floor[0], materialFlags: 0 },
  ];
  assert.equal(
    recoverWorldContacts(old, predicted, opposite, v(0, 0.25)).overlapDetected,
    false,
  );
});

test("world recovery replaces edge CCD and suppresses both unavailable endpoint tests", () => {
  const small = [v(-0.1, 0, -0.1), v(0, 0, 0.1), v(0.1, 0, -0.1)];
  const old = at(v(0, 1)),
    predicted = at(v());
  assert.equal(
    sweepHullTriangle(old, predicted, ...small, { skipWorldEdges: true }),
    null,
  );
  assert.equal(
    sweepHullTriangle(old, predicted, ...floor, {
      skipWorldEdges: true,
      suppressedVertices: new Set(old.vertices.map((_, index) => index)),
    }),
    null,
  );
  assert.equal(
    sweepHullTriangle(old, predicted, ...small, { skipWorldVertices: true }),
    null,
  );
});

test("two recovery rays choose the COM-facing face and stable forward ties", () => {
  const left = {
    a: v(-0.25, -2, -2),
    b: v(-0.25, 2, -2),
    c: v(-0.25, 0, 2),
    materialFlags: 0,
  };
  const right = {
    a: v(0.25, -2, -2),
    b: v(0.25, 0, 2),
    c: v(0.25, 2, -2),
    materialFlags: 0,
  };
  const old = at(v()),
    predicted = at(v(0.1));
  old.edges = old.edges.map(([a, b]) =>
    old.vertices[a].x > old.vertices[b].x ? [b, a] : [a, b],
  );
  const result = recoverWorldContacts(old, predicted, [left, right], v());
  assert.equal(result.overlapDetected, true);
  assert.equal(result.contacts.length, 4);
  for (const contact of result.contacts) {
    near(contact.points[0].x, 0.25);
    near(contact.normal.x, -1);
  }
  for (const index of result.suppressedVertices)
    near(old.vertices[index].x, 0.5);
});

test("stationary world placement raycasts from COM to authored shape vertices", () => {
  const hull = at(v(0, 0.25));
  const surfaces = [
    { a: floor[0], b: floor[1], c: floor[2], materialFlags: 0 },
  ];
  const contacts = worldPlacementContacts([hull], surfaces, v(0, 0.25));
  assert.equal(contacts.length, 1);
  near(contacts[0].points[0].distanceTo(v(0, 0.25)), 0);
  near(contacts[0].normal.y, 1);
  assert.equal(contacts[0].contactTypes[0], 1);
  near(worldPlacementDirection(contacts).y, 1);
  assert.equal(
    worldPlacementDirection(
      worldPlacementContacts([at(v(0, 1))], surfaces, v(0, 1)),
    ),
    null,
  );
});

test("world placement direction preserves single normals and sums multiple rows", () => {
  const make = (normal) => ({ normal, points: [v()], penetration: 0 });
  near(worldPlacementDirection([make(v(0, 0.8))]).y, 0.8);
  near(
    worldPlacementDirection([make(v(0, 1)), make(v(1))]).distanceTo(
      v(1, 1).normalize(),
    ),
    0,
  );
  const orientation = new Quaternion().setFromAxisAngle(
    v(0, 0, 1),
    Math.PI / 2,
  );
  near(
    worldPlacementDirection(
      [make(v(0, 1)), make(v(0, -1))],
      orientation,
    ).distanceTo(v(0, 1)),
    0,
  );
});

test("placement hull overlap expands each target by original float .005", () => {
  const a = at(v());
  for (const gap of [0, 0.002, 0.00499]) {
    const b = at(v(1 + gap));
    assert.equal(placementHullsOverlap(a, b), true);
    assert.equal(placementHullsOverlap(b, a), true);
  }
  for (const gap of [0.00501, 0.1])
    assert.equal(placementHullsOverlap(a, at(v(1 + gap))), false);
});

test("placement hull overlap clips edges through rotated planes and detects containment", () => {
  const rotation = new Quaternion().setFromAxisAngle(v(0, 1), Math.PI / 4);
  assert.equal(placementHullsOverlap(at(v()), at(v(0.7), rotation)), true);
  assert.equal(placementHullsOverlap(at(v()), at(v(1.3), rotation)), false);
  const small = buildHull(
    cube.vertices.map((point) => point.clone().multiplyScalar(0.1)),
  );
  const inner = transformHull(small, v(), new Quaternion());
  assert.equal(placementHullsOverlap(at(v()), inner), true);
  assert.equal(placementHullsOverlap(inner, at(v())), true);
});

test("world emitter sorts contact measures and retains four per authored shape", () => {
  const values = [4, 1, 3, 0, 2, -1].map((measure, i) => ({
    normal: v(0, 1),
    points: [v(i * 0.1)],
    penetration: 0,
    measures: [measure],
  }));
  const reduced = reduceWorldContacts(values);
  assert.equal(reduced.length, 4);
  assert.deepEqual(
    reduced.map((contact) => contact.measures[0]),
    [-1, 0, 1, 2],
  );
  assert.equal(values.length, 6);
});

test("original duplicate thresholds preserve different contact normals", () => {
  const candidates = [
    { normal: v(0, 1), points: [v()], penetration: 0 },
    { normal: v(0, 1), points: [v(0.01)], penetration: 0 },
    { normal: v(0, -1), points: [v(0.05)], penetration: 0 },
    { normal: v(1), points: [v(0.01)], penetration: 0 },
    { normal: v(0, 1), points: [v(0.03)], penetration: 0 },
  ];
  const result = reduceWorldContacts(candidates);
  assert.equal(result.length, 3);
  assert.ok(result.some((contact) => contact.normal.x === 1));
  assert.ok(result.some((contact) => contact.points[0].x === 0.03));
});

test("final world list shares its four-row cap across shapes without aliasing vertex IDs", () => {
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    normal: v(0, 1),
    points: [v(index)],
    penetration: 0,
    measures: [index],
    vertexIndices: [0],
  }));
  const selected = finalizeWorldContacts(candidates);
  assert.equal(selected.length, 4);
  assert.deepEqual(
    selected.map((contact) => contact.points[0].x),
    [0, 1, 2, 3],
  );
});

test("final world normal gate truncates the prefix at dot less than or equal .95", () => {
  const selected = finalizeWorldContacts([
    { normal: v(0, 1), points: [v()], penetration: 0, measures: [0] },
    {
      normal: v(Math.sqrt(1 - 0.95 ** 2), 0.95),
      points: [v(1)],
      penetration: 0,
      measures: [1],
    },
    { normal: v(0, 1), points: [v(2)], penetration: 0, measures: [2] },
  ]);
  assert.equal(selected.length, 1);
  near(selected[0].points[0].x, 0);
});

test("rotating authored vertices use their actual endpoint paths", () => {
  const old = at(v(0, 0.7));
  const predicted = at(
    v(0, 0.7),
    new Quaternion().setFromAxisAngle(v(0, 0, 1), Math.PI / 4),
  );
  const result = sweepHullTriangle(old, predicted, ...floor, {
    materialFlags: 0,
  });
  assert.ok(result);
  near(result.normal.y, 1);
  assert.ok(
    result.points.every((point) =>
      old.vertices.some((vertex) => vertex.distanceTo(point) < 1e-8),
    ),
  );
});

test("moving-edge quadratic CCD returns the old edge torque point", () => {
  const result = sweepMovingEdges(
    v(0, -1),
    v(0, 1),
    v(1, 0, -1),
    v(1, 0, 1),
    v(-1, 0, -1),
    v(-1, 0, 1),
  );
  assert.ok(result);
  near(result.fraction, 0.5);
  near(result.normal.x, 1);
  assert.deepEqual(result.contactTypes, [0]);
  near(result.points[0].distanceTo(v(1)), 0);
  near(result.pointsB[0].distanceTo(v()), 0);
  assert.equal(
    sweepMovingEdges(
      v(0, -1),
      v(0, 1),
      v(1, 3, -1),
      v(1, 3, 1),
      v(-1, 3, -1),
      v(-1, 3, 1),
    ),
    null,
  );
});

test("each enabled static world edge retains only its two earliest hull crossings", () => {
  const result = sweepHullTriangle(
    at(v(1)),
    at(v(-1)),
    v(0, -1),
    v(0, 1),
    v(3, 1),
    {
      faceFlags: 6,
      deferReduction: true,
    },
  );
  assert.ok(result);
  assert.equal(result.points.length, 2);
  assert.ok(result.contactTypes.every((type) => type === 0));
  assert.ok(result.pointFractions.every((fraction) => fraction === 0.25));
  assert.ok(result.pointsB.every((point) => point.x === 0 && point.z === 0));
});

test("rotating edge CCD solves a quadratic coplanarity crossing", () => {
  const result = sweepMovingEdges(
    v(0, -1),
    v(0, 1),
    v(1, 0, -1),
    v(1, 0, 1),
    v(-1, 0, 0),
    v(1, 0, 2),
  );
  assert.ok(result);
  const fraction = (Math.sqrt(5) - 1) / 2;
  near(result.fraction, fraction);
  near(result.points[0].x, 1);
  near(result.points[0].z, -fraction);
  near(result.normal.z / result.normal.x, -fraction);
});

test("each swept vertex chooses its earliest world face before reduction", () => {
  const late = {
    normal: v(0, 1),
    points: [v()],
    penetration: 0,
    fraction: 0.8,
    vertexIndices: [2],
    measures: [-1],
  };
  const early = { ...late, normal: v(1), fraction: 0.3, measures: [-0.5] };
  const result = reduceWorldContacts([late, early]);
  assert.equal(result.length, 1);
  near(result[0].fraction, 0.3);
  near(result[0].normal.x, 1);
});
