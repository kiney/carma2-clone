import assert from "node:assert/strict";
import test from "node:test";
import { createAssetStore } from "../server/assets.mjs";
import {
  rescanNativePedProximity,
  readNativePedProximityState,
  nativePedProximityPlaneContains,
} from "../src/ped-native-proximity.ts";
import { NativePedProcessCachePool } from "../src/ped-process-cache.ts";
import {
  parsePedForm,
  parsePedRemap,
  parsePedPersonalitySimpleBody,
} from "../src/ped-form.ts";
import { decodeText } from "../src/formats.ts";

const f = Math.fround;
function setup() {
  const material = {},
    model = {},
    storage = new Uint8Array(300),
    view = new DataView(storage.buffer);
  const vector = (offset, values) =>
    values.forEach((n, i) => view.setFloat32(offset + 4 * i, n, true));
  vector(0, [9, 8, 7]);
  vector(0x30, [1, 2, 3]);
  vector(0x3c, [4, 5, 6]);
  vector(0xa4, [7, 8, 9]);
  view.setUint8(0x18, 255);
  view.setFloat32(0xbc, 123, true);
  const floor = {
    a: [0, 0, 0],
    b: [1, 0, 0],
    c: [0, 0, 1],
    normal: [0, 1, 0],
    constant: 0,
    material,
    materialFlags: 0,
    nativeGroup: -1,
    nativeFace: 0,
  };
  const face = {
    ...floor,
    a: [2, -1, -1],
    b: [2, 1, -1],
    c: [2, 1, 1],
    normal: [-1, 0, 0],
    constant: -2,
  };
  const process = {
    storage,
    faceCache: { faces: [face], selectedFace: floor },
  };
  const input = {
    process,
    rootPosition: [0, 0.5, 0],
    characterDirection: [1, 0, 0],
    direction: [1, 0, 0],
    personalityBoundsMaxX: 1,
    cosMaxSlope: 0.7,
    action: 0,
    suicidal: false,
    exclusionSpec: null,
    readIndexedFace: (face) => ({
      kind: "indexed",
      value: { model, group: face.nativeGroup, indices: [0, 1, 2] },
    }),
  };
  return { material, model, storage, view, floor, face, process, input };
}
const scan = (ctx) => rescanNativePedProximity(ctx.input);
const numbers = (actual, expected) =>
  assert.deepEqual(
    actual.map((n) => (n === 0 ? 0 : n)),
    expected,
  );

test("installed synthetic front/back and in-place two-sided wall captures", () => {
  for (const kind of ["front", "back", "two-sided"]) {
    const ctx = setup();
    if (kind !== "front") {
      ctx.face.normal = [1, 0, 0];
      ctx.face.constant = 2;
    }
    if (kind === "two-sided") ctx.face.materialFlags = 0x1000;
    const actual = scan(ctx);
    assert.equal(actual.status, "complete");
    assert.equal(actual.distance, 2);
    assert.equal(actual.state.flags, kind === "back" ? 0xf5 : 0xf6);
    numbers(actual.state.floorNormal, [0, 1, 0]);
    numbers(actual.state.retainedDirection, [1, 0, 0]);
    numbers(actual.state.velocity, [0, 0, 0]);
    numbers(actual.state.position, [2, 0.5, 0]);
    numbers(actual.state.normal, kind === "back" ? [1, 0, 0] : [-1, 0, 0]);
    assert.equal(actual.state.distanceSquared, 4);
    assert.equal(actual.mutatedFaces.length, kind === "two-sided" ? 1 : 0);
    if (kind === "two-sided") {
      assert.equal(actual.mutatedFaces[0], ctx.face);
      assert.deepEqual(ctx.face.normal, [-1, -0, -0]);
      assert.equal(ctx.face.constant, -2);
    }
  }
});
test("installed NULL slot/selected pointer early returns do not alter any byte", () => {
  for (const missing of ["slot", "selected"]) {
    const ctx = setup(),
      before = ctx.storage.slice();
    if (missing === "slot") ctx.process.faceCache = null;
    else ctx.process.faceCache.selectedFace = null;
    ctx.input.direction = [NaN, 0, 0];
    assert.equal(scan(ctx).distance, 10000);
    assert.deepEqual(ctx.storage, before);
  }
});
test("installed count-zero still stores copied floor/direction and 0xf4; retained contact fields survive", () => {
  for (const direction of [
    [0, 0, 0],
    [0, 1, 0],
  ]) {
    const ctx = setup();
    ctx.process.faceCache.faces = [];
    ctx.input.direction = direction;
    const actual = scan(ctx);
    assert.equal(actual.distance, 10000);
    assert.equal(actual.state.flags, 0xf4);
    numbers(
      actual.state.retainedDirection,
      direction[1] ? direction : [1, 0, 0],
    );
    numbers(actual.state.floorNormal, [0, 1, 0]);
    numbers(actual.state.velocity, [1, 2, 3]);
    numbers(actual.state.position, [4, 5, 6]);
    numbers(actual.state.normal, [7, 8, 9]);
    assert.equal(actual.state.distanceSquared, 123);
  }
});
test("installed retained bit4 commits wall even if upper plane rejects every vertex", () => {
  const ctx = setup();
  ctx.view.setUint8(0x18, 4);
  ctx.face.normal = [1, 0, 0];
  ctx.face.constant = 2;
  ctx.face.a = [2, 1, -1];
  ctx.face.b = [2, 2, -1];
  ctx.face.c = [2, 2, 1];
  const actual = scan(ctx);
  assert.equal(actual.distance, 2);
  assert.equal(actual.state.flags, 4);
  numbers(actual.state.position, [2, 0.5, 0]);
  ctx.view.setUint8(0x18, 0);
  assert.equal(scan(ctx).distance, 10000);
});
function excluded(
  ctx,
  vertices = [
    [2, 0, -1],
    [2, 0, 1],
    [4, 0, 0],
  ],
) {
  ctx.view.setUint8(0x18, 0);
  Object.assign(ctx.face, {
    a: [2, 0, -1],
    b: [2, 0, 1],
    c: [4, 0, 0],
    normal: [0, 1, 0],
    constant: 0,
    nativeGroup: 0,
  });
  ctx.input.exclusionSpec = {
    exclusionsOkWhenRunning: false,
    exclusions: [{ material: ctx.material, flags: 1 }],
    exceptions: [],
  };
  ctx.input.readPreparedGroupVertices = () => ({ kind: "vertices", vertices });
}
test("installed excluded-floor edge capture uses prepared local vertices, not cached world triangle", () => {
  for (const x of [2, 10]) {
    const ctx = setup();
    excluded(ctx, [
      [x, 0, -1],
      [x, 0, 1],
      [x + 2, 0, 0],
    ]);
    const actual = scan(ctx);
    assert.equal(actual.distance, x);
    assert.equal(actual.state.flags, 8);
    numbers(actual.state.position, [x, 0.5, 0]);
    numbers(actual.state.normal, [0, 0, -1]);
    assert.equal(actual.state.distanceSquared, x * x);
  }
});
test("floor selection requires actual MAT identity and authored running exclusions", () => {
  for (const alteration of [
    "suicidal",
    "running",
    "all-running",
    "other-identity",
  ]) {
    const ctx = setup();
    excluded(ctx);
    if (alteration === "suicidal") ctx.input.suicidal = true;
    if (alteration === "running") ctx.input.action = 1;
    if (alteration === "all-running") {
      ctx.input.action = 1;
      ctx.input.exclusionSpec.exclusions[0].flags = 0;
      ctx.input.exclusionSpec.exclusionsOkWhenRunning = true;
    }
    if (alteration === "other-identity")
      ctx.input.exclusionSpec.exclusions[0].material = {};
    assert.equal(scan(ctx).distance, 10000);
  }
  const ctx = setup();
  excluded(ctx);
  ctx.input.action = 1;
  ctx.input.exclusionSpec.exclusions[0].flags = 0;
  assert.equal(scan(ctx).distance, 2);
});
test("negative prepared group storage and missing providers cannot silently substitute geometry", () => {
  for (const alteration of [
    "negative-group",
    "missing-edges",
    "missing-indices",
    "missing-material",
  ]) {
    const ctx = setup();
    excluded(ctx);
    if (alteration === "negative-group") ctx.face.nativeGroup = -1;
    if (alteration === "missing-edges")
      delete ctx.input.readPreparedGroupVertices;
    if (alteration === "missing-indices") delete ctx.input.readIndexedFace;
    if (alteration === "missing-material") {
      ctx.face.normal = [1, 0, 0];
      ctx.face.constant = 2;
      ctx.face.material = null;
    }
    const before = ctx.storage.slice(),
      normal = [...ctx.face.normal],
      actual = scan(ctx);
    assert.equal(actual.status, "provider-required");
    assert.deepEqual(ctx.storage, before);
    assert.deepEqual(ctx.face.normal, normal);
    assert.equal(actual.mutatedFaces.length, 0);
  }
});
test("provider preflight failure after a two-sided candidate commits neither face nor process", () => {
  const ctx = setup();
  ctx.face.normal = [1, 0, 0];
  ctx.face.constant = 2;
  ctx.face.materialFlags = 0x1000;
  const second = { ...ctx.face, nativeFace: 1 };
  ctx.process.faceCache.faces.push(second);
  ctx.input.readIndexedFace = (face) =>
    face === second
      ? { kind: "provider-required", requiredProvider: "actual-second-model" }
      : {
          kind: "indexed",
          value: { model: ctx.model, group: -1, indices: [0, 1, 2] },
        };
  const before = ctx.storage.slice();
  const actual = scan(ctx);
  assert.equal(actual.status, "provider-required");
  assert.deepEqual(ctx.storage, before);
  assert.deepEqual(ctx.face.normal, [1, 0, 0]);
  assert.equal(ctx.face.constant, 2);
});
test("native 16 MODEL/group scratch keys and 512 vertex outcodes retain same-MODEL alias behavior", () => {
  const ctx = setup();
  ctx.view.setUint8(0x18, 0);
  const first = { ...ctx.face, a: [2, -1, -1], b: [2, -1, -1], c: [2, -1, -1] };
  const second = { ...ctx.face, a: [2, 1, -1], b: [2, 1, -1], c: [2, 1, -1] };
  ctx.process.faceCache.faces = [first, second];
  assert.equal(
    scan(ctx).distance,
    10000,
    "second ACT's shared MODEL/group vertices reuse first floor outcodes",
  );
  ctx.input.readIndexedFace = (face) => ({
    kind: "indexed",
    value: { model: ctx.model, group: -1, indices: [512, 513, 514] },
  });
  assert.equal(
    scan(ctx).distance,
    2,
    "indices512+ are calculated without scratch cache",
  );
  ctx.view.setUint8(0x18, 0);
  const models = Array.from({ length: 17 }, () => ({})),
    rows = models.map(() => ({ ...first }));
  rows.push({ ...second });
  ctx.process.faceCache.faces = rows;
  ctx.input.readIndexedFace = (face) => ({
    kind: "indexed",
    value: {
      model: models[Math.min(rows.indexOf(face), 16)],
      group: -1,
      indices: [0, 1, 2],
    },
  });
  assert.equal(
    scan(ctx).distance,
    2,
    "seventeenth MODEL key has no cached alias",
  );
});
test("wall t20 is inclusive, later equal wall owns output; stored D remains authoritative", () => {
  const ctx = setup();
  ctx.face.constant = -20;
  assert.equal(
    scan(ctx).distance,
    20,
    "D need not equal normal dot cached vertex",
  );
  ctx.face.constant = -f(20 + 2 ** -19);
  assert.equal(scan(ctx).distance, 10000);
  ctx.face.constant = -2;
  const second = { ...ctx.face, normal: [-2, 0, 0], constant: -4 };
  ctx.process.faceCache.faces.push(second);
  numbers(scan(ctx).state.normal, [-2, 0, 0]);
});
test("excluded edge above20 writes best and unnormalized normal before maximum gate", () => {
  const ctx = setup();
  excluded(ctx, [
    [21, 0, -2],
    [21, 0, 2],
    [23, 0, 0],
  ]);
  const actual = scan(ctx);
  assert.equal(actual.distance, 21);
  assert.equal(actual.state.flags, 0);
  numbers(actual.state.normal, [0, 0, -4]);
  numbers(actual.state.position, [4, 5, 6]);
  assert.equal(actual.state.distanceSquared, 123);
});
test("direction epsilon strict equality, global-Y lateral and exact inclusive plane checks", () => {
  const ctx = setup();
  ctx.process.faceCache.faces = [];
  ctx.input.direction = [0, 0, 2 ** -22];
  numbers(scan(ctx).state.retainedDirection, [1, 0, 0]);
  ctx.input.direction = [0, 0, f(2 ** -22 + 2 ** -45)];
  numbers(scan(ctx).state.retainedDirection, [0, 0, 1]);
  assert.equal(nativePedProximityPlaneContains([1, 2, 3], [0, 0, 0], 99), true);
  assert.equal(nativePedProximityPlaneContains([0, 1, 0], [0, 1, 0], 1), true);
  assert.equal(
    nativePedProximityPlaneContains([0, f(1 - 2 ** -24), 0], [0, 1, 0], 1),
    false,
  );
  const slope = setup();
  slope.floor.normal = [0, 0.8, 0.6];
  slope.face.a = [2, -1, 1.2];
  slope.face.b = [2, 1, 1.2];
  slope.face.c = [2, 1, 1.3];
  assert.equal(
    scan(slope).distance,
    2,
    "globalY gives horizontal strip despite inclined selected floor",
  );
});
test("actual bounded process pool storage is canonical and unrelated recycled bytes remain intact", () => {
  const ctx = setup(),
    owner = {},
    links = new Map();
  const pool = new NativePedProcessCachePool({
    readCache: (ped) => links.get(ped) ?? null,
    writeCache: (ped, cache) => links.set(ped, cache),
  });
  const visit = pool.visit(owner, {
    timeMs: 1,
    replay: false,
    minTurnIntervalMs: 0,
    maxTurnIntervalMs: 0,
    spurtingPeriodMs: 100,
  });
  const process = visit.cache;
  process.faceCache = ctx.process.faceCache;
  process.storage.fill(0xa5);
  process.storage[0x18] = 255;
  const before = process.storage.slice();
  ctx.input.process = process;
  const actual = scan(ctx);
  numbers(process.floorNormal, [0, 1, 0]);
  numbers(process.retainedDirection, [1, 0, 0]);
  assert.equal(actual.state.flags, 0xf6);
  assert.deepEqual(readNativePedProximityState(process), actual.state);
  const changed = new Set([
    ...Array(24).keys(),
    0x18,
    ...Array.from({ length: 24 }, (_, i) => 0x30 + i),
    ...Array.from({ length: 12 }, (_, i) => 0xa4 + i),
    ...Array.from({ length: 4 }, (_, i) => 0xbc + i),
  ]);
  before.forEach((n, i) => {
    if (!changed.has(i))
      assert.equal(process.storage[i], n, `unspecified byte${i.toString(16)}`);
  });
});
test("typed invalid source face skips; invalid Float32/identity/count inputs reject", () => {
  const ctx = setup();
  ctx.input.readIndexedFace = () => ({ kind: "invalid-face" });
  assert.equal(scan(ctx).distance, 10000);
  for (const value of [Infinity, 1e50, NaN]) {
    const c = setup();
    c.input.personalityBoundsMaxX = value;
    assert.throws(() => scan(c), /Float32/);
  }
  const short = setup();
  short.input.process.storage = new Uint8Array(299);
  assert.throws(() => scan(short), /300-byte/);
  const identity = setup();
  identity.face.material = "brick";
  assert.throws(() => scan(identity), /MAT identity/);
  const count = setup();
  count.process.faceCache.faces = Array(256).fill(count.face);
  assert.throws(() => scan(count), /BYTE/);
});

test("1,000 invented seeded installed captures: 23,000 fields and signed-zero digest", () => {
  // This seed describes invented inputs, not proprietary geometry. The digest
  // was obtained by calling installed4cf860 in a private read-only PE mapping.
  let seed = 0x32b77,
    hash = 2166136261,
    accepted = 0;
  const random = () =>
      (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296,
    span = (a, b) => f(a + (b - a) * random());
  for (let id = 0; id < 1000; id++) {
    const isFloor = id % 4 === 0,
      root = [span(-10, 10), span(0.1, 1), span(-10, 10)],
      dir = [span(-1, 1), span(-0.2, 0.2), span(-1, 1)],
      geometry = Array.from({ length: 9 }, () => span(-12, 12)),
      normal = isFloor
        ? [0, 1, 0]
        : [span(-1, 1), span(-0.4, 0.4), span(-1, 1)],
      floorNormal = [span(-0.15, 0.15), span(0.7, 1), span(-0.15, 0.15)],
      d = span(-10, 10),
      floorD = span(-0.2, 0.2),
      width = span(0.02, 2),
      local = geometry.map((v) => f(v + span(-2, 2))),
      ctx = setup();
    ctx.view.setUint8(0x18, id % 6 ? 0 : 255);
    Object.assign(ctx.face, {
      a: geometry.slice(0, 3),
      b: geometry.slice(3, 6),
      c: geometry.slice(6, 9),
      normal,
      constant: d,
      nativeGroup: isFloor ? 0 : -1,
      materialFlags: id % 3 ? 0 : 4096,
    });
    Object.assign(ctx.floor, { normal: floorNormal, constant: floorD });
    Object.assign(ctx.input, {
      rootPosition: root,
      characterDirection: dir,
      direction: id % 2 ? null : dir,
      personalityBoundsMaxX: width,
      action: id % 5 ? 0 : 1,
      suicidal: id % 9 === 0,
      exclusionSpec: {
        exclusionsOkWhenRunning: false,
        exclusions: [{ material: ctx.material, flags: id % 2 }],
        exceptions: [],
      },
      readPreparedGroupVertices: () => ({
        kind: "vertices",
        vertices: [local.slice(0, 3), local.slice(3, 6), local.slice(6, 9)],
      }),
    });
    const actual = scan(ctx),
      state = actual.state;
    assert.equal(actual.status, "complete");
    if (actual.distance < 10000) accepted++;
    const output = [
        id,
        actual.distance,
        state.flags,
        12345,
        ...state.floorNormal,
        ...state.retainedDirection,
        ...state.velocity,
        ...state.position,
        ...state.normal,
        state.distanceSquared,
        ...ctx.face.normal,
        ctx.face.constant,
      ],
      bytes = new Uint8Array(96),
      packed = new DataView(bytes.buffer);
    output.forEach((v, i) =>
      [0, 2, 3].includes(i)
        ? packed.setUint32(i * 4, v, true)
        : packed.setFloat32(i * 4, v, true),
    );
    bytes.forEach((byte) => {
      hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    });
  }
  assert.equal(accepted, 220);
  assert.equal(hash, 0x3ca802c0);
});

test("original Stock/Advanced authored human and dog widths drive the finite source strip", async (t) => {
  const root =
    process.env.CARMA2_ROOT ??
    new URL("../carma2_orig/", import.meta.url).pathname;
  let store;
  try {
    store = await createAssetStore(root);
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Original installation absent");
      return;
    }
    throw error;
  }
  // No proprietary fixture is copied: read the source personality text locally.
  for (const prefix of ["data", "adv_data"]) {
    for (const [name, form] of [
      ["Blokebl", "BIPED1"],
      ["Bandsman", "BIPED1"],
      ["twolf", "DOG1"],
    ]) {
      const text = await store.read(`${prefix}/PEDS/PEEPS/${name}/${name}.TXT`),
        formText = await store.read(`${prefix}/PEDS/FORMS/${form}.TXT`);
      assert.ok(
        text && formText,
        `original ${prefix}/${name} personality and FORM`,
      );
      const remap = await store.read(
        `${prefix}/PEDS/REMAPS/${form === "DOG1" ? "DOG" : "MAN"}.TXT`,
      );
      assert.ok(remap);
      const personality = parsePedPersonalitySimpleBody(
          decodeText(text),
          parsePedForm(decodeText(formText)),
          parsePedRemap(decodeText(remap)),
        ),
        width = personality.bounds.max[0];
      const ctx = setup();
      ctx.input.personalityBoundsMaxX = width;
      const near = f(width * 1.3 - 2 ** -20),
        far = f(width * 1.3 + 2 ** -20);
      ctx.face.a = [2, -1, near];
      ctx.face.b = [2, 1, near];
      ctx.face.c = [2, 1, near];
      assert.equal(scan(ctx).distance, 2);
      ctx.face.a = [2, -1, far];
      ctx.face.b = [2, 1, far];
      ctx.face.c = [2, 1, far];
      assert.equal(scan(ctx).distance, 10000);
    }
  }
});
