import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Assets } from "../src/content.ts";
import { createAssetStore } from "../server/assets.mjs";
import { captureNativeTrackSceneLayout } from "../src/native-track-scene-layout.ts";
import { prepareNativeWorldScene } from "../src/native-world-scene.ts";
import { WorldCollision } from "../src/world.ts";
import { manageNativeTrackBounds } from "../src/native-track-resources.ts";

const material = (name) => ({
  name,
  rgba: [80, 80, 80, 255],
  flags: 4096,
  ambient: 1,
  diffuse: 0,
  specular: 0,
  power: 20,
  uvTransform: [1, 0, 0, 1, 0, 0],
});

async function originalWorld(root) {
  const store = await createAssetStore(
    process.env.CARMA2_ROOT || "carma2_orig",
  );
  const assets = new Assets();
  assets.manifest = store.manifest;
  assets.lookup = new Map(
    store.manifest.map((entry) => [entry.path.toLowerCase(), entry.path]),
  );
  assets.bytes = async (path) => {
    const bytes = await store.read(path);
    if (!bytes) throw new Error(`missing:${path}`);
    return new Uint8Array(bytes);
  };
  const scene = await assets.scene(`${root}/RACES/newcity1`, "newcity1");
  const layout = captureNativeTrackSceneLayout(scene);
  assert.equal(layout.resolved, true);
  const black = material("M14.MAT"),
    defaultTrack = material("gDefault_track_material");
  scene.materialArena.allocateMaterial(black);
  scene.materialArena.allocateMaterial(defaultTrack);
  const native = prepareNativeWorldScene(scene, {
    initialLayout: layout,
    blackMaterial: black,
    defaultTrackMaterial: defaultTrack,
    smashSpecs: [],
    actorSpecs: [],
    race: null,
    pixelBits: 16,
    spawnPedsOnFace: () => {},
  });
  return { assets, scene, layout, native, store };
}

function row(surface) {
  return {
    a: surface.a.toArray(),
    b: surface.b.toArray(),
    c: surface.c.toArray(),
    constant: surface.constant,
    faceFlags: surface.faceFlags,
    actor: surface.native?.actor?.source?.name ?? surface.native?.actor?.name,
    sourceFaceIndex: surface.native?.sourceFaceIndex,
    nativeFaceIndex: surface.native?.nativeFaceIndex,
  };
}

for (const root of ["data", "adv_data"])
  test(`original ${root} collector rows and ordered callbacks match with cached MODEL bounds`, async (t) => {
    let loaded;
    try {
      loaded = await originalWorld(root);
    } catch (error) {
      if (/ENOENT|Original installation/.test(String(error))) {
        t.skip("original installation unavailable");
        return;
      }
      throw error;
    }
    const { assets, scene, layout, native } = loaded;
    const world = new WorldCollision(scene.group, undefined, undefined, native);
    for (const resource of new Set(native.resources.values()))
      manageNativeTrackBounds(resource);
    const query = {
      bounds: new THREE.Box3(
        new THREE.Vector3(...layout.initialBounds.min),
        new THREE.Vector3(...layout.initialBounds.max),
      ).expandByScalar(1),
      matrix: new THREE.Matrix4(),
    };
    const diagnostics = () => ({
      requests: 0,
      cacheHits: 0,
      computations: 0,
      verticesVisited: 0,
      unmanagedRequests: 0,
    });
    const collect = (cache) => {
      const counts = diagnostics(),
        events = [];
      world.nativeModelBoundsOptions = { cache, diagnostics: counts };
      const faces = world.collectFaces(query, 300, true, {
        onFace: (surface) => events.push(["face", row(surface)]),
        stopGroovidelic: (object) => events.push(["stop", object.name]),
        pullActorFromWorld: (object) => {
          events.push(["pull", object.name]);
          return null;
        },
      });
      return { rows: faces.map(row), events, counts };
    };
    const uncached = collect(false),
      cachedCold = collect(true),
      cachedWarm = collect(true);
    try {
      assert.equal(
        uncached.rows.length,
        300,
        "collector returns the requested capacity prefix",
      );
      assert.deepEqual(cachedCold.rows, uncached.rows);
      assert.deepEqual(cachedCold.events, uncached.events);
      assert.deepEqual(cachedWarm.rows, uncached.rows);
      assert.deepEqual(cachedWarm.events, uncached.events);
      assert.ok(
        uncached.events.length > 300,
        "world callbacks continue after the emitted prefix fills",
      );
      assert.ok(uncached.counts.requests > 0);
      assert.equal(uncached.counts.cacheHits, 0);
      assert.equal(uncached.counts.computations, uncached.counts.requests);
      assert.ok(cachedCold.counts.computations > 0);
      assert.ok(cachedCold.counts.computations <= uncached.counts.computations);
      assert.equal(
        cachedCold.counts.cacheHits + cachedCold.counts.computations,
        cachedCold.counts.requests,
      );
      assert.ok(
        cachedCold.counts.verticesVisited <= uncached.counts.verticesVisited,
      );
      assert.equal(cachedWarm.counts.requests, cachedCold.counts.requests);
      assert.equal(cachedWarm.counts.computations, 0);
      assert.equal(cachedWarm.counts.cacheHits, cachedWarm.counts.requests);
      assert.equal(cachedWarm.counts.verticesVisited, 0);
      assert.equal(cachedWarm.counts.unmanagedRequests, 0);
    } finally {
      scene.dispose();
      assets.releaseRaceResources();
    }
  });
