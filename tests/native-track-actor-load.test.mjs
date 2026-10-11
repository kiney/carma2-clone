import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { parseAct, parseDat } from "../src/formats.ts";
import {
  allocateNativeOrderedActor,
  createNativeActorOrder,
  knownNativeActorValue as known,
  prependNativeActor,
  removeNativeActor,
} from "../src/native-actor-order.ts";
import {
  NativeTrackActorLoadError,
  normalizeNativeTrackNonCarMatrix,
  rewriteNativeSmashableActorName,
  nativeTrackNonCarId,
  setNativeTrackSmashableModel,
  findNativeTrackNonCars,
  findNativeTrackNonCarChildren,
  compactNativeTrackNonCars,
} from "../src/native-track-actor-load.ts";
const F = Math.fround;
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 20, 30];
const resource = {
  identifier: "local MODEL",
  vertices: [1, 2, 3],
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
};
function actors() {
  const state = { roots: [], actors: [] };
  const make = (name, model = resource, matrix = I) =>
    allocateNativeOrderedActor(state, {
      name,
      type: 1,
      renderStyle: 4,
      matrix,
      localModel: known(model),
      localMaterial: known(null),
      bounds: known(null),
      provenance: "source-free numeric test",
    });
  return { state, make };
}
function context(count = 2, overrides = {}) {
  const events = [],
    typeData = new Map();
  const ctx = {
    count,
    trackCount: count,
    capacity: count + 250,
    rawSlots: Array(count + 250).fill(null),
    specs: [],
    race: null,
    netGameType: null,
    pixelBits: 16,
    providers: {
      readModelIdentifier: (model) => model.identifier ?? null,
      clearTypeData: (actor) => {
        events.push(["clear", actor.name]);
        typeData.set(actor, null);
      },
      smoothificatePowerups: (actor) => events.push(["smooth", actor.name]),
      setSpinningPowerup: (actor, opacity) =>
        events.push(["spin", actor.name, opacity]),
      setChangingPowerup: (actor) => events.push(["change", actor.name]),
      addSmashableRaceTarget: (model, actor, index) =>
        events.push(["target", model, actor.name, index]),
    },
    ...overrides,
  };
  return { ctx, events, typeData };
}
const spec = (model = resource, targetCode = 0) => ({
  model,
  triggerType: 1,
  targetCode,
});

test("installed safe numeric captures: scale boundaries, independent shift/normalization and signed ID abort", () => {
  const scales = [
    1,
    0.5,
    2,
    F(Math.sqrt(0.999)),
    F(Math.sqrt(1.001)),
    F(1.0005),
    0,
    F(1.44),
  ];
  // Captured from installed 40d1f0, with generated numeric matrices, not asset data.
  const expectedX = [10, 2010, 10, 2010, 10, 10, 2010, 10];
  const expectedAxis = [
    1,
    0.5,
    1,
    F(Math.sqrt(0.999)),
    F(Math.sqrt(1.001)),
    1,
    0,
    1,
  ];
  for (let i = 0; i < scales.length; i++) {
    const { make } = actors(),
      { ctx, typeData } = context();
    const m = [...I];
    m[0] = scales[i];
    const actor = make("&00c0001.ACT", resource, m);
    assert.equal(findNativeTrackNonCars(actor, ctx), 0);
    assert.deepEqual(actor.matrix, [
      expectedAxis[i],
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      expectedX[i],
      20,
      30,
    ]);
    assert.equal(ctx.rawSlots[1], actor);
    assert.equal(typeData.get(actor), null);
    assert.equal(actor.localModel.value, resource);
  }
  const mixed = [...I];
  mixed[0] = 0.5;
  mixed[4] = 2;
  assert.deepEqual(normalizeNativeTrackNonCarMatrix(mixed).matrix, [
    ...I.slice(0, 9),
    2010,
    20,
    30,
  ]);
  const { make } = actors(),
    { ctx, events } = context();
  const invalid = make(
    "&00c9999.ACT",
    resource,
    I.map((v, i) => (i < 9 ? v * 2 : v)),
  );
  const before = [...invalid.matrix];
  assert.equal(findNativeTrackNonCars(invalid, ctx), 1);
  assert.deepEqual(invalid.matrix, before);
  assert.deepEqual(events, []);
  assert.ok(ctx.rawSlots.every((slot) => slot === null));
});

test("first undersize row compares unrounded double while rows1/2 compare Float32 stores", () => {
  const x = F(0.9994998574256897),
    y = F(0.00014000000373926014);
  assert.equal(x * x + y * y, 0.9989999845939751);
  assert.equal(F(x * x + y * y), 0.9990000128746033);
  for (const axis of [0, 1]) {
    const m = [...I];
    m[axis * 3] = axis === 0 ? x : y;
    m[axis * 3 + 1] = axis === 0 ? y : x;
    const result = normalizeNativeTrackNonCarMatrix(m);
    assert.equal(result.shifted, axis === 0);
    assert.equal(result.normalized, false);
    assert.equal(result.matrix[9], axis === 0 ? 2010 : 10);
  }
  // Source normalization preserves shear, not an orthogonalized orientation.
  const m = [2, 1, 0, 0, 2, 0, 0, 0, 1, 10, 20, 30];
  const out = normalizeNativeTrackNonCarMatrix(m).matrix;
  assert.equal(out[0], F(2 * F(1 / Math.sqrt(5))));
  assert.equal(out[1], F(1 / Math.sqrt(5)));
  assert.notEqual(out[0] * out[3] + out[1] * out[4] + out[2] * out[5], 0);
});

test("smash name uses zero-based ASCII index, overwritten short prefixes and last matching MODEL identity", () => {
  assert.equal(rewriteNativeSmashableActorName("&CORE.ACT", 0), "&CORE|00.ACT");
  assert.equal(rewriteNativeSmashableActorName("ABCD", 7), "     |07ABCD");
  assert.equal(
    rewriteNativeSmashableActorName("ABCDElong.ACT", 100),
    "ABCDE|100.ACT",
  );
  const { make } = actors(),
    { ctx } = context();
  const actor = make("ABCDElong.ACT");
  ctx.specs = [
    spec(),
    { ...spec({ identifier: resource.identifier }), triggerType: 1 },
    spec(),
  ];
  setNativeTrackSmashableModel(actor, ctx);
  assert.equal(actor.name, "ABCDE|02.ACT");
  assert.equal(actor.localModel.value, resource);
  assert.deepEqual(resource.vertices, [1, 2, 3]);
  const ignored = make("ABCDElong.ACT", { identifier: null });
  ctx.providers.readModelIdentifier = (model) => model.identifier;
  setNativeTrackSmashableModel(ignored, ctx);
  assert.equal(ignored.name, "ABCDElong.ACT");
});

test("race target outlet follows each matching rename, exact WORD/race/net eligibility", () => {
  for (const [race, netGameType, targetCode, expected] of [
    [{ type: 4, targetCode: 3 }, null, 3, true],
    [{ type: 3, targetCode: 3 }, null, 3, false],
    [{ type: 4, targetCode: 3 }, null, 2, false],
    [null, 2, 1, true],
    [null, 1, 1, false],
    [null, 2, 2, false],
  ]) {
    const { make } = actors(),
      { ctx, events } = context(2, {
        race,
        netGameType,
        specs: [spec(resource, targetCode), spec(resource, targetCode)],
      });
    const actor = make("ABCDElong.ACT");
    setNativeTrackSmashableModel(actor, ctx);
    assert.equal(events.length, expected ? 2 : 0);
    if (expected)
      assert.deepEqual(
        events.map((e) => [e[2], e[3]]),
        [
          ["ABCDE|00.ACT", -1],
          ["ABCDE|01.ACT", -1],
        ],
      );
  }
});

test("name rewrite happens before numeric ID parse; signed bytes are not digit validated", () => {
  assert.equal(nativeTrackNonCarId("&00c0001.ACT"), 1);
  assert.equal(nativeTrackNonCarId("&00c000:.ACT"), 10);
  assert.equal(nativeTrackNonCarId("&00c000\xff.ACT"), -49);
  const { make } = actors(),
    { ctx, events } = context(2, { specs: [spec()] });
  const actor = make("&00c0001.ACT");
  assert.equal(findNativeTrackNonCars(actor, ctx), 1);
  assert.equal(actor.name, "&00c0|00.ACT");
  assert.deepEqual(events, []); // Renaming corrupted raw ID; no registration fallback to authored ID.
});

test("native traversal stops all enclosing siblings on invalid ID; valid noncar skips descendants", () => {
  const { make } = actors(),
    { ctx, events } = context();
  const root = make("root", null),
    nested = make("nested", null);
  const untouched = make("&00c0001.ACT"),
    bad = make("&00c9999.ACT");
  prependNativeActor(root, untouched);
  prependNativeActor(root, nested);
  prependNativeActor(nested, bad);
  assert.equal(findNativeTrackNonCarChildren(root, ctx), 1);
  assert.ok(ctx.rawSlots.every((slot) => slot === null));
  const good = make("&00c0000.ACT"),
    child = make("&00c9999.ACT");
  prependNativeActor(good, child);
  assert.equal(findNativeTrackNonCars(good, ctx), 0);
  assert.equal(ctx.rawSlots[0], good);
  assert.equal(events.length, 1);
  assert.equal(child.name, "&00c9999.ACT");
});

test("enumerator retains saved next sibling across actual callback topology mutation", () => {
  const { make } = actors(),
    { ctx, events } = context();
  const root = make("root", null),
    next = make("&00c0001.ACT"),
    first = make("&00c0000.ACT");
  prependNativeActor(root, next);
  prependNativeActor(root, first);
  ctx.providers.clearTypeData = (actor) => {
    events.push(actor);
    if (actor === first) removeNativeActor(next);
  };
  assert.equal(findNativeTrackNonCarChildren(root, ctx), 0);
  assert.deepEqual(events, [first, next]);
  assert.equal(next.parent, null);
});

test("powerup host order/ranges/pixelBits and missing providers are explicit", () => {
  for (const [id, expected] of [
    [65, ["smooth"]],
    [66, ["smooth", "spin"]],
    [85, ["smooth", "spin"]],
    [86, ["smooth", "change"]],
    [87, ["smooth", "change"]],
    [88, ["smooth"]],
  ]) {
    const { make } = actors(),
      { ctx, events } = context();
    const actor = make(`Q£${id}.ACT`);
    assert.equal(findNativeTrackNonCars(actor, ctx), 0);
    assert.deepEqual(
      events.map((e) => e[0]),
      expected,
    );
    if (expected.includes("spin")) assert.equal(events[1][2], 0);
  }
  const { make } = actors(),
    { ctx, events } = context(2, { pixelBits: 8 });
  const actor = make("Q£66.ACT");
  findNativeTrackNonCars(actor, ctx);
  assert.deepEqual(
    events.map((e) => e[0]),
    ["spin"],
  );
  delete ctx.providers.setSpinningPowerup;
  assert.throws(
    () => findNativeTrackNonCars(actor, ctx),
    (e) => e.code === "provider-required",
  );
  const { ctx: absent } = context();
  delete absent.providers.clearTypeData;
  const good = make("&00c0000.ACT");
  const before = good.matrix;
  assert.throws(
    () => findNativeTrackNonCars(good, absent),
    (e) => e.code === "provider-required",
  );
  assert.equal(good.matrix, before);
  assert.equal(absent.rawSlots[0], null);
});

test("compaction scans raw IDs increasing, truncates names and retains allocation/trailing slots", () => {
  const { make } = actors(),
    { ctx } = context(5);
  const first = make("&00c0001.ACT"),
    last = make("&00c0004.ACT");
  ctx.rawSlots[1] = first;
  ctx.rawSlots[4] = last;
  const allocation = ctx.rawSlots,
    tail = make("retained-extra");
  ctx.rawSlots[7] = tail;
  const result = compactNativeTrackNonCars(ctx);
  assert.deepEqual(result, { removedNulls: 3, actors: [first, last] });
  assert.equal(first.name, "&00c0000");
  assert.equal(last.name, "&00c0001");
  assert.equal(ctx.count, 2);
  assert.equal(ctx.trackCount, 2);
  assert.equal(ctx.capacity, 252);
  assert.equal(ctx.rawSlots, allocation);
  assert.equal(ctx.rawSlots.length, 255);
  assert.equal(ctx.rawSlots[0], first);
  assert.equal(ctx.rawSlots[1], last);
  assert.equal(ctx.rawSlots[4], last);
  assert.equal(ctx.rawSlots[7], tail);
  // Raw duplicate IDs overwrite, rather than allocating a second body/template.
  const a = make("&00c0000.ACT"),
    b = make("&00c0000.ACT");
  findNativeTrackNonCars(a, ctx);
  findNativeTrackNonCars(b, ctx);
  assert.equal(ctx.rawSlots[0], b);
});

test("source fatal/unknown MODEL paths and unsafe matrices fail without invented inheritance or clamp", () => {
  const { make } = actors(),
    { ctx } = context();
  const parent = make("parent"),
    child = make("&00c0000.ACT", null);
  prependNativeActor(parent, child);
  assert.throws(
    () => findNativeTrackNonCars(child, ctx),
    (e) => e instanceof NativeTrackActorLoadError && e.code === "native-fatal",
  );
  const missing = make("ordinary");
  missing.localModel = {
    resolved: false,
    requiredProvider: "load actual MODEL",
  };
  assert.throws(
    () => findNativeTrackNonCars(missing, ctx),
    /load actual MODEL/,
  );
  assert.throws(
    () => rewriteNativeSmashableActorName("abc", 0),
    (e) => e.code === "native-fatal",
  );
  assert.throws(
    () => rewriteNativeSmashableActorName("A".repeat(64), 0),
    (e) => e.code === "unsafe-native-output",
  );
  assert.throws(() => nativeTrackNonCarId("&0"), /eight readable/);
  const m = [...I];
  m[0] = 0;
  m[4] = 2;
  assert.throws(
    () => normalizeNativeTrackNonCarMatrix(m),
    (e) => e.code === "unsafe-native-output",
  );
  m[0] = 0.1;
  assert.throws(
    () => normalizeNativeTrackNonCarMatrix(m),
    (e) => e.code === "invalid-input",
  );
  ctx.rawSlots = Array(ctx.capacity);
  assert.throws(() => compactNativeTrackNonCars(ctx), /explicit NULL/);
});

for (const directory of ["data", "adv_data"])
  test(`original ${directory} canopy ACTs normalize locally while actual MODEL resource/bounds remain unchanged`, async (t) => {
    const root = process.env.CARMA2_ROOT ?? "carma2_orig";
    try {
      await access(root);
    } catch {
      t.skip("original installation absent");
      return;
    }
    const store = await createAssetStore(root),
      path = `${directory}/RACES/newcity1/newcity1`;
    if (
      !store.manifest.some(
        (e) => e.path.toLowerCase() === (path + ".act").toLowerCase(),
      )
    ) {
      t.skip("original New City absent");
      return;
    }
    const raw = parseAct(await store.read(path + ".act")),
      models = parseDat(await store.read(path + ".dat"));
    const byName = new Map(
      models.map((model) => [model.name.toLowerCase(), model]),
    );
    const order = createNativeActorOrder(raw, {
      model: (name) => {
        const model = byName.get(name.toLowerCase());
        return model
          ? known(model)
          : { resolved: false, requiredProvider: `actual MODEL ${name}` };
      },
    });
    const selected = ["&07c0533.ACT", "&07c0069.ACT"].map((name) =>
      order.actors.find((actor) => actor.name === name),
    );
    assert.ok(selected.every(Boolean));
    const { ctx } = context(1126);
    ctx.providers.readModelIdentifier = (model) => model.name;
    for (const [i, actor] of selected.entries()) {
      assert.equal(actor.localModel.resolved, true);
      const model = actor.localModel.value;
      const originalPositions = model.positions.slice(),
        originalFaces = structuredClone(model.faces),
        originalFlags = model.flags;
      const originalMatrix = [...actor.matrix],
        originalBounds = actor.bounds;
      const squared = [0, 1, 2].map((row) => {
        const [x, y, z] = originalMatrix.slice(row * 3, row * 3 + 3);
        return F(x * x + y * y + z * z);
      });
      assert.deepEqual(
        squared,
        Array(3).fill(i === 0 ? 2.0736005306243896 : 1.440000057220459),
      );
      const expected = originalMatrix.map((value, index) =>
        index < 9
          ? F(value * F(1 / Math.sqrt(squared[Math.floor(index / 3)])))
          : value,
      );
      assert.equal(findNativeTrackNonCars(actor, ctx), 0);
      assert.deepEqual(actor.matrix, expected);
      assert.deepEqual(actor.matrix.slice(9), originalMatrix.slice(9));
      assert.equal(ctx.rawSlots[i === 0 ? 533 : 69], actor);
      assert.equal(actor.localModel.value, model);
      assert.equal(actor.bounds, originalBounds);
      assert.deepEqual(model.positions, originalPositions);
      assert.deepEqual(model.faces, originalFaces);
      assert.equal(model.flags, originalFlags);
    }
    const { actors: compacted } = compactNativeTrackNonCars(ctx);
    assert.deepEqual(compacted, [selected[1], selected[0]]);
    assert.equal(compacted[0].name, "&07c0000");
    assert.equal(compacted[1].name, "&07c0001");
  });
