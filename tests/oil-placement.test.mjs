import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from "three";
import {
  intersectNativeOilFace,
  projectNativeOil,
  nativeOilBroadphaseMask,
} from "../src/physics/oil-placement.ts";
import { nativeOilActorFollower } from "../src/oil-actor.ts";
import { createModelGeometry } from "../src/render-geometry.ts";
import { OilRuntime } from "../src/physics/oil.ts";
import { queueWorldSlick } from "../src/world-slick.ts";
const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const face = (height = 0) => ({
  a: v(-1, height, -1),
  b: v(1, height, 1),
  c: v(1, height, -1),
  normal: v(0, 1, 0),
  twoSided: false,
  material: "road",
});
const bounds = new Box3(v(-0.1, -0.1, -0.1), v(0.1, 0.1, 0.1));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
test("native oil finite face uses nonnegative distance, endpoint tolerance and true barycentric sign", () => {
  const ground = face();
  const hit = intersectNativeOilFace(v(0.25, 0.2, 0), v(0, -1, 0), ground);
  assert.ok(hit);
  close(hit.fraction, 0.2);
  close(hit.point.y, 0);
  assert.equal(
    intersectNativeOilFace(v(0.25, -0.00001, 0), v(0, -1, 0), ground),
    null,
    "unlike wheels, penetration is rejected",
  );
  assert.ok(intersectNativeOilFace(v(0.25, 1.002, 0), v(0, -1, 0), ground));
  assert.equal(
    intersectNativeOilFace(v(0.25, 1.004, 0), v(0, -1, 0), ground),
    null,
  );
  assert.equal(
    intersectNativeOilFace(v(-0.5, 0.2, 0.5), v(0, -1, 0), ground),
    null,
  );
  assert.equal(
    intersectNativeOilFace(v(0.25, 0.2, 0), v(1, 0, 0), ground),
    null,
  );
  assert.equal(
    intersectNativeOilFace(v(0.25, 0.2, 0), v(0, -1, 0), {
      ...ground,
      material: "!water",
    }),
    null,
  );
});
test("native oil projector retains source ACT-local model bounds, ten-face order and old spill side position", () => {
  const matrix = new Matrix4().makeTranslation(0.25, 0.1, 0);
  let query;
  const result = projectNativeOil(matrix, bounds, 0.35, v(2, 0, 0), (q, n) => {
    query = q;
    assert.equal(n, 10);
    return [face(0), face(0.1)];
  });
  assert.ok(result);
  close(result.position.y, 0);
  close(result.position.x, 0.25);
  assert.equal(query.matrix, matrix);
  close(query.bounds.min.y, Math.fround(-0.1 - 1 / 6.9));
  assert.equal(query.bounds.min.x, -0.35);
  assert.throws(
    () =>
      projectNativeOil(matrix, bounds, 0.35, v(), () => Array(11).fill(face())),
    /ten faces/,
  );
});
test("native oil graphics mask uses strict full-size overlap and slot31 unsigned bit", () => {
  const spills = Array(32).fill(null);
  spills[0] = { mesh: { position: v() }, fullSize: 0.2 };
  spills[31] = { mesh: { position: v() }, fullSize: 0.2 };
  assert.equal(nativeOilBroadphaseMask(v(), 0, spills), 0x80000001);
  assert.equal(
    nativeOilBroadphaseMask(v(0.2, 0, 0), 0, spills),
    0,
    "touching rectangle excluded",
  );
  assert.equal(
    nativeOilBroadphaseMask(v(0, 50, 0), 0, spills),
    0x80000001,
    "graphics mask has no Y gate",
  );
});
test("native oil graphics retains x87 radius until the first X-side comparison", () => {
  const shapeMaxZ = Math.fround(0.3);
  const wideRadius = shapeMaxZ * Math.fround(1 / 6.9) * Math.fround(1.5);
  const storedRadius = Math.fround(wideRadius);
  assert.ok(wideRadius > storedRadius);
  const spill = { mesh: { position: v(-storedRadius, 0, 0) }, fullSize: 0 };
  assert.equal(nativeOilBroadphaseMask(v(), shapeMaxZ, [spill]), 1);
  spill.mesh.position.x = storedRadius;
  assert.equal(
    nativeOilBroadphaseMask(v(), shapeMaxZ, [spill]),
    0,
    "second X comparison uses the Float32 store, excluding exact touch",
  );
});
test("world slick outlet shares charged slots, authored materials and source MODEL rather than child union", () => {
  const actor = new Group();
  actor.name = "source ACT";
  const model = {
    positions: new Float32Array([
      -0.1, -0.1, -0.1, 0.1, 0.1, 0.1, 0.1, -0.1, -0.1, 5, 4, 3,
    ]),
    uvs: new Float32Array(8),
    flags: 0,
    faces: [{ indices: [0, 1, 2], material: 0, smoothing: 0, flags: 0 }],
    materials: [],
  };
  const mesh = new Mesh(createModelGeometry(model), new MeshBasicMaterial());
  actor.add(mesh);
  const child = new Group();
  child.position.y = 100;
  actor.add(child);
  actor.position.set(0.25, 0.1, 0);
  const source = nativeOilActorFollower(actor);
  assert.equal(source.identity, actor);
  assert.equal(
    source.readModelBounds().max.y,
    4,
    "unused MODEL vertex retained, children excluded",
  );
  mesh.geometry.getAttribute("position").setXYZ(1, 0.1, 7, 0.1);
  assert.equal(
    source.readModelBounds().max.y,
    7,
    "retained MODEL bounds observe live deformation of a used vertex",
  );
  mesh.geometry.getAttribute("position").setXYZ(1, 0.1, 0.1, 0.1);
  const oil = new OilRuntime({ random: () => 0.5 });
  const mat = new MeshBasicMaterial(),
    smear = new MeshBasicMaterial();
  mat.name = "AUTHORED";
  smear.name = "SMEAR";
  const config = {
    material: "AUTHORED.MAT",
    first: [300.9, 0.00001, 0.00007],
    second: [0.001, 0.05, 0.15],
    firstPair: [0.2, 1],
    secondPair: [1, 1],
    secondMaterial: "SMEAR.MAT",
  };
  const world = queueWorldSlick(
    oil,
    config,
    source,
    new Map([
      ["authored", mat],
      ["smear", smear],
    ]),
    1000,
  );
  const charged = oil.queueChargedSpill(source, 1000);
  assert.equal(oil.spills.filter(Boolean).length, 2);
  assert.equal(world.owner, null);
  assert.equal(world.nativeCar, undefined);
  assert.equal(world.source.identity, actor);
  assert.equal(world.spillTime, 1300);
  assert.equal(world.initialSize, Math.fround(0.001));
  assert.equal(world.mesh.children[0].material, mat);
  assert.equal(world.smearMaterial, smear);
  assert.equal(
    charged.growRate,
    Math.fround(
      Math.fround(0.00009) + 0.5 * (Math.fround(0.0003) - Math.fround(0.00009)),
    ),
  );
  assert.throws(
    () => queueWorldSlick(oil, config, source, new Map(), 2000),
    /material missing/,
  );
  assert.equal(
    oil.spills.filter(Boolean).length,
    2,
    "missing materials cannot consume a slot",
  );
  oil.dispose();
});
