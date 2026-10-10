import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { cameraWorldQueries } from "../src/camera/world-queries.ts";

function surface({
  z = 0,
  material = "ROAD",
  materialFlags = 0,
  actor,
  a = new Vector3(-2, -2, z),
  b = new Vector3(2, -2, z),
  c = new Vector3(0, 2, z),
} = {}) {
  return {
    a,
    b,
    c,
    normal: b.clone().sub(a).cross(c.clone().sub(a)).normalize(),
    minY: Math.min(a.y, b.y, c.y),
    maxY: Math.max(a.y, b.y, c.y),
    material,
    modifier: {},
    twoSided: false,
    materialFlags,
    faceFlags: 0,
    enabled: true,
    collisionMode: "solid",
    actor,
  };
}

function fakeWorld(surfaces) {
  const calls = [];
  return {
    calls,
    querySurfaces(min, max, includeNonSolid) {
      calls.push({ min: min.clone(), max: max.clone(), includeNonSolid });
      return surfaces;
    },
  };
}

test("ray asks the world for non-solid candidates, then excludes pling prefixes", () => {
  const candidates = [
    surface({ material: "!ROAD" }),
    surface({ material: ">ROAD" }),
    surface({ material: "?ROAD" }),
    surface({ material: "ROAD" }),
  ];
  const world = fakeWorld(candidates);
  const queries = cameraWorldQueries(world);
  const hit = queries.ray(new Vector3(0, 0, 1), new Vector3(0, 0, -2));
  assert.ok(hit);
  assert.equal(hit.fraction, 0.5);
  assert.equal(world.calls.length, 1);
  assert.equal(world.calls[0].includeNonSolid, true);
});

test("box-face query clips actual triangles and retains pling faces with native sidedness flags", () => {
  const world = fakeWorld([
    surface({ material: "!ROAD" }),
    surface({ material: ">ROAD", materialFlags: 0x1000 }),
    surface({ material: "?ROAD", materialFlags: 0x800 }),
    // Its AABB overlaps the query, but every point has x+y > 2.
    surface({
      a: new Vector3(0.9, 1.2, 0),
      b: new Vector3(1.2, 0.9, 0),
      c: new Vector3(1.2, 1.2, 0),
    }),
  ]);
  const queries = cameraWorldQueries(world);
  const faces = queries.faces(
    new Vector3(-1, -1, -0.1),
    new Vector3(1, 1, 0.1),
  );
  assert.equal(world.calls[0].includeNonSolid, true);
  assert.deepEqual(
    faces.map((face) => face.twoSided),
    [false, true, false],
  );
  assert.equal(faces.length, 3);
});

test("hidden actor ancestors are excluded from both ray and face queries", () => {
  const parent = new Group();
  parent.visible = false;
  const actor = new Group();
  parent.add(actor);
  const hidden = surface({ actor });
  const world = fakeWorld([hidden]);
  const queries = cameraWorldQueries(world);
  assert.equal(
    queries.ray(new Vector3(0, 0, 1), new Vector3(0, 0, -2)),
    undefined,
  );
  assert.deepEqual(
    queries.faces(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
    [],
  );
  assert.equal(world.calls.length, 2);
  assert.ok(world.calls.every((call) => call.includeNonSolid === true));
});

test("blocking noncar supplier receives the ordered camera probes and selected world hit", () => {
  const world = fakeWorld([]);
  const body = {
    position: new Vector3(),
    orientation: new Quaternion(),
    hulls: [
      buildBoxHull(new Vector3(-0.4, -0.4, -0.4), new Vector3(0.4, 0.4, 0.4)),
    ],
  };
  let supplied = 0;
  const queries = cameraWorldQueries(world, () => {
    supplied++;
    return [body];
  });
  const com = new Vector3(0, 0, 1);
  const near = new Vector3(0, 0, 0.8);
  const end = new Vector3(0, 0, -1);
  const selected = { fraction: 0.5, normal: new Vector3(0, 1, 0) };
  const result = queries.noncars(com, near, end, selected);
  assert.equal(supplied, 1);
  assert.equal(result.collided, true);
  assert.ok(result.hit.fraction < selected.fraction);
});
