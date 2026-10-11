import test from "node:test";
import assert from "node:assert/strict";
import { createAssetStore } from "../server/assets.mjs";
import { parseDat, parseMat } from "../src/formats.ts";
import {
  createNativeActorOrder,
  knownNativeActorValue as known,
} from "../src/native-actor-order.ts";
import { nativeActorPickTransformBounds } from "../src/native-actor-pick.ts";
import {
  nativeFindFacesQuery as query,
  nativeFindFacesColumnXZ as column,
  nativeFindFacesColumnRange as range,
  createNativeFindFacesProviders,
  findNativeFacesInBox as find,
} from "../src/native-find-faces.ts";
import {
  createNativeTrackModelResource,
  prepareNativeTrackResource,
} from "../src/native-track-resources.ts";

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const box = (lo = -10, hi = 10) => ({
  min: [lo, lo, lo],
  max: [hi, hi, hi],
});
const layout = (countX = 1, countZ = 1) => ({
  originX: 0,
  originZ: 0,
  columnSizeX: 1,
  columnSizeZ: 1,
  countX,
  countZ,
});
const raw = (name, children = [], fields = {}) => ({
  name,
  type: 1,
  renderStyle: 0,
  transform: [...I],
  model: "m",
  children,
  ...fields,
});
const model = {};
function actors(roots, resource = model) {
  return createNativeActorOrder(roots, { model: () => known(resource) });
}
function input(changes = {}) {
  return {
    bounds: box(),
    matrix: I,
    layout: layout(),
    columns: [[null]],
    additionalActors: known(null),
    blackMaterial: known(null),
    worldCallbacks: known(null),
    emitModels: true,
    capacity: 20,
    providers: {
      modelBounds: () => known(box()),
      // Explicit invented capture provider, not a production MODEL stand-in.
      emitModel: (value) => ({
        resolved: true,
        rows: value.capacity ? [value] : [],
      }),
    },
    ...changes,
  };
}

test("installed FillInBounds capture retains local radius and sheared transformed bounds", () => {
  const M = [1, 2, -3, -4, 5, 6, 7, -8, 9, 10, 20, 30];
  const q = query({ min: [-1, -2, -3], max: [4, 5, 6] }, M);
  // Literal read-only 45fb90 capture, invented inputs, native CRT53 precision.
  assert.deepEqual(q.center, [16, 18.5, 48]);
  assert.equal(q.radius, 6.224949836730957);
  assert.deepEqual(q.realBounds, {
    min: [-32, -40, -21],
    max: [64, 77, 117],
  });
  assert.notEqual(q.matrix, M);
  assert.deepEqual(M, [1, 2, -3, -4, 5, 6, 7, -8, 9, 10, 20, 30]);
});

test("FillInBounds grouped additions differ from ActorPick GetNewBoundingBox", () => {
  const M = [1, 0, 0, 1, 1, 0, 1, 0, 1, 16777216, 0, 0];
  const b = box(0, 1);
  const q = query(b, M);
  assert.deepEqual(q.center, [16777218, 0.5, 0.5]);
  assert.equal(q.radius, 0.8660253882408142);
  assert.deepEqual(q.realBounds.max, [16777220, 1, 1]);
  assert.equal(nativeActorPickTransformBounds(b, M).max[0], 16777216);
});

test("installed radius capture preserves live extent times stored extent", () => {
  const b = {
    min: [29.37153434753418, -45.17511749267578, 31.163198471069336],
    max: [73.79177856445312, 10.100590705871582, 71.19879913330078],
  };
  const q = query(b, I);
  assert.equal(q.radius, 40.716739654541016);
  const ext = b.max.map((v, i) => Math.fround(v - b.min[i]));
  assert.equal(Math.fround(Math.hypot(...ext) * 0.5), 40.71673583984375);
  assert.deepEqual(
    q.realBounds.max,
    [73.79177856445312, 10.100589752197266, 71.19879913330078],
  );
});

test("installed XZ quotient capture distinguishes Float32 X from live Z", () => {
  const L = {
    ...layout(8, 8),
    columnSizeX: Math.fround(1 / 3),
    columnSizeZ: Math.fround(1 / 3),
  };
  assert.deepEqual(column(1, 1, L), [3, 2]);
  assert.deepEqual(column(-100, -100, L), [0, 0]);
  assert.deepEqual(column(100, 100, L), [7, 7]);
  assert.deepEqual(range(query({ min: [1, 0, 1], max: [1, 0, 1] }, I), L), {
    minX: 2,
    maxX: 4,
    minZ: 1,
    maxZ: 3,
  });
});

test("column rectangle expands one at each interior edge and clamps outside bounds", () => {
  assert.deepEqual(range(query(box(-100, 100), I), layout(8, 9)), {
    minX: 0,
    maxX: 7,
    minZ: 0,
    maxZ: 8,
  });
  assert.deepEqual(range(query(box(3.1, 3.2), I), layout(8, 9)), {
    minX: 2,
    maxX: 4,
    minZ: 2,
    maxZ: 4,
  });
  assert.deepEqual(range(query(box(0, 0), I), layout()), {
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0,
  });
});

test("column X outer / Z inner, MODEL-before-child and actual additional child pointer order", () => {
  const state = actors([
    raw("00", [raw("00child")]),
    raw("01"),
    raw("10"),
    raw("11"),
    raw("additional", [raw("firstAuthored"), raw("lastAuthored")]),
  ]);
  const black = { name: "source gBlack identity" };
  const result = find(
    input({
      columns: [
        [state.roots[0], state.roots[2]],
        [state.roots[1], state.roots[3]],
      ],
      layout: layout(2, 2),
      additionalActors: known(state.roots[4]),
      blackMaterial: known(black),
    }),
  );
  assert.equal(result.resolved, true);
  assert.deepEqual(
    result.rows.map((r) => r.actor.name),
    [
      "00",
      "00child",
      "01",
      "10",
      "11",
      "additional",
      "lastAuthored",
      "firstAuthored",
    ],
  );
  assert.deepEqual(
    result.rows.map((r) => r.outputOffset),
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
  for (const row of result.rows) {
    assert.equal(row.material, black);
    assert.equal(row.pMat, null);
    assert.equal(row.model, model);
  }
  assert.equal(result.remainingCapacity, 12);
});

test("capacity exhaustion and initial zero still visit later pull callbacks", () => {
  const state = actors([raw("first"), raw("&1"), raw("&2")]);
  for (const capacity of [0, 1]) {
    const visits = [];
    const result = find(
      input({
        columns: [[state.roots[0], state.roots[1]]],
        layout: layout(2, 1),
        additionalActors: known(state.roots[2]),
        capacity,
        worldCallbacks: known({
          pullActorFromWorld(actor) {
            visits.push(actor.name);
            return known({ actualInventedPulledIdentity: actor });
          },
        }),
      }),
    );
    assert.equal(result.resolved, true);
    assert.equal(result.rows.length, capacity);
    assert.deepEqual(visits, ["&1", "&2"]);
  }
});

test("empty columns retain no-emission success; unresolved additional binding preserves emitted prefix", () => {
  assert.equal(find(input()).rows.length, 0);
  const state = actors([raw("first")]);
  const result = find(
    input({
      columns: [[state.roots[0]]],
      additionalActors: {
        resolved: false,
        requiredProvider: "actual additional ACT",
      },
    }),
  );
  assert.equal(result.resolved, false);
  assert.equal(result.requiredProvider, "actual additional ACT");
  assert.equal(result.rows.length, 1);
  assert.equal(result.remainingCapacity, 19);
});

const A = { name: "A.MAT", flags: 0x1800 };
function makeResource(material = 1, name = "safe source MODEL", mat = A) {
  const source = {
    name,
    flags: 0,
    pivot: [0, 0, 0],
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    materials: [mat.name],
    faces: [{ indices: [0, 1, 2], material, flags: 0, smoothing: 0 }],
  };
  const created = createNativeTrackModelResource(source, () => known(mat), 4);
  assert.equal(created.resolved, true);
  const prepared = prepareNativeTrackResource(created.value);
  assert.equal(prepared.resolved, true);
  return created.value;
}

test("concrete ModelPick emits actual resource / inherited gBlack and absolute record indices", () => {
  const r = makeResource(0);
  const state = actors([raw("column"), raw("additional")], r);
  const black = { name: "M14.MAT", flags: 5 };
  const result = find(
    input({
      columns: [[state.roots[0]]],
      additionalActors: known(state.roots[1]),
      blackMaterial: known(black),
      providers: createNativeFindFacesProviders((identity) =>
        known(identity === r ? r : null),
      ),
    }),
  );
  assert.equal(result.resolved, true, result.requiredProvider);
  assert.deepEqual(
    result.rows.map((row) => row.recordIndex),
    [0, 1],
  );
  for (const row of result.rows) {
    assert.equal(row.sourceModel, r);
    assert.equal(row.model, r);
    assert.equal(row.material, black);
    assert.equal(row.nativeFaceIndex, 0);
  }
});

test("transformed exact emission calls stop once, emitModels false still calls pull", () => {
  const r = makeResource();
  const state = actors([raw("&rock"), raw("&1")], r);
  const events = [];
  const result = find(
    input({
      columns: [[state.roots[0]]],
      providers: createNativeFindFacesProviders(() => known(r)),
      worldCallbacks: known({
        stopGroovidelic: (actor) => events.push(actor.name),
      }),
    }),
  );
  assert.equal(result.resolved, true, result.requiredProvider);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(events, ["&rock"]);
  const disabled = find(
    input({
      columns: [[state.roots[1]]],
      emitModels: false,
      worldCallbacks: known({
        pullActorFromWorld: (actor) => {
          events.push(`pull ${actor.name}`);
          return known(null);
        },
      }),
    }),
  );
  assert.equal(disabled.rows.length, 0);
  assert.deepEqual(events, ["&rock", "pull &1"]);
});

test("pling outlet delegates literal ! material and does not clear retained state on empty query", () => {
  const r = makeResource(1, "safe water MODEL", {
    name: "!safe invented water",
    flags: 0x1800,
  });
  const state = actors([raw("column")], r);
  let pling = { old: true };
  const providers = createNativeFindFacesProviders(() => known(r), {
    writePlingFace: (row) => {
      pling = row;
    },
  });
  const result = find(input({ columns: [[state.roots[0]]], providers }));
  assert.equal(result.resolved, true, result.requiredProvider);
  assert.equal(pling, result.rows[0]);
  const retained = pling;
  find(input({ providers }));
  assert.equal(pling, retained);
});

test("missing providers are diagnostics rather than MODEL preparation or MAT fallback", () => {
  const r = makeResource();
  const state = actors([raw("column")], r);
  const providers = createNativeFindFacesProviders(() => known(r));
  r.revision++;
  const result = find(input({ columns: [[state.roots[0]]], providers }));
  assert.equal(result.resolved, false);
  assert.match(result.requiredProvider, /prepared/);
  const blackMissing = find(
    input({
      columns: [[state.roots[0]]],
      blackMaterial: { resolved: false, requiredProvider: "actual gBlack MAT" },
    }),
  );
  assert.equal(blackMissing.resolved, false);
  assert.equal(blackMissing.requiredProvider, "actual gBlack MAT");
});

test("invalid bounds, matrix, grid and capacities fail explicitly", () => {
  assert.throws(() => query(box(1, -1), I), /reversed/);
  assert.throws(() => query(box(), I.slice(1)), /twelve/);
  assert.throws(
    () =>
      query(
        box(),
        I.map(() => Infinity),
      ),
    /finite/,
  );
  assert.throws(
    () => column(0, 0, { ...layout(), countX: 0 }),
    /unsigned-byte/,
  );
  assert.throws(
    () => column(0, 0, { ...layout(), countZ: 256 }),
    /unsigned-byte/,
  );
  assert.throws(
    () => column(0, 0, { ...layout(), columnSizeX: 0 }),
    /positive/,
  );
  assert.throws(() => find(input({ capacity: -1 })), /signed32/);
  assert.throws(() => find(input({ columns: [] })), /retained grid/);
  assert.throws(
    () => find(input({ additionalActors: undefined })),
    /explicit additional/,
  );
  assert.throws(() => find(input({ emitModels: undefined })), /explicit/);
  assert.throws(() => find(input({ blackMaterial: undefined })), /bindings/);
  assert.throws(() => find(input({ worldCallbacks: undefined })), /bindings/);
});

for (const dataRoot of ["data", "adv_data"]) {
  test(`${dataRoot} original Newcity prepared one-MAT models retain real face prefixes across columns`, async (t) => {
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
    const prefix = `${dataRoot}/races/newcity1/`;
    const files = store.manifest.filter(
      (entry) =>
        entry.path.toLowerCase().startsWith(prefix) &&
        !entry.path.slice(prefix.length).includes("/"),
    );
    if (files.length === 0) {
      t.skip(`Original ${dataRoot} Newcity resources unavailable`);
      return;
    }
    const key = (name) => name.replace(/\.(mat|dat)$/i, "").toLowerCase();
    const materials = new Map();
    for (const entry of files.filter((e) => /\.mat$/i.test(e.path)))
      for (const mat of parseMat(await store.read(entry.path)))
        materials.set(key(mat.name), mat);
    let verified = 0;
    for (const entry of files.filter((e) => /\.dat$/i.test(e.path))) {
      for (const model of parseDat(await store.read(entry.path))) {
        const created = createNativeTrackModelResource(
          model,
          (name) =>
            materials.has(key(name))
              ? known(materials.get(key(name)))
              : { resolved: false, requiredProvider: `MAT:${name}` },
          4,
        );
        assert.equal(created.resolved, true);
        const r = created.value;
        const prepared = prepareNativeTrackResource(r);
        if (!prepared.resolved || !prepared.value.faces.length) continue;
        const state = actors(
          [raw("actual resource column"), raw("actual resource additional")],
          r,
        );
        const limit = Math.min(prepared.value.faces.length, 7);
        const plingWrites = [];
        const result = find(
          input({
            bounds: box(-1e5, 1e5),
            columns: [[state.roots[0]]],
            additionalActors: known(state.roots[1]),
            blackMaterial: known({
              name: "invented test gBlack identity",
              flags: 5,
            }),
            capacity: limit + 1,
            providers: createNativeFindFacesProviders(() => known(r), {
              writePlingFace: (row) => plingWrites.push(row),
            }),
          }),
        );
        assert.equal(result.resolved, true, result.requiredProvider);
        const n = Math.min(prepared.value.faces.length * 2, limit + 1);
        assert.equal(result.rows.length, n);
        assert.deepEqual(
          result.rows.map((row) => row.recordIndex),
          Array.from({ length: n }, (_, i) => i),
        );
        assert.deepEqual(
          result.rows
            .slice(0, Math.min(n, prepared.value.faces.length))
            .map((row) => row.nativeFaceIndex),
          prepared.value.faces.slice(0, n).map((face) => face.nativeFaceIndex),
        );
        for (const row of result.rows) assert.equal(row.sourceModel, r);
        for (const row of plingWrites) {
          assert.ok(result.rows.includes(row));
          assert.ok(row.material.name.startsWith("!"));
        }
        verified++;
        if (verified === 8) break;
      }
      if (verified === 8) break;
    }
    assert.equal(verified, 8);
    t.diagnostic(
      "Eight original prepared MODEL resources; invented column placement and explicit capture gBlack, no native MAT pointer ranks inferred",
    );
  });
}
