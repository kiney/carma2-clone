import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { access } from "node:fs/promises";
import { loadGhostAssets } from "../src/ghost-assets.ts";
import { createAssetStore } from "../server/assets.mjs";
import { parseAct, parseDat } from "../src/formats.ts";
import { createModelGeometry } from "../src/render-geometry.ts";

function actor(name, modelName, x = 0, sx = 1) {
  const root = new THREE.Group();
  root.name = name;
  root.position.x = x;
  root.scale.x = sx;
  root.updateMatrix();
  if (modelName) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-1, -2, 0, 3, 4, 2], 3),
    );
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = modelName;
    root.add(mesh);
  }
  return root;
}

test("positive actor count loads authored actors and borrows direct model resources", async () => {
  const first = actor("partA", "modelA", 6, 2);
  const second = actor("partB", "modelB", -3);
  const scenes = new Map([
    ["partA", Object.assign(new THREE.Group(), { children: [first] })],
    ["partB", Object.assign(new THREE.Group(), { children: [second] })],
  ]);
  const loaded = await loadGhostAssets(
    [{ kind: "ghostparts", actorCountSource: 2, actors: ["partA", "partB"] }],
    async (name) => scenes.get(name),
  );
  const set = loaded.get(0);
  assert.deepEqual(
    set.templates.map((t) => t.name),
    ["partA", "partB"],
  );
  assert.equal(set.templates[0].model, first.children[0]);
  assert.equal(set.templates[0].model.geometry, first.children[0].geometry);
  assert.equal(set.templates[0].matrix.elements[12], 6);
  assert.equal(set.boundsDX, 0);
  assert.equal(set.boundsDY, 0);
  assert.deepEqual(set.diagnostics, []);
});

test("nonpositive count selects direct container children in reverse insertion order", async () => {
  const container = actor("container", "containerModel", 0, 2);
  const parseFirst = actor("parseFirst", "model1", 1);
  const parseLast = actor("parseLast", "model2", 5);
  const nested = actor("nested", "nestedModel");
  parseFirst.add(nested);
  container.add(parseFirst, parseLast);
  const scene = new THREE.Group();
  scene.name = "scene wrapper";
  scene.add(container);
  const loaded = await loadGhostAssets(
    [{ kind: "ghostparts", actorCountSource: -1, actors: ["PARTS.ACT"] }],
    async () => scene,
  );
  const set = loaded.get(0);
  assert.deepEqual(
    set.templates.map((t) => t.name),
    ["parseLast", "parseFirst"],
  );
  assert.deepEqual(set.containerSize, [9, 6, 2]);
  assert.equal(set.templates[1].model.name, "model1");
  assert.equal(
    set.templates.some((t) => t.name === "nested"),
    false,
  );
  assert.equal(
    set.templates.some((t) => t.name === "scene wrapper"),
    false,
  );
});

test("missing direct model is reported and non-ghost specs are ignored", async () => {
  const scene = new THREE.Group();
  scene.add(actor("broken", undefined));
  const loaded = await loadGhostAssets(
    [
      { kind: "ghostparts", actorCountSource: 1, actors: ["broken"] },
      { kind: "shards" },
    ],
    async () => scene,
  );
  assert.equal(loaded.size, 1);
  assert.deepEqual(loaded.get(0).diagnostics, ["missingmodel: broken"]);
  assert.equal(loaded.has(1), false);
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

function originalSceneBuilder(assets, directory) {
  return async (filename) => {
    const actPath = `${directory}/${filename}`;
    const nodes = parseAct(await assets.read(actPath));
    const models = new Map();
    for (const entry of assets.manifest.filter(
      (item) =>
        item.path.toLowerCase().startsWith(`${directory.toLowerCase()}/`) &&
        item.path.toLowerCase().endsWith(".dat"),
    )) {
      for (const model of parseDat(await assets.read(entry.path)))
        models.set(model.name.toLowerCase(), model);
    }
    const materials = new Map();
    function makeActor(node, inheritedMaterial, inheritedStyle = 4) {
      const actor = new THREE.Group();
      actor.name = node.name;
      const m = node.transform;
      actor.matrix.set(
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
      actor.matrix.decompose(actor.position, actor.quaternion, actor.scale);
      const materialName = node.material ?? inheritedMaterial;
      const style = node.renderStyle || inheritedStyle;
      if (node.model && style !== 1) {
        const data = models.get(node.model.toLowerCase());
        if (data) {
          const geometry = createModelGeometry(data);
          let material = materials.get(materialName ?? "<default>");
          if (!material) {
            material = new THREE.MeshBasicMaterial();
            materials.set(materialName ?? "<default>", material);
          }
          const mesh = new THREE.Mesh(geometry, material);
          mesh.name = node.model;
          actor.add(mesh);
        }
      }
      for (const child of node.children)
        actor.add(makeActor(child, materialName, style));
      return actor;
    }
    const wrapper = new THREE.Group();
    wrapper.name = directory.split("/").at(-1);
    for (const node of nodes) wrapper.add(makeActor(node));
    return wrapper;
  };
}

const originals = await originalStore();
test(
  "original positive stock ghost retains ReadShrapnelSpec zero bounds",
  { skip: !originals },
  async () => {
    const directory = "data/RACES/desert1";
    const filename = "&pump_debris1.act";
    const scene = await originalSceneBuilder(originals, directory)(filename);
    const root = scene.children[0];
    const modelName = root.children.find((child) => child.isMesh)?.name;
    const data = parseDat(
      await originals.read(`${directory}/&pump_debris1.dat`),
    ).find((model) => model.name.toLowerCase() === modelName?.toLowerCase());
    assert.ok(data, `stock DAT must contain ${modelName}`);
    const spec = {
      kind: "ghostparts",
      actorCountSource: 1,
      actors: [filename],
    };
    const loaded = await loadGhostAssets([spec], async () => scene);
    const template = loaded.get(0).templates[0];
    assert.equal(template.name, root.name);
    assert.equal(template.model.name, root.children[0].name);
    assert.equal(data.positions.length > 0, true);
    assert.equal(loaded.get(0).boundsDX, 0);
    assert.equal(loaded.get(0).boundsDY, 0);
  },
);

test(
  "original negative stock ghost enumerates a container's direct ACT children",
  { skip: !originals },
  async () => {
    const directory = "data/RACES/Airport1";
    const filename = "airhutround.act";
    const parsed = parseAct(await originals.read(`${directory}/${filename}`));
    const loaded = await loadGhostAssets(
      [{ kind: "ghostparts", actorCountSource: -1, actors: [filename] }],
      originalSceneBuilder(originals, directory),
    );
    const templates = loaded.get(0).templates;
    const expected = parsed[0].children
      .slice()
      .reverse()
      .filter((node) => node.model);
    assert.equal(templates.length, expected.length);
    assert.deepEqual(
      templates.map((template) => template.name),
      expected.map((child) => child.name),
    );
    assert.ok(
      loaded
        .get(0)
        .containerSize?.every((value) => Number.isFinite(value) && value > 0),
    );
    assert.equal(loaded.get(0).boundsDX, loaded.get(0).containerSize[0]);
    assert.equal(loaded.get(0).boundsDY, loaded.get(0).containerSize[1]);
  },
);
