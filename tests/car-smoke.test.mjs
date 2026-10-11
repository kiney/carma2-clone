import test from "node:test";
import assert from "node:assert/strict";
import { Group, Mesh, Vector3 } from "three";
import { createModelGeometry } from "../src/render-geometry.ts";
import {
  prepareCarSmokeSampler,
  parseNativeDriverZOffset,
} from "../src/car-smoke.ts";

test("car fire samples sorted distinct source vertices in its first material group and follows live crush/actor movement", () => {
  const geometry = createModelGeometry({
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 4, 0, 0]),
    uvs: new Float32Array(8),
    faces: [
      { indices: [2, 0, 1], material: 0, smoothing: 1, flags: 0 },
      { indices: [1, 0, 2], material: 0, smoothing: 1, flags: 0 },
      { indices: [3, 0, 2], material: 1, smoothing: 1, flags: 0 },
    ],
  });
  const root = new Group(),
    actor = new Group(),
    mesh = new Mesh(geometry);
  root.add(actor);
  actor.add(mesh);
  actor.position.set(1, 2, 3);
  root.position.set(200, 100, 50);
  const sampler = prepareCarSmokeSampler(mesh, root),
    point = new Vector3();
  assert.equal(sampler.count, 6);
  assert.equal(sampler.firstGroupCount, 3);
  assert.equal(sampler.sample(0, point), true);
  assert.deepEqual(point.toArray(), [1, 2, 3]);
  const sourceIds = geometry.userData.sourceVertexIndices;
  const positions = geometry.getAttribute("position");
  for (let i = 0; i < positions.count; i++)
    if (sourceIds[i] === 0) positions.setXYZ(i, -0.2, 0.3, 0.4);
  assert.equal(sampler.sample(0, point), true);
  assert.ok(point.distanceTo(new Vector3(0.8, 2.3, 3.4)) < 1e-6);
  assert.equal(sampler.sample(6, point), false);
  assert.equal(sampler.sample(-1, point), false);
  assert.equal(sampler.sample(NaN, point), false);
  geometry.dispose();
});

test("native NULL group precedes the browser's first material and ignores principal basis/mesh transforms", () => {
  const geometry = createModelGeometry({
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 4, 0, 0]),
    uvs: new Float32Array(8),
    faces: [
      { indices: [3, 1, 2], material: 9, smoothing: 1, flags: 0 },
      { indices: [2, 0, 1], material: 0, smoothing: 1, flags: 0 },
    ],
  });
  const master = new Group(),
    principal = new Group(),
    mesh = new Mesh(geometry);
  master.add(principal);
  principal.add(mesh);
  master.position.set(900, 800, 700);
  principal.position.set(1, 2, 3);
  principal.rotation.set(0.7, 1.2, -0.4);
  principal.scale.set(2, 3, 4);
  mesh.position.set(50, 60, 70);
  const sampler = prepareCarSmokeSampler(mesh, master),
    point = new Vector3();
  assert.equal(sampler.materialOrder, "native-null-first");
  assert.equal(sampler.count, 6);
  assert.equal(sampler.firstGroupCount, 3);
  assert.equal(sampler.sample(1, point), true);
  assert.deepEqual(point.toArray(), [2, 2, 3]);
  principal.position.set(5, 6, 7);
  assert.equal(sampler.sample(1, point), true);
  assert.deepEqual(point.toArray(), [6, 6, 7]);
  geometry.dispose();
});

test("DONT_WELD retains distinct unnormalized smoothing sums with identical render normals", async () => {
  const { prepareNativeCarVertexOrder } = await import("../src/car-smoke.ts");
  const model = {
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    uvs: new Float32Array(6),
    faces: [1, 1, 2].map((smoothing) => ({
      indices: [0, 1, 2],
      material: 0,
      smoothing,
      flags: 0,
    })),
  };
  const geometry = createModelGeometry(model);
  const normals = geometry.getAttribute("normal");
  for (let i = 0; i < normals.count; i++)
    assert.deepEqual(
      [normals.getX(i), normals.getY(i), normals.getZ(i)],
      [0, 0, 1],
    );
  const prepared = prepareNativeCarVertexOrder(model);
  // Each source ID has one sum of Z=1 and one of Z=2 before CopyVertex normalizes.
  assert.deepEqual(prepared.sourceVertexIndices, [0, 0, 1, 1, 2, 2]);
  assert.deepEqual(
    prepared.corners.map((i) => model.faces[Math.floor(i / 3)].smoothing),
    [2, 1, 2, 1, 2, 1],
  );
  assert.equal(
    prepareCarSmokeSampler(new Mesh(geometry), new Group()).count,
    6,
  );
  geometry.dispose();
});

test("native pointer provider merges aliases and otherwise declares positive-material ambiguity", async () => {
  const { prepareNativeCarVertexOrder } = await import("../src/car-smoke.ts");
  const model = {
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    faces: [9, 1, 2].map((material) => ({
      indices: [0, 1, 2],
      material,
      smoothing: 1,
      flags: 0,
    })),
  };
  const approximate = prepareNativeCarVertexOrder(model);
  assert.equal(approximate.materialOrder, "browser-first-approximation");
  assert.deepEqual(approximate.materialIndices, [9]);
  const exact = prepareNativeCarVertexOrder(model, {
    materialPointers: new Map([
      [9, 0x5000],
      [1, 0x1000],
      [2, 0x1000],
    ]),
  });
  assert.equal(exact.materialOrder, "native-pointers");
  assert.deepEqual(exact.materialIndices, [1, 2]);
  assert.deepEqual(exact.sourceVertexIndices, [0, 1, 2, 0, 1, 2]);
  assert.equal(exact.firstGroupCount, 3);
  assert.throws(
    () =>
      prepareNativeCarVertexOrder(model, {
        materialPointers: new Map([[9, 1]]),
      }),
    /Missing native/,
  );
});

test("cockpit-only local-driver adjustment uses source head Z, strict branch and double offsets", () => {
  const geometry = createModelGeometry({
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    uvs: new Float32Array(6),
    faces: [{ indices: [0, 1, 2], material: 0, smoothing: 1, flags: 0 }],
  });
  const master = new Group(),
    principal = new Group(),
    mesh = new Mesh(geometry);
  master.add(principal);
  principal.add(mesh);
  principal.rotation.y = Math.PI / 2;
  const state = { enabled: true, driver: 8, driverZOffset: 0 };
  const sampler = prepareCarSmokeSampler(mesh, master, {
    cockpit: () => state,
  });
  const point = new Vector3();
  sampler.sample(1, point);
  assert.ok(point.distanceTo(new Vector3(0, 0, -1)) < 1e-7);
  // Translated point Z>.2 enters the Y adjustment, without the principal rotation.
  principal.position.z = 0.25;
  sampler.sample(1, point);
  assert.deepEqual(point.toArray(), [1, Math.fround(-0.07), 0.25]);
  state.driver = 6;
  sampler.sample(1, point);
  assert.deepEqual(point.toArray(), [1, 0, 0.25]);
  state.driver = 8;
  state.enabled = false;
  sampler.sample(1, point);
  assert.deepEqual(point.toArray(), [1, 0, 0.25]);
  geometry.dispose();
});

test("original Eagle, Buggy and Copcar prepared smoke mapping chooses NULL faces and reads live vertices", async (t) => {
  const { readFile } = await import("node:fs/promises");
  const { parseTwt } = await import("../server/assets.mjs");
  const { parseDat } = await import("../src/formats.ts");
  const { originalCar } = await import("./support/original-car.mjs");
  const { DamageSystem } = await import("../src/damage.ts");
  const { prepareNativeCarVertexOrder } = await import("../src/car-smoke.ts");
  for (const name of ["EAGLE3", "buggy", "copcar"]) {
    let bytes;
    try {
      bytes = await readFile(`carma2_orig/data/CARS/${name}.TWT`);
    } catch (error) {
      if (error.code === "ENOENT") {
        t.skip("Original installation absent");
        return;
      }
      throw error;
    }
    const { entries } = parseTwt(bytes);
    const models = entries
      .filter((entry) => /\.dat$/i.test(entry.name))
      .flatMap((entry) =>
        parseDat(bytes.subarray(entry.offset, entry.offset + entry.size)),
      );
    const fixture = await originalCar(name);
    const damage = new DamageSystem(
      fixture.assets,
      fixture.group,
      fixture.text,
    );
    await damage.init();
    const mesh = damage.primaryRenderMesh;
    const model = models.find(
      (model) => model.name.toLowerCase() === mesh.name.toLowerCase(),
    );
    assert.ok(model, `${name} principal original DAT`);
    assert.equal(parseNativeDriverZOffset(fixture.text), 0);
    assert.notEqual(
      model.faces[0].material,
      0,
      `${name} browser first material differs`,
    );
    assert.ok(model.faces.some((face) => face.material === 0));
    const geometry = createModelGeometry(model);
    mesh.geometry = geometry;
    const prepared = prepareNativeCarVertexOrder(model);
    assert.equal(prepared.materialOrder, "native-null-first");
    assert.ok(prepared.corners.length > 0);
    assert.ok(
      prepared.corners
        .slice(0, prepared.firstGroupCount)
        .every((corner) => model.faces[Math.floor(corner / 3)].material === 0),
    );
    assert.deepEqual(
      prepared.sourceVertexIndices.slice(0, prepared.firstGroupCount),
      [...prepared.sourceVertexIndices.slice(0, prepared.firstGroupCount)].sort(
        (a, b) => a - b,
      ),
    );
    const sampler = prepareCarSmokeSampler(mesh, fixture.group),
      point = new Vector3();
    assert.equal(sampler.count, prepared.corners.length);
    assert.equal(
      sampler.firstGroupCount,
      { EAGLE3: 6, buggy: 3, copcar: 26 }[name],
    );
    assert.ok(sampler.count > 12);
    assert.equal(
      sampler.sample(11, point),
      true,
      "raw wreck index can extend into following contiguous groups",
    );
    mesh.parent.position.set(0.25, -0.5, 0.75);
    mesh.parent.rotation.y = 1.7;
    sampler.sample(0, point);
    const source = prepared.sourceVertexIndices[0];
    const expected = Array.from(
      model.positions.subarray(source * 3, source * 3 + 3),
    ).map((v, i) => Math.fround(v + [0.25, -0.5, 0.75][i]));
    assert.deepEqual(point.toArray(), expected);
    geometry
      .getAttribute("position")
      .setXYZ(prepared.corners[0], -0.125, 0.25, 0.5);
    sampler.sample(0, point);
    assert.deepEqual(point.toArray(), [0.125, -0.25, 1.25]);
    geometry.dispose();
  }
});

test("driver head parser consumes the first source triplet after the strict marker", () => {
  assert.equal(
    parseNativeDriverZOffset(
      "VERSION 2\nSTART OF DRIVABLE STUFF // marker\n// comment\n .1,-2,3e-2 // head XYZ\nEND OF DRIVABLE STUFF",
    ),
    Math.fround(0.03),
  );
  for (const text of [
    "0,0,5",
    "start of drivable stuff\n0,0,5",
    "START OF DRIVABLE STUFF\n0,5",
    "START OF DRIVABLE STUFF\n0,0,5,6",
    "START OF DRIVABLE STUFF\n0,0,NaN",
    "START OF DRIVABLE STUFF\n0,0,1e100",
    "START OF DRIVABLE STUFF\nEND OF DRIVABLE STUFF\n0,0,5",
  ])
    assert.equal(parseNativeDriverZOffset(text), undefined);
});
