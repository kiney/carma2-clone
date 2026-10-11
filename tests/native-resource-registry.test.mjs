import assert from "node:assert/strict";
import test from "node:test";
import {
  nativeResourceNameMatches,
  NativeResourceRegistry,
} from "../src/native-resource-registry.ts";
import { Assets } from "../src/content.ts";
import { createAssetStore } from "../server/assets.mjs";
import { prepareNativeTrackSceneEdges } from "../src/track-edge-preparation.ts";

test("native name matching preserves extensions, folds ASCII and implements wildcard/slash termination", () => {
  const cases = [
    [null, null, true],
    ["*", null, false],
    ["", "", true],
    ["eagle.ACT", "EAGLE.act", true],
    ["eagle", "EAGLE.ACT", false],
    ["*?.MAT", "x.mat", true],
    ["*?.MAT", ".MAT", false],
    ["a**?c", "ABBC", true],
    ["a**?c", "ac", false],
    ["grass6/ignored", "GRASS6", true],
    ["grass6/ignored", "grass6/ignored", false],
    ["*/anything", "abc/def", true],
    ["Ä", "ä", false],
  ];
  for (const [pattern, name, expected] of cases)
    assert.equal(
      nativeResourceNameMatches(pattern, name),
      expected,
      `${pattern}: ${name}`,
    );
});

test("MAT storage rejects exact duplicates but registry lookup selects newest accepted case variant", () => {
  const registry = new NativeResourceRegistry(true),
    first = { name: "Grass6", flags: 0x1001 },
    rejected = { name: "Grass6", flags: 0x21 },
    variant = { name: "grass6", flags: 1 };
  assert.equal(registry.add(first), true);
  assert.equal(registry.add(rejected), false);
  assert.equal(registry.find("GRASS6"), first);
  assert.equal(registry.add(variant), true);
  assert.deepEqual(registry.accepted, [first, variant]);
  assert.equal(registry.find("Grass6"), variant);
  assert.equal(registry.find("grass6.mat"), undefined);
  const models = new NativeResourceRegistry(false);
  models.add(first);
  models.add(rejected);
  assert.deepEqual(models.accepted, [first, rejected]);
  assert.equal(models.find("Grass6"), rejected);
});

test("file enumeration retains raw mounted archive order rather than manifest filename order", () => {
  const assets = new Assets();
  assets.manifest = [
    {
      path: "data/test/a.mat",
      size: 0,
      enumeration: {
        kind: "archive-table",
        archive: "data/test.twt",
        index: 7,
      },
    },
    {
      path: "data/test/z.mat",
      size: 0,
      enumeration: {
        kind: "archive-table",
        archive: "data/test.twt",
        index: 0,
      },
    },
    {
      path: "data/test/m.mat",
      size: 0,
      enumeration: { kind: "host-directory", index: 0 },
    },
  ];
  assert.deepEqual(assets.files("data/test", /^[^/]+\.mat$/i), [
    "data/test/z.mat",
    "data/test/a.mat",
    "data/test/m.mat",
  ]);
});

test("Stock/Advanced scenes keep native smash MATs, distinct resource episodes and every track MODEL", async (t) => {
  let store;
  try {
    store = await createAssetStore();
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("original installation absent");
      return;
    }
    throw error;
  }
  const assets = new Assets();
  assets.manifest = store.manifest;
  assets.lookup = new Map(
    store.manifest.map(({ path }) => [path.toLowerCase(), path]),
  );
  assets.bytes = async (path) => store.read(path);
  for (const dataRoot of ["data", "adv_data"]) {
    const scene = await assets.scene(`${dataRoot}/RACES/newcity1`, "newcity1");
    assert.equal(scene.sourceMaterialEpisodes.length, 219);
    assert.equal(scene.sourceMaterialStorage.length, 195);
    assert.equal(scene.sourceModelStorage.length, 274);
    assert.equal(
      scene.sourceModelGeometries.size,
      274,
      "duplicate MODEL identifiers retain separate geometries",
    );
    for (const name of ["advert2", "advert3", "cinema01"]) {
      const episodes = scene.sourceMaterialEpisodes.filter(
        (episode) => episode.material.name === name,
      );
      assert.equal(episodes.length, 2);
      assert.equal(episodes[0].accepted, true);
      assert.equal(episodes[1].accepted, false);
      assert.equal(episodes[0].material.flags, 0x1001);
      assert.equal(episodes[1].material.flags, 0x21);
      assert.equal(scene.findSourceMaterial(name), episodes[0].material);
      assert.equal(scene.materials.get(name).userData.c2Flags, 0x1001);
    }
    const edge = prepareNativeTrackSceneEdges(scene);
    assert.equal(edge.status, "complete");
    assert.equal(edge.appliedGeometries, 274);
    const duplicate = scene.sourceModelEpisodes.filter(
      (episode) => episode.model.name === "&petpump.act",
    );
    assert.equal(duplicate.length, 2);
    assert.notEqual(duplicate[0].model, duplicate[1].model);
    assert.equal(scene.findSourceModel("&petpump.act"), duplicate[1].model);
    assert.equal(scene.findSourceModel("&petpump"), undefined);
    for (const episode of scene.sourceMaterialEpisodes)
      assert.equal(
        scene.materialArena.materialAddress(episode.material).resolved,
        episode.accepted,
      );

    const airport = await assets.scene(
      `${dataRoot}/RACES/airport1`,
      "airport1",
    );
    const variants = airport.sourceMaterialStorage.filter((mat) =>
      ["Grass6", "grass6"].includes(mat.name),
    );
    assert.equal(variants.length, 2);
    assert.notEqual(variants[0], variants[1]);
    assert.equal(airport.findSourceMaterial("GRASS6"), variants[1]);
  }
});
