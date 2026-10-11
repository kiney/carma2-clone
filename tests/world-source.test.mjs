import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createModelGeometry } from "../src/render-geometry.ts";
import { captureWorldSource, parseWorldPP01 } from "../src/world-source.ts";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";

test("PP01 dimensions parse safely and preserve authored extra room", () => {
  assert.deepEqual(parseWorldPP01("PP01 16 12 1.000 1126"), {
    countX: 16,
    countZ: 12,
    extraRoom: 1,
  });
  for (const invalid of [
    "PP02 16 16 1 0",
    "PP01 0 2 1",
    "PP01 2 2 -1",
    "PP01 256 1 0",
  ]) {
    assert.equal(parseWorldPP01(invalid), null);
  }
});

test("native non-PP root fallback is one column; malformed PP roots preserve fatal branches", () => {
  const root = new THREE.Group();
  root.name = "legacy-scene-wrapper";
  const actor = new THREE.Group();
  actor.name = "oldtrack";
  root.add(actor);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 4, 0, 0, 0, 0, 6], 3),
  );
  actor.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  const fallback = captureWorldSource(root);
  assert.equal(fallback.ppRoot, null);
  assert.equal(fallback.columnIdentifier, "oldtrack");
  assert.equal(fallback.columnMetadataSource, "native-1x1-fallback");
  assert.equal(fallback.columns.countX, 1);
  assert.equal(fallback.columns.countZ, 1);
  assert.equal(fallback.columns.originX, 0);
  assert.equal(fallback.columns.originZ, 0);
  assert.equal(fallback.columns.sizeX, 4);
  assert.equal(fallback.columns.sizeZ, 6);

  const legacyGrid = new THREE.Group();
  const gridActor = new THREE.Group();
  gridActor.name = "4 2 0.5 32";
  legacyGrid.add(gridActor);
  gridActor.add(
    new THREE.Mesh(geometry.clone(), new THREE.MeshBasicMaterial()),
  );
  const parsed = captureWorldSource(legacyGrid);
  assert.equal(parsed.columnMetadataSource, "legacy-root");
  assert.equal(parsed.columns.countX, 4);
  assert.equal(parsed.columns.countZ, 2);
  assert.equal(parsed.columns.extraRoom, 0.5);

  for (const identifier of ["PP02 2 2 1 4", "PP01 2 2 1"]) {
    const invalidRoot = new THREE.Group();
    const invalidActor = new THREE.Group();
    invalidActor.name = identifier;
    invalidRoot.add(invalidActor);
    invalidActor.add(
      new THREE.Mesh(geometry.clone(), new THREE.MeshBasicMaterial()),
    );
    assert.throws(
      () => captureWorldSource(invalidRoot),
      /unsupported PP root|obsolete three-field/,
    );
  }
});

test("source snapshot retains ACT traversal, tile identity, and render-to-DAT face mapping", () => {
  const root = new THREE.Group();
  root.name = "newcity";
  const track = new THREE.Group();
  track.name = "PP01 2 2 1.000 5";
  root.add(track);
  const tile = new THREE.Group();
  tile.name = "1 0";
  track.add(tile);
  const modelActor = new THREE.Group();
  modelActor.name = "&ground.ACT";
  tile.add(modelActor);
  const model = {
    name: "ground",
    flags: 0,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]),
    uvs: new Float32Array(),
    faces: [
      { indices: [0, 1, 2], smoothing: 0, flags: 3, material: 2 },
      { indices: [1, 3, 2], smoothing: 0, flags: 5, material: 0 },
    ],
    materials: ["unused", "road"],
  };
  const mesh = new THREE.Mesh(createModelGeometry(model), [
    new THREE.MeshBasicMaterial({ name: "actor" }),
    new THREE.MeshBasicMaterial({ name: "road" }),
  ]);
  mesh.name = "ground";
  modelActor.add(mesh);

  const snapshot = captureWorldSource(root);
  assert.equal(snapshot.preparedGroupOrderResolved, false);
  assert.equal(snapshot.columns.countX, 2);
  assert.equal(snapshot.columns.countZ, 2);
  assert.equal(snapshot.columns.originX, -1);
  assert.equal(snapshot.columns.originZ, -1);
  assert.deepEqual(
    snapshot.actors.find((entry) => entry.object === tile)?.column,
    { x: 1, z: 0 },
  );
  assert.equal(snapshot.triangles.length, 2);
  assert.deepEqual(
    snapshot.triangles.map((triangle) => triangle.sourceFaceIndex),
    [0, 1],
  );
  assert.deepEqual(
    snapshot.triangles.map((triangle) => triangle.sourceFace?.flags),
    [3, 5],
  );
  assert.deepEqual(
    snapshot.triangles.map((triangle) => triangle.materialName),
    ["actor", "road"],
  );
  assert.equal(snapshot.triangles[0].mesh, mesh);
  assert.equal(snapshot.triangles[0].actor, modelActor);
  assert.equal(snapshot.triangles[0].preparedGroupIndex, null);
  assert.ok(Object.isFrozen(snapshot.triangles));
  assert.ok(Object.isFrozen(snapshot.triangles[0]));
  assert.ok(Object.isFrozen(snapshot.triangles[0].sourceFace.indices));
  assert.throws(() => snapshot.triangles[0].sourceFace.indices.push(9));
});

test("ambiguous and malformed render-to-source mappings remain unresolved", () => {
  const root = new THREE.Group();
  root.add(new THREE.Group());
  root.children[0].name = "PP01 1 1 0 1";
  const tile = new THREE.Group();
  tile.name = "0 0";
  root.children[0].add(tile);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3),
  );
  geometry.userData.sourceVertexIndices = new Uint32Array([0, 1, 2]);
  geometry.userData.sourceFaces = [
    { indices: [0, 1, 2], smoothing: 0, flags: 0, material: 0 },
    { indices: [0, 1, 2], smoothing: 0, flags: 1, material: 0 },
  ];
  tile.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  const ambiguous = captureWorldSource(root);
  assert.equal(ambiguous.triangles[0].sourceFaceIndex, null);

  const malformedRoot = new THREE.Group();
  const pp = new THREE.Group();
  pp.name = "PP01 1 1 0 1";
  malformedRoot.add(pp);
  const malformed = createModelGeometry({
    name: "bad",
    flags: 0,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    uvs: new Float32Array(),
    faces: [{ indices: [0, 1, 2], smoothing: 0, flags: 0, material: 0 }],
    materials: [],
  });
  malformed.userData.sourceVertexIndices[0] = 99;
  pp.add(new THREE.Mesh(malformed, new THREE.MeshBasicMaterial()));
  assert.equal(
    captureWorldSource(malformedRoot).triangles[0].sourceFaceIndex,
    null,
  );
});

test("original Stock and Advanced Newcity ACT roots retain PP01 and tile metadata", async (t) => {
  let store;
  try {
    store = await createAssetStore(process.env.CARMA2_ROOT || "carma2_orig");
  } catch (error) {
    if (/ENOENT|Original installation/.test(String(error))) {
      t.skip("Original installation unavailable");
      return;
    }
    throw error;
  }
  for (const dataRoot of ["data", "adv_data"]) {
    const assets = new Assets();
    assets.manifest = store.manifest;
    assets.lookup = new Map(
      store.manifest.map((entry) => [entry.path.toLowerCase(), entry.path]),
    );
    assets.bytes = async (path) => {
      const bytes = await store.read(path);
      if (!bytes) throw new Error(`Asset missing: ${path}`);
      return new Uint8Array(bytes);
    };
    const scene = await assets.scene(`${dataRoot}/RACES/newcity1`, "newcity1");
    const snapshot = captureWorldSource(scene.group, {
      modelPreparation: "track",
    });
    assert.equal(snapshot.ppRoot.name, "PP01 16 16 1.000 1126");
    assert.equal(snapshot.columns.countX, 16);
    assert.equal(snapshot.columns.countZ, 16);
    assert.equal(snapshot.columns.extraRoom, 1);
    const tileActors = snapshot.actors.filter(
      (actor) => actor.column !== null && /^\d+ \d+$/.test(actor.identifier),
    );
    assert.ok(
      tileActors.length > 0,
      `${dataRoot}: expected parsed tile ACT identifiers`,
    );
    assert.ok(snapshot.triangles.length > 0);
    assert.ok(
      snapshot.triangles.every(
        (triangle) => triangle.preparedGroupIndex === null,
      ),
    );
    assert.equal(snapshot.preparedGroupOrderResolved, false);
    assert.ok(
      snapshot.triangles.every(
        (triangle) => triangle.nativeModelPlane !== null,
      ),
    );
    assert.ok(
      snapshot.triangles.every(
        (triangle) => (triangle.effectiveTrackModelFlags & 0x80) !== 0,
      ),
    );
    assert.ok(
      snapshot.triangles.every(
        (triangle) => (triangle.effectiveTrackModelFlags & 0x201) === 0,
      ),
    );
  }
});

test("track snapshot retains installed prepared plane and effective loader flags without changing render geometry", () => {
  const root = new THREE.Group(),
    actor = new THREE.Group();
  actor.name = "track";
  root.add(actor);
  const model = {
    name: "floor",
    flags: 0x201,
    positions: new Float32Array([0, 2, 0, 1, 2, 0, 0, 2, 1]),
    uvs: new Float32Array(),
    materials: [],
    faces: [{ indices: [0, 1, 2], smoothing: 0, flags: 0x85, material: 0 }],
  };
  const geometry = createModelGeometry(model);
  actor.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  const unknown = captureWorldSource(root).triangles[0];
  assert.equal(unknown.nativeModelPlane, null);
  assert.equal(unknown.effectiveTrackModelFlags, null);
  const triangle = captureWorldSource(root, { modelPreparation: "track" })
    .triangles[0];
  assert.equal(triangle.effectiveTrackModelFlags, 0x80);
  assert.deepEqual(triangle.nativeModelPlane, {
    normal: [0, -0.9999998807907104, 0],
    d: -2,
    degenerate: false,
  });
  assert.equal(triangle.sourceFace.flags, 0x85);
  assert.equal(geometry.userData.modelFlags, 0x201);
  assert.deepEqual(
    Array.from(geometry.userData.sourcePositions),
    Array.from(model.positions),
  );
  assert.ok(Object.isFrozen(triangle.nativeModelPlane));
  assert.ok(Object.isFrozen(triangle.nativeModelPlane.normal));
});
