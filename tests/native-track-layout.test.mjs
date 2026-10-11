import test from "node:test";
import assert from "node:assert/strict";
import { createAssetStore } from "../server/assets.mjs";
import { parseAct, parseDat } from "../src/formats.ts";
import {
  createNativeActorOrder,
  knownNativeActorValue as known,
} from "../src/native-actor-order.ts";
import { nativeRawModelBounds } from "../src/native-track-resources.ts";
import {
  NativeTrackLayoutError,
  parseNativeTrackLayoutHeader as header,
  nativeTrackApplyModelBounds as apply,
  nativeTrackActorBounds as actorBounds,
  extractNativeTrackLayout as extract,
  createNativeTrackLayoutBoundsProvider,
} from "../src/native-track-layout.ts";

const F = Math.fround;
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const B = { min: [-1, -2, -3], max: [4, 5, 6] };
const model = { sourceBounds: B };
const unavailableDefault = {
  resolved: false,
  requiredProvider: "actual v1db default MODEL",
};
const raw = (name, children = [], fields = {}) => ({
  name,
  type: 0,
  renderStyle: 0,
  transform: [...I],
  children,
  ...fields,
});
const rawModel = (name, children = [], fields = {}) =>
  raw(name, children, { type: 1, model: "M", ...fields });
const load = (roots, models = new Map([["M", model]])) =>
  createNativeActorOrder(roots, {
    model: (name) =>
      models.has(name)
        ? known(models.get(name))
        : { resolved: false, requiredProvider: `MODEL:${name}` },
  });
const providers = (extra = {}) => ({
  defaultModel: unavailableDefault,
  modelBounds: (m) => known(m.sourceBounds),
  ...extra,
});
const errorCode = (fn, code) =>
  assert.throws(
    fn,
    (e) => e instanceof NativeTrackLayoutError && e.code === code,
  );

test("PP header stores byte dimensions, raw slot count and +250 before compaction", () => {
  assert.deepEqual(header("PP01 16 16 1.000 1126"), {
    conversionCount: 4,
    processColumns: true,
    rawCountX: 16,
    rawCountZ: 16,
    countX: 16,
    countZ: 16,
    extraRoom: 1,
    rawNonCarCount: 1126,
    nonCarCapacity: 1376,
  });
  const result = header("PPX1 257 258 .5 7 trailing text");
  assert.equal(result.rawCountX, 257);
  assert.equal(result.rawCountZ, 258);
  assert.equal(result.countX, 1);
  assert.equal(result.countZ, 2);
  assert.equal(result.extraRoom, 0.5);
  assert.equal(result.rawNonCarCount, 7);
  assert.equal(result.nonCarCapacity, 257);
});

test("native four-conversion branch also accepts numeric non-PP root names", () => {
  const h = header("16+16.5+7");
  assert.equal(h.processColumns, true);
  assert.equal(h.countX, 16);
  assert.equal(h.countZ, 16);
  assert.equal(h.extraRoom, 0.5);
  assert.equal(h.rawNonCarCount, 7);
  assert.equal(header("-1 1 0 0").countX, 255);
  assert.equal(header("PP01 1 1 0 0\0ignored").processColumns, true);
});

test("partial non-ancient names take source one-column fallback; no fake PP ancestor search", () => {
  for (const [name, conversions] of [
    ["ordinary", 0],
    ["", -1],
    ["PP01 ", -1],
    ["16", 1],
    ["16 16", 2],
    ["pp01 2 2 0 10", 0],
  ]) {
    const h = header(name);
    assert.equal(h.conversionCount, conversions, name);
    assert.equal(h.processColumns, false, name);
    assert.deepEqual(
      [h.countX, h.countZ, h.extraRoom, h.rawNonCarCount, h.nonCarCapacity],
      [1, 1, 0, 0, 250],
    );
  }
  errorCode(() => header("PP00 1 1 0 0"), "track-version");
  errorCode(() => header("PP02 1 1 0 0"), "track-version");
  errorCode(() => header("PP01"), "track-header-pointer");
  errorCode(() => header("PP01 16 16 1"), "ancient-track");
});

test("unsafe byte count, allocation, Float32 and unsupported CRT grammar are explicit errors", () => {
  errorCode(() => header("PP01 256 16 1 0"), "zero-column-count");
  errorCode(() => header("PP01 1 1 0 -1"), "noncar-allocation");
  errorCode(() => header("PP01 1 1 0 1073741823"), "noncar-allocation");
  errorCode(() => header("4294967296 1 0 1"), "crt-integer-overflow");
  errorCode(() => header("1 1 0 2147483648"), "crt-integer-overflow");
  errorCode(() => header("1 1 1e39 0"), "nonfinite-scalar");
  errorCode(() => header("1 1 1e+ 0"), "crt-float-grammar");
});

test("installed BrActorToBounds captures ignore root matrix and render style", () => {
  const T = [...I];
  T.splice(9, 3, 1000, 2000, 3000);
  const state = load([
    raw("root", [rawModel("child", [rawModel("grand")], { renderStyle: 1 })], {
      transform: T,
      renderStyle: 1,
    }),
  ]);
  const result = actorBounds(state.roots[0], providers());
  assert.equal(result.resolved, true);
  assert.deepEqual(result.bounds, B); // Literal installed51e160 private capture.
  assert.equal(result.modelActorCount, 2);
  assert.deepEqual(state.roots[0].matrix, T);
});

test("type5 authored bounds do not prune; inherited MODEL and each descendant transform participate", () => {
  const T = [...I];
  T.splice(9, 3, 1000, 2000, 3000);
  const C = [...I];
  C.splice(9, 3, 10, 20, 30);
  const state = load([
    rawModel(
      "root",
      [
        raw(
          "tiny authored BOUNDS",
          [raw("inherited model leaf", [], { type: 1, renderStyle: 1 })],
          {
            type: 5,
            transform: C,
            bounds: { min: [10000, 10000, 10000], max: [10001, 10001, 10001] },
          },
        ),
      ],
      { transform: T, renderStyle: 1 },
    ),
  ]);
  state.roots[0].localMaterial = {
    resolved: false,
    requiredProvider: "unused MAT",
  };
  const result = actorBounds(state.roots[0], providers());
  assert.equal(result.resolved, true);
  // Literal installed capture: type1 root raw box + translated inherited grandchild.
  assert.deepEqual(result.bounds, { min: [-1, -2, -3], max: [14, 25, 36] });
  assert.equal(result.modelActorCount, 2);
});

test("non-MODEL local MODEL overrides inheritance without emitting its own bounds", () => {
  const second = { sourceBounds: { min: [7, 8, 9], max: [10, 11, 12] } };
  const state = load(
    [
      raw("root", [
        raw("none MODEL owner", [raw("MODELNULL leaf", [], { type: 1 })], {
          model: "N",
        }),
      ]),
    ],
    new Map([["N", second]]),
  );
  const result = actorBounds(state.roots[0], providers());
  assert.equal(result.resolved, true);
  assert.deepEqual(result.bounds, second.sourceBounds);
  assert.equal(result.modelActorCount, 1);
});

test("default MODEL may be unresolved and unused, but actual inherited use requires it", () => {
  const actual = { sourceBounds: { min: [1, 2, 3], max: [4, 5, 6] } };
  const state = load([
    raw("root", [raw("type1 without local MODEL", [], { type: 1 })]),
  ]);
  const unknown = actorBounds(state.roots[0], providers());
  assert.equal(unknown.resolved, false);
  assert.equal(unknown.requiredProvider, unavailableDefault.requiredProvider);
  const result = actorBounds(
    state.roots[0],
    providers({ defaultModel: known(actual) }),
  );
  assert.equal(result.resolved, true);
  assert.deepEqual(result.bounds, actual.sourceBounds);
  const nullDefault = actorBounds(
    state.roots[0],
    providers({ defaultModel: known(null) }),
  );
  assert.equal(nullDefault.resolved, false);
  assert.equal(nullDefault.requiredProvider, "native-v1db-default-MODEL");
});

test("MODEL-bound products remain live until each row accumulation store", () => {
  const tiny = { min: [1.5, 0, 0], max: [1.5, 0, 0] };
  const M = [F(0.1), 0, 0, 0, 1, 0, 0, 0, 1, -F(0.15), 0, 0];
  const result = apply(tiny, M);
  assert.equal(result.min[0], -3.725290298461914e-9);
  assert.equal(result.max[0], -3.725290298461914e-9);
  assert.equal(F(F(tiny.min[0] * M[0]) + M[9]), 0);
  assert.deepEqual(apply(B, [1, 2, -3, -4, 5, 6, 7, -8, 9, 10, 20, 30]), {
    min: [-32, -40, -21],
    max: [64, 77, 117],
  });
});

test("layout subtracts doubled extra room, stores detached pre-mutation bounds and raw slots", () => {
  const worldModel = {
    sourceBounds: { min: [-10, -20, -30], max: [50, 40, 70] },
  };
  const state = load(
    [raw("PP01 3 2 1.5 6", [rawModel("physical accessory")])],
    new Map([["M", worldModel]]),
  );
  const result = extract(state.roots[0], providers());
  assert.equal(result.resolved, true);
  assert.deepEqual(result.layout, {
    originX: -11.5,
    originZ: -31.5,
    columnSizeX: 19,
    columnSizeZ: 48.5,
    countX: 3,
    countZ: 2,
  });
  assert.equal(result.header.rawNonCarCount, 6);
  assert.equal(result.header.nonCarCapacity, 256);
  worldModel.sourceBounds.min[0] = -100;
  state.roots[0].firstChild.matrix[9] = 2000;
  assert.deepEqual(result.initialBounds, {
    min: [-10, -20, -30],
    max: [50, 40, 70],
  });
  assert.equal(result.layout.originX, -11.5);
});

test("bounds failures preserve header diagnostic and empty native sentinels are not fabricated track boxes", () => {
  const state = load([raw("PP01 1 1 0 0", [rawModel("missing")])]);
  const result = extract(
    state.roots[0],
    providers({
      modelBounds: () => ({
        resolved: false,
        requiredProvider: "custom native MODEL bounds",
      }),
    }),
  );
  assert.equal(result.resolved, false);
  assert.equal(result.requiredProvider, "custom native MODEL bounds");
  assert.equal(result.header.rawNonCarCount, 0);
  const empty = load([raw("empty")]);
  const b = actorBounds(empty.roots[0], providers());
  assert.equal(b.modelActorCount, 0);
  assert.deepEqual(b.bounds, {
    min: [3.4028234663852886e38, 3.4028234663852886e38, 3.4028234663852886e38],
    max: [
      -3.4028234663852886e38, -3.4028234663852886e38, -3.4028234663852886e38,
    ],
  });
  errorCode(() => extract(empty.roots[0], providers()), "empty-model-subtree");
  const flat = load([rawModel("PP01 1 1 1 0")]);
  errorCode(
    () =>
      extract(
        flat.roots[0],
        providers({
          modelBounds: () => known({ min: [0, 0, 0], max: [1, 1, 1] }),
        }),
      ),
    "column-size",
  );
});

test("bounds-safe typed errors cover malformed model boxes and actor cycles", () => {
  errorCode(
    () => apply({ min: [1, 0, 0], max: [0, 0, 0] }, I),
    "reversed-bounds",
  );
  errorCode(() => apply(B, I.slice(1)), "matrix-size");
  errorCode(
    () =>
      apply(
        B,
        I.map(() => Infinity),
      ),
    "nonfinite-scalar",
  );
  const state = load([raw("root", [rawModel("child")])]);
  state.roots[0].firstChild.next = state.roots[0].firstChild;
  errorCode(() => actorBounds(state.roots[0], providers()), "actor-cycle");
});

test("actual-resource bounds adapter delegates custom/empty metadata diagnostics", () => {
  const resource = {
    current: {
      flags: 0,
      vertices: [{ position: [-1, -2, -3] }, { position: [4, 5, 6] }],
    },
  };
  const reader = createNativeTrackLayoutBoundsProvider((identity) =>
    known(identity === resource ? resource : null),
  );
  assert.deepEqual(reader(resource), known(B));
  resource.current.flags = 0x400;
  assert.equal(reader(resource).resolved, false);
  resource.current.flags = 0;
  resource.current.vertices = [];
  assert.equal(reader(resource).resolved, false);
  assert.equal(reader({}).resolved, false);
});

const captured = {
  newcity1: {
    bounds: {
      min: [-78.9973373413086, -12.745138168334961, -243.819091796875],
      max: [108.72412872314453, 23.413419723510742, 100.56779479980469],
    },
    columns: 16,
    slots: 1126,
    modelActors: 1346,
  },
  Carrier1: {
    bounds: {
      min: [-92.71574401855469, -48.049983978271484, -49.58782958984375],
      max: [100.66124725341797, 6.5, 49.58781433105469],
    },
    columns: 6,
    slots: 514,
    modelActors: 343,
  },
  Airport1: {
    bounds: {
      min: [-288.787109375, -136.1642303466797, -280.9778747558594],
      max: [277.3437805175781, 29.640790939331055, 362.6515197753906],
    },
    columns: 16,
    slots: 831,
    modelActors: 999,
  },
};
for (const dataRoot of ["data", "adv_data"])
  for (const track of Object.keys(captured)) {
    test(`${dataRoot} original ${track} initial MODEL bounds match installed whole-tree capture`, async (t) => {
      let store;
      try {
        store = await createAssetStore(
          process.env.CARMA2_ROOT || "carma2_orig",
        );
      } catch (e) {
        if (/ENOENT|Original installation/.test(String(e))) {
          t.skip("Original installation unavailable");
          return;
        }
        throw e;
      }
      const prefix = `${dataRoot}/races/${track}/`.toLowerCase();
      const actFile = store.manifest.find(
        (e) => e.path.toLowerCase() === `${prefix}${track}.act`.toLowerCase(),
      );
      if (!actFile) {
        t.skip("Original track resources unavailable");
        return;
      }
      const models = new Map();
      const key = (name) => name.replace(/\.(dat|act)$/i, "").toLowerCase();
      for (const file of store.manifest.filter(
        (e) =>
          e.path.toLowerCase().startsWith(prefix) &&
          /\.dat$/i.test(e.path) &&
          !e.path.slice(prefix.length).includes("/"),
      ))
        for (const m of parseDat(await store.read(file.path)))
          models.set(key(m.name), m);
      const roots = parseAct(await store.read(actFile.path));
      assert.equal(roots.length, 1);
      assert.ok(roots[0].name.startsWith("PP01 "));
      const state = createNativeActorOrder(roots, {
        model: (name) =>
          models.has(key(name))
            ? known(models.get(key(name)))
            : { resolved: false, requiredProvider: `actual MODEL:${name}` },
      });
      const result = extract(state.roots[0], {
        defaultModel: unavailableDefault,
        modelBounds: (m) => {
          if (!m) {
            throw new Error("Native default MODEL unexpectedly required");
          }
          const b = nativeRawModelBounds(
            m.flags,
            (function* () {
              for (let i = 0; i < m.positions.length; i += 3)
                yield [m.positions[i], m.positions[i + 1], m.positions[i + 2]];
            })(),
          );
          return b.resolved ? known(b.value.bounds) : b;
        },
      });
      const c = captured[track];
      assert.equal(result.resolved, true, result.requiredProvider);
      assert.deepEqual(result.initialBounds, c.bounds);
      assert.equal(result.modelActorCount, c.modelActors);
      assert.equal(result.header.rawNonCarCount, c.slots);
      assert.equal(result.header.nonCarCapacity, c.slots + 250);
      assert.equal(result.layout.countX, c.columns);
      assert.equal(result.layout.countZ, c.columns);
      assert.equal(result.layout.originX, F(c.bounds.min[0] - 1));
      assert.equal(result.layout.originZ, F(c.bounds.min[2] - 1));
      assert.equal(
        result.layout.columnSizeX,
        F((c.bounds.max[0] - c.bounds.min[0] - 2) / c.columns),
      );
      assert.equal(
        result.layout.columnSizeZ,
        F((c.bounds.max[2] - c.bounds.min[2] - 2) / c.columns),
      );
      assert.deepEqual(roots[0].transform, I);
      t.diagnostic(
        "Read-only original raw MODEL bounds and ACT topology; installed51e160 private whole-tree output, no MAT or renderer fallback",
      );
    });
  }
