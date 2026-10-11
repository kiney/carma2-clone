import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import { nativeSphereMovingWorldContacts } from "../src/physics/sphere-moving-world.ts";
import { nativeSphereWorldContacts } from "../src/physics/sphere-contact.ts";
import {
  createMovingWorldBody,
  prepareMovingWorldPose,
  captureMovingWorldPose,
} from "../src/physics/moving-world.ts";
import { pointVelocity } from "../src/physics/contact.ts";

const f = Math.fround,
  sphere = { radius: 0.5, radiusSquared: 0.25, center: [0, 0, 0] };
const identity = (x = 0, y = 0, z = 0) => [1, 0, 0, 0, 1, 0, 0, 0, 1, x, y, z];
const pose = (position, orientation = new Quaternion()) => {
  const axes = [
    new Vector3(1, 0, 0),
    new Vector3(0, 1, 0),
    new Vector3(0, 0, 1),
  ].flatMap((a) => a.applyQuaternion(orientation).toArray().map(f));
  return [...axes, ...position.toArray().map(f)];
};
function near(actual, expected, epsilon = 2e-6) {
  if (typeof expected === "number")
    assert.ok(
      Math.abs(actual - expected) <= epsilon,
      `${actual} != ${expected}`,
    );
  else expected.forEach((value, i) => near(actual[i], value, epsilon));
}
function fixture({
  oldPosition = new Vector3(),
  oldOrientation = new Quaternion(),
  newPosition = new Vector3(0, 2, 0),
  newOrientation = oldOrientation,
  vertices = [
    [-10, 0, -10],
    [0, 0, 10],
    [10, 0, -10],
  ],
  normal = [0, 1, 0],
  extra = {},
} = {}) {
  const actor = new Group();
  actor.position.copy(oldPosition);
  actor.quaternion.copy(oldOrientation);
  const owner = createMovingWorldBody(actor);
  prepareMovingWorldPose(owner, newPosition, newOrientation, 1);
  const world = (p) =>
    new Vector3(...p).applyQuaternion(newOrientation).add(newPosition);
  const [a, b, c] = vertices.map(world),
    n = new Vector3(...normal).applyQuaternion(newOrientation);
  const surface = {
    a,
    b,
    c,
    normal: n,
    minY: Math.min(a.y, b.y, c.y),
    maxY: Math.max(a.y, b.y, c.y),
    material: "actual-floor.MAT",
    modifier: {},
    twoSided: false,
    materialFlags: 0,
    faceFlags: 7,
    owner,
    faceFriction: 0.4,
    ...extra,
  };
  return { owner, surface };
}
const input = (old = identity(0, 2, 0), predicted = old, s = sphere) => ({
  sphere: s,
  oldPose: old,
  predictedPose: predicted,
});

test("full target translation catches a stationary sphere and preserves independent OLD torque points", () => {
  const { surface } = fixture();
  const rows = nativeSphereMovingWorldContacts(input(), [surface]);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.fraction, 0.75);
  assert.deepEqual(row.contactTypes, [3]);
  near(row.normal.toArray(), [0, 1, 0]);
  near(row.points[0].toArray(), [0, 1.5, 0]);
  near(row.pointsB[0].toArray(), [0, 0, 0]);
  assert.equal(row.sourceSurface, surface);
  assert.equal(row.faceFriction, 0.4);
});
test("translated tangential motion reconstructs the target feature rather than sharing A's old surface point", () => {
  const { surface } = fixture({
    oldPosition: new Vector3(5, 0, 0),
    newPosition: new Vector3(7, 2, 0),
  });
  const row = nativeSphereMovingWorldContacts(input(identity(7, 2, 0)), [
    surface,
  ])[0];
  assert.equal(row.fraction, 0.75);
  near(row.points[0].toArray(), [7, 1.5, 0]);
  near(row.pointsB[0].toArray(), [5.5, 0, 0]);
});
test("rotating target uses endpoint relative bases and an OLD feature lever, without quaternion arc guessing", () => {
  const rotation = new Quaternion().setFromAxisAngle(
    new Vector3(0, 0, 1),
    Math.PI / 2,
  );
  const { surface, owner } = fixture({
    newPosition: new Vector3(),
    newOrientation: rotation,
  });
  const row = nativeSphereMovingWorldContacts(input(), [surface])[0];
  near(row.fraction, 0.75);
  near(row.normal.toArray(), [0, 1, 0]);
  near(row.points[0].toArray(), [0, 1.5, 0]);
  near(row.pointsB[0].toArray(), [1.5, 0, 0]);
  near(pointVelocity(owner.state, owner.properties, row.pointsB[0]).toArray(), [
    0,
    Math.PI * 0.75,
    0,
  ]);
});
test("source sphere MODEL-center offset and rotating A retain authored OLD surface position", () => {
  const shape = { ...sphere, center: [1, 0, 0] },
    orientation = new Quaternion().setFromAxisAngle(
      new Vector3(0, 0, 1),
      Math.PI / 2,
    ),
    { surface } = fixture({ newPosition: new Vector3() });
  const rows = nativeSphereMovingWorldContacts(
    input(identity(0, 2, 0), pose(new Vector3(0, -1, 0), orientation), shape),
    [surface],
  );
  const row = rows[0];
  near(row.fraction, 0.75);
  near(row.points[0].toArray(), [1, 1.5, 0]);
  near(row.pointsB[0].toArray(), [0.25, 0, 0]);
});
test("captured geometry/query pose survives subsequent live owner rollback", () => {
  const { surface, owner } = fixture();
  surface.collectedPose = captureMovingWorldPose(owner);
  owner.state.position.set(90, 91, 92);
  owner.state.predictedPosition.set(-50, 60, -70);
  owner.state.orientation.setFromAxisAngle(new Vector3(1, 0, 0), 1);
  owner.state.predictedOrientation.setFromAxisAngle(new Vector3(0, 1, 0), 2);
  const row = nativeSphereMovingWorldContacts(input(), [surface])[0];
  assert.equal(row.fraction, 0.75);
  near(row.pointsB[0].toArray(), [0, 0, 0]);
  near(row.points[0].toArray(), [0, 1.5, 0]);
});
test("pose wrapper retains actual cached source face identity without mutating it", () => {
  const { surface, owner } = fixture();
  const wrapper = {
    ...surface,
    sourceSurface: surface,
    collectedPose: captureMovingWorldPose(owner),
  };
  const row = nativeSphereMovingWorldContacts(input(), [wrapper])[0];
  assert.equal(row.sourceSurface, surface);
  assert.equal(surface.collectedPose, undefined);
});
test("explicit packed plane constant controls TOI while finite projection controls B point", () => {
  const { surface } = fixture({ extra: { constant: 2.125 } });
  const row = nativeSphereMovingWorldContacts(input(), [surface])[0];
  assert.equal(row.fraction, 0.6875);
  near(row.pointsB[0].toArray(), [0, 0, 0]);
  near(row.points[0].toArray(), [0, 1.5, 0]);
});
test("provided authored normal is retained independently of triangle winding", () => {
  const n = [0.001, f(Math.sqrt(1 - 0.001 ** 2)), 0],
    { surface } = fixture({ normal: n });
  const first = nativeSphereMovingWorldContacts(input(), [surface])[0];
  [surface.b, surface.c] = [surface.c, surface.b];
  const second = nativeSphereMovingWorldContacts(input(), [surface])[0];
  near(second.fraction, first.fraction);
  near(first.normal.toArray(), n);
  near(second.normal.toArray(), n);
});
test("finite triangle excludes the face while the analytic edge supplies source4 and its real old feature", () => {
  const { surface } = fixture({
    vertices: [
      [-1, 0, 0],
      [1, 0, 0],
      [0, 0, -2],
    ],
    extra: { faceFlags: 6 },
  });
  const rows = nativeSphereMovingWorldContacts(input(identity(0, 2, 0.3)), [
    surface,
  ]);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.deepEqual(row.contactTypes, [4]);
  near(row.fraction, 0.8);
  near(row.normal.toArray(), [0, 0.8, 0.6]);
  near(row.points[0].toArray(), [0, 1.6, 0]);
  near(row.pointsB[0].toArray(), [0, 0, 0]);
});
test("rotating target preserves source4 blended sphere torque direction and separate old emitted normal", () => {
  const rotation = new Quaternion().setFromAxisAngle(
    new Vector3(0, 0, 1),
    Math.PI / 2,
  );
  const { surface } = fixture({
    newPosition: new Vector3(),
    newOrientation: rotation,
    vertices: [
      [-10, 0, 0],
      [10, 0, 0],
      [0, 0, -10],
    ],
    extra: { faceFlags: 6 },
  });
  const row = nativeSphereMovingWorldContacts(input(identity(0, 2, 0.3)), [
    surface,
  ])[0];
  assert.deepEqual(row.contactTypes, [4]);
  near(row.fraction, 0.8);
  near(row.normal.toArray(), [0, 0.8, 0.6]);
  near(row.pointsB[0].toArray(), [1.6, 0, 0]);
  const length = Math.sqrt(0.64 ** 2 + 0.16 ** 2 + 0.6 ** 2);
  near(row.points[0].toArray(), [
    (0.5 * 0.64) / length,
    2 - (0.5 * 0.16) / length,
    0.3 - (0.5 * 0.6) / length,
  ]);
});
test("analytic moving endpoint and resting edge paths retain exact source feature endpoints", () => {
  const vertices = [
      [-1, 0, 0],
      [1, 0, 0],
      [0, 0, -2],
    ],
    moving = fixture({ vertices, extra: { faceFlags: 6 } }),
    row = nativeSphereMovingWorldContacts(input(identity(1.3, 2, 0.3)), [
      moving.surface,
    ])[0];
  assert.deepEqual(row.contactTypes, [4]);
  near(row.pointsB[0].toArray(), [1, 0, 0]);
  const resting = fixture({
      vertices,
      newPosition: new Vector3(),
      extra: { faceFlags: 6, collisionMode: "edges" },
    }),
    rest = nativeSphereMovingWorldContacts(input(identity(1.3, 0.266, 0.3)), [
      resting.surface,
    ])[0];
  assert.equal(rest.fraction, 1);
  near(rest.pointsB[0].toArray(), [1, 0, 0]);
});
test("edge flags1/2/4 and80 suppress features while face80 remains eligible", () => {
  const { surface } = fixture({
    vertices: [
      [-1, 0, 0],
      [1, 0, 0],
      [0, 0, -2],
    ],
    extra: { faceFlags: 6 },
  });
  assert.equal(
    nativeSphereMovingWorldContacts(input(identity(0, 2, 0.3)), [surface])
      .length,
    1,
  );
  for (const flags of [7, 0x80]) {
    surface.faceFlags = flags;
    assert.equal(
      nativeSphereMovingWorldContacts(input(identity(0, 2, 0.3)), [surface])
        .length,
      0,
    );
  }
  const large = fixture({ extra: { faceFlags: 0x80 } }).surface;
  assert.deepEqual(
    nativeSphereMovingWorldContacts(input(), [large])[0].contactTypes,
    [3],
  );
});
test("backface keeps installed signed-distance quotient and requires material1000", () => {
  const { surface } = fixture({ newPosition: new Vector3(0, -2, 0) });
  assert.equal(
    nativeSphereMovingWorldContacts(input(identity(0, -2, 0)), [surface])
      .length,
    0,
  );
  surface.materialFlags = 0x800;
  assert.equal(
    nativeSphereMovingWorldContacts(input(identity(0, -2, 0)), [surface])
      .length,
    0,
  );
  surface.materialFlags = 0x1000;
  const row = nativeSphereMovingWorldContacts(input(identity(0, -2, 0)), [
    surface,
  ])[0];
  assert.equal(row.fraction, 1);
  near(row.normal.toArray(), [0, -1, 0]);
  near(row.points[0].toArray(), [0, -1.5, 0]);
  near(row.pointsB[0].toArray(), [0, 0, 0]);
});
test("material prefixes reject finite face but do not invent an extra edge filter", () => {
  for (const prefix of ["!", ">", "?"]) {
    const large = fixture({ extra: { material: `${prefix}floor` } }).surface;
    assert.equal(nativeSphereMovingWorldContacts(input(), [large]).length, 0);
    const small = fixture({
      vertices: [
        [-1, 0, 0],
        [1, 0, 0],
        [0, 0, -2],
      ],
      extra: { material: `${prefix}edge`, faceFlags: 6 },
    }).surface;
    assert.deepEqual(
      nativeSphereMovingWorldContacts(input(identity(0, 2, 0.3)), [small])[0]
        .contactTypes,
      [4],
    );
  }
});
test("multiple owners retain one earliest finite face, stable face ties and unreduced ordered edges", () => {
  const early = fixture({ newPosition: new Vector3(0, 3, 0) }).surface,
    late = fixture().surface,
    small = fixture({
      vertices: [
        [-1, 0, 0],
        [1, 0, 0],
        [0, 0, -2],
      ],
      extra: { faceFlags: 6 },
    }).surface;
  const rows = nativeSphereMovingWorldContacts(input(identity(0, 2, 0.3)), [
    late,
    early,
    small,
  ]);
  assert.deepEqual(
    rows.map((r) => r.contactTypes[0]),
    [3, 4],
  );
  assert.equal(rows[0].fraction, 0.5);
  assert.equal(rows[0].sourceSurface, early);
  assert.equal(rows[1].sourceSurface, small);
  const twin = fixture().surface;
  assert.equal(
    nativeSphereMovingWorldContacts(input(), [late, twin])[0].sourceSurface,
    late,
  );
});
test("disabled/passthrough faces and edges-only policy preserve source world processing", () => {
  const { surface } = fixture();
  surface.enabled = false;
  assert.equal(nativeSphereMovingWorldContacts(input(), [surface]).length, 0);
  surface.enabled = true;
  surface.collisionMode = "passthrough";
  assert.equal(nativeSphereMovingWorldContacts(input(), [surface]).length, 0);
  surface.collisionMode = "edges";
  assert.equal(nativeSphereMovingWorldContacts(input(), [surface]).length, 0);
});
test("stationary target adapter matches existing source world points/normals and metadata", () => {
  const { surface } = fixture({ newPosition: new Vector3() });
  const body = input(identity(0, 2, 0), identity(0, -2, 0));
  const source = nativeSphereWorldContacts(body, [
      {
        a: surface.a.toArray(),
        b: surface.b.toArray(),
        c: surface.c.toArray(),
        normal: surface.normal.toArray(),
        constant: 0,
        materialIdentifier: surface.material,
        materialFlags: surface.materialFlags,
        faceFlags: surface.faceFlags,
        faceFriction: surface.faceFriction,
        sourceSurface: surface,
      },
    ]),
    actual = nativeSphereMovingWorldContacts(body, [surface]);
  assert.equal(actual.length, source.length);
  near(actual[0].points[0].toArray(), source[0].points[0].toArray());
  near(actual[0].normal.toArray(), source[0].normal.toArray());
  assert.equal(actual[0].fraction, source[0].fraction);
});
test("common rigid transform preserves relative fractions and rotates both old-frame torque points", () => {
  const rotation = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      Math.PI / 2,
    ),
    offset = new Vector3(5, 6, 7),
    { surface } = fixture({
      oldPosition: offset,
      newPosition: new Vector3(0, 2, 0).applyQuaternion(rotation).add(offset),
      oldOrientation: rotation,
      newOrientation: rotation,
    }),
    p = pose(
      new Vector3(0, 2, 0).applyQuaternion(rotation).add(offset),
      rotation,
    ),
    row = nativeSphereMovingWorldContacts(input(p), [surface])[0];
  near(row.fraction, 0.75);
  near(
    row.points[0].toArray(),
    new Vector3(0, 1.5, 0).applyQuaternion(rotation).add(offset).toArray(),
  );
  near(row.pointsB[0].toArray(), offset.toArray());
  near(row.normal.toArray(), [0, 0, 1]);
});
test("placement override changes the relative center sweep without changing source authored A torque", () => {
  const { surface } = fixture({ newPosition: new Vector3() });
  const row = nativeSphereMovingWorldContacts(
    input(identity(0, 2, 0), identity(0, -2, 0)),
    [surface],
    { placementStart: [0, 1, 0] },
  )[0];
  near(row.fraction, 1 / 6);
  near(row.points[0].toArray(), [0, 1.5, 0]);
  near(row.pointsB[0].toArray(), [0, 0, 0]);
});
test("invalid shapes/poses/normals and absent real moving owners fail explicitly", () => {
  const { surface } = fixture();
  assert.throws(
    () =>
      nativeSphereMovingWorldContacts(
        { ...input(), sphere: { ...sphere, radiusSquared: 0.3 } },
        [surface],
      ),
    /radius/,
  );
  assert.throws(
    () =>
      nativeSphereMovingWorldContacts(
        input([2, 0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0]),
        [surface],
      ),
    /orthonormal/,
  );
  assert.throws(
    () =>
      nativeSphereMovingWorldContacts(input(), [
        { ...surface, owner: undefined },
      ]),
    /actual MovingWorldBody/,
  );
  assert.throws(
    () =>
      nativeSphereMovingWorldContacts(input(), [
        { ...surface, normal: new Vector3(0, 2, 0) },
      ]),
    /authored unit normal/,
  );
  assert.throws(
    () =>
      nativeSphereMovingWorldContacts(input(), [{ ...surface, constant: NaN }]),
    /finite/,
  );
  assert.throws(
    () => nativeSphereMovingWorldContacts(input(), Array(65536).fill(surface)),
    /face span/,
  );
});
