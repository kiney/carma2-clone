import assert from "node:assert/strict";
import test from "node:test";
import { createAssetStore } from "../server/assets.mjs";
import { parseDat, parseMat } from "../src/formats.ts";
import {
  knownNativeActorValue as known,
  createNativeActorOrder,
} from "../src/native-actor-order.ts";
import { pickNativeActorBox } from "../src/native-actor-pick.ts";
import {
  createNativeTrackModelResource as create,
  prepareNativeTrackResource as prepare,
  invalidateNativeTrackResource as invalidate,
  nativeTrackRawBounds,
} from "../src/native-track-resources.ts";
import {
  emitNativeModelPickBox as emit,
  createNativeModelPickEmitter,
  nativeModelPickPlaneRadiusPass as plane,
  nativeModelPickTriangleBoundsPass as boundsPass,
  nativeModelPickBoxCoordinates as coordinates,
} from "../src/native-model-pick.ts";

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const box = (min = -100, max = 100) => ({
  min: [min, min, min],
  max: [max, max, max],
});
const A = { name: "A.MAT", flags: 0x1800 };
const B = { name: "B.MAT", flags: 0x80 };
const dat = (materials = [1], changes = {}) => ({
  name: "invented MODEL",
  flags: 0,
  pivot: [0, 0, 0],
  positions: new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1]),
  uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
  materials: [A.name, B.name],
  faces: materials.map((material, i) => ({
    indices: [0, 1, 2],
    material,
    flags: (0x80 + i) & 255,
    smoothing: 0,
  })),
  ...changes,
});
function resource(source = dat(), keys) {
  const result = create(source, (name) => known(name === A.name ? A : B), 4);
  assert.equal(result.resolved, true);
  const r = result.value;
  const result2 = prepare(
    r,
    keys
      ? {
          kind: "native-pointers",
          keys,
          evidence: "invented allocated pointers, not an original heap capture",
        }
      : undefined,
  );
  assert.equal(result2.resolved, true);
  return r;
}
function input(r, changes = {}) {
  return {
    actor: { name: "invented actor identity" },
    model: r,
    material: null,
    query: {
      matrix: I,
      originalBounds: box(),
      realBounds: box(),
      center: [0, 0, 0],
      radius: 100,
    },
    pMat: null,
    capacity: 76,
    outputOffset: 0,
    ...changes,
  };
}
function rows(r, changes = {}) {
  const result = emit(r, input(r, changes));
  assert.equal(result.resolved, true, result.requiredProvider);
  return result;
}

// All numerical fixtures are invented. The whole installed460490 function was
// called against their prepared records in a read-only private PE mapping.
test("native capacity selects CRT prepared prefix, raw ownership, UV identity and absolute spans", () => {
  const r = resource(dat([1, 1, 1, 1]));
  assert.deepEqual(r.prepared.order.faceOrder, [1, 2, 3, 0]);
  const source = input(r, { capacity: 2, outputOffset: 75 });
  const result = emit(r, source);
  assert.equal(result.resolved, true);
  assert.equal(result.remainingCapacity, 0);
  assert.deepEqual(
    result.rows.map((row) => row.nativeFaceIndex),
    [1, 2],
  );
  assert.deepEqual(
    result.rows.map((row) => row.nativeFace),
    [1, 2],
  );
  assert.deepEqual(
    result.rows.map((row) => row.nativeGroup),
    [-1, -1],
  );
  assert.deepEqual(
    result.rows.map((row) => row.recordIndex),
    [75, 76],
  );
  assert.deepEqual(
    result.rows.map((row) => row.rawFlags),
    [0x81, 0x82],
  );
  assert.deepEqual(result.groupSpans, [
    { groupIndex: 0, recordStart: 75, recordCount: 2 },
  ]);
  for (const row of result.rows) {
    assert.equal(row.actor, source.actor);
    assert.equal(row.model, r);
    assert.equal(row.sourceModel, r);
    assert.equal(row.material, A);
    row.map.forEach((uv, i) => assert.equal(uv, r.current.vertices[i].uv));
  }
});

test("actual nullable group and supplied pointer ordering determine spans before inherited MAT selection", () => {
  const r = resource(dat([1, 2, 1, 0, 2]), [0x2000, 0x1000, 0x2000, 0, 0x1000]);
  const result = rows(r, { material: A, outputOffset: 3 });
  assert.deepEqual(
    result.rows.map((row) => row.groupIndex),
    [0, 1, 1, 2, 2],
  );
  assert.deepEqual(
    result.rows.map((row) => row.material),
    [A, B, B, A, A],
  );
  assert.deepEqual(result.groupSpans, [
    { groupIndex: 0, recordStart: 3, recordCount: 1 },
    { groupIndex: 1, recordStart: 4, recordCount: 2 },
    { groupIndex: 2, recordStart: 6, recordCount: 2 },
  ]);
  assert.equal(result.remainingCapacity, 71);
  // Inherited A does not merge the NULL prepared group with A's own group.
  assert.equal(result.rows[0].nativeFaceIndex, 3);
});

test("installed plane-radius equality accepts, live halfULP delta rejects and plane D is not admission input", () => {
  const V = [1, 0, 0],
    N = [1, 0, 0];
  assert.equal(plane(V, N, [0, 0, 0], 1), true);
  assert.equal(plane(V, N, [2, 0, 0], 1), true);
  assert.equal(plane(V, N, [-(2 ** -24), 0, 0], 1), false);
  assert.equal(Math.fround(1 + 2 ** -24), 1);
  const r = resource(
    dat([0], {
      positions: new Float32Array([1, 0, 0, 1, 1, 0, 1, 0, 1]),
    }),
  );
  const query = {
    matrix: I,
    originalBounds: box(-2, 2),
    realBounds: box(-2, 2),
    center: [0, 0, 0],
    radius: 1,
  };
  r.prepared.faces[0] = {
    ...r.prepared.faces[0],
    plane: { normal: N, d: 91, degenerate: false },
  };
  assert.equal(rows(r, { query }).rows[0].constant, 91);
  assert.equal(
    rows(r, { query: { ...query, center: [-(2 ** -24), 0, 0] } }).rows.length,
    0,
  );
});

test("strict real-bound gates reject only when all three vertices lie outside one plane", () => {
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1]) {
      const vertices = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      vertices.forEach((v) => {
        v[axis] = sign * 2;
      });
      assert.equal(boundsPass(vertices, box(-1, 1)), false);
      vertices[2][axis] = sign;
      assert.equal(boundsPass(vertices, box(-1, 1)), true);
    }
  }
});

test("finite clipping removes a triangle whose plane and AABB gates alone pass", () => {
  const r = resource(
    dat([0], {
      positions: new Float32Array([2, 0, 0, 0, 2, 0, 2, 2, 0]),
    }),
  );
  const query = {
    ...input(r).query,
    originalBounds: box(-0.5, 0.5),
    realBounds: box(-0.5, 0.5),
  };
  assert.equal(
    boundsPass(
      [
        [2, 0, 0],
        [0, 2, 0],
        [2, 2, 0],
      ],
      query.realBounds,
    ),
    true,
  );
  assert.equal(rows(r, { query }).rows.length, 0);
  // Native counts retained vertices; it does not add an area/degeneracy epsilon.
  const degenerate = resource(
    dat([0], {
      positions: new Float32Array(9),
    }),
  );
  assert.equal(rows(degenerate, { query }).rows.length, 1);
});

test("cached emission retains the whole triangle rather than its clipped polygon", () => {
  const r = resource(
    dat([1], {
      positions: new Float32Array([-10, -10, 0, 10, -10, 0, 0, 10, 0]),
    }),
  );
  const query = {
    ...input(r).query,
    originalBounds: box(-0.25, 0.25),
    realBounds: box(-0.25, 0.25),
  };
  const row = rows(r, { query }).rows[0];
  assert.deepEqual(
    [row.a, row.b, row.c],
    [
      [-10, -10, 0],
      [10, -10, 0],
      [0, 10, 0],
    ],
  );
});

test("prepared pivot subtraction and NULL-versus-identity emission preserve different D paths", () => {
  const r = resource(
    dat([0], {
      pivot: [10, 20, 30],
      positions: new Float32Array([11, 22, 34, 12, 22, 34, 11, 23, 34]),
    }),
  );
  assert.deepEqual(nativeTrackRawBounds(r).value.bounds.min, [11, 22, 34]);
  const nullRow = rows(r).rows[0],
    identityRow = rows(r, { pMat: I }).rows[0];
  assert.deepEqual(nullRow.a, [1, 2, 4]);
  assert.deepEqual(identityRow.a, nullRow.a);
  assert.equal(nullRow.constant, 34);
  assert.equal(identityRow.constant, 4);
  assert.deepEqual(nullRow.normal, [0, 0, 1]);
});

test("query coordinates use stored translation subtraction and transpose, not arbitrary-scale inverse", () => {
  const M = [0, 2, 0, -3, 0, 0, 0, 0, 4, 1, 2, 3];
  assert.deepEqual(coordinates([3, 4, 5], M), [4, -6, 8]);
  const r = resource(
    dat([0], {
      positions: new Float32Array([3, 4, 5, 3, 4.25, 5, 3.25, 4, 5]),
    }),
  );
  const query = {
    ...input(r).query,
    matrix: M,
    originalBounds: { min: [3.9, -6.9, 7.9], max: [4.6, -5.9, 8.1] },
  };
  assert.equal(rows(r, { query }).rows.length, 1);
  assert.equal(
    rows(r, { query: { ...query, originalBounds: box(-1, 1) } }).rows.length,
    0,
  );
});

test("source raw flags and selected MAT flags have no ModelPickBox admission filter", () => {
  const r = resource(
    dat([0], {
      faces: [{ indices: [0, 1, 2], material: 0, flags: 0xff, smoothing: 0 }],
    }),
  );
  const material = { name: "raw80.MAT", flags: 0x80000080 };
  const row = rows(r, { material }).rows[0];
  assert.equal(row.rawFlags, 0xff);
  assert.equal(row.materialFlags, 0x80000080);
  assert.equal(row.material, material);
  assert.equal(row.materialPresence, "present");
});

test("captured installed full-function oblique query emits exact transformed record components", () => {
  const values = [
    7.13026762008667, -4.1747212409973145, 6.703360080718994,
    -3.3255867958068848, -3.6121861934661865, -7.243593692779541,
    -0.4748086929321289, 4.0637359619140625, 4.815454483032227,
    7.095210075378418, -1.529573917388916, 5.814254283905029,
    13.297181129455566, -6, -6, -6, 6, 6, 6, -4, -4, -4, 4, 4, 4,
    0.9876775145530701, 0.1803973764181137, -0.9882762432098389,
    1.3080412149429321, -0.9249988794326782, 0.514999508857727,
    -0.9768776297569275, -0.990717887878418, 0.015175791457295418,
    -0.4545792043209076, 0.21742895245552063, -0.22262009978294373,
    -0.8977717161178589, -0.9634060263633728, -0.9733505249023438,
    3.5609259605407715, 1.976439356803894, 1.5824947357177734,
    -0.9344478249549866, 1.1613863706588745, 1.6176961660385132,
    0.7279070019721985, 0.34983009099960327, 1.8656415939331055,
    -0.07459919154644012, 0.7296136617660522, 1.1587276458740234,
    0.07436972111463547,
  ];
  const r = resource(
    dat([0], {
      positions: new Float32Array(values.slice(0, 9)),
      faces: [{ indices: [0, 1, 2], material: 0, smoothing: 0, flags: 77 }],
    }),
  );
  // Explicit invented packed record, independently observed through the native
  // function; this fixture does not claim to reproduce BrModelUpdate's plane.
  r.prepared.faces[0] = {
    ...r.prepared.faces[0],
    plane: { normal: values.slice(37, 40), d: values[40], degenerate: false },
  };
  const query = {
    matrix: values.slice(25, 37),
    center: values.slice(9, 12),
    radius: values[12],
    realBounds: { min: values.slice(13, 16), max: values.slice(16, 19) },
    originalBounds: { min: values.slice(19, 22), max: values.slice(22, 25) },
  };
  const result = rows(r, { query, pMat: values.slice(41, 53), capacity: 1 });
  const row = result.rows[0];
  assert.deepEqual(
    [
      result.remainingCapacity,
      ...row.a,
      ...row.b,
      ...row.c,
      ...row.normal,
      row.constant,
      row.rawFlags,
      row.nativeGroup,
      row.nativeFace,
      0,
    ],
    [
      0, 12.318727493286133, 18.194974899291992, -10.12736701965332,
      -12.572378158569336, -23.46136474609375, 1.0929876565933228,
      6.19534158706665, 15.965147972106934, 3.1168465614318848,
      -3.233785390853882, -4.795140266418457, 0.2102620005607605,
      -129.21298217773438, 77, -1, 0, 0,
    ],
  );
});

test("NULL prepared MAT requires actual inherited metadata only after admission", () => {
  const r = resource(dat([0]));
  const missing = input(r, { material: {} });
  const rejected = emit(r, {
    ...missing,
    query: { ...missing.query, radius: 0 },
  });
  assert.equal(rejected.resolved, true);
  assert.equal(rejected.rows.length, 0);
  assert.equal(
    emit(r, missing).requiredProvider,
    "prepared-face:native-inherited-MAT-metadata-provider",
  );
  const nullRow = rows(r).rows[0];
  assert.equal(nullRow.material, null);
  assert.equal(nullRow.materialPresence, "null");
  const result = emit(r, missing, { resolveMaterial: () => known(B) });
  assert.equal(result.resolved, true);
  assert.equal(result.rows[0].material, B);
  const own = resource();
  assert.equal(rows(own, { material: {} }).rows[0].material, A);
});

test("missing MODEL/preparation/multi-MAT order and admitted non80 edges remain explicit", () => {
  const r = resource();
  assert.equal(
    emit(r, input(r, { model: {} })).requiredProvider,
    "native-MODEL-resource-identity-provider",
  );
  invalidate(r);
  assert.equal(
    emit(r, input(r)).requiredProvider,
    "native-current-prepared-MODEL-provider",
  );
  const multi = create(
    dat([1, 2]),
    (name) => known(name === A.name ? A : B),
    4,
  ).value;
  assert.equal(prepare(multi).resolved, false);
  assert.equal(
    emit(multi, input(multi)).requiredProvider,
    "native-current-prepared-MODEL-provider",
  );
  const non80 = resource();
  non80.prepared.flags &= ~0x80;
  assert.match(
    emit(non80, input(non80)).requiredProvider,
    /non-updateable-prepared-edge/,
  );
  assert.equal(
    rows(non80, { query: { ...input(non80).query, radius: 0 } }).rows.length,
    0,
  );
});

test("capacity zero does not require geometry, query metadata or actual MODEL lookup", () => {
  const r = resource();
  invalidate(r);
  const result = emit(
    r,
    input(r, { model: {}, query: null, capacity: 0, outputOffset: 12 }),
  );
  assert.deepEqual(result, {
    resolved: true,
    rows: [],
    remainingCapacity: 0,
    groupSpans: [],
    plingFace: null,
  });
  let calls = 0;
  const adapter = createNativeModelPickEmitter(() => {
    calls++;
    return known(null);
  });
  assert.deepEqual(adapter(input(r, { model: {}, query: null, capacity: 0 })), {
    resolved: true,
    rows: [],
  });
  assert.equal(calls, 0);
});

test("literal exclamation MAT writes the last admitted row and absence retains the old global", () => {
  const r = resource(dat([0, 0, 0]));
  const material = { name: "!SFX.MAT", flags: 0 };
  let current = { previous: true },
    writes = 0;
  const adapter = createNativeModelPickEmitter(() => known(r), {
    writePlingFace: (face) => {
      current = face;
      writes++;
    },
  });
  const result = adapter(input(r, { material, capacity: 2 }));
  assert.equal(result.resolved, true);
  assert.equal(current, result.rows[1]);
  assert.equal(writes, 1);
  adapter(input(r));
  assert.equal(writes, 1);
  assert.equal(current, result.rows[1]);
  const pure = emit(r, input(r, { material }), {
    writePlingFace() {
      throw Error("pure result must not write host state");
    },
  });
  assert.equal(pure.plingFace, pure.rows.at(-1));
  assert.equal(
    createNativeModelPickEmitter(() => known(r))(input(r, { material }))
      .requiredProvider,
    "native-pling-face-state-provider",
  );
});

test("ActorBoxPick adapter consumes actual resources and preserves traversal after exhausted finite prefix", () => {
  const r = resource(dat([1, 1, 1, 1]));
  const raw = (name, children = [], fields = {}) => ({
    name,
    children,
    type: 0,
    renderStyle: 0,
    transform: I,
    ...fields,
  });
  const order = createNativeActorOrder(
    [
      raw("root", [
        raw("first-in-file", [], { type: 1, model: "MODEL" }),
        raw("last-in-file", [], { type: 1, model: "MODEL" }),
      ]),
    ],
    { model: () => known(r), material: () => known(null) },
  );
  let modelLookups = 0;
  const result = pickNativeActorBox({
    actor: order.roots[0],
    query: input(r).query,
    inheritedModel: known(null),
    inheritedMaterial: known(null),
    pMat: null,
    capacity: 2,
    emitModels: true,
    worldCallbacks: known(null),
    providers: {
      modelBounds: (model) => {
        const result = nativeTrackRawBounds(model);
        return result.resolved ? known(result.value.bounds) : result;
      },
      emitModel: createNativeModelPickEmitter((identity) => {
        assert.equal(identity, r);
        modelLookups++;
        return known(r);
      }),
    },
  });
  assert.equal(result.resolved, true);
  assert.equal(result.remainingCapacity, 0);
  assert.equal(modelLookups, 1);
  assert.deepEqual(
    result.rows.map((row) => row.actor.name),
    ["last-in-file", "last-in-file"],
  );
  assert.deepEqual(
    result.rows.map((row) => row.nativeFaceIndex),
    [1, 2],
  );
});

test("bounded source inputs reject Float32 overflow, invalid capacity and missing UV storage", () => {
  assert.throws(
    () => plane([1e50, 0, 0], [1, 0, 0], [0, 0, 0], 1),
    /finite Float32/,
  );
  assert.throws(
    () => coordinates([0, 0, 0], [...I.slice(0, 11), 1e50]),
    /finite Float32/,
  );
  assert.throws(
    () => plane([0, 0, 0], [1, 0, 0], [0, 0, 0], -1),
    /nonnegative/,
  );
  const r = resource();
  assert.throws(() => emit(r, input(r, { capacity: 1.5 })), /capacity/);
  assert.throws(
    () => emit(r, input(r, { query: { ...input(r).query, radius: 1e50 } })),
    /finite Float32/,
  );
  assert.throws(
    () =>
      emit(
        r,
        input(r, {
          query: {
            ...input(r).query,
            realBounds: { min: [3, 0, 0], max: [2, 1, 1] },
          },
        }),
      ),
    /ordered bounds/,
  );
  r.current.vertices[0].uv = [];
  assert.throws(() => rows(r), /UV storage/);
});

for (const dataRoot of ["data", "adv_data"]) {
  test(`${dataRoot} original Newcity one-MAT resources emit source capacity prefixes without guessed heap ordering`, async (t) => {
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
    let preparedCount = 0,
      unresolvedCount = 0,
      admittedCount = 0;
    for (const model of models.values()) {
      const result = create(
        model,
        (name) =>
          mats.has(key(name))
            ? known(mats.get(key(name)))
            : {
                resolved: false,
                requiredProvider: `actual MAT unavailable:${name}`,
              },
        4,
      );
      assert.equal(result.resolved, true);
      const r = result.value,
        prep = prepare(r);
      if (!prep.resolved) {
        unresolvedCount++;
        assert.match(prep.requiredProviders[0], /multi-material pointer order/);
        assert.equal(emit(r, input(r)).resolved, false);
        continue;
      }
      preparedCount++;
      const result2 = rows(r, {
        capacity: 76,
        outputOffset: 224,
        query: {
          matrix: I,
          originalBounds: box(-1e7, 1e7),
          realBounds: box(-1e7, 1e7),
          center: [0, 0, 0],
          radius: 1e7,
        },
      });
      const prefixFaces = prep.value.faces.slice(0, 76);
      assert.deepEqual(
        result2.rows.map((row) => row.nativeFaceIndex),
        prefixFaces.map((face) => face.nativeFaceIndex),
        model.name,
      );
      for (const [i, row] of result2.rows.entries()) {
        admittedCount++;
        assert.equal(row.recordIndex, 224 + i);
        assert.equal(row.sourceModel, r);
        assert.equal(row.model, r);
        assert.equal(row.rawFlags, model.faces[row.sourceFaceIndex].flags);
        assert.equal(row.constant, prefixFaces[i].plane.d);
        assert.equal(row.material, prefixFaces[i].material);
        model.faces[row.sourceFaceIndex].indices.forEach((index, vertex) =>
          assert.equal(row.map[vertex], r.current.vertices[index].uv),
        );
      }
      assert.equal(result2.remainingCapacity, 76 - prefixFaces.length);
    }
    assert.equal(preparedCount, 89);
    assert.equal(unresolvedCount, 184);
    t.diagnostic(
      `Original MODELs ${preparedCount} resolved, ${unresolvedCount} unresolved; ${admittedCount} emitted prefix records`,
    );
    assert.equal(admittedCount, 566);
  });
}
