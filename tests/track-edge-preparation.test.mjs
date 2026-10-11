import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createModelGeometry } from "../src/render-geometry.ts";
import { prepareNativeTrackSceneEdges } from "../src/track-edge-preparation.ts";
import { captureWorldSource } from "../src/world-source.ts";
import { batchStaticWorld } from "../src/world.ts";
import { emitNativePreparedFace } from "../src/physics/prepared-face.ts";

function sourceFixture({ materialBound = true } = {}) {
  const mat = {
      name: "EDGE_MAT.MAT",
      flags: 0x1000,
      rgba: [255, 255, 255, 255],
      texture: null,
      uvTransform: [1, 0, 0, 1, 0, 0],
    },
    model = {
      name: "edge_model.DAT",
      flags: 0x201,
      pivot: [0, 0, 0],
      positions: new Float32Array([
        0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 1, 3, 0, 0, 4, 0, 0, 3, 1, 0,
      ]),
      uvs: new Float32Array(),
      materials: ["EDGE_MAT.MAT"],
      // The MAT faces are interleaved with a NULL face. Geometry groups reorder
      // render triangles to source faces 0,2,1 (MAT then NULL).
      faces: [
        { indices: [0, 1, 2], smoothing: 0, flags: 0x80, material: 1 },
        { indices: [1, 0, 3], smoothing: 0, flags: 0x40, material: 0 },
        { indices: [4, 5, 6], smoothing: 0, flags: 0x20, material: 1 },
      ],
    },
    geometry = createModelGeometry(model);
  geometry.computeBoundingBox();
  const visualMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  visualMat.name = "EDGE_MAT";
  const mesh = new THREE.Mesh(geometry, [
    new THREE.MeshBasicMaterial(),
    visualMat,
  ]);
  mesh.name = model.name;
  const actor = new THREE.Group();
  actor.name = "edge-actor";
  actor.scale.x = -1;
  actor.add(mesh);
  const root = new THREE.Group();
  root.name = "PP01 1 1 0 0";
  root.add(actor);
  root.updateMatrixWorld(true);
  return {
    root,
    actor,
    mesh,
    geometry,
    model,
    mat,
    scene: {
      models: new Map([["edge_model", model]]),
      sourceMaterials: new Map(materialBound ? [["edge_mat", mat]] : []),
      sourceModelGeometries: new Map([[model, geometry]]),
    },
  };
}

test("track edge preparation preserves raw DAT/MAT identity and carries flags through reordered and mirrored render triangles", () => {
  const f = sourceFixture(),
    rawBefore = structuredClone({
      positions: [...f.model.positions],
      faces: f.model.faces,
      flags: f.model.flags,
      materials: f.model.materials,
    }),
    sourceFacesBefore = structuredClone(f.geometry.userData.sourceFaces);
  const prepared = prepareNativeTrackSceneEdges(f.scene);

  assert.equal(prepared.status, "complete");
  assert.deepEqual(prepared.requiredProviders, []);
  assert.equal(prepared.models.get(f.model).modelFlags, 0x80);
  assert.equal(prepared.models.get(f.model).updateMask, 0x80);
  assert.equal(prepared.appliedGeometries, 1);
  assert.equal(prepared.changedFaces, 1);
  assert.equal(f.geometry.userData.c2NativeTrackEdgeFlags, true);
  assert.equal(f.geometry.userData.modelFlags, 0x80);
  assert.deepEqual(
    [...f.geometry.userData.sourceFaceFlags],
    [0x80, 0x20, 0x41],
    "render-order edge flags map source face order [0,1,2] to [0,2,1]",
  );
  assert.deepEqual(f.geometry.userData.sourceFaces, sourceFacesBefore);
  assert.deepEqual(
    {
      positions: [...f.model.positions],
      faces: f.model.faces,
      flags: f.model.flags,
      materials: f.model.materials,
    },
    rawBefore,
    "edge preparation mutates live geometry metadata, not authored DAT records",
  );
  assert.equal(f.scene.sourceMaterials.get("edge_mat"), f.mat);

  const snapshot = captureWorldSource(f.root, { modelPreparation: "track" });
  assert.deepEqual(
    snapshot.triangles.map((triangle) => triangle.sourceFaceIndex),
    [0, 2, 1],
  );
  assert.deepEqual(
    snapshot.triangles.map((triangle) => triangle.nativeModelFaceFlags),
    [0x80, 0x20, 0x41],
  );
  assert.deepEqual(
    snapshot.triangles.map((triangle) => triangle.sourceFace.flags),
    [0x80, 0x20, 0x40],
    "the immutable source snapshot retains authored flags separately",
  );
  const emitted = snapshot.triangles.map((source) =>
    emitNativePreparedFace({
      source,
      pMat: null,
      material:
        source.sourceFace.material === 0
          ? { kind: "null" }
          : { kind: "present", identifier: "EDGE_MAT", flags: f.mat.flags },
    }),
  );
  assert.deepEqual(
    emitted.map((result) =>
      result.kind === "emitted" ? result.face.rawFlags : result.reason,
    ),
    [0x80, 0x20, 0x41],
    "prepared-face emission consumes the computed raw flags, not stale DAT metadata",
  );
  assert.deepEqual(
    emitted.map((result) =>
      result.kind === "emitted" ? result.face.materialPresence : result.reason,
    ),
    ["present", "present", "null"],
  );

  const batch = batchStaticWorld(f.root);
  assert.deepEqual(
    batch.children.map((part) => [...part.geometry.userData.sourceFaceFlags]),
    [[0x80, 0x20], [0x44]],
    "mirroring flips edge0/edge2 once while material batches preserve face flags",
  );
});

test("unresolved raw MAT leaves that MODEL unapplied with an explicit provider", () => {
  const f = sourceFixture({ materialBound: false });
  const prepared = prepareNativeTrackSceneEdges(f.scene);
  assert.equal(prepared.status, "provider-required");
  assert.deepEqual(prepared.requiredProviders, [
    "native-track-edge-raw-MAT:EDGE_MAT.MAT",
  ]);
  assert.equal(prepared.models.has(f.model), false);
  assert.equal(prepared.appliedGeometries, 0);
  assert.equal(f.geometry.userData.c2NativeTrackEdgeFlags, undefined);
  assert.equal(f.geometry.userData.sourceFaceFlags, undefined);
});

test("malformed initial geometry and nonfinite authored vertices fail instead of using render bounds", () => {
  const reordered = sourceFixture();
  reordered.geometry.setIndex([1, 0, 2, 6, 7, 8, 3, 4, 5]);
  assert.throws(
    () => prepareNativeTrackSceneEdges(reordered.scene),
    /changed source layout/,
  );
  const repeated = sourceFixture();
  repeated.geometry.setIndex([0, 1, 2, 0, 1, 2, 3, 4, 5]);
  assert.throws(
    () => prepareNativeTrackSceneEdges(repeated.scene),
    /repeats a source face/,
  );

  const nonfinite = sourceFixture();
  nonfinite.model.positions[0] = Number.NaN;
  assert.throws(
    () => prepareNativeTrackSceneEdges(nonfinite.scene),
    /finite stored Float32/,
  );

  const missing = sourceFixture();
  missing.scene.sourceModelGeometries = new Map();
  const result = prepareNativeTrackSceneEdges(missing.scene);
  assert.equal(result.status, "provider-required");
  assert.deepEqual(result.requiredProviders, [
    "native-track-edge-MODEL-geometry:edge_model.DAT",
  ]);
  assert.equal(result.appliedGeometries, 0);
});
