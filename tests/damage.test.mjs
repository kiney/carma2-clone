import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Group,
  Mesh,
  MeshLambertMaterial,
  Vector3,
} from "three";
import { parseWam, DamageSystem } from "../src/damage.ts";
import { parseTwt } from "../server/assets.mjs";
import { parseAct, parseDat } from "../src/formats.ts";

const connotations = ["0", "0", "0", "none", "0", "0", "0", "0", "none", "0"];
function smash() {
  return [
    "GLASS.MAT",
    "INTACT.PIX",
    "2",
    "0.0005",
    "1",
    ...connotations,
    "1",
    "CRACKED.PIX",
    "0.002",
    "0",
    ...connotations,
    "1",
    "BROKEN.PIX",
  ];
}
function wam(parts = ["BODY.DAT", "normal", "boring", "0"]) {
  return [
    "VERSION 4",
    "1",
    "0.1",
    "1",
    "-0.1",
    "0",
    "0",
    "1",
    "0.25",
    "1",
    "-0.25",
    "1",
    "-0.05",
    "0.15",
    "1",
    "0",
    "0,0.16,0.05",
    "1",
    ...parts,
  ].join("\n");
}
function mesh(name = "BODY.DAT", geometry) {
  if (!geometry) {
    geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([
          -0.2, 0.1, -0.4, 0.2, 0.1, -0.4, -0.2, 0.2, -0.4, 0.2, 0.2, -0.4,
        ]),
        3,
      ),
    );
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    geometry.computeVertexNormals();
  }
  const material = new MeshLambertMaterial();
  material.name = "GLASS.MAT";
  const object = new Mesh(geometry, material);
  object.name = name;
  return object;
}
function fakeAssets(text, textures = new Map()) {
  const path = "data/CARS/TEST/TEST.WAM";
  return {
    manifest: [{ path }],
    textures,
    warnings: [],
    resolve: (name) =>
      name.toLowerCase() === path.toLowerCase() ? path : undefined,
    text: async () => text,
  };
}
function systemGroup(object) {
  const group = new Group();
  group.name = "TEST";
  group.add(object);
  return group;
}

test("WAM parser reads crush regions, softness, flap hinges, poly samples and smash thresholds", () => {
  const parsed = parseWam(
    wam([
      "DOOR.DAT",
      "hard",
      "flap",
      "0",
      "1",
      "2",
      "1",
      "easy",
      "poly",
      "2",
      "0",
      "3",
      "1",
      ...smash(),
    ]),
  );
  assert.deepEqual(parsed.limits[0], { min: [0.1], max: [-0.1] });
  assert.equal(parsed.bendability, 1);
  assert.deepEqual(parsed.driver.toArray(), [0, 0.16, 0.05]);
  const part = parsed.parts[0];
  assert.equal(part.softnessFactor, 0.5);
  assert.deepEqual(part.hinges, [0, 1, 2]);
  assert.deepEqual(part.shapePoints, [0, 3]);
  assert.equal(part.kevOFlap, true);
  assert.deepEqual(
    part.smashes[0].levels.map((level) => level.threshold),
    [0.0005, 0.002],
  );
  assert.deepEqual(part.smashes[0].levels[1].pixelmaps, ["BROKEN.PIX"]);
  assert.equal(
    parseWam(wam().replace("VERSION 4", "VERSION 104")).version,
    104,
  );
  assert.throws(() => parseWam("VERSION 3"), /version/);
  assert.throws(
    () => parseWam(wam().split("\n").slice(0, 15).join("\n")),
    /Truncated/,
  );
  assert.throws(
    () => parseWam(wam().replace("\n1\n0.1", "\n-1\n0.1")),
    /count/,
  );
});

test("impacts visibly deform vertices, respect master crush planes and repair exactly", async () => {
  const object = mesh();
  const pristine = Array.from(object.geometry.attributes.position.array);
  const system = new DamageSystem(
    fakeAssets(wam()),
    systemGroup(object),
    "TEST.TXT\nTEST.WAM",
  );
  await system.init();
  const impact = new Vector3(-0.2, 0.1, -0.4);
  system.impact(impact, new Vector3(0, 0, 1), 0.5);
  assert.deepEqual(
    Array.from(object.geometry.attributes.position.array),
    pristine,
  );
  for (let hit = 0; hit < 20; hit++)
    system.impact(impact, new Vector3(0, 0, 1), 8);
  const positions = object.geometry.attributes.position;
  assert.ok(
    positions.getZ(0) > pristine[2] + 0.1,
    "dent must be visible at the impact point",
  );
  for (let i = 0; i < positions.count; i++)
    assert.ok(
      positions.getZ(i) <= -0.25 + 1e-6,
      "original front vertices cannot cross the WAM front crush plane",
    );
  assert.ok(object.geometry.boundingSphere);
  assert.ok(object.geometry.boundingBox);
  system.repair();
  assert.deepEqual(Array.from(positions.array), pristine);
});

test("flap hinges and uncrushable parts remain fixed; harder parts bend less", async () => {
  const normal = mesh();
  const hard = mesh();
  const solid = mesh();
  const flap = mesh("DOOR.DAT");
  const objects = [normal, hard, solid, flap];
  const data = [
    wam(),
    wam(["BODY.DAT", "very_hard", "boring", "0"]),
    wam(["BODY.DAT", "uncrushable", "boring", "0"]),
    wam([
      "DOOR.DAT",
      "normal",
      "flap",
      "0",
      "1",
      "2",
      "1",
      "normal",
      "box",
      "0",
    ]),
  ];
  const systems = [];
  for (let i = 0; i < objects.length; i++) {
    const system = new DamageSystem(
      fakeAssets(data[i]),
      systemGroup(objects[i]),
      "TEST.TXT\nTEST.WAM",
    );
    await system.init();
    systems.push(system);
  }
  const pristine = Array.from(solid.geometry.attributes.position.array);
  systems.forEach((system) =>
    system.impact(new Vector3(0.2, 0.2, -0.4), new Vector3(0, 0, 1), 3),
  );
  assert.deepEqual(
    Array.from(solid.geometry.attributes.position.array),
    pristine,
  );
  assert.ok(
    normal.geometry.attributes.position.getZ(3) >
      hard.geometry.attributes.position.getZ(3),
  );
  for (let i = 0; i < 3; i++)
    assert.equal(
      flap.geometry.attributes.position.getZ(i),
      pristine[i * 3 + 2],
    );
  assert.ok(flap.geometry.attributes.position.getZ(3) > pristine[11]);
});

test("damage isolates shared geometries and materials and handles actor transforms", async () => {
  const source = mesh();
  const other = new Mesh(source.geometry, source.material);
  const sourceGeometry = source.geometry,
    sourceMaterial = source.material;
  source.position.x = 2;
  const group = systemGroup(source);
  group.rotation.y = 0.7;
  group.position.set(10, 4, 20);
  const system = new DamageSystem(
    fakeAssets(wam()),
    group,
    "TEST.TXT\nTEST.WAM",
  );
  await system.init();
  assert.notEqual(source.geometry, sourceGeometry);
  assert.notEqual(source.material, sourceMaterial);
  const pristine = Array.from(other.geometry.attributes.position.array);
  system.impact(new Vector3(1.8, 0.1, -0.4), new Vector3(0, 0, 1), 4);
  assert.notDeepEqual(
    Array.from(source.geometry.attributes.position.array),
    pristine,
  );
  assert.deepEqual(
    Array.from(other.geometry.attributes.position.array),
    pristine,
  );
});

test("original smash thresholds swap pixelmaps and repair restores the original material", async () => {
  const textures = new Map();
  for (const name of ["intact", "cracked", "broken"]) {
    const texture = new DataTexture();
    texture.name = name;
    textures.set(name, texture);
  }
  const object = mesh();
  object.material.map = textures.get("intact");
  const system = new DamageSystem(
    fakeAssets(
      wam(["BODY.DAT", "normal", "boring", "1", ...smash()]),
      textures,
    ),
    systemGroup(object),
    "TEST.TXT\nTEST.WAM",
  );
  await system.init();
  const impact = new Vector3(-0.2, 0.1, -0.4);
  system.impact(impact, new Vector3(0, 0, 1), 4);
  assert.equal(object.material.map.name, "cracked");
  assert.notEqual(
    object.material.map,
    textures.get("cracked"),
    "private texture preserves per-material transforms",
  );
  system.impact(impact, new Vector3(0, 0, 1), 6);
  assert.equal(object.material.map.name, "broken");
  system.repair();
  assert.equal(object.material.map, textures.get("intact"));
});

test("missing damage data still permits bounded dents and init is idempotent", async () => {
  const object = mesh("UNKNOWN");
  const system = new DamageSystem(
    fakeAssets("invalid"),
    systemGroup(object),
    "TEST.TXT",
  );
  await system.init();
  const geometry = object.geometry;
  await system.init();
  assert.equal(object.geometry, geometry);
  system.impact(new Vector3(-0.2, 0.1, -0.4), new Vector3(0, 0, 1), 4);
  assert.ok(object.geometry.attributes.position.getZ(0) > -0.4);
  assert.ok(object.geometry.attributes.position.getZ(0) < -0.37);
});

async function archive(name) {
  const buffer = await readFile(`carma2_orig/data/CARS/${name}.TWT`);
  const entries = parseTwt(buffer).entries;
  return {
    entries,
    read: (entry) => buffer.subarray(entry.offset, entry.offset + entry.size),
  };
}

test("local Eagle3 and rival archive WAMs parse, and original Eagle meshes visibly deform and repair", async (t) => {
  let eagle;
  try {
    eagle = await archive("EAGLE3");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local game assets absent");
      return;
    }
    throw error;
  }
  const w = parseWam(
    eagle
      .read(eagle.entries.find((entry) => /\.wam$/i.test(entry.name)))
      .toString("latin1"),
  );
  assert.equal(w.parts.length, 18);
  assert.equal(w.parts.filter((part) => part.type === "flap").length, 3);
  assert.equal(
    w.parts.reduce((count, part) => count + part.smashes.length, 0),
    7,
  );
  for (const name of [
    "newhawk",
    "VLAD3",
    "copcar",
    "buggy",
    "piranh4",
    "bigdump",
  ]) {
    const a = await archive(name);
    const data = parseWam(
      a
        .read(a.entries.find((entry) => /\.wam$/i.test(entry.name)))
        .toString("latin1"),
    );
    assert.ok(data.parts.length > 0, `${name} original crush parts parsed`);
  }
  const models = new Map();
  for (const entry of eagle.entries.filter((entry) =>
    /\.dat$/i.test(entry.name),
  )) {
    for (const model of parseDat(eagle.read(entry)))
      models.set(model.name.toLowerCase(), model);
  }
  const group = new Group();
  group.name = "EAGLE3";
  const originals = [];
  function actor(node) {
    const part = new Group();
    part.name = node.name;
    if (node.model) {
      const model = models.get(node.model.toLowerCase());
      if (model) {
        const geometry = new BufferGeometry();
        geometry.setAttribute(
          "position",
          new BufferAttribute(model.positions.slice(), 3),
        );
        geometry.setIndex(model.faces.flatMap((face) => face.indices));
        const object = mesh(model.name, geometry);
        part.add(object);
        originals.push([object, Array.from(model.positions)]);
      }
    }
    node.children.forEach((child) => part.add(actor(child)));
    return part;
  }
  const act = eagle.entries.find((entry) => /^EAGLE3.ACT$/i.test(entry.name));
  parseAct(eagle.read(act)).forEach((node) => group.add(actor(node)));
  const path = "data/CARS/EAGLE3/EAGLE3.WAM";
  const assets = {
    manifest: [{ path }],
    resolve: (name) =>
      name.toLowerCase() === path.toLowerCase() ? path : undefined,
    text: async () =>
      eagle
        .read(eagle.entries.find((entry) => /\.wam$/i.test(entry.name)))
        .toString("latin1"),
  };
  const system = new DamageSystem(assets, group, "EAGLE3.TXT\nEAGLE3.WAM");
  await system.init();
  system.impact(new Vector3(0, 0.1, -0.35), new Vector3(0, 0, 1), 6);
  let changed = 0;
  for (const [object, original] of originals) {
    if (
      Array.from(object.geometry.attributes.position.array).some(
        (value, index) => Math.abs(value - original[index]) > 1e-5,
      )
    )
      changed++;
    assert.ok(
      Array.from(object.geometry.attributes.position.array).every(
        Number.isFinite,
      ),
    );
  }
  assert.ok(changed >= 3, "original nose/body parts visibly dent");
  system.repair();
  for (const [object, original] of originals)
    assert.deepEqual(
      Array.from(object.geometry.attributes.position.array),
      original,
    );
});
