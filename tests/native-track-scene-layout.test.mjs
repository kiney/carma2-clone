import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { captureNativeTrackSceneLayout } from "../src/native-track-scene-layout.ts";
import { captureWorldSource } from "../src/world-source.ts";
import { Assets } from "../src/content.ts";
import { createAssetStore } from "../server/assets.mjs";

const model = () => ({
  name: "layout-model.DAT",
  flags: 0,
  pivot: [90, 80, 70],
  positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, 20, 9, 3, 19]),
  uvs: new Float32Array(),
  materials: [],
  faces: [{ indices: [0, 1, 2], flags: 0, smoothing: 0, material: 0 }],
});
const root = () => ({
  name: "PP01 2 2 0.25 1",
  type: 1,
  renderStyle: 1,
  model: "layout-model.DAT",
  transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 100, 200, 300],
  children: [],
});

test("scene binding uses actual RAW DAT identity, ignores root transform/style and retains unused vertices", () => {
  const actual = model();
  const result = captureNativeTrackSceneLayout({
    sourceActors: [root()],
    models: new Map([["layout-model", actual]]),
  });
  assert.equal(result.resolved, true);
  assert.deepEqual(result.initialBounds, { min: [0, 0, 0], max: [10, 3, 20] });
  assert.equal(result.modelActorCount, 1);
  assert.deepEqual(result.layout, {
    countX: 2,
    countZ: 2,
    originX: -0.25,
    originZ: -0.25,
    columnSizeX: 4.75,
    columnSizeZ: 9.75,
  });
  assert.deepEqual(actual.pivot, [90, 80, 70]);
  assert.equal(actual.flags, 0);
  actual.positions[3] = 100;
  assert.equal(result.initialBounds.max[0], 10, "initial snapshot is copied");
});

test("world snapshot consumes retained native layout rather than later render geometry bounds", () => {
  const retained = captureNativeTrackSceneLayout({
    sourceActors: [root()],
    models: new Map([["layout-model", model()]]),
  });
  const render = new THREE.Group(),
    actor = new THREE.Group();
  actor.name = root().name;
  render.add(actor);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [1000, 0, 1000, 1010, 0, 1000, 1000, 0, 1020],
      3,
    ),
  );
  actor.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  const source = captureWorldSource(render, { initialNativeLayout: retained });
  assert.equal(source.columns.boundsSource, "native-initial-act");
  assert.deepEqual(source.columns.bounds, {
    minX: 0,
    maxX: 10,
    minZ: 0,
    maxZ: 20,
  });
  assert.equal(source.columns.sizeX, 4.75);
  assert.equal(source.columns.sizeZ, 9.75);
  assert.equal(source.columns.originX, -0.25);
  assert.equal(
    source.triangles.length,
    1,
    "render face crosswalk remains independent",
  );
  assert.equal(
    captureWorldSource(render).columns.boundsSource,
    "renderer-fallback",
  );
});

test("missing, custom and empty MODEL bounds remain explicit instead of renderer fallback", () => {
  const missing = captureNativeTrackSceneLayout({
    sourceActors: [root()],
    models: new Map(),
  });
  assert.equal(missing.resolved, false);
  assert.match(missing.requiredProvider, /source MODEL/);
  const custom = model();
  custom.flags = 0x400;
  assert.match(
    captureNativeTrackSceneLayout({
      sourceActors: [root()],
      models: new Map([["layout-model", custom]]),
    }).requiredProvider,
    /custom MODEL/,
  );
  const empty = model();
  empty.positions = new Float32Array();
  assert.match(
    captureNativeTrackSceneLayout({
      sourceActors: [root()],
      models: new Map([["layout-model", empty]]),
    }).requiredProvider,
    /empty MODEL/,
  );
  assert.throws(
    () =>
      captureNativeTrackSceneLayout({ sourceActors: [], models: new Map() }),
    /single loaded ACT root/,
  );
});

test("Stock and Advanced original tracks use native pre-mutation layout in the render crosswalk", async (t) => {
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
      if (!bytes) throw new Error(`Missing asset: ${path}`);
      return new Uint8Array(bytes);
    };
    for (const name of ["newcity1", "carrier1", "airport1"]) {
      const scene = await assets.scene(`${dataRoot}/RACES/${name}`, name);
      const retained = captureNativeTrackSceneLayout(scene);
      assert.equal(
        retained.resolved,
        true,
        `${dataRoot}/${name}: ${retained.requiredProvider}`,
      );
      const source = captureWorldSource(scene.group, {
        modelPreparation: "track",
        initialNativeLayout: retained,
      });
      assert.equal(source.columns.boundsSource, "native-initial-act");
      assert.equal(source.columns.sizeX, retained.layout.columnSizeX);
      assert.equal(source.columns.sizeZ, retained.layout.columnSizeZ);
      assert.equal(
        source.ppRoot,
        scene.sourceActorObjects.get(scene.sourceActors[0]),
      );
      assert.ok(source.triangles.length > 0);
    }
  }
});
