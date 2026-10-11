import assert from "node:assert/strict";
import test from "node:test";
import { createAssetStore } from "../server/assets.mjs";
import { parseDat, parseMat } from "../src/formats.ts";
import { knownNativeActorValue as known } from "../src/native-actor-order.ts";
import {
  createNativeTrackModelResource as create,
  migrateNativeTrackResource as migrate,
  prepareNativeTrackResource as prepare,
  emitNativeTrackPreparedFace as emit,
  nativeTrackMaterialOrder,
  invalidateNativeTrackResource as invalidate,
  nativeTrackRawBounds,
  nativeRawModelBounds,
} from "../src/native-track-resources.ts";
const mat = (name, flags = 0x1800) => ({ name, flags });
const A = mat("A.MAT"),
  B = mat("B.MAT");
const dat = (materials = [1, 1, 1]) => ({
  name: "test MODEL",
  flags: 0,
  pivot: [1, 2, 3],
  positions: new Float32Array([1, 2, 4, 2, 2, 4, 1, 3, 4]),
  uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
  materials: [A.name, B.name],
  faces: materials.map((material, i) => ({
    indices: [0, 1, 2],
    material,
    flags: 0xe0 | i,
    smoothing: 0,
  })),
});
const find = (name) => known(name === A.name ? A : B);
function resource(source = dat()) {
  const result = create(source, find, 4);
  assert.equal(result.resolved, true);
  return result.value;
}
const providers = {
  // No spawning is claimed by these isolated MODEL tests.
  spawnPedsOnFace() {},
  copyVertexPayload: structuredClone,
  copyFacePayload: structuredClone,
};
const order = (keys) => ({
  kind: "native-pointers",
  keys,
  evidence:
    "invented synthetic allocated-pointer fixture, not a stock heap capture",
});

test("current MODEL copies DAT tables and shares real MAT identity without render fallback", () => {
  const source = dat();
  const r = resource(source);
  assert.equal(r.current.identity, r);
  assert.equal(r.source, source);
  assert.equal(r.current.flags, 0x80);
  assert.equal(r.current.faces[0].material, A);
  assert.equal(r.current.faces[1].material, A);
  source.positions[0] = 90;
  source.uvs[0] = 80;
  source.faces[0].indices[0] = 2;
  source.faces[0].flags = 0;
  source.pivot[0] = 70;
  assert.deepEqual(r.current.vertices[0].position, [1, 2, 4]);
  assert.deepEqual(r.current.vertices[0].uv, [0, 0]);
  assert.deepEqual(r.current.faces[0].indices, [0, 1, 2]);
  assert.equal(r.current.faces[0].payload.flags, 0xe0);
  assert.deepEqual(r.current.pivot, [1, 2, 3]);
  const missing = create(
    dat(),
    () => ({ resolved: false, requiredProvider: "actual MAT missing" }),
    4,
  );
  assert.deepEqual(missing, {
    resolved: false,
    requiredProviders: ["actual MAT missing"],
  });
  assert.throws(
    () => create(dat(), () => ({ resolved: false }), 4),
    /provider reason/,
  );
  assert.throws(
    () => create(dat(), () => known("renderer-fallback"), 4),
    /actual parsed resource/,
  );
  assert.throws(() => create(dat(), find, 256), /uint8/);
  const invalid = dat();
  invalid.positions[0] = NaN;
  assert.throws(() => create(invalid, find, 4), /finite Float32/);
});

test("proven one-MAT CRT preparation is unstable and records raw compacted IDs separately from group ordinals", () => {
  const r = resource();
  const prepared = prepare(r);
  assert.equal(prepared.resolved, true);
  // Installed shortsort equal-key three-face permutation, not source stability.
  assert.deepEqual(prepared.value.order.faceOrder, [1, 2, 0]);
  assert.deepEqual(
    prepared.value.faces.map((f) => [
      f.groupIndex,
      f.groupFaceIndex,
      f.nativeFaceIndex,
      f.sourceFaceIndex,
    ]),
    [
      [0, 0, 1, 1],
      [0, 1, 2, 2],
      [0, 2, 0, 0],
    ],
  );
  const result = emit(r, 0, null, {
    resolved: false,
    requiredProvider: "unused inheritance",
  });
  assert.equal(result.kind, "emitted");
  assert.equal(result.face.materialIdentifier, "A.MAT");
  assert.equal(result.face.nativeFaceIndex, 1);
  assert.equal(result.face.sourceFaceIndex, 1);
  assert.equal(result.face.rawFlags, 0xe1);
  assert.deepEqual(result.face.a, [0, 0, 1]);
  assert.equal(result.face.constant, 4);
});

test("migration invalidates all sharing ACT preparations and generated MODEL keeps old DAT provenance with new pivot", () => {
  const r = resource(dat([0, 1, 0]));
  prepare(r);
  const old = r.prepared;
  const changed = migrate(
    r,
    [{ material: A, triggerType: 0, mode: 3, levelCount: 0 }],
    providers,
  );
  assert.equal(r.prepared, null);
  assert.equal(emit(r, 0, null, known(null)).kind, "unresolved");
  assert.equal(old.revision, 0);
  assert.equal(r.revision, 1);
  assert.equal(changed.remainingActorModelPresent, true);
  const g = changed.generated;
  assert.notEqual(g, r);
  assert.equal(g.current.identity, g);
  assert.equal(g.source, null);
  assert.deepEqual(g.current.pivot, [0, 0, 0]);
  prepare(r);
  prepare(g);
  const generated = emit(g, 0, null, known(null)).face;
  assert.equal(generated.sourceModel, r);
  assert.equal(generated.model, g);
  assert.equal(generated.sourceFaceIndex, 1);
  assert.equal(generated.nativeFaceIndex, 0);
  assert.deepEqual(generated.a, [1, 2, 4]);
  const remaining = r.prepared.faces.map(
    (_, i) => emit(r, i, null, known(null)).face,
  );
  assert.deepEqual(
    remaining.map((f) => f.sourceFaceIndex),
    [2, 0],
  );
  assert.ok(remaining.every((f) => f.a[0] === 0 && f.a[2] === 1));
});

test("multi-MAT keys require evidence and must preserve exact pointer equality and NULL zero", () => {
  const r = resource(dat([0, 1, 2, 1]));
  assert.equal(nativeTrackMaterialOrder(r).kind, "unresolved");
  assert.equal(prepare(r).resolved, false);
  assert.equal(r.prepared, null);
  for (const keys of [
    [1, 2, 3, 2],
    [0, 0, 3, 0],
    [0, 7, 7, 7],
    [0, 7, 8, 9],
  ])
    assert.throws(
      () => prepare(r, order(keys)),
      /genuine NULL|identity equality/,
    );
  const good = prepare(r, order([0, 7, 8, 7]));
  assert.equal(good.resolved, true);
  assert.equal(good.value.order.groups.length, 3);
  const inherited = mat("!actual actor", 0);
  assert.equal(
    emit(r, 0, null, known(inherited)).face.materialIdentifier,
    inherited.name,
  );
  assert.equal(
    emit(r, 0, null, {
      resolved: false,
      requiredProvider: "real ACT material missing",
    }).kind,
    "unresolved",
  );
  assert.equal(emit(r, 0, null, known(null)).face.materialPresence, "null");
  assert.equal(emit(r, 1, null, known(B)).face.materialIdentifier, A.name);
});

test("failed reprepare and partial migration effects never leave stale MODEL emission available", () => {
  const r = resource();
  prepare(r);
  r.current.flags = 0;
  assert.equal(prepare(r).resolved, false);
  assert.equal(r.prepared, null);
  assert.equal(emit(r, 0, null, known(null)).kind, "unresolved");
  r.current.flags = 0x80;
  prepare(r);
  const before = r.revision;
  assert.throws(
    () =>
      migrate(r, [], {
        ...providers,
        spawnPedsOnFace() {
          throw new Error("host failed");
        },
      }),
    /host failed/,
  );
  assert.equal(r.prepared, null);
  assert.equal(r.revision, before + 1);
  prepare(r);
  invalidate(r);
  assert.equal(emit(r, 0, null, known(null)).kind, "unresolved");
});

test("installed MODEL bounds/radius use all raw vertices including unused vertices, without pivot subtraction", () => {
  const r = resource(dat());
  r.current.vertices = [
    ...r.current.vertices,
    { position: [-8, -9, 12], uv: [0, 0], payload: null },
  ];
  const result = nativeTrackRawBounds(r);
  assert.equal(result.resolved, true);
  assert.deepEqual(result.value.bounds, { min: [-8, -9, 4], max: [2, 3, 12] });
  assert.equal(
    result.value.radius,
    Math.fround(Math.sqrt(Math.fround(81 + 144 + 64))),
  );
  assert.deepEqual(r.current.pivot, [1, 2, 3]);
  r.current.flags |= 0x400;
  assert.equal(nativeTrackRawBounds(r).resolved, false);
  r.current.flags &= ~0x400;
  r.current.vertices = [];
  assert.equal(nativeTrackRawBounds(r).resolved, false);
});

test("preparation-independent RAW bounds consume an iterable once and retain unresolved custom/empty owners", () => {
  const r = resource(dat());
  let reads = 0;
  function* positions() {
    for (const vertex of r.current.vertices) {
      reads++;
      yield vertex.position;
    }
  }
  assert.deepEqual(
    nativeRawModelBounds(r.current.flags, positions()),
    nativeTrackRawBounds(r),
  );
  assert.equal(reads, r.current.vertices.length);
  assert.equal(r.prepared, null);
  const unused = {
    [Symbol.iterator]() {
      throw new Error("custom bounds must not read RAW vertices");
    },
  };
  assert.equal(nativeRawModelBounds(0x400, unused).resolved, false);
  assert.match(nativeRawModelBounds(0, []).requiredProvider, /empty MODEL/);
  for (const flags of [-1, 65536, 1.5, NaN])
    assert.throws(() => nativeRawModelBounds(flags, []), /uint16/);
  for (const position of [
    [1, 2],
    [1, 2, 3, 4],
    [NaN, 0, 0],
    [0.1, 0, 0],
  ])
    assert.throws(() => nativeRawModelBounds(0, [position]), /finite Float32/);
  assert.throws(
    () => nativeRawModelBounds(0, [[Math.fround(3e38), 0, 0]]),
    /finite stored result/,
  );
});

test("Stock and Advanced Newcity material identities and single-MAT cached records use original tables", async (t) => {
  let store;
  try {
    store = await createAssetStore(process.env.CARMA2_ROOT || "carma2_orig");
  } catch (error) {
    if (/ENOENT|Original installation/.test(String(error))) {
      t.skip("Original installation unavailable");
      return;
    }
    throw error;
  }
  const key = (s) => s.replace(/\.(mat|dat)$/i, "").toLowerCase();
  for (const dataRoot of ["data", "adv_data"]) {
    const prefix = `${dataRoot}/races/newcity1/`;
    const files = store.manifest.filter(
      (e) =>
        e.path.toLowerCase().startsWith(prefix) &&
        !e.path.slice(prefix.length).includes("/"),
    );
    const mats = new Map(),
      models = new Map();
    for (const file of files.filter((e) => /\.mat$/i.test(e.path)))
      for (const m of parseMat(await store.read(file.path)))
        mats.set(key(m.name), m);
    for (const file of files.filter((e) => /\.dat$/i.test(e.path)))
      for (const m of parseDat(await store.read(file.path)))
        models.set(key(m.name), m);
    assert.equal(models.size, 273);
    assert.equal(mats.size, 195);
    let resolved = 0,
      unresolved = 0,
      faces = 0;
    for (const model of models.values()) {
      const created = create(
        model,
        (name) =>
          mats.has(key(name))
            ? known(mats.get(key(name)))
            : {
                resolved: false,
                requiredProvider: `missing source MAT:${name}`,
              },
        4,
      );
      assert.equal(created.resolved, true, model.name);
      const r = created.value;
      if (!model.uvs.length)
        assert.ok(r.current.vertices.every((v) => v.uv.every((n) => n === 0)));
      const result = prepare(r);
      if (!result.resolved) {
        unresolved++;
        assert.match(
          result.requiredProviders[0],
          /multi-material pointer order/,
        );
        continue;
      }
      resolved++;
      for (let i = 0; i < result.value.faces.length; i++) {
        const record = emit(r, i, null, known(null));
        assert.equal(record.kind, "emitted");
        faces++;
        assert.equal(record.face.sourceModel, r);
        assert.equal(
          record.face.rawFlags,
          model.faces[record.face.sourceFaceIndex].flags,
        );
        assert.equal(record.face.nativeFaceIndex, record.face.sourceFaceIndex);
        assert.equal(record.face.model, r);
      }
    }
    assert.equal(resolved, 89);
    assert.equal(unresolved, 184);
    assert.ok(faces > 100);
  }
});
