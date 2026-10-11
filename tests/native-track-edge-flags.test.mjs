import test from "node:test";
import assert from "node:assert/strict";
import { createAssetStore } from "../server/assets.mjs";
import { parseDat, parseMat } from "../src/formats.ts";
import {
  prepareNativeTrackEdgeFlags as prepare,
  nativeTrackVertexWeldDistanceSquared as distance,
  nativeTrackSharedEdgeVolume as volume,
  NativeTrackEdgeFlagsError,
} from "../src/native-track-edge-flags.ts";

const F = Math.fround;
const face = (indices, flags = 0, material = null) => ({
  indices,
  flags,
  material,
});
const model = (positions, faces = [], modelFlags = 0) => ({
  positions: Float32Array.from(positions.flat()),
  faces,
  modelFlags,
});
const result = (m) => [...prepare(m).faceFlags];
const quad = () =>
  model(
    [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
    [face([0, 1, 2]), face([1, 3, 2])],
  );

test("installed quad marks earlier edge1 and later edge2; source records stay immutable", () => {
  const m = quad();
  m.faces[0].flags = 0x80;
  m.faces[1].flags = 0x40;
  m.modelFlags = 0x204;
  const before = structuredClone(m);
  const r = prepare(m);
  assert.deepEqual([...r.faceFlags], [0x82, 0x44]);
  assert.deepEqual([...r.vertexRepresentatives], [0, 1, 2, 3, 4]);
  assert.equal(r.modelFlags, 0x284);
  assert.equal(r.updateMask, 0x80);
  assert.deepEqual(m, before);
});

test("final vertex is initialized and one-face/empty MODEL still requests FACES update", () => {
  const r = prepare(model([[0, 0, 0]], [face([0, 0, 0], 0x90)]));
  assert.deepEqual([...r.vertexRepresentatives], [0, 1]);
  assert.deepEqual([...r.faceFlags], [0x90]);
  const empty = prepare(model([]));
  assert.deepEqual([...empty.vertexRepresentatives], [0]);
  assert.equal(empty.modelFlags, 0x80);
  assert.equal(empty.updateMask, 0x80);
});

test("weld uses strict stored threshold, overwrites later IDs, and is not transitive", () => {
  const close = F(0.00009999999),
    far = F(0.00010000001);
  const r = prepare(
    model([
      [0, 0, 0],
      [close, 0, 0],
      [far, 0, 0],
    ]),
  );
  assert.deepEqual([...r.vertexRepresentatives], [0, 1, 1, 3]);
  // Both independent earlier representatives reach vertex3; the latter write wins.
  assert.deepEqual(
    [
      ...prepare(
        model([
          [0, 0, 0],
          [F(0.00015), 0, 0],
          [F(0.000075), 0, 0],
        ]),
      ).vertexRepresentatives,
    ],
    [0, 1, 2, 2],
  );
  assert.deepEqual(
    [
      ...prepare(
        model([
          [0, 0, 0],
          [F(0.00009), 0, 0],
          [F(0.00018), 0, 0],
        ]),
      ).vertexRepresentatives,
    ],
    [0, 1, 1, 3],
  );
});

test("shared edge ignores UV/material identities and preserves both winding orders", () => {
  const p = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [1, 0, 0],
    [0, 1, 0],
  ];
  const first = face([0, 1, 2], 0, { flags: 0x800 });
  for (const [indices, expected] of [
    [
      [4, 3, 5],
      [2, 4],
    ],
    [
      [5, 3, 4],
      [2, 4],
    ],
  ])
    assert.deepEqual(
      result(model(p, [first, face(indices, 0, { flags: 0x80 })])),
      expected,
    );
});

test("conditional earlier flag uses signed volume and either raw TWO_SIDED material", () => {
  const run = (z, first = null, second = null) =>
    result(
      model(
        [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [0, -1, F(z)],
        ],
        [face([0, 1, 2], 0, first), face([1, 0, 3], 0, second)],
      ),
    );
  assert.deepEqual(run(-1), [0, 1]);
  assert.deepEqual(run(1), [1, 1]);
  assert.deepEqual(run(1, { flags: 0x1000 }), [0, 1]);
  assert.deepEqual(run(1, null, { flags: 0x1000 }), [0, 1]);
  // ALWAYS_VISIBLE alone is not TWO_SIDED.
  assert.deepEqual(run(1, { flags: 0x800 }), [1, 1]);
});

test("stored F32 volume is compared against literal double thresholds", () => {
  const run = (z) =>
    result(
      model(
        [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [0, -1, F(z)],
        ],
        [face([0, 1, 2]), face([1, 0, 3], 0, { flags: 0x1000 })],
      ),
    );
  for (const z of [-0.0001, 0.0001]) assert.deepEqual(run(z), [1, 1]);
  for (const z of [-0.000100001, 0.000100001]) assert.deepEqual(run(z), [0, 1]);
});

test("live differences and temporary F32 stores retain installed arithmetic", () => {
  const a = [F(16777216), F(16777216), F(16777216)],
    b = [-1, -1, -1];
  const d = 16777217;
  assert.equal(distance(a, b), d * 16777216 + d * 16777216 + d * d);
  assert.notEqual(distance(a, b), 3 * F(d) ** 2);
  assert.equal(
    volume([0, 0, 0], [1, 0, 0], [0, -1, F(0.0001)], [0, 1, 0]),
    F(0.0001),
  );
});

test("bad source bounds, raw material bindings and nonfinite native output fail explicitly", () => {
  for (const m of [
    model([[0, 0, 0]], [face([0, 1, 0])]),
    { positions: [0.1, 0, 0], faces: [], modelFlags: 0 },
    { positions: [0, 0], faces: [], modelFlags: 0 },
    model([[0, 0, 0]], [face([0, 0, 0], 256)]),
    model([[0, 0, 0]], [{ indices: [0, 0, 0], flags: 0, material: undefined }]),
    model([], [], -1),
  ])
    assert.throws(() => prepare(m), NativeTrackEdgeFlagsError);
  const huge = F(3e38);
  assert.throws(
    () =>
      prepare(
        model(
          [
            [0, 0, 0],
            [huge, 0, 0],
            [0, huge, 0],
            [0, -huge, huge],
          ],
          [face([0, 1, 2]), face([1, 0, 3])],
        ),
      ),
    /nonfinite volume/,
  );
});

let storePromise;
const captures = [
  ["newcity1", "5 12", 735, 505, 2778, 226099],
  ["Carrier_mission", "3 2", 1291, 859, 4689, 796730],
  ["Airport1", "7 9", 2150, 1264, 6255, 2171871],
];
for (const dataset of ["data", "adv_data"])
  for (const [
    track,
    name,
    vertexCount,
    faceCount,
    flagsSum,
    repSum,
  ] of captures)
    test(`${dataset} ${track} source MODEL edge flags match installed capture`, async (t) => {
      let store;
      try {
        store = await (storePromise ??= createAssetStore(
          process.env.CARMA2_ROOT || "carma2_orig",
        ));
      } catch (e) {
        if (/ENOENT|Original installation/.test(String(e))) {
          t.skip("Original installation unavailable");
          return;
        }
        throw e;
      }
      const prefix = `${dataset}/races/${track}/`.toLowerCase();
      const files = store.manifest.filter((p) =>
        p.path.toLowerCase().startsWith(prefix),
      );
      if (!files.length) {
        t.skip("Original track unavailable");
        return;
      }
      const materials = new Map();
      for (const p of files.filter((p) => /\.mat$/i.test(p.path)))
        for (const m of parseMat(await store.read(p.path)))
          materials.set(m.name.toLowerCase(), m);
      let source;
      for (const p of files.filter((p) => /\.dat$/i.test(p.path))) {
        source = parseDat(await store.read(p.path)).find(
          (m) => m.name === name,
        );
        if (source) break;
      }
      assert.ok(source, `actual MODEL ${name}`);
      assert.equal(source.positions.length / 3, vertexCount);
      assert.equal(source.faces.length, faceCount);
      const authored = source.faces.map((f) => f.flags);
      const faces = source.faces.map((f) => {
        const material =
          f.material === 0
            ? null
            : materials.get(source.materials[f.material - 1].toLowerCase());
        assert.notEqual(material, undefined, "actual raw MAT identity");
        return { ...f, material };
      });
      const r = prepare({
        positions: source.positions,
        faces,
        modelFlags: source.flags,
      });
      assert.equal(
        r.faceFlags.reduce((a, b) => a + b, 0),
        flagsSum,
      );
      assert.equal(
        r.vertexRepresentatives.reduce((a, b) => a + b, 0),
        repSum,
      );
      assert.ok(r.faceFlags.some((f, i) => f !== authored[i]));
      assert.deepEqual(
        source.faces.map((f) => f.flags),
        authored,
      );
      for (let i = 0; i < authored.length; i++)
        assert.equal(r.faceFlags[i] & authored[i], authored[i]);
    });
