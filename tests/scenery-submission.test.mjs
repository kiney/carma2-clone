import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { estimateScenerySubmission } from "../tools/render-presentation-probe.mjs";

function fixture(camera, matrices, flags = []) {
  const scene = new T.Scene(),
    geometry = new T.BoxGeometry(1, 1, 1);
  const material = new T.MeshBasicMaterial();
  const mesh = new T.InstancedMesh(geometry, material, matrices.length);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const group = { mesh, records: [] },
    bodies = new Map();
  matrices.forEach((matrix, slot) => {
    mesh.setMatrixAt(slot, matrix);
    const source = {
      renderable: true,
      uploaded: true,
      batch: group,
      slot,
      ...flags[slot]?.source,
    };
    group.records.push(source);
    bodies.set({}, { pulled: flags[slot]?.pulled ?? false, meshes: [source] });
  });
  camera.position.z = 5;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  scene.updateMatrixWorld(true);
  const carma = {
    scene,
    camera,
    noncarRenderBatch: { instances: [group], bodies },
    stats: { ready: true, drawCalls: 1, triangles: matrices.length * 12 },
    renderer: {
      info: { render: { calls: 1, triangles: matrices.length * 12 } },
    },
  };
  return {
    carma,
    mesh,
    geometry,
    material,
    group,
    bodies,
    dispose() {
      geometry.dispose();
      mesh.geometry !== geometry && mesh.geometry.dispose();
      for (const m of new Set([material, ...[].concat(mesh.material)]))
        m.dispose();
      mesh.dispose();
    },
  };
}
function withWindow(carma, run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    value: { carma },
    configurable: true,
  });
  try {
    return run();
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
}
function nativeVisible(f, expectedSlots) {
  const camera = f.carma.camera;
  const frustum = new T.Frustum().setFromProjectionMatrix(
    new T.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    ),
    camera.coordinateSystem,
    camera.reversedDepth,
  );
  let visible = 0;
  for (const slot of expectedSlots) {
    const local = new T.Matrix4();
    f.mesh.getMatrixAt(slot, local);
    const world = new T.Matrix4().multiplyMatrices(f.mesh.matrixWorld, local);
    if (
      frustum.intersectsSphere(
        f.mesh.geometry.boundingSphere.clone().applyMatrix4(world),
      )
    )
      visible++;
  }
  return visible;
}

for (const name of ["perspective", "orthographic", "webgpu", "reversed"]) {
  test(`${name} scalar planes match native world-sphere frustum and exclude hidden slots`, (t) => {
    const camera =
      name === "orthographic"
        ? new T.OrthographicCamera(-3, 3, 3, -3, 0.1, 20)
        : new T.PerspectiveCamera(60, 1, 0.1, 20);
    if (name === "webgpu") {
      if (T.WebGPUCoordinateSystem === undefined)
        return t.skip("WebGPU clip convention unavailable");
      camera.coordinateSystem = T.WebGPUCoordinateSystem;
    }
    if (name === "reversed") {
      if (!("reversedDepth" in camera))
        return t.skip("Reversed depth unavailable");
      camera._reversedDepth = true;
    }
    const positions = [
      [0, 0, -5],
      [30, 0, -5],
      [0, 0, -30],
      [0, 0, 15],
      [-1, 0, -3],
    ];
    const matrices = positions.map((p) =>
      new T.Matrix4().makeTranslation(...p),
    );
    for (let i = 0; i < 4; i++)
      matrices.push(new T.Matrix4().makeScale(0, 0, 0));
    const flags = [];
    flags[5] = { pulled: true };
    flags[6] = { source: { renderable: false } };
    flags[7] = { source: { uploaded: false } };
    flags[8] = { source: { slot: undefined } };
    const f = fixture(camera, matrices, flags);
    try {
      withWindow(f.carma, () => {
        const report = estimateScenerySubmission();
        const expected = nativeVisible(f, [0, 1, 2, 3, 4]);
        assert.equal(report.totals.eligibleSources, 5);
        assert.equal(report.totals.sphereVisibleSources, expected);
        assert.ok(report.totals.sphereVisibleSources < 5);
        assert.equal(
          report.totals.submittedTrianglesUpperBound,
          matrices.length * 12,
        );
        assert.equal(report.totals.sphereVisibleTriangles, expected * 12);
        assert.equal(report.sphereComputations, 1);
        assert.equal(estimateScenerySubmission().sphereComputations, 0);
        assert.equal(report.groups[0].eligiblePopulation, 5);
        assert.equal(report.groups[0].slotCapacity, 9);
        f.mesh.position.x = 8;
        f.mesh.updateMatrixWorld(true);
        const moved = estimateScenerySubmission();
        assert.equal(
          moved.totals.sphereVisibleSources,
          nativeVisible(f, [0, 1, 2, 3, 4]),
        );
        assert.notEqual(
          moved.totals.sphereVisibleSources,
          expected,
          "actual mesh-world transform must affect visibility",
        );
      });
    } finally {
      f.dispose();
    }
  });
}

test("indexed draw ranges honor material groups; single material ignores group partition", () => {
  const f = fixture(new T.PerspectiveCamera(60, 1, 0.1, 20), [
    new T.Matrix4(),
    new T.Matrix4().makeTranslation(0, 0, -5),
  ]);
  try {
    withWindow(f.carma, () => {
      f.geometry.setDrawRange(3, 9);
      const second = new T.MeshBasicMaterial();
      f.mesh.material = [f.material, second];
      const grouped = estimateScenerySubmission();
      assert.equal(grouped.groups[0].geometryDraw.baseDrawCalls, 2);
      assert.equal(grouped.groups[0].geometryDraw.baseTriangles, 3);
      assert.equal(grouped.totals.submittedTrianglesUpperBound, 6);
      second.visible = false;
      assert.equal(
        estimateScenerySubmission().totals.submittedTrianglesUpperBound,
        2,
      );
      f.mesh.material = f.material;
      const single = estimateScenerySubmission();
      assert.equal(single.groups[0].geometryDraw.baseDrawCalls, 1);
      assert.equal(single.totals.submittedTrianglesUpperBound, 6);
      second.dispose();
      f.mesh.geometry = f.geometry.toNonIndexed();
      f.mesh.geometry.setDrawRange(3, 9);
      const unindexed = estimateScenerySubmission();
      assert.equal(unindexed.groups[0].geometryDraw.available, 36);
      assert.equal(unindexed.totals.submittedElementReferencesUpperBound, 18);
      assert.equal(unindexed.totals.submittedTrianglesUpperBound, 6);
    });
  } finally {
    f.dispose();
  }
});

test("window fixture restores the original descriptor even when the capture rejects", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  assert.throws(
    () => withWindow({ stats: { ready: false } }, estimateScenerySubmission),
    /Loaded scene/,
  );
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(globalThis, "window"),
    original,
  );
});
