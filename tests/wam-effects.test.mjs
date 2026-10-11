import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  Vector3,
} from "three";
import { createAssetStore } from "../server/assets.mjs";
import { parseWam, DamageSystem, flushWamSmashQueue } from "../src/damage.ts";
import { NativeSmashQueue } from "../src/smash-queue.ts";
import { parseSmashableEnvironment } from "../src/world-smash.ts";

// Independently authored fixtures; proprietary assets remain external.
const empty = ["0", "0", "0", "none", "0", "0", "0", "0", "none", "0"];
const speed = ["1,2", "0.25", "0.5", "0.75", "1", "1.25"];
function effects(sound) {
  return ["1", String(sound), ...empty.slice(1)];
}
function smash(
  material = "GLASS.MAT",
  levels = [
    { threshold: 0.00001, flags: 0, sound: 101 },
    { threshold: 0.00002, flags: 0, sound: 202 },
  ],
) {
  return [
    material,
    "INTACT.PIX",
    String(levels.length),
    ...levels.flatMap((l) => [
      String(l.threshold),
      String(l.flags),
      ...(l.data ?? effects(l.sound)),
      "1",
      `TIER${l.sound ?? 0}.PIX`,
    ]),
  ];
}
function wam(smashes = [smash()], actor = "BODY.DAT") {
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
    actor,
    "normal",
    "boring",
    String(smashes.length),
    ...smashes.flat(),
  ].join("\n");
}
function mesh(name = "BODY.DAT", materialName = "GLASS.MAT") {
  const geometry = new BufferGeometry();
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
  const material = new MeshLambertMaterial();
  material.name = materialName;
  const model = new Mesh(geometry, material);
  model.name = name;
  return model;
}
async function system(text = wam(), models = [mesh()]) {
  const path = "data/CARS/TEST/TEST.WAM";
  const assets = {
    manifest: [{ path }],
    textures: new Map(),
    warnings: [],
    resolve: (name) =>
      name.toLowerCase() === path.toLowerCase() ? path : undefined,
    text: async () => text,
  };
  const group = new Group();
  group.name = "TEST";
  group.add(...models);
  const damage = new DamageSystem(assets, group, "TEST.TXT\nTEST.WAM");
  await damage.init();
  const events = [];
  damage.onWamSmash = (event) => events.push(event);
  return { damage, events, group };
}
function impact(damage) {
  damage.impact(new Vector3(-0.2, 0.1, -0.4), new Vector3(0, 0, 1), 0.5);
}

test("shared WAM queue retains first impact context across cars and samples the flush clock", async () => {
  const a = await system();
  const b = await system();
  const queue = new NativeSmashQueue();
  a.damage.configureWamSmashQueue(queue);
  b.damage.configureWamSmashQueue(queue);
  impact(a.damage);
  a.damage.impact(new Vector3(0.2, 0.1, -0.4), new Vector3(0, 0, 1), 0.5);
  impact(b.damage);
  assert.equal(queue.count, 2, "authored identity is separate for each car");
  assert.equal(
    a.events.length + b.events.length,
    0,
    "effects wait for the shared barrier",
  );
  let clock = 999;
  assert.equal(
    flushWamSmashQueue(queue, () => ++clock),
    2,
  );
  assert.deepEqual(
    a.events.map((event) => event.timeMs),
    [1000, 1000],
  );
  assert.deepEqual(
    b.events.map((event) => event.timeMs),
    [1001, 1001],
  );
  assert.deepEqual(a.events[0].localPoint.toArray(), [-0.2, 0.1, -0.4]);
  assert.equal(queue.count, 0);
  impact(a.damage);
  assert.equal(queue.count, 0, "reached state advances only on dispatch");
  a.damage.repair();
  impact(a.damage);
  assert.equal(queue.count, 1, "repair rearms the authored tier");
});

test("WAM keeps the first queued starting velocity through upgrades and later physical changes", async () => {
  const { damage, events } = await system();
  const queue = new NativeSmashQueue();
  damage.configureWamSmashQueue(queue);
  const velocity = new Vector3(6.9, 0, 0);
  damage.readSmashStartingVelocity = () => velocity;
  impact(damage);
  velocity.set(0, 0, 99);
  impact(damage);
  flushWamSmashQueue(queue, () => 1000);
  assert.ok(events.length > 0);
  for (const event of events)
    assert.deepEqual(event.startingVelocity.toArray(), [6.9, 0, 0]);
});

const full = [
  "2",
  "110",
  "220",
  "4",
  "abstract",
  "2",
  "DUST.MAT",
  "SPARK.MAT",
  "shards",
  ...speed,
  "2,4",
  "0.3",
  "6",
  "GLASSBITS.MAT",
  "ghostparts",
  ...speed,
  "sphereclumped",
  "0.2",
  "impact",
  "1,3",
  "-1",
  "-1",
  "WHEEL.ACT",
  "noncars",
  ...speed,
  "boxclumped",
  "1,2,3",
  "2,4",
  "50",
  "2",
  "0,3",
  "BITS.ACT",
  "1",
  "BIT.ACT",
  "05BIT.TXT",
  "1",
  "1,2",
  "0,0.5",
  "0,1,0",
  "1,2",
  "2,3",
  "3,4",
  "10,20",
  "0.5,1",
  "randomrotate",
  "2",
  "0.75",
  "FIRE1.PIX",
  "0.5",
  "FIRE2.PIX",
  "OIL.MAT",
  "1,2,3",
  "4,5,0",
  "6,7",
  "8,9",
  "MUD.MAT",
  "1",
  "1,2",
  "relative",
  "7",
  "-1,-2,-3",
  "1,2,3",
  ...speed,
  "1",
  "0,1",
  "OTHER.MAT",
  "absolute",
  "-1,0,-1",
  "1,2,1",
  "away",
  "12",
  "1",
  "99",
  "7",
  "repeated",
  "1.5",
  "2.5",
  "3",
  "4",
  "2",
  "8,9",
  "10,11",
];

test("WAM and world share the complete connotation grammar and preserve following records", () => {
  const parsed = parseWam(
    wam([
      smash("FULL.MAT", [{ threshold: 1, flags: 0, data: full }]),
      smash("FOLLOWING.MAT"),
    ]),
  );
  const level = parsed.parts[0].smashes[0].levels[0];
  const world = parseSmashableEnvironment(
    ["1", "0", "TEST.MAT", "remove", "1", ...full, "0", "0", "0", "0"].join(
      "\n",
    ),
  )[0].connotations;
  assert.deepEqual(level.connotations, world);
  const c = level.connotations;
  assert.deepEqual(c.sounds, [110, 220]);
  assert.deepEqual(
    c.shrapnel.map((s) => s.kind),
    ["abstract", "shards", "ghostparts", "noncars"],
  );
  assert.deepEqual(c.shrapnel[2].amount, [-1]);
  assert.deepEqual(c.shrapnel[2].actors, ["WHEEL.ACT"]);
  assert.deepEqual(c.shrapnel[3].position, {
    kind: "boxclumped",
    size: [1, 2, 3],
  });
  assert.equal(c.shrapnel[3].fire.count, 2);
  assert.equal(c.explosions[0].frames[1].pixelmap, "FIRE2.PIX");
  assert.equal(c.slick.secondMaterial, "MUD.MAT");
  assert.equal(c.activations[0].speed.randomSpinRateMax, 1.25);
  assert.equal(c.sideEffects[0].strength, 12);
  assert.equal(c.extensionArgument, 99);
  assert.equal(c.roomCode, 7);
  assert.equal(c.award.integerSecond, 4);
  assert.deepEqual(c.variableChanges, [
    [8, 9],
    [10, 11],
  ]);
  assert.deepEqual(level.pixelmaps, ["TIER0.PIX"]);
  assert.equal(parsed.parts[0].smashes[1].material, "FOLLOWING.MAT");
});

test("WAM connotations reject excessive counts, truncated records and fractional activation delays", () => {
  assert.throws(
    () =>
      parseWam(
        wam([smash("BAD.MAT", [{ threshold: 1, flags: 0, data: ["101"] }])]),
      ),
    /sounds count/,
  );
  assert.throws(
    () => parseWam(wam().split("\n").slice(0, -8).join("\n")),
    /WAM|Truncated/,
  );
  const fractional = full
    .join("\n")
    .replace("1\n1,2\nrelative", "1\n0.1,2\nrelative");
  assert.throws(
    () =>
      parseWam(
        wam([
          smash("BAD.MAT", [
            { threshold: 1, flags: 0, data: fractional.split("\n") },
          ]),
        ]),
      ),
    /integer activation delay/,
  );
});

test("final-tier effects repeat across crossed tiers with missing textures, then rearm after repair", async () => {
  const { damage, events, group } = await system();
  impact(damage);
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((e) => e.connotations.sounds),
    [[202], [202]],
  );
  assert.deepEqual(
    events.map((e) => [e.oldLevel, e.targetLevel, e.repetition, e.repetitions]),
    [
      [0, 2, 0, 2],
      [0, 2, 1, 2],
    ],
  );
  assert.equal(events[0].bodyActor, group);
  assert.deepEqual(events[0].localPoint.toArray(), [-0.2, 0.1, -0.4]);
  assert.deepEqual(events[0].localDirection.toArray(), [0, 0, 1]);
  assert.notEqual(events[0].localPoint, events[1].localPoint);
  assert.equal(
    events[0].mesh.material.map,
    null,
    "missing maps do not suppress effects",
  );
  impact(damage);
  assert.equal(events.length, 2, "already reached tier is idempotent");
  damage.repair();
  assert.equal(events.length, 2, "repair itself emits no effects");
  impact(damage);
  assert.equal(events.length, 4);
  assert.equal(events[2].oldLevel, 0);
});

test("crossed flag1 tiers suppress repetitions only when advancing by multiple tiers", async () => {
  const multi = await system(
    wam([
      smash("GLASS.MAT", [
        { threshold: 0.00001, flags: 1, sound: 101 },
        { threshold: 0.00002, flags: 0, sound: 202 },
      ]),
    ]),
  );
  impact(multi.damage);
  assert.equal(multi.events.length, 1);
  assert.deepEqual(multi.events[0].connotations.sounds, [202]);
  const single = await system(
    wam([smash("GLASS.MAT", [{ threshold: 0.00001, flags: 1, sound: 101 }])]),
  );
  impact(single.damage);
  assert.equal(single.events.length, 1);
  assert.deepEqual(single.events[0].connotations.sounds, [101]);
});

test("below-threshold impacts produce no WAM effects", async () => {
  const { damage, events } = await system(
    wam([smash("GLASS.MAT", [{ threshold: 999, flags: 0, sound: 101 }])]),
  );
  impact(damage);
  assert.equal(events.length, 0);
});

test("LOD meshes sharing one authored smashable emit one repetition set", async () => {
  const actor = new Group();
  actor.name = "BODY.ACT";
  actor.add(mesh("BODY0.DAT"), mesh("BODY1.DAT"));
  const { damage, events } = await system(wam(undefined, "BODY.ACT"), [actor]);
  assert.equal(damage.runtimeParts[0].actor, actor);
  impact(damage);
  assert.equal(events.length, 2);
  assert.equal(new Set(events.map((e) => e.smash)).size, 1);
  impact(damage);
  assert.equal(events.length, 2);
});

test("the per-impact queue admits 20 authored smashables and leaves overflow eligible", async () => {
  const actor = new Group();
  actor.name = "BODY.ACT";
  const records = Array.from({ length: 21 }, (_, index) => {
    const material = `MAT${index}`;
    actor.add(mesh(`MODEL${index}.DAT`, material));
    return smash(material, [
      { threshold: 0.00001, flags: 0, sound: index + 1 },
    ]);
  });
  const { damage, events } = await system(wam(records, "BODY.ACT"), [actor]);
  impact(damage);
  assert.equal(events.length, 20);
  assert.deepEqual(
    events.map((e) => e.connotations.sounds[0]),
    Array.from({ length: 20 }, (_, i) => i + 1),
  );
  impact(damage);
  assert.equal(events.length, 21);
  assert.deepEqual(events[20].connotations.sounds, [21]);
});

test("installed stock WAMs preserve connotations; Eagle3, Copcar and VLAD3 supply sounds and glass", async (t) => {
  const root = process.env.CARMA2_ROOT ?? "carma2_orig";
  try {
    await access(root);
  } catch {
    t.skip("Local original installation absent");
    return;
  }
  const assets = await createAssetStore(root);
  const paths = assets.manifest.filter(({ path }) =>
    /^data\/cars\/.*\.wam$/i.test(path),
  );
  if (!paths.length) {
    t.skip("Installation has no stock WAMs");
    return;
  }
  const inventory = new Map();
  for (const { path } of paths) {
    const text = (await assets.read(path)).toString("latin1");
    const data = parseWam(text);
    const levels = data.parts.flatMap((p) =>
      p.smashes.flatMap((s) => s.levels),
    );
    const count = {
      levels: levels.length,
      sounds: levels.reduce((n, l) => n + l.connotations.sounds.length, 0),
      shards: levels.reduce(
        (n, l) =>
          n + l.connotations.shrapnel.filter((s) => s.kind === "shards").length,
        0,
      ),
    };
    inventory.set(path.split("/")[2].toLowerCase(), count);
    for (const { connotations: c } of levels) {
      assert.ok(
        c.shrapnel.every((s) => s.kind === "shards"),
        path,
      );
      assert.equal(c.explosions.length, 0, path);
      assert.equal(c.slick, null, path);
      assert.equal(c.activations.length, 0, path);
      assert.equal(c.sideEffects.length, 0, path);
      assert.equal(c.variableChanges.length, 0, path);
      assert.equal(c.roomCode, 0, path);
      assert.equal(c.award.frequency, "none", path);
    }
  }
  for (const [name, expected] of [
    ["eagle3", { levels: 10, sounds: 10, shards: 7 }],
    ["copcar", { levels: 16, sounds: 16, shards: 10 }],
    ["vlad3", { levels: 3, sounds: 3, shards: 3 }],
  ])
    if (inventory.has(name))
      assert.deepEqual(inventory.get(name), expected, name);
  t.diagnostic(
    `Read ${paths.length} external stock WAMs; observed installation contains 52.`,
  );
});
