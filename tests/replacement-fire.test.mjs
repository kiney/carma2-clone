import assert from "node:assert/strict";
import test from "node:test";
import { Group, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { createNativeReplacementColumns } from "../src/replacement-fire.ts";
import { NativeResourceArena } from "../src/native-resource-arena.ts";
import { createModelGeometry } from "../src/render-geometry.ts";
import { prepareNativeNonCarSmokeSampler } from "../src/noncar-debris.ts";
import { SmokeSystem } from "../src/smoke.ts";
import { Assets } from "../src/content.ts";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parseTrackSmashables } from "../src/world-smash.ts";

const f32 = Math.fround;
function collect(samples, overrides = {}) {
  const events = [],
    packets = [];
  let draws = 0;
  const actor = new Group();
  const source = {
    firstGroupCount: 3,
    sampleVertex: () => true,
  };
  createNativeReplacementColumns({
    modelChanged: true,
    fire: { chance: 100, parameters: [2, 1, 4] },
    actor,
    random: () => {
      assert.ok(draws < samples.length, "all CRT draws accounted for");
      events.push("draw");
      return samples[draws++];
    },
    readPreparedSource: () => {
      events.push("prepare");
      return source;
    },
    spawn: (packet) => {
      events.push("spawn");
      packets.push(packet);
    },
    ...overrides,
  });
  return { events, packets, draws, actor };
}

test("replacement fire uses chance then inclusive vertex/colour per column, without reseeding", () => {
  const result = collect([32767 / 32768, 32767 / 32768, 0, 0.5, 32767 / 32768]);
  assert.equal(result.draws, 5, "chance100 still consumes its CRT sample");
  assert.deepEqual(result.events, [
    "draw",
    "prepare",
    "draw",
    "draw",
    "spawn",
    "prepare",
    "draw",
    "draw",
    "spawn",
  ]);
  assert.deepEqual(
    result.packets.map(
      ({ mode, vertex, colour, lifetimeMs, actor, car, rigid }) => ({
        mode,
        vertex,
        colour,
        lifetimeMs,
        actor,
        car,
        rigid,
      }),
    ),
    [
      {
        mode: 0,
        vertex: 3,
        colour: 1,
        lifetimeMs: 10_000_000,
        actor: result.actor,
        car: undefined,
        rigid: undefined,
      },
      {
        mode: 0,
        vertex: 2,
        colour: 4,
        lifetimeMs: 10_000_000,
        actor: result.actor,
        car: undefined,
        rigid: undefined,
      },
    ],
  );
});

test("unchanged model and zero chance draw nothing; rejected chance and nonpositive count never request geometry", () => {
  assert.equal(collect([], { modelChanged: false }).draws, 0);
  assert.equal(collect([], { fire: { chance: 0 } }).draws, 0);
  assert.deepEqual(collect([0.5], { fire: { chance: 50 } }).events, ["draw"]);
  for (const count of [0, -1])
    assert.deepEqual(
      collect([0], { fire: { chance: 100, parameters: [count, 0, 0] } }).events,
      ["draw"],
    );
  assert.equal(collect([0], { fire: { chance: -1 } }).packets.length, 0);
  assert.throws(() => collect([1]), /random sample/);
  assert.throws(() => collect([NaN]), /random sample/);
  assert.throws(() => collect([0], { fire: { chance: 100 } }), /parameters/);
});

function model(offset = 0, slots = [1, 2]) {
  return {
    name: "independent replacement",
    flags: 0,
    positions: Float32Array.from([
      offset + 10,
      0,
      0,
      offset + 11,
      0,
      0,
      offset + 10,
      1,
      0,
      offset + 20,
      0,
      0,
      offset + 21,
      0,
      0,
      offset + 20,
      1,
      0,
    ]),
    uvs: new Float32Array(12),
    materials: ["first", "second"],
    faces: slots.map((material, index) => ({
      indices: index === 0 ? [0, 1, 2] : [3, 4, 5],
      material,
      smoothing: 1,
      flags: 0,
    })),
  };
}

function preparedFixture(initialModel = model()) {
  const arena = new NativeResourceArena();
  const first = {},
    second = {};
  const low = arena.allocateMaterial(second),
    high = arena.allocateMaterial(first);
  const options = {
    materialPointers: new Map([
      [1, high.address],
      [2, low.address],
    ]),
  };
  const actor = new Mesh(
    createModelGeometry(initialModel),
    new MeshBasicMaterial(),
  );
  let geometry, sampler;
  const diagnostics = [];
  const readPreparedSource = () => {
    if (geometry !== actor.geometry) {
      geometry = actor.geometry;
      sampler = prepareNativeNonCarSmokeSampler(actor, options, (text) =>
        diagnostics.push(text),
      );
    }
    return sampler;
  };
  return { actor, readPreparedSource, diagnostics };
}

test("mode0 follows live prepared MODEL and full affine ACT; inclusive endpoint reaches the next contiguous group", () => {
  const fixture = preparedFixture();
  const { actor, readPreparedSource, diagnostics } = fixture;
  const parent = new Group();
  parent.position.set(3, 4, 5);
  parent.add(actor);
  actor.matrixAutoUpdate = false;
  actor.matrix.set(2, 0.5, 0, 7, 0, 3, 0.25, 8, 0, 0, -1, 9, 0, 0, 0, 1);
  const samples = [0, 32767 / 32768, 0],
    packets = [];
  createNativeReplacementColumns({
    modelChanged: true,
    fire: { chance: 100, parameters: [1, 2, 2] },
    actor,
    readPreparedSource,
    random: () => samples.shift(),
    spawn: (packet) => packets.push(packet),
  });
  const [packet] = packets;
  assert.equal(packet.vertex, 3);
  const local = new Vector3();
  assert.equal(packet.sampleVertex(3, local), true);
  assert.equal(
    local.x,
    10,
    "lowest live pointer group contains the other triangle",
  );
  const smoke = new SmokeSystem(undefined, { random: () => 0.5 });
  smoke.spawnColumn(packet);
  smoke.expireCarColumns({ velocity: new Vector3() });
  smoke.updateColumns(40, 40);
  const expected = local
    .clone()
    .applyMatrix4(actor.matrixWorld)
    .toArray()
    .map(f32);
  expected[1] = f32(expected[1] - f32(0.03));
  assert.deepEqual(smoke.snapshot().columns[0].position.toArray(), expected);
  assert.equal(smoke.snapshot().columns[0].remaining, 10_000_000 - 40);
  actor.geometry = createModelGeometry(model(100));
  actor.matrix.premultiply(new Matrix4().makeTranslation(1, 2, 3));
  smoke.updateColumns(80, 40);
  packet.sampleVertex(3, local);
  const moved = local
    .clone()
    .applyMatrix4(actor.matrixWorld)
    .toArray()
    .map(f32);
  moved[1] = f32(moved[1] - f32(0.03));
  assert.deepEqual(smoke.snapshot().columns[0].position.toArray(), moved);
  assert.deepEqual(diagnostics, []);
  // Removing the following group makes the same inclusive endpoint unsafe.
  actor.geometry = createModelGeometry(model(200, [1]));
  smoke.updateColumns(120, 40);
  assert.equal(smoke.snapshot().columns[0].active, false);
  assert.match(diagnostics.join(), /index 3, allocation 3/);
  assert.match(smoke.diagnostics.join(), /mode 0, vertex 3/);
  smoke.dispose();
});

test("mode0 uses the ordinary expiry boundary and ownerless upward emission", () => {
  const fixture = preparedFixture(model(0, [1]));
  const smoke = new SmokeSystem(undefined, { random: () => 0.5 });
  createNativeReplacementColumns({
    modelChanged: true,
    fire: { chance: 100, parameters: [1, 2, 2] },
    actor: fixture.actor,
    readPreparedSource: fixture.readPreparedSource,
    random: () => 0,
    spawn: (packet) => smoke.spawnColumn({ ...packet, lifetimeMs: 240 }),
  });
  for (let frame = 1; frame <= 6; frame++) smoke.updateColumns(40 * frame, 40);
  const final = smoke.snapshot();
  assert.equal(final.columns[0].active, true);
  assert.equal(
    final.columns[0].remaining,
    0,
    "lifetime equality still performs the update",
  );
  assert.equal(final.puffs[0].active, true);
  assert.deepEqual(final.puffs[0].velocity.toArray(), [
    0,
    f32(f32(2.8985507) * f32(1 / 6.9) + 1 / 6.9),
    0,
  ]);
  smoke.updateColumns(280, 40);
  assert.equal(smoke.snapshot().columns[0].active, false);
  smoke.dispose();
});

test("Stock and Advanced Carrier and City replacement fire use actual retained MODEL/MAT resources", async (t) => {
  let store;
  try {
    store = await createAssetStore(process.env.CARMA2_ROOT || "carma2_orig");
  } catch (error) {
    if (/ENOENT|Original installation/.test(String(error)))
      return t.skip("Original installation unavailable");
    throw error;
  }
  const assets = new Assets();
  assets.manifest = store.manifest;
  assets.lookup = new Map(
    store.manifest.map(({ path }) => [path.toLowerCase(), path]),
  );
  assets.bytes = (path) => store.read(path);
  let checked = 0;
  for (const root of ["data", "adv_data"])
    for (const race of ["Carrier1", "newcity1"]) {
      const directory = `${root}/RACES/${race}`;
      const path = assets.resolve(`${directory}/${race}.txt`);
      const specs = parseTrackSmashables(
        decodeText(await store.read(path)),
        path,
      );
      const scene = await assets.scene(directory, race);
      for (const spec of specs.filter(
        (entry) => entry.replacement?.fire.chance,
      )) {
        const replacement = scene.findSourceModel(spec.replacement.model);
        assert.ok(replacement, spec.replacement.model);
        const geometry = scene.sourceModelGeometries.get(replacement);
        assert.ok(geometry, spec.replacement.model);
        const actor = new Mesh(geometry.clone(), new MeshBasicMaterial());
        const diagnostics = [];
        const prepared = prepareNativeNonCarSmokeSampler(
          actor,
          assets.getNativeModelPreparedOptions(actor.geometry),
          (text) => diagnostics.push(text),
        );
        const packets = [];
        createNativeReplacementColumns({
          modelChanged: true,
          fire: spec.replacement.fire,
          actor,
          readPreparedSource: () => prepared,
          random: () => 0,
          spawn: (packet) => packets.push(packet),
        });
        assert.equal(packets.length, spec.replacement.fire.parameters[0]);
        assert.ok(packets.length > 0);
        assert.deepEqual(diagnostics, []);
        assert.equal(prepared.remainingMaterialOrder, "known-order");
        assert.ok(
          packets.every(
            (packet) =>
              packet.mode === 0 &&
              packet.sampleVertex(packet.vertex, new Vector3()),
          ),
        );
        actor.geometry.dispose();
        actor.material.dispose();
        checked++;
      }
      scene.dispose();
    }
  assert.equal(checked, 6);
});
