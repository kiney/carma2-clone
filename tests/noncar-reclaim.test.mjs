import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { Box3, Matrix4, Vector3 } from "three";
import { createAssetStore } from "../server/assets.mjs";
import { parseDat } from "../src/formats.ts";
import {
  NativeNonCarReclaimRuntime,
  nativeNonCarId,
  nativeNonCarModelBounds,
  nativeNonCarReclaimBounds,
} from "../src/physics/noncar-reclaim.ts";

const f = Math.fround;
const box = (min = [-1, -1, -1], max = [1, 1, 1]) =>
  new Box3(new Vector3(...min), new Vector3(...max));
const object = (owner, overrides = {}) => ({
  owner,
  driver: 4,
  doNothing: true,
  actorMatrix: new Matrix4(),
  authoredModelBounds: box(),
  committedMatrix: new Matrix4(),
  flags: 0,
  carId: 3,
  ...overrides,
});
const collider = (owner, overrides = {}) => ({
  owner,
  doNothing: false,
  cachedBounds: box(),
  cachedInverse: new Matrix4(),
  ...overrides,
});
const frame = (activeNonCars, activeObjects = [], extra = {}) => ({
  activeNonCars,
  activeObjects,
  minimumWorldY: -100,
  viewedOwner: null,
  ...extra,
});
const kinds = (result) => result.effects.map((effect) => effect.kind);

test("lazy reclaim providers are read only on due active passes and excess time is discarded", () => {
  const runtime = new NativeNonCarReclaimRuntime();
  let reads = 0;
  const provider = () => {
    reads++;
    return frame([object("awake", { doNothing: false })]);
  };
  assert.equal(runtime.advanceFrame(5000, provider, undefined, 0).ran, false);
  assert.equal(runtime.accumulatorMs, 0);
  assert.equal(runtime.advanceFrame(999, provider, undefined, 1).ran, false);
  assert.equal(reads, 0);
  assert.equal(runtime.advanceFrame(1, provider, undefined, 1).ran, true);
  assert.equal(reads, 1);
  assert.equal(runtime.accumulatorMs, 0);
  assert.equal(runtime.advanceFrame(2500, provider, undefined, 1).ran, true);
  assert.equal(reads, 2, "a long frame invokes one pass");
  assert.equal(runtime.accumulatorMs, 0);
  assert.equal(runtime.advanceFrame(999, provider, undefined, 1).ran, false);
  assert.equal(reads, 2);
  assert.equal(runtime.advanceFrame(1, provider, undefined, 1).ran, true);
  assert.equal(reads, 3);
  assert.throws(() => runtime.advanceFrame(0, provider), /active count/);
  assert.equal(reads, 3, "missing count must not eagerly invoke the provider");
});

test("lazy blocked-removal passes consume the clock despite missing providers", () => {
  const runtime = new NativeNonCarReclaimRuntime();
  let reads = 0,
    allowRemoval = false;
  const provider = () => {
    reads++;
    return frame([object("quiet")], [], { activeNonCarCount: 2, allowRemoval });
  };
  runtime.advanceFrame(600, provider, undefined, 2);
  assert.equal(reads, 0);
  const blocked = runtime.advanceFrame(400, provider, undefined, 2);
  assert.equal(blocked.ran, true);
  assert.equal(blocked.accumulatorMs, 0);
  assert.equal(blocked.reclaimed.length, 0);
  assert.equal(reads, 1);
  assert.equal(runtime.advanceFrame(999, provider, undefined, 2).ran, false);
  assert.equal(reads, 1);
  allowRemoval = true;
  const accepted = runtime.advanceFrame(1, provider, undefined, 2);
  assert.equal(reads, 2);
  assert.deepEqual(
    accepted.reclaimed.map((item) => item.owner),
    ["quiet"],
  );
});

test("outer-frame accumulator pauses without active noncars, runs once and discards excess", () => {
  const runtime = new NativeNonCarReclaimRuntime(700),
    awake = object("awake", { doNothing: false });
  assert.equal(runtime.advanceFrame(1000, frame([])).accumulatorMs, 700);
  assert.equal(runtime.advanceFrame(299, frame([awake])).ran, false);
  const result = runtime.advanceFrame(1, frame([awake]));
  assert.equal(result.ran, true);
  assert.equal(result.accumulatorMs, 0);
  assert.deepEqual(
    result.survivors.map((item) => item.owner),
    ["awake"],
  );
  assert.equal(runtime.advanceFrame(2700, frame([awake])).accumulatorMs, 0);
  assert.equal(runtime.advanceFrame(999, frame([awake])).ran, false);
  const wrapped = new NativeNonCarReclaimRuntime(0xfffffff0);
  assert.equal(wrapped.advanceFrame(32, frame([awake])).accumulatorMs, 16);
  assert.equal(wrapped.advanceFrame(984, frame([awake])).ran, true);
});

test("increasing survivor compaction emits native release order while ACT count/resources remain host-owned", () => {
  const inputs = [
      object("first"),
      object("driver2", { driver: 2 }),
      object("additional", { carId: 0xffff }),
      object("awake", { doNothing: false }),
      object("last"),
    ],
    runtime = new NativeNonCarReclaimRuntime(),
    events = [],
    originalCount = 312;
  const result = runtime.advanceFrame(1000, frame(inputs), (effect) => {
    events.push([effect.owner, effect.kind]);
    assert.equal(originalCount, 312);
  });
  assert.deepEqual(
    result.survivors.map((item) => item.owner),
    ["driver2", "awake"],
  );
  assert.deepEqual(
    result.reclaimed.map((item) => item.owner),
    ["first", "additional", "last"],
  );
  const release = [
    "remove-actor",
    "clear-splashes",
    "set-driver",
    "return-actor",
    "clear-actor-binding",
    "remove-physics",
  ];
  assert.deepEqual(
    events,
    ["first", "additional", "last"].flatMap((owner) =>
      release.map((kind) => [owner, kind]),
    ),
  );
  assert.deepEqual(
    result.effects
      .filter((effect) => effect.kind === "return-actor")
      .map((effect) => effect.destination),
    ["track-column", "additional-actors", "track-column"],
  );
  assert.deepEqual(
    inputs.map((item) => item.driver),
    [4, 2, 4, 4, 4],
    "pure input snapshots are not mutated",
  );
});

test("source ec and driver4 eligibility excludes awake, detached and split pieces", () => {
  const result = new NativeNonCarReclaimRuntime().advanceFrame(
    1000,
    frame([
      object("awake", { doNothing: false }),
      object("detached", { driver: 2 }),
      object("split", { driver: 3 }),
      object("sleeping"),
    ]),
  );
  assert.deepEqual(
    result.reclaimed.map((item) => item.owner),
    ["sleeping"],
  );
  assert.deepEqual(
    result.survivors.map((item) => item.owner),
    ["awake", "detached", "split"],
  );
});

test("minimum-world-Y gate is strict and forces ec before ordinary release", () => {
  for (const [y, expected] of [
    [-10, false],
    [-10.000001, true],
  ]) {
    const result = new NativeNonCarReclaimRuntime().advanceFrame(
      1000,
      frame(
        [
          object("body", {
            doNothing: false,
            actorMatrix: new Matrix4().makeTranslation(0, y, 0),
          }),
        ],
        [],
        { minimumWorldY: 0 },
      ),
    );
    assert.equal(result.reclaimed.length !== 0, expected);
    if (expected) assert.equal(kinds(result)[0], "set-do-nothing");
  }
});

test("Y exponent failure repairs NaN and both infinities in native order, with corrected return pose", () => {
  for (const y of [NaN, Infinity, -Infinity]) {
    const actor = new Matrix4().makeScale(2, 3, 4).setPosition(7, y, 9),
      result = new NativeNonCarReclaimRuntime().advanceFrame(
        1000,
        frame([object("body", { doNothing: false, actorMatrix: actor })]),
      );
    const prefix = y === -Infinity ? ["set-do-nothing"] : [];
    assert.deepEqual(kinds(result).slice(0, prefix.length + 3), [
      ...prefix,
      "zero-body-omega",
      "set-actor-matrix",
      "set-do-nothing",
    ]);
    assert.deepEqual(
      result.reclaimed[0].actorMatrix.elements,
      new Matrix4().makeTranslation(2000, 0, 0).elements,
    );
    assert.deepEqual(
      result.effects
        .find((effect) => effect.kind === "return-actor")
        .position.toArray(),
      [2000, 0, 0],
    );
    assert.ok(
      Number.isNaN(actor.elements[13]) || !Number.isFinite(actor.elements[13]),
      "caller ACT remains unchanged",
    );
  }
});

test("touching authored MODEL bounds blocks reclaim against retained cache, independent of cache epoch", () => {
  const sleeping = object("sleeping", {
    actorMatrix: new Matrix4().makeTranslation(2, 0, 0),
  });
  const evaluate = (other) =>
    new NativeNonCarReclaimRuntime().advanceFrame(
      1000,
      frame([sleeping], [other]),
    );
  assert.equal(
    evaluate(
      collider("other", {
        reference: -999,
        currentPhysicalBounds: box([100, 100, 100], [101, 101, 101]),
      }),
    ).reclaimed.length,
    0,
  );
  assert.equal(
    evaluate(
      collider("other", {
        cachedBounds: box([-1, -1, -1], [f(1 - 2 ** -23), 1, 1]),
      }),
    ).reclaimed.length,
    1,
  );
  assert.equal(
    evaluate(collider("other", { doNothing: true })).reclaimed.length,
    1,
  );
  assert.equal(evaluate(collider("sleeping")).reclaimed.length, 1);
});

test("earlier Y-forced ec changes later combined-list eligibility during the same pass", () => {
  const first = object("first", {
      actorMatrix: new Matrix4().makeTranslation(0, -11, 0),
      doNothing: false,
    }),
    last = object("last"),
    activeObjects = [
      collider("first", { cachedBounds: box([-10, -10, -10], [10, 10, 10]) }),
    ];
  const result = new NativeNonCarReclaimRuntime().advanceFrame(
    1000,
    frame([first, last], activeObjects, { minimumWorldY: 0 }),
  );
  assert.deepEqual(
    result.reclaimed.map((item) => item.owner),
    ["first", "last"],
  );
  assert.deepEqual(kinds(result).slice(0, 2), [
    "set-do-nothing",
    "remove-actor",
  ]);
});

test("transformed bounds reverse native matrix products and retain shear and reflection", () => {
  const model = box([-1, -2, -3], [4, 5, 6]),
    actor = new Matrix4().set(
      0,
      -1,
      2,
      10,
      1,
      0,
      0,
      20,
      0,
      0,
      -1,
      30,
      0,
      0,
      0,
      1,
    ),
    inverse = new Matrix4().set(
      1,
      0,
      0,
      -40,
      0,
      0,
      -1,
      -50,
      0,
      1,
      0,
      -60,
      0,
      0,
      0,
      1,
    ),
    expected = new Box3();
  for (const x of [-1, 4])
    for (const y of [-2, 5])
      for (const z of [-3, 6]) {
        // Independently apply actor then cached inverse in explicit scalar form.
        const ax = -y + 2 * z + 10,
          ay = x + 20,
          az = -z + 30;
        expected.expandByPoint(new Vector3(ax - 40, -az - 50, ay - 60));
      }
  const result = nativeNonCarReclaimBounds(model, actor, inverse);
  assert.deepEqual(result.min.toArray(), expected.min.toArray());
  assert.deepEqual(result.max.toArray(), expected.max.toArray());
});

test("installed bounds helper rounds each axis addition rather than rec2's combined contribution sum", () => {
  const actor = new Matrix4().set(
      3,
      3,
      3,
      100000000,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
    ),
    result = nativeNonCarReclaimBounds(
      box([0, 0, 0], [1, 1, 1]),
      actor,
      new Matrix4(),
    );
  assert.equal(result.max.x, 100000000);
  assert.equal(
    f(100000000 + 3 + 3 + 3),
    100000008,
    "one final store produces a different bound",
  );
});

test("translation reference threshold uses installed Float32 square and rechecks drop", () => {
  for (const [offset, reclaimed] of [
    [f(0.005), true],
    [f(f(0.005) + 2 ** -30), false],
  ]) {
    const result = new NativeNonCarReclaimRuntime().advanceFrame(
      1000,
      frame([
        object("lift", {
          flags: 0x10000,
          jointReference: new Vector3(offset, 0, 0),
        }),
      ]),
    );
    const dx = f(offset);
    assert.equal(dx * f(dx) <= f(0.005 * 0.005), reclaimed);
    assert.equal(result.reclaimed.length !== 0, reclaimed);
    assert.equal(
      kinds(result).includes("set-committed-translation"),
      reclaimed,
    );
    if (!reclaimed)
      assert.deepEqual(
        kinds(result),
        [],
        "rec2's missing recheck must not release the lift",
      );
  }
});

test("viewed owner is protected after eligible translation snapping, before any release effects", () => {
  const result = new NativeNonCarReclaimRuntime().advanceFrame(
    1000,
    frame(
      [
        object("viewed", {
          flags: 0x10000,
          jointReference: new Vector3(0.001, 0, 0),
        }),
      ],
      [],
      { viewedOwner: "viewed" },
    ),
  );
  assert.deepEqual(kinds(result), ["set-committed-translation"]);
  assert.equal(result.reclaimed.length, 0);
  assert.equal(result.survivors[0].committedMatrix.elements[12], f(0.001));
});

test("native IDs decode three signed bytes; additional-parent sentinel is explicit", () => {
  assert.equal(nativeNonCarId("&50!0312.ACT", false), 312);
  assert.equal(nativeNonCarId("&50!1312.ACT", false), 312);
  assert.equal(nativeNonCarId("&50!10003.ACT", false), 0);
  assert.equal(nativeNonCarId("short", true), 0xffff);
  const signedText = "&50!0" + String.fromCharCode(255) + "00.ACT";
  assert.equal(nativeNonCarId(signedText, false), (-100 - 48 * 100) & 0xffff);
  assert.throws(() => nativeNonCarId("short", false), /bytes5/);
});

test("MODEL bounds scan unused original vertices and require authored custom-bounds provider", () => {
  const model = {
    flags: 0,
    positions: Float32Array.from([0, 0, 0, 1, 2, 3, 100, -10, 7]),
  };
  assert.deepEqual(nativeNonCarModelBounds(model).max.toArray(), [100, 2, 7]);
  assert.throws(
    () => nativeNonCarModelBounds({ ...model, flags: 0x400 }),
    /custom bounds/,
  );
  assert.deepEqual(
    nativeNonCarModelBounds({ ...model, flags: 0x400 }, box()).max.toArray(),
    [1, 1, 1],
  );
});

test("missing native providers and malformed numeric bounds fail clearly", () => {
  const run = (value, objects = []) =>
    new NativeNonCarReclaimRuntime().advanceFrame(
      1000,
      frame([value], objects),
    );
  assert.throws(
    () => run(object("missing", { doNothing: undefined })),
    /ec provider/,
  );
  assert.throws(
    () => run(object("missing", { flags: 0x10000 })),
    /translation reference/,
  );
  assert.throws(
    () => nativeNonCarReclaimBounds(new Box3(), new Matrix4(), new Matrix4()),
    /bounds/,
  );
  assert.throws(
    () =>
      nativeNonCarReclaimBounds(
        box(),
        new Matrix4().makePerspective(-1, 1, 1, -1, 0.1, 10),
        new Matrix4(),
      ),
    /affine/,
  );
  assert.throws(
    () => new NativeNonCarReclaimRuntime().advanceFrame(0.5, frame([])),
    /frame period/,
  );
});

test("all five original debris MODEL bounds supply source-correct reclaim without hull/render unions", async (t) => {
  const root = new URL("../carma2_orig", import.meta.url).pathname;
  try {
    await access(`${root}/data.twt`);
  } catch (error) {
    if (error.code === "ENOENT") return t.skip("Original installation absent");
    throw error;
  }
  const assets = await createAssetStore(root);
  for (const [race, basename] of [
    ["Carrier1", "&50gun01_DEBRIS1"],
    ["Carrier1", "&51gun01_DEBRIS2"],
    ["Carrier1", "&52TGUN_DEBRIS1"],
    ["Carrier1", "&53TGUN_DEBRIS2"],
    ["newcity1", "&petpump"],
  ]) {
    const model = parseDat(
        await assets.read(`data/RACES/${race}/${basename}.dat`),
      )[0],
      modelBounds = nativeNonCarModelBounds(model),
      maximumX = Math.max(
        ...Array.from(model.positions).filter((_, i) => i % 3 === 0),
      ),
      minimumX = Math.min(
        ...Array.from(model.positions).filter((_, i) => i % 3 === 0),
      ),
      touching = collider("awake", {
        cachedBounds: box(
          [maximumX, modelBounds.min.y, modelBounds.min.z],
          [maximumX + 1, modelBounds.max.y, modelBounds.max.z],
        ),
      }),
      input = object(basename, { authoredModelBounds: modelBounds });
    assert.equal(modelBounds.min.x, minimumX);
    assert.equal(modelBounds.max.x, maximumX);
    // Float32 extent plus sequential addition can shift a nonzero minimum
    // by one ULP; use the installed transformed bound, not render equality.
    const transformed = nativeNonCarReclaimBounds(
      modelBounds,
      new Matrix4(),
      new Matrix4(),
    );
    touching.cachedBounds.min.x = transformed.max.x;
    assert.equal(
      new NativeNonCarReclaimRuntime().advanceFrame(
        1000,
        frame([input], [touching]),
      ).reclaimed.length,
      0,
      basename,
    );
    assert.equal(
      new NativeNonCarReclaimRuntime().advanceFrame(1000, frame([input]))
        .reclaimed.length,
      1,
      basename,
    );
  }
});
