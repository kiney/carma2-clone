import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";
import { NativePedPresentation } from "../src/ped-presentation.ts";

let assetPromise;
async function assets(t) {
  try {
    assetPromise ??= createAssetStore(
      new URL("../carma2_orig/", import.meta.url).pathname,
    ).then((store) => {
      const result = new Assets();
      result.manifest = store.manifest;
      result.lookup = new Map(
        store.manifest.map((entry) => [entry.path.toLowerCase(), entry.path]),
      );
      result.bytes = async (path) => {
        const bytes = await store.read(path);
        if (!bytes) throw new Error(`Asset missing: ${path}`);
        return new Uint8Array(bytes);
      };
      return result;
    });
    return await assetPromise;
  } catch (error) {
    if (/ENOENT|Original installation/.test(String(error))) {
      t.skip("Original installation unavailable");
      return null;
    }
    throw error;
  }
}
function close(actual, expected, epsilon = 3e-6) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) =>
    assert.ok(
      Math.abs(value - expected[index]) <= epsilon,
      `component ${index}: ${value} != ${expected[index]}`,
    ),
  );
}
function input(parent, overrides = {}) {
  parent.updateWorldMatrix(true, false);
  return {
    parent,
    worldPosition: parent.getWorldPosition(new THREE.Vector3()),
    heading: 0,
    groundY: parent.getWorldPosition(new THREE.Vector3()).y,
    moveId: 30,
    periodMs: 33,
    timeMs: 100,
    alive: true,
    ...overrides,
  };
}
function anchors(presentation) {
  const instance = presentation.instance;
  instance.group.updateMatrixWorld(true);
  for (let index = 1; index < instance.bones.length; index++) {
    const bone = instance.poseBones[index];
    const child = new THREE.Vector3(...bone.childAttachment).applyMatrix4(
      instance.bones[index].actor.matrixWorld,
    );
    const parent = new THREE.Vector3(...bone.parentAttachment).applyMatrix4(
      instance.bones[bone.parent].actor.matrixWorld,
    );
    close(child.toArray(), parent.toArray());
  }
}

test("ordinary native presenter replaces ACT default transforms with full human/dog frames", async (t) => {
  const source = await assets(t);
  if (!source) return;
  const roots = [];
  for (const [stem, expectedSlot, expectedOffset] of [
    ["CitySwat", 15, 0.154],
    ["Blokebl", 15, 0.154],
    ["twolf", 3, 0.114],
  ]) {
    const template = await loadNativePedAssets(
      source,
      `PEDS/PEEPS/${stem}`,
      stem,
      "data",
    );
    const presentation = new NativePedPresentation(template);
    const parent = new THREE.Group();
    parent.position.set(10, 20, 30);
    assert.equal(presentation.update(input(parent)).status, "complete");
    assert.equal(presentation.moveSlot, expectedSlot);
    assert.ok(Math.abs(presentation.groundingOffset - expectedOffset) < 2e-7);
    roots.push([...presentation.instance.rootPose]);
    anchors(presentation);
    close(
      presentation.instance.bones[0].actor
        .getWorldPosition(new THREE.Vector3())
        .toArray(),
      [10, 20 + expectedOffset, 30],
    );
    // Resources contain remapped DAT vertices under an identity model group;
    // no historical ACT node basis survives below the native FORM bone actor.
    for (const bone of presentation.instance.bones)
      if (bone.model)
        close(bone.model.matrix.elements, new THREE.Matrix4().elements);
    presentation.dispose();
  }
  close(roots[0], roots[1]);
  close(roots[0].slice(0, 3), [0.0142869912, 0.999859214, -0.0087992903]);
  close(roots[2].slice(0, 9), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
});

test("presenter compensates transformed parents, avoids double transport, and resets native clock", async (t) => {
  const source = await assets(t);
  if (!source) return;
  const template = await loadNativePedAssets(
    source,
    "PEDS/PEEPS/CitySwat",
    "CitySwat",
    "data",
  );
  const presentation = new NativePedPresentation(template);
  const ancestor = new THREE.Group();
  ancestor.position.set(-2, 3, 4);
  ancestor.rotation.y = -0.7;
  ancestor.scale.set(2, 1.5, 0.75);
  const parent = new THREE.Group();
  ancestor.add(parent);
  parent.position.set(10, 20, 30);
  parent.rotation.y = 1.2;
  let request = input(parent, { heading: 1.2 });
  presentation.update(request);
  close(presentation.group.matrixWorld.elements, new THREE.Matrix4().elements);
  assert.equal(presentation.instance.clock.frame, 0);
  assert.equal(presentation.instance.clock.lastTimeMs, 100);
  parent.position.x += 1;
  request = input(parent, { heading: 1.2, timeMs: 133 });
  const gameplayPosition = parent.position.clone();
  presentation.update(request);
  assert.equal(presentation.instance.clock.frame, 1);
  assert.deepEqual(parent.position, gameplayPosition);
  close(
    [presentation.instance.rootPose[9], presentation.instance.rootPose[11]],
    [request.worldPosition.x, request.worldPosition.z],
  );
  close(presentation.group.matrixWorld.elements, new THREE.Matrix4().elements);
  anchors(presentation);
  presentation.update(input(parent, { moveId: 0, timeMs: 170 }));
  assert.equal(presentation.instance.clock.frame, 0);
  assert.equal(presentation.instance.clock.lastTimeMs, 170);
  presentation.reset(input(parent, { timeMs: 0 }));
  assert.equal(presentation.instance.clock.frame, 0);
  assert.equal(presentation.moveSlot, 15);
  presentation.dispose();
});

test("legacy rigid/corpse transport freezes native bones and preserves joint coherence", async (t) => {
  const source = await assets(t);
  if (!source) return;
  const template = await loadNativePedAssets(
    source,
    "PEDS/PEEPS/Blokebl",
    "Blokebl",
    "data",
  );
  const presentation = new NativePedPresentation(template);
  const parent = new THREE.Group();
  parent.position.set(10, 2, 20);
  presentation.update(input(parent));
  const clock = { ...presentation.instance.clock };
  const poses = presentation.instance.bones.map((bone) => [...bone.pose]);
  const oldRoot = presentation.instance.bones[0].actor.matrixWorld.clone();
  parent.position.x += 2;
  parent.rotation.z = 0.3;
  presentation.update(input(parent, { legacyRigid: true, timeMs: 1000 }));
  assert.deepEqual(presentation.instance.clock, clock);
  assert.deepEqual(
    presentation.instance.bones.map((bone) => [...bone.pose]),
    poses,
  );
  assert.notDeepEqual(
    presentation.instance.bones[0].actor.matrixWorld.elements,
    oldRoot.elements,
  );
  anchors(presentation);
  presentation.update(
    input(parent, {
      alive: false,
      timeMs: 1500,
      legacyFall: { pitchRadians: Math.PI / 2, rootHeight: 0.055 },
    }),
  );
  assert.deepEqual(presentation.instance.clock, clock);
  const rootLocal = presentation.instance.bones[0].actor
    .getWorldPosition(new THREE.Vector3())
    .applyMatrix4(parent.matrixWorld.clone().invert());
  close(rootLocal.toArray(), [0, 0.055, 0]);
  anchors(presentation);
  presentation.reset(input(parent));
  assert.equal(
    presentation.update(input(parent, { moveId: 999 })).status,
    "provider-required",
  );
  assert.ok(presentation.diagnostics.some((name) => name.includes("999")));
  anchors(presentation);
  presentation.dispose();
});
