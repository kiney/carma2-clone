import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Texture,
  Vector3,
} from "three";
import { NativeRandom, sharedNativeRandom } from "../src/native-random.ts";
import {
  emitNativePedGiblets,
  nativePedSphereClumpedPlacement,
} from "../src/ped-giblet-source.ts";
import { PedBloodRuntime, parsePedBloodSettings } from "../src/ped-blood.ts";
import { ShardRuntime } from "../src/smash-shards.ts";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";

const f = Math.fround,
  I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const speed = {
  towards: [0, 0],
  impacteeVelocityFactor: 1,
  randomVelocityMax: 0,
  randomUpVelocityMax: 0,
  randomNormalVelocityMax: 0,
  randomSpinRateMax: 0,
};
const spec = {
  position: { kind: "sphereclumped", radius: 0.2, center: "impact" },
  speed,
  lifetimeMs: [50, 100],
};
const model = {
  name: "safe",
  scale: 2,
  nativeScale: 2,
  color: 0xff0000,
  indexedColor: 4,
};
const size = { minForce: 0, instanceForce: 1, maxCount: 1, models: [model] };
const input = (extra = {}) => ({
  kind: "impact",
  seed: 24,
  point: [1, 2, 3],
  velocity: [6.9, 0, 0],
  direction: [0, 0, 0],
  spec,
  sizes: [size],
  force: 0.01,
  startSize: 0,
  ...extra,
});
function tracked(seed = 17) {
  const rng = new NativeRandom(seed),
    log = [];
  return {
    rng,
    log,
    crt: {
      nextInteger() {
        const value = rng.nextInteger();
        log.push(["rand", value]);
        return value;
      },
      seed(value) {
        log.push(["seed", value]);
        rng.seed(value);
      },
    },
  };
}
function geometry() {
  const result = new BufferGeometry();
  result.setAttribute(
    "position",
    new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3),
  );
  return result;
}
function settings(extra = {}) {
  return {
    radius: 0.2,
    velocityFactor: 1,
    randomVelocity: 0,
    randomUp: 0,
    spin: 0,
    lifetimeMs: [50, 100],
    spurtingPeriodMs: 100,
    sizes: [size],
    clouds: [[], [], []],
    slick: {
      pixelmap: "safe",
      delayMs: 0,
      growth: [0, 0],
      initialSize: 0,
      fullSize: [0, 0],
      friction: [0, 0],
      smearDistance: null,
      smearMaterial: null,
    },
    impact: { ...spec, scrapeStart: 0 },
    spurt: {
      ...spec,
      lumpsPerEmission: 2,
      model: { ...model, scale: 3, nativeScale: 3, color: 0x00ff00 },
    },
    ...extra,
  };
}
function runtime(
  extra = {},
  models = new Map([["safe", geometry()]]),
  textures = new Map(),
) {
  const config = settings(extra),
    scene = new Group(),
    blood = new PedBloodRuntime(
      config,
      () => null,
      () => {
        throw new Error("native emission used legacy RNG");
      },
      textures,
      models,
    ),
    shards = new ShardRuntime(scene, new Map());
  return {
    config,
    scene,
    blood,
    shards,
    dispose() {
      blood.dispose();
      shards.dispose();
    },
  };
}
function packet(extra = {}) {
  return {
    kind: "impact",
    point: [1000, 1000, 1000],
    pedestrianPosition: [0, 0, 0],
    velocity: [6.9, 0, 0],
    force: 0.01,
    startSize: 0,
    timeMs: 1000,
    seed: 24,
    goreLevel: 2,
    bodyPose: I,
    localBounds: { min: [-1, -1, -1], max: [1, 1, 1] },
    localCentreOfMass: [0, 0, 0],
    ...extra,
  };
}
function marker(shards, priority, owner) {
  return shards.spawnFragment(priority, () => ({
    mesh: new Mesh(geometry(), new MeshBasicMaterial()),
    velocity: new Vector3(),
    spin: new Vector3(),
    timeMs: 1000,
    visibleMs: 500,
    maximumMs: 1000,
    groupId: shards.createFragmentGroup(),
    owner,
    ownsGeometry: true,
  }));
}

test("source sphere placement consumes six basis then four offset draws and preserves its fallback", () => {
  const draws = [0.25, 0.5, 0.5, 0.5, 0.75, 0.5, 0.75, 0.5, 0.5, 0.25];
  let used = 0;
  const placed = nativePedSphereClumpedPlacement(
    [1, 2, 3],
    0.2,
    () => draws[used++],
  );
  assert.equal(used, 10);
  assert.deepEqual(placed.matrix.elements, [
    0,
    0,
    -1,
    0,
    -1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    f(1.05),
    2,
    3,
    1,
  ]);
  assert.equal(placed.sizeFactor, 0.25);
  const fallback = [...Array(6).fill(0.5), 0.75, 0.5, 0.5, 0.25];
  used = 0;
  const result = nativePedSphereClumpedPlacement(
    [0, 0, 0],
    0.2,
    () => fallback[used++],
  );
  assert.deepEqual(
    result.matrix.elements.slice(0, 12),
    new Matrix4().elements.slice(0, 12),
  );
  assert.equal(used, 10);
});

test("impact selects before actual admission and restores a captured output even for empty/failing factories", () => {
  const trace = tracked(),
    events = [];
  const result = emitNativePedGiblets(
    input({
      sizes: [
        { ...size, maxCount: 3 },
        { ...size, maxCount: 3 },
      ],
      force: 3,
    }),
    {
      crt: trace.crt,
      model(i, j) {
        events.push(["model", i, j]);
        return model;
      },
      reserve(priority) {
        events.push(["reserve", priority]);
        return false;
      },
    },
  );
  assert.deepEqual(events, [
    ["model", 0, 0],
    ["reserve", 2],
    ["model", 1, 0],
    ["reserve", 2],
  ]);
  assert.deepEqual(result, { created: 0, poolFull: 2, randomDraws: 3 });
  assert.equal(trace.rng.state, trace.log[0][1]);
  assert.deepEqual(
    trace.log.filter(([kind]) => kind === "seed"),
    [
      ["seed", 24],
      ["seed", trace.log[0][1]],
    ],
  );
  const empty = tracked();
  assert.equal(
    emitNativePedGiblets(input({ startSize: 999 }), {
      crt: empty.crt,
      model() {
        throw new Error("no model lookup");
      },
      reserve() {
        throw new Error("no reservation");
      },
    }).randomDraws,
    1,
  );
  assert.equal(empty.rng.state, empty.log[0][1]);
  const full = tracked();
  assert.deepEqual(
    emitNativePedGiblets(input({ kind: "spurt", lumpsPerEmission: 5 }), {
      crt: full.crt,
      model() {
        throw new Error("no model read before admitted spurt");
      },
      reserve(priority) {
        assert.equal(priority, 1);
        return false;
      },
    }),
    { created: 0, poolFull: 1, randomDraws: 1 },
  );
});

test("admitted source movement uses all thirteen draws and metric velocity exactly once", () => {
  const queue = [
    999,
    0,
    8192,
    16384,
    16384,
    16384,
    24576,
    16384,
    24576,
    16384,
    16384,
    16384,
    ...Array(13).fill(0),
    0,
  ];
  let used = 0;
  const seeds = [],
    pieces = [];
  const result = emitNativePedGiblets(input(), {
    crt: {
      nextInteger() {
        assert.ok(used < queue.length);
        return queue[used++];
      },
      seed(value) {
        seeds.push(value);
      },
    },
    model() {
      return model;
    },
    reserve(priority, produce) {
      assert.equal(priority, 2);
      pieces.push(produce());
      return true;
    },
  });
  assert.equal(result.created, 1);
  assert.equal(result.randomDraws, 26);
  assert.equal(used, 26);
  assert.deepEqual(seeds, [24, 999]);
  assert.deepEqual(pieces[0].velocity.toArray(), [f(f(6.9) * 0.5), 0, 0]);
  assert.equal(pieces[0].visibleMs, 50);
  assert.equal(pieces[0].maximumMs, 100);
  assert.equal(pieces[0].matrix.elements[12], f(1.1));
});

test("native chunks share the real pool, prepare aliased MODEL vertices in reader order, and clear only their owner", () => {
  const h = runtime(),
    trace = tracked();
  try {
    assert.equal(h.blood.nativeHit(packet(), h.shards, trace.crt).created, 1);
    const first = h.scene.children.find(
      (mesh) => mesh.name === "native-ped-impact-giblet",
    );
    assert.equal(first.geometry.getAttribute("position").getX(0), 6);
    assert.equal(
      first.material.color.getHex(),
      0x00ff00,
      "later aliased spurt model wins material colour",
    );
    assert.equal(
      h.blood.nativeSpurt(
        {
          kind: "spurt",
          point: [0, 0, 0],
          direction: [0, 1, 0],
          velocity: [0, 0, 0],
          timeMs: 1000,
          seed: 9,
          goreLevel: 2,
        },
        h.shards,
        trace.crt,
      ).created,
      2,
    );
    assert.equal(h.blood.stats.giblets, 3);
    assert.equal(h.blood.giblets.length, 0);
    const sprites = h.scene.children.filter((mesh) =>
      mesh.name.startsWith("native-ped-"),
    );
    assert.ok(sprites.every((mesh) => mesh.geometry === first.geometry));
    assert.deepEqual(
      h.shards.snapshot().fragments.map((fragment) => fragment.priority),
      [2, 1, 1],
    );
    assert.deepEqual(h.blood.nativeStats, {
      created: 3,
      impacts: 1,
      spurts: 1,
      poolFull: 0,
      active: 3,
    });
    const foreign = {};
    marker(h.shards, 3, foreign);
    h.blood.reset();
    assert.equal(h.shards.countOwner(foreign), 1);
    assert.equal(h.shards.stats.active, 1);
    assert.equal(h.blood.nativeStats.created, 0);
    h.blood.nativeHit(packet(), h.shards, trace.crt);
    assert.equal(
      h.scene.children
        .find((mesh) => mesh.name === "native-ped-impact-giblet")
        .geometry.getAttribute("position")
        .getX(0),
      6,
      "reset never scales source MODEL twice again",
    );
  } finally {
    h.dispose();
  }
});

test("shared priority2 impact preempts priority1 spurt but cannot displace priority2 or WAM priority3", () => {
  const h = runtime(),
    trace = tracked(),
    foreign = {};
  try {
    for (let i = 0; i < 199; i++)
      assert.equal(marker(h.shards, 2, foreign), true);
    assert.equal(marker(h.shards, 1, foreign), true);
    assert.equal(h.blood.nativeHit(packet(), h.shards, trace.crt).created, 1);
    assert.equal(h.shards.stats.active, 200);
    assert.equal(h.shards.countOwner(foreign), 199);
    const before = trace.log.length;
    const blocked = h.blood.nativeHit(packet(), h.shards, trace.crt);
    assert.equal(blocked.created, 0);
    assert.equal(blocked.poolFull, 1);
    assert.equal(
      trace.log.slice(before).filter(([kind]) => kind === "rand").length,
      2,
      "only capture and model draw occur when full",
    );
    h.shards.clear();
    for (let i = 0; i < 200; i++) marker(h.shards, 3, foreign);
    assert.equal(
      h.blood.nativeSpurt(
        {
          kind: "spurt",
          point: [0, 0, 0],
          direction: [0, 1, 0],
          velocity: [0, 0, 0],
          timeMs: 1000,
          seed: 9,
          goreLevel: 2,
        },
        h.shards,
        trace.crt,
      ).created,
      0,
    );
    assert.equal(h.shards.countOwner(foreign), 200);
  } finally {
    h.dispose();
  }
});

test("packet fragments share authored maximum expiry while retaining individual source visible times", () => {
  const h = runtime({ sizes: [{ ...size, maxCount: 3 }], spurt: undefined }),
    trace = tracked();
  try {
    h.blood.nativeHit(packet({ force: 3, startSize: 0 }), h.shards, trace.crt);
    const rows = h.shards.snapshot().fragments;
    assert.equal(rows.length, 3);
    assert.equal(new Set(rows.map((row) => row.groupId)).size, 1);
    assert.ok(
      rows.every(
        (row) =>
          row.endMs === 1100 &&
          row.visibleUntilMs >= 1050 &&
          row.visibleUntilMs <= 1100,
      ),
    );
    h.shards.update(1000);
    h.shards.update(1060);
    assert.equal(h.shards.stats.active, 3);
    h.shards.update(1100);
    assert.equal(h.shards.stats.active, 0);
    assert.equal(h.blood.stats.giblets, 0);
  } finally {
    h.dispose();
  }
});

test("native cloud uses local bounds plus actual local COM in a live root ACT frame before factory seeding", () => {
  const cloud = {
    amount: [1, 1],
    delaySeconds: [0, 0],
    offset: [0, 0, 0],
    xFactor: [1, 1],
    yFactor: [0, 0],
    zFactor: [0, 0],
    frameRate: [10, 10],
    scale: [1, 1],
    rotation: "randomrotate",
    frames: [{ opacity: 100, pixelmap: "cloud" }],
  };
  const h = runtime(
      { clouds: [[cloud], [], []] },
      new Map([["safe", geometry()]]),
      new Map([["cloud", new Texture()]]),
    ),
    trace = tracked();
  const pose = [0, 1, 0, -1, 0, 0, 0, 0, 1, 10, 20, 30];
  try {
    const result = h.blood.nativeHit(
      packet({
        force: 0.1,
        startSize: 999,
        bodyPose: pose,
        readBodyPose: () => pose,
        localBounds: { min: [-1, -2, -3], max: [2, 3, 4] },
        localCentreOfMass: [1, 2, 3],
      }),
      h.shards,
      trace.crt,
    );
    assert.equal(result.clouds, 1);
    assert.equal(result.created, 0);
    const firstSeed = trace.log.findIndex(([kind]) => kind === "seed");
    assert.equal(
      firstSeed,
      12,
      "eleven complete cloud draws precede the captured rand and seed",
    );
    const sprite = h.blood.group.children.find(
      (node) => node.name === "source-explosion",
    );
    assert.equal(sprite.position.x, 8);
    assert.ok([19, 23].includes(sprite.position.y));
    assert.equal(sprite.position.z, 33);
    pose[9] = 11;
    h.blood.update(0.01, 1010);
    assert.equal(sprite.position.x, 9);
  } finally {
    h.dispose();
  }
});

test("missing geometry, cloud bounds and malformed vectors diagnose before shared RNG or pool changes", () => {
  const h = runtime({}, new Map()),
    trace = tracked();
  try {
    assert.deepEqual(
      h.blood.nativeHit(packet({ point: [1, 2] }), h.shards, trace.crt)
        .requiredProviders,
      ["source-native-ped-blood-point-velocity-seed-clock"],
    );
    assert.equal(trace.log.length, 0);
    const before = trace.rng.state;
    const result = h.blood.nativeHit(packet(), h.shards, trace.crt);
    assert.deepEqual(result.requiredProviders, [
      "source-ped-giblet-MODEL:safe",
    ]);
    assert.equal(trace.rng.state, before);
    assert.equal(h.shards.stats.active, 0);
    assert.equal(
      h.blood.nativeHit(packet({ goreLevel: 0 }), h.shards, trace.crt).status,
      "complete",
    );
    assert.equal(trace.rng.state, before);
  } finally {
    h.dispose();
  }
  const valid = runtime(),
    second = tracked();
  try {
    assert.ok(
      valid.blood
        .nativeHit(
          packet({ force: 0.1, localBounds: null }),
          valid.shards,
          second.crt,
        )
        .requiredProviders.includes("source-native-ped-blood-local-bounds-COM"),
    );
    assert.equal(second.log.length, 0);
  } finally {
    valid.dispose();
  }
});

test("native requirements share emission preflight without source geometry, cloud, pool, RNG or counter writes", () => {
  const h = runtime(),
    beforeRng = sharedNativeRandom.state,
    beforePool = h.shards.snapshot(),
    beforeStats = h.blood.nativeStats,
    source = Array.from(
      h.blood.geometries.get("safe").getAttribute("position").array,
    );
  try {
    assert.deepEqual(h.blood.nativeRequirements(packet(), h.shards), []);
    assert.deepEqual(
      h.blood.nativeRequirements(packet({ point: [1, 2] }), h.shards),
      ["source-native-ped-blood-point-velocity-seed-clock"],
    );
    assert.deepEqual(h.blood.nativeRequirements(packet(), undefined), [
      "source-shared-200-fragment-runtime-owner",
    ]);
    assert.equal(sharedNativeRandom.state, beforeRng);
    assert.deepEqual(h.shards.snapshot(), beforePool);
    assert.deepEqual(h.blood.nativeStats, beforeStats);
    assert.deepEqual(
      Array.from(h.blood.geometries.get("safe").getAttribute("position").array),
      source,
    );
    assert.equal(h.blood.stats.clouds, 0);
  } finally {
    h.dispose();
  }
});

test("invalid MODEL preparation diagnoses repeatedly without retaining partial resources", () => {
  const h = runtime({}, new Map([["safe", new BufferGeometry()]])),
    trace = tracked();
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.deepEqual(
        h.blood.nativeHit(packet(), h.shards, trace.crt).requiredProviders,
        ["source-native-ped-giblet-MODEL-positions"],
      );
      assert.equal(h.blood.nativeResources.size, 0);
      assert.equal(h.shards.stats.active, 0);
      assert.equal(trace.log.length, 0);
    }
  } finally {
    h.dispose();
  }
});

let originals = true;
try {
  await access(new URL("../carma2_orig", import.meta.url));
} catch {
  originals = false;
}
test(
  "Stock and Advanced retain full spurt SETTINGS and actual aliased MODEL component scaling",
  { skip: !originals },
  async () => {
    const store = await createAssetStore(
        new URL("../carma2_orig", import.meta.url).pathname,
      ),
      assets = new Assets();
    assets.manifest = store.manifest;
    assets.lookup = new Map(
      store.manifest.map((entry) => [entry.path.toLowerCase(), entry.path]),
    );
    const reads = [];
    assets.bytes = (path) => {
      reads.push(path);
      return store.read(path);
    };
    for (const tree of ["data", "adv_data"]) {
      const parsed = parsePedBloodSettings(
        await assets.text(`${tree}/PEDS/settings.txt`),
      );
      assert.equal(parsed.impact.scrapeStart, 0);
      assert.equal(parsed.impact.speed.randomNormalVelocityMax, 0);
      assert.equal(parsed.spurt.lumpsPerEmission, 5);
      assert.equal(parsed.spurt.position.radius, 0.015);
      assert.equal(parsed.spurt.speed.randomNormalVelocityMax, 3);
      assert.deepEqual(parsed.spurt.lifetimeMs, [250, 1000]);
      const blood = await PedBloodRuntime.create(
          assets,
          parsed,
          () => null,
          () => 0.25,
          undefined,
          tree,
        ),
        scene = new Group(),
        shards = new ShardRuntime(scene, new Map()),
        trace = tracked();
      try {
        assert.ok(
          reads.some((path) =>
            path.toLowerCase().startsWith(`${tree}/peds/giblets/`),
          ),
        );
        if (tree === "adv_data")
          assert.ok(
            reads
              .filter((path) => /\/giblets\//i.test(path))
              .every((path) => path.toLowerCase().startsWith("adv_data/")),
          );
        const base = blood.geometries.get("chunk05").getAttribute("position"),
          raw = Array.from(base.array);
        assert.equal(
          blood.nativeHit(
            packet({ startSize: 4, force: 0.001 }),
            shards,
            trace.crt,
          ).status,
          "complete",
        );
        const rendered = scene.children
          .find((node) => node.name === "native-ped-impact-giblet")
          .geometry.getAttribute("position").array;
        const first = parsed.sizes[4].models[0].nativeScale,
          second = parsed.spurt.model.nativeScale;
        assert.deepEqual(
          Array.from(rendered),
          raw.map((value) => f(f(value * first) * second)),
        );
      } finally {
        blood.dispose();
        shards.dispose();
        reads.length = 0;
      }
    }
  },
);
