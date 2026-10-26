import test from "node:test";
import { existsSync, readdirSync } from "node:fs";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parseCarMechanics } from "../src/mechanics.ts";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import {
  buildHull,
  hullBounds,
  hullsBounds,
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

test("source tetrahedron seeding preserves compact feature and stable edge order", () => {
  // First three authored cube points are coplanar at minX; authored point4
  // seeds the tetrahedron before coplanar point3 expands that first face.
  assert.deepEqual(cube.vertexOrder, [0, 1, 2, 4, 3, 5, 6, 7]);
  assert.deepEqual(cube.edges, [
    [0, 1],
    [0, 2],
    [0, 4],
    [1, 3],
    [2, 3],
    [1, 5],
    [4, 5],
    [2, 6],
    [4, 6],
    [3, 7],
    [5, 7],
    [6, 7],
  ]);
  assert.deepEqual(
    cube.faces.map((face) => face.normal.toArray().map((value) => value || 0)),
    [
      [-1, 0, 0],
      [0, -1, 0],
      [0, 0, -1],
      [0, 0, 1],
      [0, 1, 0],
      [1, 0, 0],
    ],
  );
});

test("interior authored vertices keep damage indices but are omitted from collision features", () => {
  const authored = [...cube.vertices.map((point) => point.clone()), v()];
  const hull = buildHull(authored);
  assert.equal(hull.vertices.length, 9);
  assert.equal(hull.vertexOrder.length, 8);
  assert.ok(!hull.vertexOrder.includes(8));
  assert.ok(hull.edges.every((edge) => edge.every((index) => index < 8)));
  authored.forEach((point, index) =>
    near(hull.vertices[index].distanceTo(point), 0),
  );
  const old = transformHull(hull, v(0, 1), new Quaternion());
  const predicted = transformHull(hull, v(0, -1), new Quaternion());
  assert.deepEqual(old.vertexOrder, hull.vertexOrder);
  const hit = sweepHullTriangle(old, predicted, ...floor, {
    deferReduction: true,
  });
  assert.ok(hit);
  hit.contactTypes.forEach((type, index) => {
    if (type === 1) assert.notEqual(hit.vertexIndices[index], 8);
  });
});

test("stock polyhedra retain authored indexing and finite closed source topology", async (t) => {
  const directory = new URL("../carma2_orig/data/CARS/", import.meta.url);
  if (!existsSync(directory)) {
    t.skip("Local original car archives absent");
    return;
  }
  const assets = await createAssetStore(
    new URL("../carma2_orig", import.meta.url).pathname,
  );
  const names = readdirSync(directory)
    .filter((name) => /\.twt$/i.test(name))
    .map((name) => name.slice(0, -4));
  let count = 0;
  for (const name of names) {
    const bytes = await assets.read(`data/CARS/${name}/${name}.txt`);
    assert.ok(bytes, name);
    const mechanics = parseCarMechanics(decodeText(bytes));
    for (const shape of mechanics.shapes) {
      if (shape.kind !== "polyhedron") continue;
      const authored = shape.vertices.map((point) => v(...point));
      const hull = buildHull(authored);
      assert.equal(hull.recoveredFrom, undefined, `${name}: native primary`);
      if (name.toLowerCase() === "dondump") {
        // Direct original-HW0x420fd0 measurements: the near-coplanar end
        // retains edge2->7, whose presence depends on x87 spill precision.
        assert.deepEqual(hull.edges, [
          [0, 1],
          [1, 2],
          [0, 2],
          [1, 3],
          [2, 3],
          [0, 4],
          [1, 5],
          [4, 5],
          [2, 6],
          [4, 6],
          [5, 6],
          [2, 7],
          [3, 7],
          [5, 7],
          [6, 7],
          [0, 8],
          [2, 8],
          [4, 9],
          [6, 9],
          [8, 9],
        ]);
        assert.equal(hull.faces.length, 12);
      }
      if (
        name.toLowerCase() === "logmachine" &&
        shape === mechanics.shapes[2]
      ) {
        // The original also compacts this near-flat seed to these six points.
        assert.deepEqual(hull.vertexOrder, [0, 1, 2, 3, 4, 5]);
        assert.equal(hull.edges.length, 10);
      }
      assert.equal(hull.vertices.length, authored.length, name);
      assert.equal(
        new Set(hull.vertexOrder).size,
        hull.vertexOrder.length,
        name,
      );
      assert.equal(
        hull.edges.length,
        hull.vertexOrder.length + hull.faces.length - 2,
        name,
      );
      const used = new Set(hull.edges.flat());
      assert.ok(
        hull.vertexOrder.every((index) => used.has(index)),
        name,
      );
      for (const face of hull.faces) {
        assert.ok(face.indices.length >= 3, name);
        assert.ok(face.normal.toArray().every(Number.isFinite), name);
        assert.ok(
          face.indices.every((index) => hull.vertexOrder.includes(index)),
          name,
        );
      }
      count++;
    }
  }
  assert.equal(names.length, 52);
  assert.equal(count, 59);
});

test("source collision bounds exclude retired authored storage and aggregate active shapes", () => {
  const hull = buildHull([...cube.vertices, v()]);
  hull.vertices[8].set(100, -100, 200); // A retired slot remains available to damage storage.
  const bounds = hullBounds(hull);
  near(bounds.min.distanceTo(v(-0.5, -0.5, -0.5)), 0);
  near(bounds.max.distanceTo(v(0.5, 0.5, 0.5)), 0);
  const moved = transformHull(hull, v(2), new Quaternion());
  const aggregate = hullsBounds([hull, moved]);
  near(aggregate.max.x, 2.5);
  near(aggregate.min.y, -0.5);
  near(aggregate.max.z, 0.5);
});

test("native bent hull retains coplanar CCD branches while face polygons remain closed", async (t) => {
  const { originalCar } = await import("./support/original-car.mjs");
  let data;
  try {
    data = await originalCar("EAGLE3");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local original Eagle archive absent");
      return;
    }
    throw error;
  }
  const { DamageSystem } = await import("../src/damage.ts");
  const { createSimulatedCar } = await import("../src/physics/simulation.ts");
  const damage = new DamageSystem(data.assets, data.group, data.text);
  await damage.init();
  damage.damageContext.random = () => 0;
  const car = createSimulatedCar(data.group, data.text, damage, v(), 0, true);
  damage.applyImpact(
    [v(0, 0.1, -0.3)],
    v(0, 0, 5),
    false,
    true,
    10000,
    v(0, 0, 5),
  );
  assert.ok(damage.structuralBend);
  const hull = buildHull(car.shapeVertices[0]);
  assert.equal(
    hull.recoveredFrom,
    undefined,
    "native bent CCD branches retained",
  );
  // Measured directly from original HW0x420fd0 on this resulting point array.
  assert.deepEqual(
    hull.vertexOrder,
    Array.from({ length: 12 }, (_, i) => i),
  );
  assert.deepEqual(hull.edges, [
    [0, 1],
    [1, 2],
    [0, 3],
    [0, 4],
    [2, 4],
    [1, 5],
    [3, 5],
    [5, 6],
    [3, 7],
    [6, 7],
    [2, 10],
    [6, 10],
    [9, 10],
    [4, 11],
    [8, 11],
    [7, 11],
    [10, 11],
  ]);
  assert.equal(hull.faces.length, 7);
  near(hull.faces[6].normal.y, 0.9983391761779785);
  near(hull.faces[6].normal.z, -0.057609423995018005);
  near(hull.faces[6].constant, 0.2195526510477066);
  // These are still original vertex/edge CCD features, although they branch
  // into the interiors of the two side faces instead of their boundary loops.
  assert.ok(hull.vertexOrder.includes(8) && hull.vertexOrder.includes(9));
  const left = hull.faces.find((face) => face.normal.x === -1);
  const right = hull.faces.find((face) => face.normal.x === 1);
  assert.ok(left && right);
  assert.ok(!left.indices.includes(8) && !right.indices.includes(9));
  for (const face of hull.faces) {
    assert.ok(face.indices.length >= 3);
    assert.equal(new Set(face.indices).size, face.indices.length);
    for (const index of face.indices)
      near(face.normal.dot(hull.vertices[index]), face.constant);
  }
});

test("native buggy bend preserves source planes without auxiliary cycles through transforms", async (t) => {
  const { originalCar } = await import("./support/original-car.mjs");
  let data;
  try {
    data = await originalCar("buggy");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local original buggy archive absent");
      return;
    }
    throw error;
  }
  const { DamageSystem } = await import("../src/damage.ts");
  const { createSimulatedCar } = await import("../src/physics/simulation.ts");
  const damage = new DamageSystem(data.assets, data.group, data.text);
  await damage.init();
  damage.damageContext.random = () => 0;
  const car = createSimulatedCar(
    data.group,
    data.text,
    damage,
    v(0, 3),
    0,
    true,
  );
  const points = car.shapeVertices.flat();
  const point = v(
    Math.min(...points.map((p) => p.x)) * 0.4,
    0.1,
    Math.max(...points.map((p) => p.z)) * 0.8,
  );
  damage.applyImpact([point], v(0, 0, -5), false, true, 10000, v(0, 0, -5));
  assert.ok(damage.structuralBend);
  const hull = buildHull(car.shapeVertices[0]);
  // Native original420fd0 accepts both retained near-duplicate half-spaces.
  assert.deepEqual(
    hull.vertexOrder,
    Array.from({ length: 18 }, (_, i) => i),
  );
  assert.equal(hull.edges.length, 33);
  assert.equal(hull.faces.length, 18);
  assert.deepEqual(
    hull.faces
      .map((face, index) => (face.indices.length < 3 ? index : -1))
      .filter((index) => index >= 0),
    [13, 14],
  );
  const measured = [
    [0, 0.939590573310852, -0.3423004448413849, 0.24789783358573914],
    [
      1.5525394303494977e-8, 0.939590573310852, -0.3423003852367401,
      0.24789781868457794,
    ],
  ];
  for (const [index, expected] of measured.entries()) {
    const face = hull.faces[index + 13];
    [...face.normal.toArray(), face.constant].forEach((value, i) =>
      assert.equal(value || 0, expected[i]),
    );
  }
  const position = v(2, -1, 3),
    rotation = new Quaternion().setFromAxisAngle(v(1, 2, 3).normalize(), 0.7);
  const transformed = transformHull(hull, position, rotation);
  for (let i = 0; i < hull.faces.length; i++) {
    const local = hull.faces[i],
      world = transformed.faces[i];
    near(world.constant, local.constant + world.normal.dot(position));
    assert.ok(Number.isFinite(world.constant));
    const localPoint = local.normal
      .clone()
      .multiplyScalar(local.constant / local.normal.lengthSq());
    near(
      world.normal.dot(localPoint.applyQuaternion(rotation).add(position)),
      world.constant,
    );
  }
});
