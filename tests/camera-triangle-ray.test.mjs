import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { cameraTriangleRay } from "../src/camera/triangle-ray.ts";

function surface({
  z = 0,
  normal = [0, 0, 1],
  material = "ROAD",
  materialFlags = 0,
  enabled = true,
  collisionMode = "solid",
  actor,
  owner,
} = {}) {
  return {
    a: new Vector3(-2, -2, z),
    b: new Vector3(2, -2, z),
    c: new Vector3(0, 2, z),
    normal: new Vector3(...normal),
    minY: -2,
    maxY: 2,
    material,
    modifier: {},
    twoSided: !!(materialFlags & 0x1800),
    materialFlags,
    faceFlags: 0,
    enabled,
    collisionMode,
    actor,
    owner,
  };
}

const rayFromFront = (
  surfaces,
  from = new Vector3(0, 0, 1),
  delta = new Vector3(0, 0, -2),
) => cameraTriangleRay(from, delta, surfaces);

test("camera ray excludes pling material prefixes by default with explicit override", () => {
  for (const material of ["!ROAD", ">ROAD", "?ROAD"]) {
    assert.equal(rayFromFront([surface({ material })]), undefined, material);
    assert.ok(
      cameraTriangleRay(
        new Vector3(0, 0, 1),
        new Vector3(0, 0, -2),
        [surface({ material })],
        false,
      ),
      material,
    );
  }
  assert.ok(rayFromFront([surface({ material: "ROAD" })]));
});

test("parallel rejection is strict at abs(normal dot delta) below 2^-22", () => {
  const epsilon = 2 ** -22;
  const candidate = surface();
  assert.equal(
    cameraTriangleRay(
      new Vector3(0, 0, epsilon / 2),
      new Vector3(0, 0, -epsilon / 2),
      [candidate],
    ),
    undefined,
  );
  const boundary = cameraTriangleRay(
    new Vector3(0, 0, epsilon),
    new Vector3(0, 0, -epsilon),
    [candidate],
  );
  assert.ok(boundary);
  assert.equal(boundary.fraction, 1);
  assert.ok(
    cameraTriangleRay(
      new Vector3(0, 0, epsilon * 2),
      new Vector3(0, 0, -epsilon * 2),
      [candidate],
    ),
  );
});

test("backfaces are rejected unless the accepted native material flags are set", () => {
  const fromBehind = new Vector3(0, 0, -1);
  const towardFront = new Vector3(0, 0, 2);
  assert.equal(
    cameraTriangleRay(fromBehind, towardFront, [surface()]),
    undefined,
  );
  for (const materialFlags of [0x800, 0x1000])
    assert.ok(
      cameraTriangleRay(fromBehind, towardFront, [surface({ materialFlags })]),
      `flags ${materialFlags.toString(16)}`,
    );
});

test("ray segment is finite and equal-distance hits preserve supplied order", () => {
  assert.equal(
    cameraTriangleRay(new Vector3(0, 0, 1), new Vector3(0, 0, -0.5), [
      surface(),
    ]),
    undefined,
  );
  const first = surface({ normal: [0, 0, 1], materialFlags: 0x800 });
  const second = surface({ normal: [0, 0, -1], materialFlags: 0x800 });
  const hit = rayFromFront([first, second]);
  assert.equal(hit.fraction, 0.5);
  assert.deepEqual(hit.normal.toArray(), [0, 0, 1]);
});

test("disabled surfaces and hidden actor ancestors are ignored", () => {
  const parent = new Group();
  parent.visible = false;
  const child = new Group();
  parent.add(child);
  assert.equal(rayFromFront([surface({ enabled: false })]), undefined);
  assert.equal(rayFromFront([surface({ actor: child })]), undefined);
});

test("edge-mode and explicitly supplied moving-owner faces remain camera-visible", () => {
  const edgeFace = surface({ collisionMode: "edges" });
  const movingFace = surface({ owner: { kind: "moving" } });
  assert.ok(rayFromFront([edgeFace]));
  assert.ok(rayFromFront([movingFace]));
});
