import test from "node:test";
import assert from "node:assert/strict";
import { createAssetStore } from "../server/assets.mjs";
import { parseDat } from "../src/formats.ts";
import { migrateNativeTrackModel } from "../src/native-track-models.ts";
import { prepareNativeFaceOrder } from "../src/native-face-order.ts";
import { prepareNativeModelFacePlane } from "../src/physics/prepared-plane.ts";
import { emitNativePreparedIndexedFace as emit } from "../src/physics/prepared-face.ts";
import { nativeCheckSingleFace } from "../src/physics/single-face.ts";

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const material = { identifier: "road", flags: 0x1800 };
const outlets = {
  // These tests isolate migration/emission; no population creation is claimed.
  spawnPedsOnFace() {},
  copyVertexPayload: structuredClone,
  copyFacePayload: structuredClone,
};
function input(model, face, overrides = {}) {
  const positions = new Float32Array(model.vertices.flatMap((v) => v.position));
  const vertices = face.indices.map((i) =>
    Array.from(positions.subarray(i * 3, i * 3 + 3)),
  );
  return {
    positions,
    indices: face.indices,
    pivot: model.pivot ?? [0, 0, 0],
    plane: prepareNativeModelFacePlane(...vertices),
    nativeModelFlags: model.flags,
    rawFaceFlags: face.payload.flags,
    pMat: null,
    material: { kind: "present", ...material },
    ...overrides,
  };
}
function emitted(model, face, overrides) {
  const result = emit(input(model, face, overrides));
  assert.equal(result.kind, "emitted");
  return result.face;
}
function example() {
  return {
    identity: {},
    flags: 0x80,
    pivot: [1, 2, 3],
    actorRenderStyle: 4,
    vertices: [
      [1, 2, 4],
      [2, 2, 4],
      [1, 3, 4],
      [1, 2, 8],
      [2, 2, 8],
      [1, 3, 8],
    ].map((position) => ({ position, uv: [0, 0], payload: {} })),
    faces: [
      {
        indices: [0, 1, 2],
        material: null,
        sourceFaceIndex: 5,
        payload: { flags: 0x42 },
      },
      {
        indices: [3, 4, 5],
        material,
        sourceFaceIndex: 9,
        payload: { flags: 0xe5 },
      },
    ],
  };
}

test("compacted and migrated MODEL records use destination pivot and indices, retaining separate DAT provenance", () => {
  const model = example();
  const migration = migrateNativeTrackModel(
    model,
    [{ material, triggerType: 0, mode: 3, levelCount: 0 }],
    outlets,
  );
  const remaining = migration.remaining;
  const generated = migration.generated.model;
  assert.deepEqual(
    remaining.faces.map((f) => [f.nativeFaceIndex, f.sourceFaceIndex]),
    [[0, 5]],
  );
  assert.deepEqual(
    generated.faces.map((f) => [f.nativeFaceIndex, f.sourceFaceIndex]),
    [[0, 9]],
  );
  assert.equal(generated.faces[0].sourceModel, model.identity);
  assert.deepEqual(emitted(remaining, remaining.faces[0]).a, [0, 0, 1]);
  assert.deepEqual(emitted(generated, generated.faces[0]).a, [1, 2, 8]);
  assert.deepEqual(generated.faces[0].indices, [0, 1, 2]);
  assert.equal(emitted(generated, generated.faces[0]).constant, 8);
  assert.equal(emitted(generated, generated.faces[0]).rawFlags, 0xe5);
  // A geometry-only record does not fabricate compacted IDs from DAT indices.
  assert.equal(
    emitted(generated, generated.faces[0]).sourceFaceIndex,
    undefined,
  );
  assert.equal(
    emitted(generated, generated.faces[0]).nativeFaceIndex,
    undefined,
  );
});

test("emitted migrated geometry participates in actual native single-face queries", () => {
  const model = example();
  const { generated } = migrateNativeTrackModel(
    model,
    [{ material, triggerType: 0, mode: 4, levelCount: 0 }],
    outlets,
  );
  const face = emitted(generated.model, generated.model.faces[0]);
  const hit = nativeCheckSingleFace(face, {
    origin: [1.25, 2.25, 9],
    segment: [0, 0, -2],
    excludePlingMaterials: false,
  });
  assert.ok(hit);
  assert.equal(hit.parameter, 0.5);
  assert.deepEqual(hit.point, [1.25, 2.25, 8]);
  assert.equal(
    nativeCheckSingleFace(face, {
      origin: [0.25, 0.25, 9],
      segment: [0, 0, -2],
      excludePlingMaterials: false,
    }),
    null,
  );
});

test("explicit current MODEL input preserves native NULL/identity D and rejects invalid stored data", () => {
  const model = example();
  const args = input(model, model.faces[0], {
    positions: new Float32Array([0, 0, 4, 0, 1, 4, 1, 0, 4]),
    pivot: [0, 0, 0],
    plane: prepareNativeModelFacePlane([0, 0, 4], [0, 1, 4], [1, 0, 4]),
  });
  assert.equal(emit(args).face.constant, -4);
  assert.equal(emit({ ...args, pMat: I }).face.constant, -3.999999523162842);
  assert.throws(() => emit({ ...args, positions: [0, 1] }), /position table/);
  assert.throws(
    () => emit({ ...args, positions: [Infinity, 0, 4, 0, 1, 4, 1, 0, 4] }),
    /finite Float32/,
  );
  assert.throws(() => emit({ ...args, pivot: [1e50, 0, 0] }), /finite Float32/);
  assert.equal(emit({ ...args, plane: undefined }).kind, "unresolved");
});

test("Stock and Advanced original MODELS can migrate and emit both destination tables without Three geometry", async (t) => {
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
    const models = parseDat(
      await store.read(`${root}/RACES/newcity1/newcity1.dat`),
    )
      .filter((m) => m.faces.length)
      .slice(0, 12);
    assert.equal(models.length, 12);
    let emittedCount = 0;
    for (const dat of models) {
      // Explicit synthetic spec selects NULL raw materials. This verifies the
      // installed-table adapter, not authored stock smash bindings or population.
      const identities = dat.materials.map((identifier) => ({ identifier }));
      const model = {
        identity: dat,
        flags: (dat.flags | 0x80) & 0xfdfe,
        pivot: dat.pivot ?? [0, 0, 0],
        actorRenderStyle: 4,
        vertices: Array.from({ length: dat.positions.length / 3 }, (_, i) => ({
          position: Array.from(dat.positions.subarray(i * 3, i * 3 + 3)),
          uv: Array.from(dat.uvs.subarray(i * 2, i * 2 + 2)),
          payload: {},
        })),
        faces: dat.faces.map((f, sourceFaceIndex) => ({
          indices: f.indices,
          material: f.material ? identities[f.material - 1] : null,
          sourceFaceIndex,
          payload: f,
        })),
      };
      const migration = migrateNativeTrackModel(
        model,
        [{ material: null, triggerType: 0, mode: 4, levelCount: 0 }],
        outlets,
      );
      for (const destination of [
        migration.remaining,
        migration.generated?.model,
      ].filter(Boolean)) {
        const emittedFaces = destination.faces.map((f) =>
          emitted(destination, f),
        );
        emittedCount += emittedFaces.length;
        assert.equal(emittedFaces.length, destination.faces.length);
        for (let i = 0; i < emittedFaces.length; i++) {
          const record = emittedFaces[i];
          const nativeFace = destination.faces[i];
          const vertex = destination.vertices[nativeFace.indices[0]];
          assert.deepEqual(
            record.a,
            vertex.position.map((value, axis) =>
              Math.fround(value - (destination.pivot?.[axis] ?? 0)),
            ),
          );
          assert.equal(
            record.rawFlags,
            dat.faces[nativeFace.sourceFaceIndex].flags,
          );
          assert.equal(nativeFace.nativeFaceIndex, i);
        }
        const mats = new Set(
          destination.faces.map((f) => f.material).filter(Boolean),
        );
        if (mats.size <= 1) {
          const order = prepareNativeFaceOrder(destination.faces.length, {
            kind: "verified-pointer-order",
            keys: destination.faces.map((f) => (f.material === null ? 0 : 1)),
            evidence:
              "NULL compares below the only non-NULL identity; no multi-material rank guessed",
          });
          assert.equal(order.resolved, true);
          assert.deepEqual(
            [...order.faceOrder].sort((a, b) => a - b),
            destination.faces.map((_, i) => i),
          );
        }
      }
    }
    assert.ok(emittedCount > 100);
  }
});
