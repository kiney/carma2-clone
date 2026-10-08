import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { Box3, Group, Quaternion, Vector3 } from "three";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText, parseAct } from "../src/formats.ts";
import { parseNonCarMechanics, parseTrackNonCarFiles } from "../src/noncars.ts";
import {
  buildHull,
  hullBounds,
  transformHull,
  sweepHulls,
  sweepHullTriangle,
  placementHullsOverlap,
} from "../src/physics/geometry.ts";
import { buildWireHull } from "../src/physics/wire-hull.ts";
import { createNonCarBody, nonCarActors } from "../src/physics/noncar-body.ts";

function assertHull(hull, points, label, planeTolerance = 1e-6) {
  assert.equal(
    hull.vertices.length,
    points.length,
    `${label}: authored storage`,
  );
  for (let i = 0; i < points.length; i++)
    assert.deepEqual(
      hull.vertices[i].toArray(),
      points[i].toArray(),
      `${label}: vertex ${i}`,
    );
  const expected = new Box3().setFromPoints(points),
    actual = hullBounds(hull);
  assert.deepEqual(
    actual.min.toArray(),
    expected.min.toArray(),
    `${label}: minimum`,
  );
  assert.deepEqual(
    actual.max.toArray(),
    expected.max.toArray(),
    `${label}: maximum`,
  );
  for (const face of hull.faces) {
    assert.ok(
      face.normal.toArray().every(Number.isFinite),
      `${label}: finite plane`,
    );
    assert.ok(
      Math.abs(face.normal.length() - 1) < 1e-6,
      `${label}: unit plane`,
    );
    for (const point of points)
      assert.ok(
        face.normal.dot(point) - face.constant <= planeTolerance,
        `${label}: containing halfspace`,
      );
  }
  const indices = [
    ...(hull.vertexOrder ?? []),
    ...hull.edges.flat(),
    ...hull.faces.flatMap((f) => f.indices),
  ];
  assert.ok(
    indices.every((i) => Number.isInteger(i) && i >= 0 && i < points.length),
    `${label}: authored IDs`,
  );
}

test("collinear boundary repair retains authored vertices and the exact box surface", () => {
  // Independently authored coordinates and ordering exercise a coplanar extension.
  const points = [
    [2, -1, -4],
    [2, -1, -1],
    [2, 3, -1],
    [2, 3, 1],
    [2, -1, 1],
    [2, -1, 4],
    [2, 3, 4],
    [2, 3, -4],
    [-2, -1, 1],
    [-2, -1, 4],
    [-2, 3, 4],
    [-2, 3, 1],
    [-2, 3, -1],
    [-2, 3, -4],
    [-2, -1, -4],
    [-2, -1, -1],
  ].map((point) => new Vector3(...point));
  const before = points.map((point) => point.toArray()),
    hull = buildHull(points);
  assertHull(hull, points, "synthetic collinear box");
  assert.deepEqual(
    points.map((point) => point.toArray()),
    before,
  );
  assert.deepEqual(
    [...hull.vertexOrder].sort((a, b) => a - b),
    [0, 5, 6, 7, 9, 10, 13, 14],
  );
  assert.equal(hull.edges.length, 12);
  assert.equal(hull.faces.length, 6);
  assert.ok(hull.faces.every((face) => face.indices.length === 4));
});

test("collinear repair still rejects flat and non-finite authored polyhedra", () => {
  assert.throws(
    () =>
      buildHull(
        [
          [0, 0, 0],
          [1, 0, 0],
          [2, 0, 0],
          [2, 0, 2],
          [0, 0, 2],
        ].map((point) => new Vector3(...point)),
      ),
    /Degenerate collision hull/,
  );
  assert.throws(
    () =>
      buildHull([
        new Vector3(),
        new Vector3(1, 0, 0),
        new Vector3(0, 1, 0),
        new Vector3(0, 0, NaN),
      ]),
    /Invalid collision hull vertices/,
  );
});

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const transformed = (hull, position = v()) =>
  transformHull(hull, position, new Quaternion());
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const transverseWire = () => buildWireHull([v(0, 0, -1), v(0, 0, 1)], [[0, 1]]);
const solidCube = () =>
  buildHull(
    [-0.5, 0.5].flatMap((x) =>
      [-0.5, 0.5].flatMap((y) => [-0.5, 0.5].map((z) => v(x, y, z))),
    ),
  );

test("wire world CCD uses authored endpoint rays and moving edges without invented faces", () => {
  const wire = transverseWire();
  const falling = sweepHullTriangle(
    transformed(wire, v(0, 1)),
    transformed(wire, v(0, -1)),
    v(-4, 0, -4),
    v(0, 0, 4),
    v(4, 0, -4),
    { skipWorldEdges: true, skipWorldVertices: true, deferReduction: true },
  );
  assert.ok(falling);
  assert.equal(falling.points.length, 2);
  assert.deepEqual(falling.contactTypes, [1, 1]);
  near(falling.fraction, 1 / (2 + 0.0010434782598167658));
  for (const point of falling.points) near(point.y, 1); // Source old torque lever.
  near(falling.normal.y, 1);

  const crossing = sweepHullTriangle(
    transformed(wire, v(1)),
    transformed(wire, v(-1)),
    v(0, -2),
    v(0, 2),
    v(3, 2),
    { faceFlags: 6, edgeOnly: true, deferReduction: true },
  );
  assert.ok(crossing);
  assert.deepEqual(crossing.contactTypes, [0]);
  near(crossing.fraction, 0.5);
  assert.deepEqual(crossing.points[0].toArray(), [1, 0, 0]);
  assert.deepEqual(crossing.pointsB[0].toArray(), [0, 0, 0]);
  near(crossing.normal.x, 1);
});

test("wire versus polyhedron edge CCD is symmetric and reports the first surface crossing", () => {
  const wire = transverseWire(),
    cube = solidCube();
  const oldWire = transformed(wire, v(1)),
    nextWire = transformed(wire, v(-1)),
    box = transformed(cube);
  const forward = sweepHulls(oldWire, nextWire, box, box);
  const reverse = sweepHulls(box, box, oldWire, nextWire);
  assert.ok(forward);
  assert.ok(reverse);
  near(forward.fraction, 0.25);
  near(reverse.fraction, 0.25);
  near(forward.normal.x, 1);
  near(reverse.normal.x, -1);
  assert.deepEqual(
    reverse.points.map((point) => point.toArray()),
    forward.pointsB.map((point) => point.toArray()),
  );
  assert.deepEqual(
    reverse.pointsB.map((point) => point.toArray()),
    forward.points.map((point) => point.toArray()),
  );
});

test("wire versus wire CCD retains finite edge contacts with no false interior detection", () => {
  const wire = transverseWire(),
    vertical = buildWireHull([v(0, -1), v(0, 1)], [[0, 1]]);
  const a = transformed(wire, v(1)),
    nextA = transformed(wire, v(-1)),
    b = transformed(vertical);
  let overlaps = 0;
  const options = { onOverlap: () => overlaps++ };
  const forward = sweepHulls(a, nextA, b, b, options),
    reverse = sweepHulls(b, b, a, nextA, options);
  assert.ok(forward);
  assert.ok(reverse);
  near(forward.fraction, 0.5);
  near(reverse.fraction, 0.5);
  near(forward.normal.x, 1);
  near(reverse.normal.x, -1);
  assert.deepEqual(forward.points[0].toArray(), [1, 0, 0]);
  assert.deepEqual(forward.pointsB[0].toArray(), [0, 0, 0]);
  assert.equal(overlaps, 0);
  assert.equal(
    sweepHulls(transformed(wire), transformed(wire), b, b, options),
    null,
  );
  assert.equal(overlaps, 0);
  assert.equal(placementHullsOverlap(transformed(wire), b), false);
});

test("wire placement and stationary CCD do not turn its bounds into a filled volume", () => {
  const wire = transformed(
    buildWireHull([v(-2, -2, -2), v(2, 2, 2)], [[0, 1]]),
  );
  const cube = transformed(solidCube(), v(0, 1.5));
  let overlaps = 0;
  const options = { onOverlap: () => overlaps++ };
  assert.equal(sweepHulls(wire, wire, cube, cube, options), null);
  assert.equal(sweepHulls(cube, cube, wire, wire, options), null);
  assert.equal(placementHullsOverlap(wire, cube), false);
  assert.equal(placementHullsOverlap(cube, wire), false);
  assert.equal(overlaps, 0);
});

let store;
try {
  await access(new URL("../carma2_orig/data.twt", import.meta.url));
  store = await createAssetStore(
    new URL("../carma2_orig", import.meta.url).pathname,
  );
} catch {
  // Proprietary assets are optional and remain outside the test fixtures.
}
const resolve = (path) =>
  store?.manifest.find(
    (entry) => entry.path.toLowerCase() === path.toLowerCase(),
  )?.path;
async function bytes(path) {
  const result = await store.read(resolve(path) ?? path);
  assert.ok(result, path);
  return result;
}

function actorTree(node) {
  const actor = new Group(),
    m = node.transform;
  actor.name = node.name;
  actor.matrix.set(
    m[0],
    m[3],
    m[6],
    m[9],
    m[1],
    m[4],
    m[7],
    m[10],
    m[2],
    m[5],
    m[8],
    m[11],
    0,
    0,
    0,
    1,
  );
  actor.matrix.decompose(actor.position, actor.quaternion, actor.scale);
  for (const child of node.children) actor.add(actorTree(child));
  return actor;
}

test(
  "all five stock Airport1 monorail instances preserve their bevelled collision shapes",
  {
    skip: !resolve("data/RACES/Airport1/airport1.act"),
  },
  async () => {
    const base = "data/RACES/Airport1/airport1",
      mechanics = new Map();
    for (const filename of parseTrackNonCarFiles(
      decodeText(await bytes(`${base}.txt`)),
    )) {
      const definition = parseNonCarMechanics(
        decodeText(await bytes(`data/NONCARS/${filename}`)),
        filename,
      );
      mechanics.set(definition.index, definition);
    }
    const root = new Group();
    for (const node of parseAct(await bytes(`${base}.act`)))
      root.add(actorTree(node));
    root.updateMatrixWorld(true);
    const names = new Set([
      "&07!0668.ACT",
      "&12!0669.ACT",
      "&12!0670.ACT",
      "&07!0671.ACT",
      "&07!0672.ACT",
    ]);
    const instances = nonCarActors(root).filter(({ actor }) =>
      names.has(actor.name),
    );
    assert.equal(instances.length, 5);
    for (const { actor, type } of instances) {
      const definition = mechanics.get(type),
        scale = new Vector3();
      actor.matrixWorld.decompose(new Vector3(), new Quaternion(), scale);
      const body = createNonCarBody(actor, definition);
      assert.equal(body.hulls.length, 2);
      const points = definition.shapes[0].vertices.map((point) =>
        new Vector3(...point).multiply(scale),
      );
      const hull = body.hulls[0];
      assertHull(hull, points, actor.name);
      assert.deepEqual(
        [...hull.vertexOrder].sort((a, b) => a - b),
        type === 7 ? [0, 5, 6, 7, 9, 10, 13, 14] : [1, 2, 5, 6, 9, 10, 13, 14],
      );
      assert.equal(hull.edges.length, 12);
      assert.equal(hull.faces.length, 6);
      assert.ok(hull.faces.every((face) => face.indices.length === 4));
      // Original front/rear planes have a small authored slope: retain that bevel.
      assert.equal(
        hull.faces.filter(
          (face) =>
            Math.abs(face.normal.y) > 1e-4 && Math.abs(face.normal.z) > 0.9,
        ).length,
        2,
      );
    }
  },
);

test(
  "stock noncar volumetric hulls contain all authored points; native wires remain explicit",
  {
    skip: !store,
  },
  async () => {
    const entries = store.manifest.filter((entry) =>
      /^data\/NONCARS\/[^/]+\.txt$/i.test(entry.path),
    );
    if (!entries.length) return;
    let parsed = 0,
      oversized = 0,
      wireSegments = 0,
      polyhedra = 0;
    for (const entry of entries) {
      let definition;
      try {
        definition = parseNonCarMechanics(
          decodeText(await bytes(entry.path)),
          entry.path,
        );
      } catch (error) {
        assert.match(entry.path, /\/79OILDRUM_0[123]\.txt$/i);
        assert.match(error.message, /polyhedron vertex count/);
        oversized++;
        continue;
      }
      parsed++;
      for (const [index, shape] of definition.shapes.entries()) {
        if (shape.kind === "polyhedron") {
          const points = shape.vertices.map((point) => new Vector3(...point));
          // Native accepts the same ~1.08e-6 overshoot on the learjet. Stored
          // float32 plane coefficients add coordinate-scale rounding to its
          // 1e-6 classification tolerance; do not reject that source behavior.
          const magnitude = Math.max(
            1,
            ...points.flatMap((point) => point.toArray().map(Math.abs)),
          );
          assertHull(
            buildHull(points),
            points,
            `${entry.path} shape ${index}`,
            1e-6 + magnitude * 2 ** -23,
          );
          polyhedra++;
        } else if (shape.kind === "wire") {
          // A native two-point wire is not a volumetric hull. Audit its contract
          // separately so valid original wire data is neither dropped nor truncated.
          assert.equal(shape.vertices.length, 2, entry.path);
          assert.deepEqual(shape.edges, [[0, 1]], entry.path);
          assert.match(entry.path, /\/(?:01checkout|39magnet_ball)\.txt$/i);
          wireSegments++;
        }
      }
      const actor = new Group();
      actor.name = `&${String(definition.index).padStart(2, "0")}!0000.ACT`;
      const body = createNonCarBody(actor, definition);
      assert.equal(body.hulls.length, definition.shapes.length, entry.path);
      for (const [index, shape] of definition.shapes.entries()) {
        if (shape.kind !== "wire") continue;
        const hull = body.hulls[index];
        assert.deepEqual(
          hull.vertices.map((point) => point.toArray()),
          shape.vertices,
          entry.path,
        );
        assert.deepEqual(hull.vertexOrder, [0, 1], entry.path);
        assert.deepEqual(hull.edges, shape.edges, entry.path);
        assert.deepEqual(hull.faces, [], entry.path);
        assertHull(
          hull,
          shape.vertices.map((point) => new Vector3(...point)),
          `${entry.path} wire ${index}`,
        );
      }
    }
    assert.equal(parsed + oversized, entries.length);
    assert.ok(polyhedra > 0);
    assert.ok(oversized <= 3);
    assert.ok(wireSegments <= 2);
    if (entries.length === 215) {
      assert.equal(parsed, 212);
      assert.equal(oversized, 3);
      assert.equal(wireSegments, 2);
    }
  },
);
