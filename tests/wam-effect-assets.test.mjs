import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { loadWamEffectAssets } from "../src/wam-effect-assets.ts";

const actor = (name, withModel = true) => {
  const root = new THREE.Group();
  root.name = name;
  if (withModel) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    root.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  }
  return root;
};
const sceneFor = (...actors) => {
  const scene = new THREE.Group();
  for (const value of actors) scene.add(value);
  return scene;
};
const level = (...shrapnel) => ({ connotations: { shrapnel } });
const wam = (specs) => ({
  parts: [{ smashes: [{ levels: [level(...specs)] }] }],
});

test("preloads WAM ghost and noncar effects once per exact spec and retains ACT scenes", async () => {
  const ghost = {
    kind: "ghostparts",
    actors: ["WAM_GHOST.ACT"],
    actorCountSource: 1,
  };
  const noncar = {
    kind: "noncars",
    actorFile: "WAM_DEBRIS.ACT",
    nonCars: [{ actor: "PANEL", mechanics: "PA_PANEL.MEC" }],
  };
  const actorLoads = [];
  const mechanicsLoads = [];
  const assets = await loadWamEffectAssets(
    wam([ghost, noncar, ghost]),
    async (name) => {
      actorLoads.push(name);
      return name === "WAM_GHOST.ACT"
        ? sceneFor(actor(name))
        : sceneFor(actor("PANEL"));
    },
    async (name) => {
      mechanicsLoads.push(name);
      return { version: null, index: 0 };
    },
  );
  assert.equal(assets.ghosts.get(ghost).templates.length, 1);
  assert.equal(assets.nonCars.get(noncar).templates.length, 1);
  assert.deepEqual(actorLoads.sort(), ["WAM_DEBRIS.ACT", "WAM_GHOST.ACT"]);
  assert.deepEqual(mechanicsLoads, ["PA_PANEL.MEC"]);
  assert.equal(assets.library.children.length, 2);
  assert.equal(assets.library.visible, false);
  assert.deepEqual(assets.diagnostics, []);
});

test("asset failures stay car-scoped and return loader diagnostics", async () => {
  const ghost = {
    kind: "ghostparts",
    actors: ["CAR_A_GHOST.ACT"],
    actorCountSource: 1,
  };
  const noncar = {
    kind: "noncars",
    actorFile: "CAR_A_DEBRIS.ACT",
    nonCars: [{ actor: "PANEL", mechanics: "CAR_A_PANEL.MEC" }],
  };
  const actorLoads = [];
  const assets = await loadWamEffectAssets(
    wam([ghost, noncar]),
    async (name) => {
      actorLoads.push(name);
      if (name === "CAR_A_DEBRIS.ACT") return sceneFor(actor("PANEL"));
      throw new Error(`missing ${name}`);
    },
    async (name) => {
      throw new Error(`missing ${name}`);
    },
  );
  assert.deepEqual(actorLoads.sort(), ["CAR_A_DEBRIS.ACT", "CAR_A_GHOST.ACT"]);
  assert.equal(assets.ghosts.get(ghost).templates.length, 0);
  assert.equal(assets.nonCars.get(noncar).templates.length, 0);
  assert.ok(
    assets.diagnostics.some((value) => value.includes("CAR_A_GHOST.ACT")),
  );
  assert.ok(
    assets.diagnostics.some((value) => value.includes("CAR_A_PANEL.MEC")),
  );
});

test("missing optional WAM data returns an empty owned asset library", async () => {
  const assets = await loadWamEffectAssets(
    undefined,
    async () => assert.fail("no ACT assets should be requested"),
    async () => assert.fail("no mechanics should be requested"),
  );
  assert.equal(assets.library.visible, false);
  assert.equal(assets.library.children.length, 0);
  assert.equal(assets.ghosts.size, 0);
  assert.equal(assets.nonCars.size, 0);
});
