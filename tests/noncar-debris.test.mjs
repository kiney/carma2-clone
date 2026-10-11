import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { Group, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText, parseAct, parseDat } from "../src/formats.ts";
import { parseNonCarMechanics } from "../src/noncars.ts";
import { createModelGeometry } from "../src/render-geometry.ts";
import { NativeRandom } from "../src/native-random.ts";
import { loadNonCarDebrisAssets } from "../src/noncar-debris-assets.ts";
import {
  NativeNonCarDebrisRuntime,
  prepareNativeNonCarSmokeSampler,
} from "../src/noncar-debris.ts";

const f32 = Math.fround;
const noSpeed = {
  towards: [0, 0],
  impacteeVelocityFactor: 0,
  randomVelocityMax: 0,
  randomUpVelocityMax: 0,
  randomNormalVelocityMax: 0,
  randomSpinRateMax: 0,
};
function mechanics(index = 50) {
  return {
    index,
    version: 101,
    centerOfMass: [0, 0.1, 0],
    attachedCenterOfMass: [0, 0, 0],
    shapes: [
      {
        kind: "box",
        bounds: { min: [-0.1, -0.1, -0.1], max: [0.1, 0.1, 0.1] },
      },
    ],
    extraPoints: [],
    freeMass: 2,
    attachedMass: 17,
    inertiaDimensions: [1, 1, 1],
    inertiaPerMass: [0.1, 0.2, 0.3],
    snapAngleDegrees: 0,
    minimumTorque: 0,
    shrapnelMaterials: ["fixture.MAT"],
    worldFriction: 0,
    objectFriction: 0,
    riseWhenHit: false,
    riseWhenDrivenOn: false,
    drivableOn: false,
    infiniteInertia: false,
    ignoreWorldCollisions: false,
    blockCamera: false,
    sparky: false,
  };
}
function template(index = 50, matrix = new Matrix4(), extraMaterial = false) {
  const actor = new Group();
  actor.name = `&${index}!bbbb.ACT`;
  actor.matrix.copy(matrix);
  actor.matrixAutoUpdate = false;
  const face = (material) => ({
    indices: [0, 1, 2],
    material,
    smoothing: 1,
    flags: 0,
  });
  const model = {
    name: "independent",
    flags: 0,
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    uvs: Float32Array.from([0, 0, 1, 0, 0, 1]),
    faces: extraMaterial ? [face(0), face(1)] : [face(0)],
    materials: [],
  };
  actor.add(new Mesh(createModelGeometry(model), new MeshBasicMaterial()));
  return {
    originalName: `original${index}`,
    nativeIdentifier: actor.name,
    actor,
    mechanics: mechanics(index),
  };
}
function spec(overrides = {}) {
  return {
    kind: "noncars",
    position: { kind: "actorbased" },
    speed: { ...noSpeed },
    amount: [-1],
    fire: { chance: 0 },
    ...overrides,
  };
}
function assetSet(templates) {
  return {
    specIndex: 0,
    actorFile: "independent.act",
    templates,
    diagnostics: [],
  };
}
const context = () => ({
  frame: new Matrix4(),
  point: new Vector3(10, 0, 0),
  impacteeVelocity: new Vector3(),
});
function harness({ original = 10, initial = original, occupied = [] } = {}) {
  const scene = new Group(),
    events = [],
    columns = [],
    diagnostics = [],
    slots = new Set(occupied);
  let count = initial;
  const key = (slot) =>
    slot.kind === "dedicated" ? `d${slot.mechanicsIndex}` : `e${slot.index}`;
  const host = {
    originalActorCount: original,
    readActorCount: () => count,
    addActor(actor) {
      scene.add(actor);
      count++;
      events.push(["add", actor.name]);
    },
    removeActor(actor) {
      actor.removeFromParent();
      count--;
      events.push(["remove", actor.name]);
    },
    isBodySlotOccupied: (slot) => slots.has(key(slot)),
    registerBody(body, slot) {
      assert.equal(body.attached, false);
      assert.equal(body.joint, undefined);
      assert.equal(body.properties.mass, body.mechanics.freeMass);
      assert.equal(body.properties.immovable, false);
      assert.equal(body.motor.sleeping, false);
      assert.deepEqual(body.state.velocity.toArray(), [0, 0, 0]);
      slots.add(key(slot));
      events.push(["register", key(slot)]);
    },
    addSmokeColumn: (column) => columns.push(column),
    diagnose: (message) => diagnostics.push(message),
  };
  return {
    host,
    scene,
    events,
    columns,
    diagnostics,
    slots,
    get count() {
      return count;
    },
  };
}
function monitored(seed = 19) {
  const native = new NativeRandom(seed),
    events = [];
  return {
    random() {
      const value = native.nextInteger();
      events.push(["draw", value]);
      return value / 32768;
    },
    seed(value) {
      events.push(["seed", value]);
      native.seed(value);
    },
    events,
    get state() {
      return native.state;
    },
  };
}

test("ordered clones borrow resources, preserve ACT placement and initialize before launch", () => {
  const h = harness({ original: 10003 }),
    source = template(50, new Matrix4().makeTranslation(2, 3, 4)),
    c = context();
  c.frame.makeRotationY(Math.PI / 2).setPosition(10, 20, 30);
  c.impacteeVelocity.set(6.9, 13.8, -20.7);
  const [launch] = new NativeNonCarDebrisRuntime(h.host, monitored()).spawn(
    spec({ speed: { ...noSpeed, impacteeVelocityFactor: 1 } }),
    assetSet([source]),
    c,
  );
  assert.equal(launch.actor.name, "&50!10003.ACT");
  assert.equal(
    launch.actor.children[0].geometry,
    source.actor.children[0].geometry,
  );
  assert.equal(
    launch.actor.children[0].material,
    source.actor.children[0].material,
  );
  assert.deepEqual(
    launch.actor.matrix.elements,
    c.frame.clone().multiply(source.actor.matrix).elements.map(f32),
  );
  assert.deepEqual(source.actor.matrix.elements.slice(12, 15), [2, 3, 4]);
  assert.deepEqual(
    launch.body.state.velocity.toArray(),
    [6.9, 13.8, -20.7].map((v) => f32(f32(v) / 6.9)),
  );
  assert.equal(launch.body.motor.sleeping, false);
  assert.deepEqual(launch.slot, { kind: "dedicated", mechanicsIndex: 50 });
  assert.equal(launch.actor.matrixAutoUpdate, true);
  // Same position/quaternion writes as Simulation.syncActor must update visuals.
  launch.body.state.position.x += 2;
  launch.actor.position.copy(launch.body.state.position);
  launch.actor.quaternion.copy(launch.body.state.orientation);
  launch.actor.updateMatrixWorld(true);
  assert.equal(
    launch.actor.matrixWorld.elements[12],
    launch.body.state.position.x,
  );
});

test("native body omega is stored before its world-angular-velocity bridge", () => {
  const h = harness(),
    c = context();
  c.frame.makeRotationZ(Math.PI / 2);
  const [launch] = new NativeNonCarDebrisRuntime(h.host, {
    random: () => 0.75,
    seed() {},
  }).spawn(
    spec({ speed: { ...noSpeed, randomSpinRateMax: 20 } }),
    assetSet([template()]),
    c,
  );
  const omega = f32(f32(1 / Math.sqrt(3)) * 6.283185307179586);
  assert.deepEqual(launch.nativeOmega.toArray(), [omega, omega, omega]);
  assert.deepEqual(
    launch.body.state.angularVelocity.toArray(),
    launch.nativeOmega
      .clone()
      .applyQuaternion(launch.body.state.orientation)
      .toArray()
      .map(f32),
  );
  assert.ok(launch.body.state.angularVelocity.x < 0);
});

test("attempt rand precedes ACT saturation; failed pull decrements count and aborts branch", () => {
  const full = harness({ initial: 260 }),
    rng = monitored();
  assert.deepEqual(
    new NativeNonCarDebrisRuntime(full.host, rng).spawn(
      spec(),
      assetSet([template(), template(51)]),
      context(),
    ),
    [],
  );
  assert.equal(rng.events.length, 1);
  assert.equal(full.scene.children.length, 0);
  for (const pull of [
    () => null,
    () => {
      throw new Error("unavailable physics shape");
    },
  ]) {
    const failed = harness(),
      failedRng = monitored();
    failed.host.pull = pull;
    assert.deepEqual(
      new NativeNonCarDebrisRuntime(failed.host, failedRng).spawn(
        spec(),
        assetSet([template(), template(51)]),
        context(),
      ),
      [],
    );
    assert.equal(failed.count, 10);
    assert.equal(failed.scene.children.length, 0);
    assert.equal(failedRng.events.length, 1);
    assert.deepEqual(
      failed.events.map((event) => event[0]),
      ["add", "remove"],
    );
  }
});

test("dedicated occupancy selects first-free from one shared forty-extra pool", () => {
  const h = harness({
      occupied: [
        "d50",
        "d51",
        ...Array.from({ length: 39 }, (_, i) => `e${i}`),
      ],
    }),
    rng = monitored();
  const launches = new NativeNonCarDebrisRuntime(h.host, rng).spawn(
    spec(),
    assetSet([template(50), template(51)]),
    context(),
  );
  assert.equal(launches.length, 1);
  assert.deepEqual(launches[0].slot, { kind: "extra", index: 39 });
  assert.equal(h.count, 11);
  assert.equal(h.scene.children.length, 1);
  assert.equal(rng.events.filter((event) => event[0] === "draw").length, 16);
  assert.deepEqual(
    h.events.map((event) => event[0]),
    ["add", "register", "add", "remove"],
  );
});

test("positive count/template draws include upper endpoint; negative amount preserves template order", () => {
  const rng = {
      count: 0,
      random() {
        this.count++;
        return 32767 / 32768;
      },
      seed() {},
    },
    h = harness();
  const launches = new NativeNonCarDebrisRuntime(h.host, rng).spawn(
    spec({ amount: [1, 2] }),
    assetSet([template(50), template(51)]),
    context(),
  );
  assert.deepEqual(
    launches.map((launch) => launch.actor.name.slice(0, 4)),
    ["&51!", "&51!"],
  );
  assert.equal(rng.count, 1 + 2 * (1 + 1 + 1 + 13));
  const ordered = harness();
  assert.deepEqual(
    new NativeNonCarDebrisRuntime(ordered.host, monitored())
      .spawn(
        spec({ amount: [-1, 0] }),
        assetSet([template(50), template(51)]),
        context(),
      )
      .map((launch) => launch.actor.name.slice(0, 4)),
    ["&50!", "&51!"],
  );
});

test("fire reseeds attempt, consumes chance100, draws vertex then colour and restores saved rand output", () => {
  const h = harness(),
    rng = monitored(123);
  h.host.addSmokeColumn = (column) => {
    h.columns.push(column);
    rng.random();
  };
  const [launch] = new NativeNonCarDebrisRuntime(h.host, rng).spawn(
    spec({ fire: { chance: 100, count: 2, smokiness: [2, 5] } }),
    assetSet([template(50, new Matrix4(), true)]),
    context(),
  );
  const next = (state) => (Math.imul(state, 214013) + 2531011) >>> 0,
    sample = (state) => (state >>> 16) & 32767;
  const firstState = next(123),
    savedState = next(firstState);
  assert.equal(launch.attemptSeed, sample(firstState));
  assert.equal(launch.savedMovementRand, sample(savedState));
  assert.deepEqual(
    rng.events.filter((event) => event[0] === "seed"),
    [
      ["seed", sample(firstState)],
      ["seed", sample(savedState)],
    ],
  );
  assert.equal(
    rng.state,
    sample(savedState),
    "srand(randOutput), not previous CRT state",
  );
  let fireState = next(sample(firstState));
  for (const column of h.columns) {
    fireState = next(fireState);
    assert.equal(column.vertex, Math.floor((sample(fireState) * 4) / 32768));
    fireState = next(fireState);
    assert.equal(
      column.colour,
      2 + Math.floor((sample(fireState) * 4) / 32768),
    );
    fireState = next(fireState);
    assert.equal(column.mode, 2);
    assert.equal(column.lifetimeMs, 10_000_000);
    assert.equal(column.rigid.velocity, launch.body.state.velocity);
  }
  assert.equal(
    rng.events.filter((event) => event[0] === "draw").length,
    15 + 1 + 2 * 3,
  );
});

test("chance0 consumes none; rejected chance and chance100 with no columns each consume one", () => {
  for (const [fire, count] of [
    [{ chance: 0 }, 15],
    [{ chance: 1, count: 3, smokiness: [0, 0] }, 16],
    [{ chance: 100, count: 0 }, 16],
  ]) {
    const h = harness(),
      rng = {
        count: 0,
        random() {
          this.count++;
          return 32767 / 32768;
        },
        seed() {},
      };
    new NativeNonCarDebrisRuntime(h.host, rng).spawn(
      spec({ fire }),
      assetSet([template()]),
      context(),
    );
    assert.equal(rng.count, count);
    assert.equal(h.columns.length, 0);
  }
});

test("mode2 uses live model vertices/full ACT; inclusive endpoint may reach next group and final overrun diagnoses", () => {
  const t = template(
      50,
      new Matrix4().makeRotationY(Math.PI / 2).setPosition(3, 4, 5),
      true,
    ),
    diagnostics = [];
  const sampler = prepareNativeNonCarSmokeSampler(t.actor, {}, (message) =>
      diagnostics.push(message),
    ),
    point = new Vector3();
  assert.equal(sampler.firstGroupCount, 3);
  assert.equal(sampler.count, 6);
  assert.equal(sampler.sampleVertex(3, point), true);
  t.actor.children[0].geometry
    .getAttribute("position")
    .setXYZ(sampler.corners[3], 2, 3, 4);
  assert.equal(sampler.sampleWorldVertex(3, point), true);
  const expected = new Vector3(2, 3, 4)
    .applyMatrix4(t.actor.matrix)
    .toArray()
    .map(f32);
  expected[1] = f32(expected[1] - f32(0.03));
  assert.deepEqual(point.toArray(), expected);
  assert.equal(sampler.sampleVertex(6, point), false);
  assert.match(diagnostics.at(-1), /allocation 6/);
  const single = prepareNativeNonCarSmokeSampler(
    template().actor,
    {},
    (message) => diagnostics.push(message),
  );
  assert.equal(single.sampleVertex(single.firstGroupCount, point), false);
});

test("all five original ACT/mechanics fixtures launch free bodies and mode2 columns", async (t) => {
  const root = new URL("../carma2_orig", import.meta.url).pathname;
  try {
    await access(`${root}/data.twt`);
  } catch (error) {
    if (error.code === "ENOENT") return t.skip("Original installation absent");
    throw error;
  }
  const assets = await createAssetStore(root);
  const cases = [
    ["Carrier1", "&50gun01_DEBRIS1", "50gun01_DEBRIS1.txt", 21.239775, 8],
    ["Carrier1", "&51gun01_DEBRIS2", "51gun01_DEBRIS2.txt", 8.295681, 8],
    ["Carrier1", "&52TGUN_DEBRIS1", "52TGUN_DEBRIS1.txt", 7.638896, 8],
    ["Carrier1", "&53TGUN_DEBRIS2", "53TGUN_DEBRIS2.txt", 15.882541, 8],
    ["newcity1", "&petpump", "99petpump.txt", 0.166343, 12],
  ];
  for (const [race, basename, filename, mass, vertices] of cases) {
    const directory = `data/RACES/${race}`,
      nodes = parseAct(await assets.read(`${directory}/${basename}.act`)),
      models = parseDat(await assets.read(`${directory}/${basename}.dat`));
    const rootActor = new Group(),
      wrapper = new Group(),
      node = nodes[0],
      m = node.transform;
    rootActor.name = node.name;
    rootActor.matrix.set(
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
    rootActor.matrixAutoUpdate = false;
    const model = models.find(
      (model) => model.name.toLowerCase() === node.model.toLowerCase(),
    );
    assert.ok(model);
    rootActor.add(
      new Mesh(createModelGeometry(model), new MeshBasicMaterial()),
    );
    wrapper.add(rootActor);
    const authored = spec({
      actorFile: `${basename}.act`,
      nonCars: [{ actor: node.name, mechanics: filename }],
      fire: { chance: 100, count: 1, smokiness: [1, 1] },
      speed: { ...noSpeed, impacteeVelocityFactor: 1 },
    });
    const loaded = await loadNonCarDebrisAssets(
      [authored],
      async () => wrapper,
      async () =>
        parseNonCarMechanics(
          decodeText(await assets.read(`data/NONCARS/${filename}`)),
          filename,
        ),
    );
    const h = harness(),
      c = context();
    c.impacteeVelocity.set(6.9, 0, 0);
    const [launch] = new NativeNonCarDebrisRuntime(h.host, monitored()).spawn(
      authored,
      loaded.get(0),
      c,
    );
    assert.ok(Math.abs(launch.body.properties.mass - mass) < 1e-5);
    assert.equal(launch.body.hulls[0].vertices.length, vertices);
    assert.equal(
      launch.body.mechanics.shrapnelMaterials[0].toLowerCase(),
      "m14.mat",
    );
    assert.deepEqual(launch.body.state.velocity.toArray(), [
      f32(f32(6.9) / 6.9),
      0,
      0,
    ]);
    assert.equal(launch.body.joint, undefined);
    assert.equal(launch.actor.matrixAutoUpdate, true);
    launch.body.state.position.z += 1;
    launch.actor.position.copy(launch.body.state.position);
    launch.actor.updateMatrixWorld(true);
    assert.equal(
      launch.actor.matrixWorld.elements[14],
      launch.body.state.position.z,
    );
    assert.equal(h.columns.length, 1);
    assert.equal(h.columns[0].mode, 2);
    assert.equal(h.columns[0].lifetimeMs, 10_000_000);
    if (!model.faces.some((face) => face.material === 0))
      assert.ok(
        h.diagnostics.some((message) => message.includes("material-pointer")),
      );
  }
});
