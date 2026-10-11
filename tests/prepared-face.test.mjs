import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createAssetStore } from "../server/assets.mjs";
import { parseDat } from "../src/formats.ts";
import { createModelGeometry } from "../src/render-geometry.ts";
import { captureWorldSource } from "../src/world-source.ts";
import { emitNativePreparedFace as emit } from "../src/physics/prepared-face.ts";
import { prepareNativeModelFacePlane as plane } from "../src/physics/prepared-plane.ts";
import { nativeCheckSingleFace } from "../src/physics/single-face.ts";

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function source(options = {}) {
  const geometry = new THREE.BufferGeometry();
  geometry.userData.sourcePositions = new Float32Array(
    options.positions ?? [0, 0, 4, 0, 1, 4, 1, 0, 4],
  );
  geometry.userData.c2Pivot = options.pivot ?? [0, 0, 0];
  const vertices = [0, 1, 2].map((i) =>
    Array.from(geometry.userData.sourcePositions.subarray(i * 3, i * 3 + 3)),
  );
  return {
    geometry,
    sourceFaceIndex: 0,
    sourceFace: { indices: [0, 1, 2], flags: options.rawFlags ?? 0xe5 },
    effectiveTrackModelFlags: options.modelFlags ?? 0x80,
    nativeModelPlane: options.plane ?? plane(...vertices),
  };
}
function face(s, pMat = null, extra = {}) {
  const result = emit({
    source: s,
    pMat,
    material: { kind: "null" },
    ...extra,
  });
  assert.equal(result.kind, "emitted");
  return result.face;
}

test("NULL retains original D while identity recomputes it from the stored clamped normal", () => {
  const s = source();
  const original = face(s),
    transformed = face(s, identity);
  assert.equal(original.constant, -4);
  assert.equal(transformed.constant, -3.999999523162842);
  assert.deepEqual(original.normal, [0, 0, -0.9999998807907104]);
  assert.deepEqual(original.a, transformed.a);
  assert.equal(original.source, s);
  assert.equal(original.rawFlags, 0xe5);
});

test("pivot subtraction is a separate Float32 store and does not recompute the NULL plane", () => {
  const s = source({ pivot: [0.125, 0.25, 1.5] });
  assert.deepEqual(face(s).a, [-0.125, -0.25, 2.5]);
  assert.equal(face(s).constant, -4);
  assert.equal(face(s, identity).constant, -2.499999761581421);
  const negativeZero = source({
    positions: [-0, -0, -0, 1, 0, 0, 0, 1, 0],
    plane: { normal: [-0, -0, -0], d: -0, degenerate: true },
  });
  assert.ok(face(negativeZero).a.every((n) => Object.is(n, -0)));
  assert.ok(face(negativeZero).normal.every((n) => Object.is(n, -0)));
  assert.ok(Object.is(face(negativeZero).constant, -0));
  // ApplyV has no extra +0, which would erase this source signed zero.
  const positiveBasis = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0];
  assert.ok(
    face(negativeZero, positiveBasis).normal.every((n) => Object.is(n, -0)),
  );
});

test("native basis rows transform points and normals independently without normalization", () => {
  const s = source({
    positions: [1, 2, 3, 2, 2, 3, 1, 3, 3],
    plane: { normal: [0, 0, 1], d: 3, degenerate: false },
  });
  const rotation = [0, 1, 0, -1, 0, 0, 0, 0, 1, 10, 20, 30];
  assert.deepEqual(face(s, rotation).a, [8, 21, 33]);
  assert.deepEqual(face(s, rotation).normal, [0, 0, 1]);
  const shear = [2, 1, 0, 0, 3, 0, 4, 0, 5, 10, 20, 30];
  const result = face(s, shear);
  assert.deepEqual(result.a, [24, 27, 45]);
  assert.deepEqual(result.normal, [4, 0, 5]);
  assert.equal(result.constant, 321);
  assert.ok(Math.hypot(...result.normal) > 1);
});

test("installed sheared emission fixture captures native arithmetic association and final spills", () => {
  const s = source({
    positions: [
      42.89826202392578, 78.4180908203125, -86.01111602783203,
      -5.292678356170654, 51.63637161254883, 77.91236877441406,
      -65.69497680664062, -83.94076538085938, -51.98313522338867,
    ],
    pivot: [1.044411540031433, 1.5305074453353882, 0.3072071671485901],
    plane: {
      normal: [-0.7240241765975952, 0.08850427716970444, 0.052541639655828476],
      d: -131.48825073242188,
      degenerate: false,
    },
    modelFlags: 0,
  });
  const result = face(
    s,
    [
      -18.523027420043945, 7.161261558532715, -11.828987121582031,
      4.74407958984375, 8.782439231872559, -1.5924427509307861,
      -11.383081436157227, -14.62816047668457, -9.69717788696289,
      14.082476615905762, 3.2923364639282227, -14.18915843963623,
    ],
    { preparedEdges: [0, 0, 0] },
  );
  assert.deepEqual(
    [
      ...result.a,
      ...result.b,
      ...result.c,
      ...result.normal,
      result.constant,
      result.rawFlags,
    ],
    [
      586.1517333984375, 2240.95751953125, 205.3272247314453, -514.215087890625,
      -737.25830078125, -771.569580078125, 1440.0406494140625,
      -460.380615234375, 1418.447021484375, 13.232905387878418,
      -5.176230430603027, 7.914029121398926, -2218.25634765625, 7,
    ],
  );
});

test("updateable flags copy the full original byte; other models require actual prepared edges", () => {
  const s = source({ rawFlags: 0xff });
  assert.equal(face(s, null, { preparedEdges: [1, 1, 1] }).rawFlags, 0xff);
  s.effectiveTrackModelFlags = 0;
  assert.equal(
    emit({ source: s, pMat: null, material: { kind: "null" } }).kind,
    "unresolved",
  );
  assert.equal(face(s, null, { preparedEdges: [0, 17, 0xffff] }).rawFlags, 1);
  assert.equal(face(s, null, { preparedEdges: [9, 0, 0] }).rawFlags, 6);
});

test("native NULL and present NULL-identifier materials retain distinct single-face side gates", () => {
  const s = source({
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    plane: { normal: [0, 0, 1], d: 0, degenerate: false },
  });
  s.materialName = "!render-fallback";
  const query = {
    origin: [0.25, 0.25, -1],
    segment: [0, 0, 2],
    excludePlingMaterials: true,
  };
  assert.ok(nativeCheckSingleFace(face(s), query));
  const present = face(s, null, {
    material: { kind: "present", identifier: null, flags: 0 },
  });
  assert.equal(present.materialFlags, 0);
  assert.equal(nativeCheckSingleFace(present, query), null);
  const doubleSided = face(s, null, {
    material: { kind: "present", identifier: "road", flags: 0x1800 },
  });
  assert.ok(nativeCheckSingleFace(doubleSided, query));
  const excluded = face(s, null, {
    material: { kind: "present", identifier: "!road", flags: 0x1800 },
  });
  assert.equal(nativeCheckSingleFace(excluded, query), null);
});

test("missing source metadata stays unresolved and malformed supplied values fail explicitly", () => {
  for (const [field, value] of [
    ["sourceFaceIndex", null],
    ["sourceFace", null],
    ["nativeModelPlane", null],
    ["effectiveTrackModelFlags", null],
  ]) {
    const s = source();
    s[field] = value;
    assert.equal(
      emit({ source: s, pMat: null, material: { kind: "null" } }).kind,
      "unresolved",
    );
  }
  for (const key of ["sourcePositions", "c2Pivot"]) {
    const s = source();
    delete s.geometry.userData[key];
    assert.equal(
      emit({ source: s, pMat: null, material: { kind: "null" } }).kind,
      "unresolved",
    );
  }
  assert.equal(
    emit({ source: source(), material: { kind: "null" } }).kind,
    "unresolved",
  );
  assert.equal(
    emit({
      source: source(),
      pMat: null,
      material: {
        kind: "unresolved",
        reason: "native material inheritance unavailable",
      },
    }).kind,
    "unresolved",
  );
  assert.throws(() => face(source(), [1, 2, 3]), /12-component/);
  assert.throws(
    () =>
      face(
        source(),
        identity.map(() => Infinity),
      ),
    /finite Float32/,
  );
  assert.throws(() => face(source({ rawFlags: 256 })), /raw face flags/);
  assert.throws(
    () => face(source({ modelFlags: 0 }), null, { preparedEdges: [0, -1, 0] }),
    /edge index/,
  );
  assert.throws(
    () =>
      face(source(), null, {
        material: { kind: "present", identifier: null, flags: -1 },
      }),
    /material flags/,
  );
});

test("Stock and Advanced original indexed track snapshots supply retained emission metadata", async (t) => {
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
  for (const root of ["data", "adv_data"]) {
    const bytes = await store.read(`${root}/RACES/newcity1/newcity1.dat`);
    assert.ok(bytes);
    const models = parseDat(bytes)
      .filter((m) => m.faces.length)
      .slice(0, 8);
    assert.equal(models.length, 8);
    for (const model of models) {
      const group = new THREE.Group();
      group.add(
        new THREE.Mesh(
          createModelGeometry(model),
          new THREE.MeshBasicMaterial(),
        ),
      );
      const snapshot = captureWorldSource(group, { modelPreparation: "track" });
      assert.equal(snapshot.triangles.length, model.faces.length);
      for (const source of snapshot.triangles) {
        const result = face(source);
        assert.equal(result.source, source);
        assert.equal(
          result.rawFlags,
          model.faces[source.sourceFaceIndex].flags,
        );
        assert.equal(result.constant, source.nativeModelPlane.d);
        assert.deepEqual(result.normal, source.nativeModelPlane.normal);
      }
    }
  }
});
