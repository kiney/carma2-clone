import test from "node:test";
import assert from "node:assert/strict";
import { Group, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { DamageSystem } from "../src/damage.ts";
import { nativeCarGrooveActors } from "../src/default-car-crush.ts";
import { createModelGeometry } from "../src/render-geometry.ts";
import { parseAct, parseDat } from "../src/formats.ts";
import { createAssetStore } from "../server/assets.mjs";

const fixtureModel = () => ({
  name: "MODEL.DAT",
  positions: Float32Array.from([
    -0.2, 0.1, -0.4, 0.2, 0.1, -0.4, -0.2, 0.2, -0.4, 0.2, 0.2, -0.4,
  ]),
  uvs: new Float32Array(8),
  flags: 0,
  faces: [
    { indices: [0, 1, 2], material: 0, smoothing: 0, flags: 0 },
    { indices: [2, 1, 3], material: 0, smoothing: 0, flags: 0 },
  ],
});
function actor(name, type = 1, provenance = true) {
  const result = new Group();
  result.name = name;
  if (type !== undefined) result.userData.c2ActorType = type;
  const geometry = createModelGeometry(fixtureModel());
  if (!provenance) delete geometry.userData.sourcePositions;
  result.add(new Mesh(geometry, new MeshBasicMaterial()));
  return result;
}
const wam = (explicit = "EXPLICIT.ACT", softness = "uncrushable") =>
  [
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
    explicit,
    softness,
    "boring",
    "0",
  ].join("\n");
async function system(
  actors,
  { config = "", text = wam(), available = true } = {},
) {
  const group = new Group();
  group.name = "TEST";
  group.add(...actors);
  const warnings = [];
  const damage = new DamageSystem(
    {
      resolve: () => (available ? "data/CARS/TEST/TEST.WAM" : undefined),
      text: async () => text,
      warnings,
    },
    group,
    `TEST.TXT\nTEST.WAM\n${config}`,
  );
  await damage.init();
  return { damage, warnings };
}
const coordinates = (actor) =>
  Array.from(actor.children[0].geometry.getAttribute("position").array);
const hit = (damage) =>
  damage.impact(new Vector3(-0.2, 0.1, -0.4), new Vector3(0, 0, 1), 0.5);

test("native default MODEL crush preserves authored entries and explicit uncrushable records", async () => {
  const body = actor("BODY.ACT"),
    explicit = actor("EXPLICIT.ACT"),
    other = actor("OTHER.ACT");
  const { damage } = await system([body, explicit, other]);
  assert.equal(damage.wam.parts.length, 1);
  assert.equal(damage.wam.parts[0].actor, "EXPLICIT.ACT");
  assert.equal(damage.runtimeParts.length, 3);
  const runtime = damage.runtimeParts.find((part) => part.actor === body);
  assert.equal(runtime.defaultCrush, true);
  assert.equal(runtime.part.softnessFactor, 1);
  assert.equal(runtime.part.type, "boring");
  assert.equal(runtime.part.smashes.length, 0);
  assert.equal(damage.wam.parts.includes(runtime.part), false);
  const listed = damage.runtimeParts.find((part) => part.actor === explicit);
  assert.equal(listed.part, damage.wam.parts[0]);
  assert.equal(listed.defaultCrush, false);
  damage.repair();
  const beforeBody = coordinates(body),
    beforeExplicit = coordinates(explicit);
  hit(damage);
  assert.notDeepEqual(coordinates(body), beforeBody);
  assert.deepEqual(coordinates(explicit), beforeExplicit);
  assert.equal(damage.detachQueue.length, 0);
  damage.repairStep(100000);
  damage.repairStep(40);
  assert.deepEqual(coordinates(body), beforeBody);
  hit(damage);
  damage.repair();
  assert.deepEqual(coordinates(body), beforeBody);
  assert.equal(damage.wam.parts.length, 1);
});

test("default crush requires loaded WAM limits, native MODEL type and original MODEL provenance", async () => {
  const noMetadata = actor("PLAIN.ACT");
  delete noMetadata.userData.c2ActorType;
  const nonModel = actor("DUMMY.ACT", 0),
    noProvenance = actor("NO_SOURCE.ACT", 1, false);
  const listed = actor("EXPLICIT.ACT");
  const { damage } = await system([noMetadata, nonModel, noProvenance, listed]);
  assert.equal(damage.runtimeParts.length, 1);
  hit(damage);
  for (const value of [noMetadata, nonModel, noProvenance])
    assert.deepEqual(
      coordinates(value),
      Array.from(
        createModelGeometry(fixtureModel()).getAttribute("position").array,
      ),
    );
  const missing = await system([actor("BODY.ACT")], { available: false });
  assert.equal(missing.damage.runtimeParts.length, 0);
  const partial = await system([actor("BODY.ACT")]);
  assert.ok(
    partial.warnings.some((warning) =>
      warning.includes("0/1 WAM actors bound"),
    ),
  );
});

test("default crush excludes the actual case-sensitive full-identifier GROOVE owner only", async () => {
  const spin = actor("SPIN.ACT"),
    caseVariant = actor("spin.act"),
    bare = actor("BARE"),
    extension = actor("BARE.ACT"),
    firstDuplicate = actor("DUP.ACT"),
    lastDuplicate = actor("DUP.ACT");
  const config =
    "START OF GROOVE\nSPIN.ACT\nnot a lollipop\nNEXT GROOVE\nBARE\nnot a lollipop\nNEXT GROOVE\nDUP.ACT\nnot a lollipop\nEND OF GROOVE";
  const { damage } = await system(
    [spin, caseVariant, bare, extension, firstDuplicate, lastDuplicate],
    { config },
  );
  const defaults = new Set(
    damage.runtimeParts
      .filter((part) => part.defaultCrush)
      .map((part) => part.actor),
  );
  assert.deepEqual(defaults, new Set([caseVariant, extension, firstDuplicate]));
  const group = new Group();
  group.add(spin);
  assert.throws(
    () => nativeCarGrooveActors(group, "START OF GROOVE\nSPIN.ACT"),
    /Missing END/,
  );
  const invalid = await system([actor("BODY.ACT")], {
    config: "START OF GROOVE\nBODY.ACT",
  });
  assert.equal(invalid.damage.runtimeParts.length, 0);
});

test("two original omitted main MODEL actors receive localized default crush and repair", async (t) => {
  let store;
  try {
    store = await createAssetStore(process.env.CARMA2_ROOT);
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Original installation absent");
      return;
    }
    throw error;
  }
  const paths = new Map(
    store.manifest.map(({ path }) => [path.toLowerCase(), path]),
  );
  const cases = [
    ["data/CARS/bugtoo5/bugtoo5", "BUGTOO.ACT"],
    ["adv_data/CARS/ped_o_matic2000/PED_O_MATIC2000", "PEDOMATICbase"],
  ];
  let checked = 0;
  for (const [base, rootName] of cases) {
    const configPath = paths.get((base + ".txt").toLowerCase()),
      actPath = paths.get((base + ".act").toLowerCase()),
      wamPath = paths.get((base + ".wam").toLowerCase());
    if (!configPath || !actPath || !wamPath) {
      t.diagnostic(`Original ${base} absent`);
      continue;
    }
    checked++;
    const directory = configPath.slice(0, configPath.lastIndexOf("/") + 1);
    const models = new Map();
    for (const path of paths.values())
      if (
        path.toLowerCase().startsWith(directory.toLowerCase()) &&
        /\.dat$/i.test(path)
      )
        for (const model of parseDat(await store.read(path)))
          models.set(model.name.toLowerCase(), model);
    const group = new Group();
    group.name = base.split("/").at(-1);
    const convert = (node) => {
      const value = new Group();
      value.name = node.name;
      value.userData.c2ActorType = node.type;
      const m = node.transform;
      value.matrix.set(
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
      value.matrix.decompose(value.position, value.quaternion, value.scale);
      const model = node.model && models.get(node.model.toLowerCase());
      if (model)
        value.add(
          new Mesh(createModelGeometry(model), new MeshBasicMaterial()),
        );
      node.children.forEach((child) => value.add(convert(child)));
      return value;
    };
    parseAct(await store.read(actPath)).forEach((node) =>
      group.add(convert(node)),
    );
    const text = (await store.read(configPath)).toString("latin1");
    const damage = new DamageSystem(
      {
        resolve: (path) => paths.get(path.toLowerCase()),
        text: async (path) => (await store.read(path)).toString("latin1"),
      },
      group,
      text,
      configPath,
    );
    await damage.init();
    const body = damage.runtimeParts.find(
      (part) => part.actor.name === rootName,
    );
    assert.ok(
      body?.defaultCrush,
      `${base}: omitted main MODEL uses native default`,
    );
    assert.equal(
      damage.wam.parts.some(
        (part) => part.actor.toLowerCase() === rootName.toLowerCase(),
      ),
      false,
    );
    damage.repair();
    const mesh = body.actor.children.find((child) => child instanceof Mesh);
    const position = mesh.geometry.getAttribute("position");
    const clean = Array.from(position.array);
    let front = 0;
    for (let i = 1; i < position.count; i++)
      if (position.getZ(i) < position.getZ(front)) front = i;
    const point = new Vector3()
      .fromBufferAttribute(position, front)
      .applyMatrix4(mesh.matrixWorld)
      .applyMatrix4(group.matrixWorld.clone().invert());
    damage.impact(point, new Vector3(0, 0, 1), 0.5);
    const moved = Array.from(position.array).filter(
      (value, index) => value !== clean[index],
    ).length;
    assert.ok(
      moved > 0 && moved < clean.length,
      `${base}: localized movement ${moved}/${clean.length}`,
    );
    damage.repairStep(100000);
    damage.repairStep(40);
    assert.deepEqual(
      Array.from(position.array),
      clean,
      `${base}: held repair restores root MODEL`,
    );
    damage.impact(point, new Vector3(0, 0, 1), 0.5);
    damage.repair();
    assert.deepEqual(
      Array.from(position.array),
      clean,
      `${base}: full repair restores root MODEL`,
    );
    t.diagnostic(
      `${base}: ${moved}/${clean.length} default root coordinates moved and repaired; ${damage.runtimeParts.filter((part) => part.defaultCrush).length} runtime defaults`,
    );
  }
  if (!checked) t.skip("Original target cars absent");
});
