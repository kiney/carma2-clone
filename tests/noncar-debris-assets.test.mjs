import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import * as THREE from "three";
import { createAssetStore } from "../server/assets.mjs";
import { parseAct, parseDat, decodeText } from "../src/formats.ts";
import { createModelGeometry } from "../src/render-geometry.ts";
import { parseNonCarMechanics } from "../src/noncars.ts";
import { loadNonCarDebrisAssets } from "../src/noncar-debris-assets.ts";

function addActor(parent, name, matrix, model = false) {
  const actor = new THREE.Group();
  actor.name = name;
  actor.matrix.copy(matrix);
  actor.matrixAutoUpdate = false;
  actor.userData.c2ActorMatrix = matrix.clone();
  parent.add(actor);
  if (model) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    actor.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  }
  return actor;
}

const mechanics = (index) => ({ index, freeMass: index + 1 });

test("selects root and nested actors case-sensitively, preserving detached local shear and borrowed resources", async () => {
  const scene = new THREE.Group();
  const wrapperMatrix = new THREE.Matrix4().makeTranslation(100, 0, 0);
  const root = addActor(scene, "rootACT", wrapperMatrix, true);
  const local = new THREE.Matrix4().set(
    1,
    0.25,
    0,
    4,
    0,
    1,
    0.5,
    5,
    0,
    0,
    1,
    6,
    0,
    0,
    0,
    1,
  );
  const nested = addActor(root, "Piece", local, true);
  const wrongCase = addActor(root, "piece", new THREE.Matrix4(), true);
  const specs = [
    {
      kind: "noncars",
      actorFile: "wreck.act",
      nonCars: [
        { actor: "rootACT", mechanics: "50part.txt" },
        { actor: "Piece", mechanics: "51part.txt" },
        { actor: "piece", mechanics: "52part.txt" },
      ],
    },
  ];
  const loaded = await loadNonCarDebrisAssets(
    specs,
    async () => scene,
    async (name) => mechanics(Number(name.slice(0, 2))),
  );
  const entries = loaded.get(0).templates;
  assert.deepEqual(
    entries.map((entry) => entry.originalName),
    ["rootACT", "Piece", "piece"],
  );
  assert.equal(entries[0].actor.parent, null);
  assert.equal(entries[0].actor.name, "&50!bbbb.ACT");
  assert.equal(entries[1].actor.parent, null);
  assert.equal(entries[1].actor.matrix.elements[12], 4);
  assert.deepEqual(entries[1].actor.matrix.elements, local.elements);
  assert.equal(
    entries[1].actor.children[0].geometry,
    nested.children[0].geometry,
  );
  assert.equal(
    entries[2].actor.children[0].geometry,
    wrongCase.children[0].geometry,
  );
  assert.deepEqual(
    entries.map((entry) => entry.nativeIdentifier),
    ["&50!bbbb.ACT", "&51!bbbb.ACT", "&52!bbbb.ACT"],
  );
  assert.deepEqual(loaded.get(0).diagnostics, []);
});

test("reports missing ACT names and mechanics without flattening another actor", async () => {
  const scene = new THREE.Group();
  addActor(scene, "Exact", new THREE.Matrix4(), true);
  const loaded = await loadNonCarDebrisAssets(
    [
      {
        kind: "noncars",
        actorFile: "parts.act",
        nonCars: [
          { actor: "exact", mechanics: "50missing.txt" },
          { actor: "Exact", mechanics: "50missing.txt" },
        ],
      },
    ],
    async () => scene,
    async () => {
      throw new Error("file absent");
    },
  );
  assert.equal(loaded.get(0).templates.length, 0);
  assert.match(loaded.get(0).diagnostics[0], /missingactor: exact/);
  assert.match(
    loaded.get(0).diagnostics[1],
    /missingmechanics: 50missing\.txt/,
  );
});

test("deduplicates exact actor identifiers through the native 100-entry resource cache", async () => {
  const scene = new THREE.Group();
  addActor(scene, "Shared", new THREE.Matrix4(), true);
  let actorLoads = 0;
  const loaded = await loadNonCarDebrisAssets(
    [
      {
        kind: "noncars",
        actorFile: "parts.act",
        nonCars: [
          { actor: "Shared", mechanics: "50part.txt" },
          { actor: "Shared", mechanics: "50part.txt" },
        ],
      },
    ],
    async () => {
      actorLoads++;
      return scene;
    },
    async () => mechanics(50),
  );
  const templates = loaded.get(0).templates;
  assert.equal(actorLoads, 1);
  assert.equal(templates.length, 2);
  assert.equal(templates[0].actor, templates[1].actor);
});

async function originalStore() {
  try {
    await access(new URL("../carma2_orig/data.twt", import.meta.url));
    return await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
  } catch {
    return undefined;
  }
}

function originalSceneBuilder(assets, directory, scenes) {
  return async (filename) => {
    const nodes = parseAct(await assets.read(`${directory}/${filename}`));
    const models = new Map();
    for (const entry of assets.manifest.filter(
      (item) =>
        item.path.toLowerCase().startsWith(`${directory.toLowerCase()}/`) &&
        item.path.toLowerCase().endsWith(".dat"),
    )) {
      for (const model of parseDat(await assets.read(entry.path)))
        models.set(model.name.toLowerCase(), model);
    }
    const material = new THREE.MeshBasicMaterial();
    function build(node) {
      const actor = new THREE.Group();
      actor.name = node.name;
      const m = node.transform;
      const matrix = new THREE.Matrix4().set(
        m[0],
        m[3],
        m[6],
        m[9],
        m[1],
        m[4],
        m[7],
        m[10],
        m[2],
        m[5],
        m[8],
        m[11],
        0,
        0,
        0,
        1,
      );
      actor.matrix.copy(matrix);
      actor.matrixAutoUpdate = false;
      actor.userData.c2ActorMatrix = matrix.clone();
      if (node.model) {
        const data = models.get(node.model.toLowerCase());
        if (data)
          actor.add(new THREE.Mesh(createModelGeometry(data), material));
      }
      for (const child of node.children) actor.add(build(child));
      return actor;
    }
    const wrapper = new THREE.Group();
    for (const node of nodes) wrapper.add(build(node));
    scenes.set(filename, wrapper);
    return wrapper;
  };
}

const originals = await originalStore();
test(
  "loads all five authored stock noncar ACT and mechanics dependencies",
  { skip: !originals },
  async () => {
    const cases = [
      {
        directory: "data/RACES/Carrier1",
        actorFile: "&50gun01_DEBRIS1.act",
        mechanics: "50gun01_DEBRIS1.txt",
        mass: 21.239775,
      },
      {
        directory: "data/RACES/Carrier1",
        actorFile: "&51gun01_DEBRIS2.act",
        mechanics: "51gun01_DEBRIS2.txt",
        mass: 8.295681,
      },
      {
        directory: "data/RACES/Carrier1",
        actorFile: "&52TGUN_DEBRIS1.act",
        mechanics: "52TGUN_DEBRIS1.txt",
        mass: 7.638896,
      },
      {
        directory: "data/RACES/Carrier1",
        actorFile: "&53TGUN_DEBRIS2.act",
        mechanics: "53TGUN_DEBRIS2.txt",
        mass: 15.882541,
      },
      {
        directory: "data/RACES/newcity1",
        actorFile: "&petpump.act",
        mechanics: "99petpump.txt",
        mass: 0.166343,
      },
    ];
    const scenes = new Map();
    const specs = [];
    for (const item of cases) {
      const roots = parseAct(
        await originals.read(`${item.directory}/${item.actorFile}`),
      );
      assert.equal(roots.length, 1);
      specs.push({
        kind: "noncars",
        actorFile: item.actorFile,
        nonCars: [{ actor: roots[0].name, mechanics: item.mechanics }],
      });
    }
    const loaded = await loadNonCarDebrisAssets(
      specs,
      async (name) => {
        const item = cases.find((candidate) => candidate.actorFile === name);
        return originalSceneBuilder(originals, item.directory, scenes)(name);
      },
      async (name) =>
        parseNonCarMechanics(
          decodeText(await originals.read(`data/NONCARS/${name}`)),
          name,
        ),
    );
    assert.equal(loaded.size, cases.length);
    for (let index = 0; index < cases.length; index++) {
      const item = cases[index];
      const [template] = loaded.get(index).templates;
      assert.equal(loaded.get(index).diagnostics.length, 0);
      assert.equal(
        template.originalName,
        parseAct(await originals.read(`${item.directory}/${item.actorFile}`))[0]
          .name,
      );
      assert.equal(
        template.nativeIdentifier,
        `&${item.mechanics.slice(0, 2)}!bbbb.ACT`,
      );
      assert.ok(Math.abs(template.mechanics.freeMass - item.mass) < 1e-5);
      const originalScene = scenes.get(item.actorFile);
      const originalActor = originalScene.children[0];
      assert.equal(template.actor.parent, null);
      assert.deepEqual(
        template.actor.matrix.elements,
        originalActor.matrix.elements,
      );
      assert.equal(
        template.actor.children[0].geometry,
        originalActor.children[0].geometry,
      );
    }
  },
);
