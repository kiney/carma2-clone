import test from "node:test";
import assert from "node:assert/strict";
import { Euler, Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import {
  collideHulls,
  hullBounds,
  hullPenetration,
  transformHull,
} from "../src/physics/geometry.ts";
import { guardPairTrajectory } from "../src/physics/pair-guard.ts";
import { DamageSystem } from "../src/damage.ts";
import { createSimulatedCar } from "../src/physics/simulation.ts";
import { originalCar } from "./support/original-car.mjs";
import {
  eagerAxes,
  eagerPenetration,
  eagerContact,
  legacyGuardPairTrajectory,
} from "./support/legacy-physics-guard.mjs";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const box = (x = 1, y = 1, z = 1) => buildBoxHull(v(-x, -y, -z), v(x, y, z));
const pose = (hull, position = v(), orientation = new Quaternion()) =>
  transformHull(hull, position, orientation);
const exact = (actual, expected, label) =>
  assert.ok(Object.is(actual, expected), `${label}: ${actual} != ${expected}`);
function exactVector(actual, expected, label) {
  for (let k = 0; k < 3; k++)
    exact(actual.getComponent(k), expected.getComponent(k), `${label}[${k}]`);
}
function compareSAT(a, b, label, tolerance = 0) {
  exact(hullPenetration(a, b), eagerPenetration(a, b), `${label} depth`);
  const expected = eagerContact(a, b, tolerance),
    actual = collideHulls(a, b, tolerance);
  assert.equal(
    actual === null,
    expected === null,
    `${label} collision decision`,
  );
  if (expected) {
    exact(actual.penetration, expected.penetration, `${label} penetration`);
    exactVector(actual.normal, expected.normal, `${label} normal`);
    assert.equal(
      actual.points.length,
      expected.points.length,
      `${label} manifold length`,
    );
    actual.points.forEach((point, i) =>
      exactVector(point, expected.points[i], `${label} point ${i}`),
    );
  }
}
function rng(seed = 0x12345678) {
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}
function body(hulls = [box(0.2, 0.2, 0.2)]) {
  return {
    hulls,
    properties: { centerOfMass: v(), mass: 1, inertia: v(1, 1, 1) },
    state: {
      position: v(),
      orientation: new Quaternion(),
      velocity: v(),
      angularVelocity: v(),
    },
  };
}
const linear =
  (start = v(), end = start, rotation = 0) =>
  (t) => ({
    position: start.clone().lerp(end, t),
    orientation: new Quaternion().setFromAxisAngle(v(0, 1, 0), rotation * t),
  });
function compareGuard(a, b, pathA, pathB, label, pairAllowed) {
  const expected = legacyGuardPairTrajectory(a, b, pathA, pathB, pairAllowed);
  const actual = guardPairTrajectory(a, b, pathA, pathB, pairAllowed);
  exact(actual, expected, label);
  assert.ok(expected >= 0 && expected <= 1, `${label} bounded fraction`);
  return expected;
}

test("optimized SAT exactly preserves seeded transformed hull depths, normals and manifolds", () => {
  const random = rng(),
    h1 = box(1, 0.7, 0.55),
    h2 = box(0.8, 0.65, 0.9);
  for (let i = 0; i < 100; i++) {
    const qa = new Quaternion().setFromEuler(
      new Euler(random() * 2, random() * 2, random() * 2),
    );
    const qb = new Quaternion().setFromEuler(
      new Euler(random() * 2, random() * 2, random() * 2),
    );
    const a = pose(h1, v(), qa),
      b = pose(
        h2,
        v((random() - 0.5) * 3, (random() - 0.5) * 2, (random() - 0.5) * 3),
        qb,
      );
    compareSAT(a, b, `seeded pair ${i}`);
    compareSAT(b, a, `swapped pair ${i}`, 0.001);
  }
});

test("near-parallel axes straddle the original 1e-7 deduplication threshold", () => {
  const h = box(),
    a = pose(h);
  for (const angle of [0.0002, 0.0006]) {
    const b = pose(
      h,
      v(1.9, 0.3, 0.2),
      new Quaternion().setFromAxisAngle(v(0, 1, 0), angle),
    );
    const count = eagerAxes(a, b).length;
    if (angle === 0.0002) assert.equal(count, 3, "near axes must deduplicate");
    else assert.ok(count > 3, "axes beyond the original threshold must remain");
    compareSAT(a, b, `angle ${angle}`);
    compareSAT(b, a, `swapped angle ${angle}`);
  }
});

test("face rejection avoids edge construction even with overlapping broadphase bounds", () => {
  const rotation = new Quaternion().setFromAxisAngle(v(0, 1, 0), Math.PI / 4);
  const rod = box(0.05, 0.1, 1.2);
  const a = pose(rod, v(), rotation);
  const b = pose(rod, v(0.2, 0, 0).applyQuaternion(rotation), rotation);
  assert.ok(
    hullBounds(a).intersectsBox(hullBounds(b)),
    "pair must enter narrowphase",
  );
  assert.equal(
    eagerPenetration(a, b),
    0,
    "parallel rods are separated along their face normal",
  );
  let edgeReads = 0;
  const watched = (hull) =>
    Object.defineProperty({ ...hull }, "edges", {
      get() {
        edgeReads++;
        return hull.edges;
      },
    });
  assert.equal(hullPenetration(watched(a), watched(b)), 0);
  assert.equal(
    edgeReads,
    0,
    "separation must stop before either edge array is constructed",
  );
});

test("zero and sub-threshold edge crosses retain baseline decisions", () => {
  const h = box(),
    a = pose(h),
    b = pose(h, v(0.3, 0.2, 0.1));
  const edges = [
    [0, 0],
    [0, 1],
    [0, 1],
  ];
  const degenerate = { ...a, edges };
  compareSAT(degenerate, { ...b, edges }, "zero and parallel edges");
  const tiny = {
    ...a,
    vertices: [...a.vertices, v(), v(1e-8, 0, 0)],
    edges: [[8, 9]],
    vertexOrder: a.vertices.map((_, i) => i),
  };
  compareSAT(tiny, b, "sub-threshold cross");
  const wire = { ...a, faces: [] };
  exact(hullPenetration(wire, b), eagerPenetration(wire, b), "wire depth");
  exact(hullPenetration(wire, b), 0, "wire has no solid depth");
});

test("equal-depth normal ties, touching and tolerance gaps preserve signs and axis order", () => {
  const h = box(),
    a = pose(h),
    b = pose(h);
  compareSAT(a, b, "coincident tied axes");
  const tied = collideHulls(a, b);
  exactVector(
    tied.normal,
    a.faces[0].normal.clone().normalize().multiplyScalar(-1),
    "first axis wins equal left/right depths",
  );
  for (const distance of [2 - 1e-7, 2, 2 + 0.0005, 2 + 0.002]) {
    compareSAT(a, pose(h, v(distance)), `distance ${distance}`);
    compareSAT(
      a,
      pose(h, v(distance)),
      `tolerated distance ${distance}`,
      0.001,
    );
  }
});

test("compact vertex order excludes retained storage and preserves authored traversal", () => {
  const h = box(),
    a = pose(h),
    b = pose(h, v(1.9, 0.2, 0.1));
  const originalOrder = a.vertices.map((_, i) => i);
  const retained = {
    ...a,
    vertices: [...a.vertices, v(1000, -1000, 1000), v(NaN, NaN, NaN)],
    vertexOrder: originalOrder,
  };
  compareSAT(retained, b, "ignored stored points");
  exact(
    eagerPenetration(retained, b),
    eagerPenetration(a, b),
    "ignored points do not enlarge depth",
  );
  compareSAT(
    { ...retained, vertexOrder: originalOrder.toReversed() },
    b,
    "reversed authored points",
  );
  compareSAT({ ...a, vertexOrder: [] }, b, "empty compact points");
});

test("NaN projection and signed-zero components preserve exact baseline outcomes", () => {
  const h = box(),
    a = pose(h),
    b = pose(h, v(0.3));
  const nanVertices = {
    ...a,
    vertices: a.vertices.map((point) => point.clone()),
  };
  nanVertices.vertices[0].x = NaN;
  compareSAT(nanVertices, b, "NaN projected point");
  const nanAxis = {
    ...a,
    faces: [...a.faces, { ...a.faces[0], normal: v(NaN, 0, 0) }],
  };
  compareSAT(nanAxis, b, "NaN accepted axis");
  const zeroFaces = {
    ...a,
    faces: a.faces.map((face) => ({ ...face, normal: face.normal.clone() })),
  };
  for (const face of zeroFaces.faces)
    for (const key of ["x", "y", "z"])
      if (face.normal[key] === 0) face.normal[key] = -0;
  compareSAT(zeroFaces, b, "negative zero normals");
});

test("face separation rejects before reading edge lists in both SAT entry points", () => {
  let reads = 0;
  const h = box(),
    a = pose(h),
    b = pose(h, v(10));
  const watched = (hull) => {
    const result = { ...hull };
    Object.defineProperty(result, "edges", {
      get() {
        reads++;
        return hull.edges;
      },
    });
    return result;
  };
  exact(hullPenetration(watched(a), watched(b)), 0, "separated depth");
  assert.equal(collideHulls(watched(a), watched(b)), null);
  assert.equal(
    reads,
    0,
    "clear face axis must avoid unused edge-cross construction",
  );
});

const scenarios = [
  [
    "head-on opposing paths",
    linear(v(-1), v(1)),
    linear(v(1), v(-1)),
    "blocked",
  ],
  ["side crossing with clear ends", linear(v(-1), v(1)), linear(), "blocked"],
  ["front crossing", linear(v(0, 0, -1), v(0, 0, 1)), linear(), "blocked"],
  ["rear crossing", linear(v(0, 0, 1), v(0, 0, -1)), linear(), "blocked"],
  [
    "off-center corner impact",
    linear(v(-1, 0, -0.8), v(0.7, 0, 0.4)),
    linear(),
    "blocked",
  ],
  [
    "vertically clear paths",
    linear(v(-1, 1, 0), v(1, 1, 0)),
    linear(),
    "clear",
  ],
  [
    "touching separation",
    linear(v(-0.2), v(-1)),
    linear(v(0.2), v(1)),
    "clear",
  ],
  [
    "touching tangential slide",
    linear(v(-0.2), v(-0.2, 0, -1)),
    linear(v(0.2)),
    "clear",
  ],
  ["initial overlap escapes", linear(v(-0.1), v(-1)), linear(v(0.1)), "clear"],
  [
    "initial overlap deepens",
    linear(v(-0.1), v(0.1)),
    linear(v(0.1)),
    "blocked",
  ],
  [
    "overlap clears then re-enters",
    (t) => ({
      position: v(-0.1 - Math.sin(Math.PI * t)),
      orientation: new Quaternion(),
    }),
    linear(v(0.1)),
    "blocked",
  ],
  [
    "no relative motion",
    linear(v(-0.1), v(0.1)),
    linear(v(0.1), v(0.3)),
    "clear",
  ],
  [
    "rotating off-center approach",
    linear(v(-1, 0, 0.2), v(0.1, 0, 0.2), 0.7),
    linear(v(0.1)),
    "blocked",
  ],
];
for (const [name, pa, pb, outcome] of scenarios) {
  test(`legacy guard fraction is exact for ${name}`, () => {
    const fraction = compareGuard(body(), body(), pa, pb, name);
    if (outcome === "blocked")
      assert.ok(fraction < 1, `${name} must exercise clamping`);
    else exact(fraction, 1, `${name} must remain clear`);
  });
}

test("rotation arcs and complete turns preserve angularTravel sampling and bisection", () => {
  const a = body([box(0.5, 0.04, 0.04)]),
    b = body([box(0.025, 0.025, 0.025)]);
  for (const turn of [Math.PI, 2 * Math.PI, 8 * Math.PI]) {
    const pa = linear(v(), v(), turn),
      pb = linear(v(0, 0, 0.35));
    pa.angularTravel = turn;
    const fraction = compareGuard(a, b, pa, pb, `rotation ${turn}`);
    assert.ok(
      fraction > 0 && fraction < 1,
      "clear endpoints must still detect the rotation arc",
    );
  }
});

test("each hull pair keeps independent overlap allowance", () => {
  const left = buildBoxHull(v(-1.2, -0.2, -0.2), v(-0.8, 0.2, 0.2));
  const right = buildBoxHull(v(0.8, -0.2, -0.2), v(1.2, 0.2, 0.2));
  const a = body([left, right]),
    b = body([box(0.2, 0.2, 0.2)]);
  // The left hull begins embedded and moves away; the initially clear right hull
  // subsequently enters the target and must not inherit the left hull's allowance.
  const pa = linear(v(), v(-2)),
    pb = linear(v(-0.9));
  const fraction = compareGuard(a, b, pa, pb, "independent two-hull allowance");
  assert.ok(
    fraction > 0.7 && fraction < 1,
    "the clear hull's later entry must clamp",
  );
  const escapeOnly = compareGuard(
    body([left]),
    b,
    pa,
    pb,
    "embedded hull escapes",
  );
  exact(escapeOnly, 1, "escaping overlap alone must remain allowed");
});

test("cache lifetime observes in-place vertex and plane mutation between moving guard calls", () => {
  const a = body([box(0.5, 0.4, 0.3)]),
    b = body([box(0.5, 0.4, 0.3)]);
  const pa = linear(v(-3), v(3)),
    pb = linear();
  const before = compareGuard(a, b, pa, pb, "before pooled hull mutation");
  assert.ok(before > 0 && before < 1, "first call must exercise a collision");
  const hull = a.hulls[0],
    vertices = hull.vertices,
    faces = hull.faces;
  for (const point of vertices) point.x += 6;
  for (const face of faces) face.constant += face.normal.x * 6;
  assert.equal(a.hulls[0], hull);
  assert.equal(a.hulls[0].vertices, vertices);
  assert.equal(a.hulls[0].faces, faces);
  const after = compareGuard(a, b, pa, pb, "after pooled hull mutation");
  exact(after, 1, "moved local hull clears the same moving trajectory");
  assert.notEqual(
    before,
    after,
    "mutation test must change the actual guard outcome",
  );
});

test("pair rejection precedes sampling in both guard implementations", () => {
  const forbiddenPath = () => {
    throw new Error("Rejected pair path must not be sampled");
  };
  exact(
    compareGuard(
      body(),
      body(),
      forbiddenPath,
      forbiddenPath,
      "rejected pair",
      () => false,
    ),
    1,
    "rejected fraction",
  );
});

async function stock(t, name) {
  let original;
  try {
    original = await originalCar(name);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip("Original installation absent");
    return null;
  }
  const damage = new DamageSystem(
    original.assets,
    original.group,
    original.text,
  );
  await damage.init();
  return createSimulatedCar(
    original.group,
    original.text,
    damage,
    v(),
    0,
    true,
  );
}
for (const name of ["EAGLE3", "buggy", "bigdump"]) {
  test(`original ${name} guard and SAT exactly match baseline authored hulls`, async (t) => {
    const a = await stock(t, name);
    if (!a) return;
    const b = await stock(t, "EAGLE3");
    if (!b) return;
    for (const [i, hull] of a.hulls.entries())
      compareSAT(
        pose(
          hull,
          v(0.05),
          new Quaternion().setFromAxisAngle(v(0, 1, 0), 0.31),
        ),
        pose(b.hulls[0]),
        `${name} hull ${i}`,
      );
    for (const [label, pa] of [
      ["side", linear(v(-2, 0, 0.05), v(2, 0, 0.05))],
      ["oblique", linear(v(-2, 0, -0.5), v(1, 0, 0.3), 0.4)],
    ]) {
      const fraction = compareGuard(a, b, pa, linear(), `${name} ${label}`);
      assert.ok(
        fraction > 0 && fraction < 1,
        `${name} ${label} must exercise authored collision geometry`,
      );
    }
  });
}
