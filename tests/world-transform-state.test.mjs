import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { WorldTransformState } from "../src/world-transform-state.ts";

const diagnostics = () => ({
  resolved: 0,
  cacheHits: 0,
  localChecks: 0,
  compositions: 0,
  multiplications: 0,
  nativeUpdates: 0,
});

function oracle(state, object, counters) {
  state.beginPhase();
  const result = state.resolve(object, counters);
  const retained = result.matrix.toArray();
  object.updateWorldMatrix(true, false);
  assert.deepEqual(retained, object.matrixWorld.toArray());
  return result;
}

function pose(object, seed) {
  object.position.set(seed + 0.125, seed * -0.75, 2.375 - seed);
  object.rotation.set(seed * 0.15, seed * -0.33, seed * 0.57);
  object.scale.set(seed + 1.3, -0.75, 2.6);
}

test("exact Three composition, reflected scale and live non-native ancestors", () => {
  const state = new WorldTransformState();
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  const actor = new THREE.Mesh();
  scene.add(parent);
  parent.add(actor);
  pose(scene, 0.2);
  pose(parent, 1.1);
  pose(actor, 2.3);
  const initial = oracle(state, actor).revision;
  parent.position.x += 0.125;
  assert.ok(oracle(state, actor).revision > initial);
  scene.rotation.z += 0.001;
  oracle(state, actor);
  const other = new THREE.Group();
  pose(other, 3.4);
  scene.add(other);
  other.add(actor);
  oracle(state, actor);
  actor.removeFromParent();
  oracle(state, actor);
});

test("manual affine matrices retain every element without decomposition", () => {
  const state = new WorldTransformState();
  const parent = new THREE.Group();
  const actor = new THREE.Object3D();
  parent.add(actor);
  pose(parent, 0.6);
  actor.matrixAutoUpdate = false;
  actor.matrix.set(
    1.3,
    0.2,
    0.1,
    4,
    -0.1,
    0.8,
    0.3,
    -2,
    0.15,
    0.05,
    1.7,
    6,
    0.001,
    -0.002,
    0.003,
    1,
  );
  oracle(state, actor);
  actor.matrix.elements[3] += 1e-12;
  const revision = oracle(state, actor).revision;
  actor.position.x += 10;
  assert.equal(oracle(state, actor).revision, revision);
  actor.matrixAutoUpdate = true;
  oracle(state, actor);
});

test("restored physical transforms are independent of stale interpolated matrixWorld", () => {
  const state = new WorldTransformState();
  const parent = new THREE.Group();
  const actor = new THREE.Object3D();
  parent.add(actor);
  pose(parent, 0.3);
  pose(actor, 1.7);
  const physical = oracle(state, actor).matrix.toArray();
  const physicalRevision = state.resolve(actor).revision;
  const position = actor.position.clone();
  const quaternion = actor.quaternion.clone();
  actor.position.x += 50;
  actor.rotation.y += 0.2;
  actor.updateWorldMatrix(true, false);
  const presentation = actor.matrixWorld.toArray();
  actor.position.copy(position);
  actor.quaternion.copy(quaternion);
  state.beginPhase();
  const restored = state.resolve(actor);
  assert.deepEqual(restored.matrix.toArray(), physical);
  assert.equal(restored.revision, physicalRevision);
  assert.deepEqual(actor.matrixWorld.toArray(), presentation);
  oracle(state, actor);
});

test("authoritative matrixWorld survives disabled automatic world updates", () => {
  const state = new WorldTransformState();
  const parent = new THREE.Group();
  const actor = new THREE.Object3D();
  const child = new THREE.Object3D();
  parent.add(actor);
  actor.add(child);
  actor.matrixWorldAutoUpdate = false;
  actor.matrixWorld.makeRotationY(0.31).setPosition(12, -2, 7);
  pose(actor, 5);
  pose(child, 0.1);
  const frozen = oracle(state, actor).matrix.toArray();
  oracle(state, child);
  parent.position.x = 70;
  assert.deepEqual(oracle(state, actor).matrix.toArray(), frozen);
  oracle(state, child);
  actor.matrixWorld.elements[12] += 0.25;
  oracle(state, child);
  actor.matrixWorldAutoUpdate = true;
  oracle(state, child);
});

test("unchanged phases check each ancestor once and compose only changed locals", () => {
  const state = new WorldTransformState();
  const parent = new THREE.Group();
  const a = new THREE.Object3D();
  const b = new THREE.Object3D();
  parent.add(a, b);
  const first = diagnostics();
  state.beginPhase();
  state.resolve(a, first);
  state.resolve(b, first);
  assert.equal(first.localChecks, 3);
  assert.equal(first.compositions, 3);
  assert.equal(first.multiplications, 2);
  assert.equal(first.nativeUpdates, 0);
  const warm = diagnostics();
  state.beginPhase();
  state.resolve(a, warm);
  state.resolve(b, warm);
  state.resolve(a, warm);
  assert.equal(warm.localChecks, 3);
  assert.equal(warm.compositions, 0);
  assert.equal(warm.multiplications, 0);
  assert.ok(warm.cacheHits >= 3);
  parent.position.x = 0.2;
  const moved = diagnostics();
  state.beginPhase();
  state.resolve(a, moved);
  state.resolve(b, moved);
  assert.equal(moved.compositions, 1);
  assert.equal(moved.multiplications, 2);
});

test("callback phase invalidation observes descendant and ancestor mutations", () => {
  const state = new WorldTransformState();
  const parent = new THREE.Group();
  const child = new THREE.Object3D();
  parent.add(child);
  state.beginPhase();
  const before = state.resolve(child).matrix.clone();
  parent.position.x = 4;
  child.position.z = -7;
  assert.deepEqual(state.resolve(child).matrix.toArray(), before.toArray());
  state.invalidatePhase();
  const after = state.resolve(child).matrix.toArray();
  child.updateWorldMatrix(true, false);
  assert.deepEqual(after, child.matrixWorld.toArray());
  assert.notDeepEqual(after, before.toArray());
});

test("custom updateWorldMatrix ancestors run once per resolve and remain opaque", () => {
  const state = new WorldTransformState();
  const parent = new THREE.Group();
  const child = new THREE.Object3D();
  parent.add(child);
  let calls = 0;
  parent.updateWorldMatrix = function (updateParents, updateChildren) {
    calls++;
    this.position.x += 1;
    THREE.Object3D.prototype.updateWorldMatrix.call(
      this,
      updateParents,
      updateChildren,
    );
  };
  const counts = diagnostics();
  state.beginPhase();
  for (let iteration = 1; iteration <= 3; iteration++) {
    const result = state.resolve(child, counts);
    assert.equal(result.ordinary, false);
    assert.equal(result.matrix.elements[12], iteration);
    assert.equal(calls, iteration);
  }
  assert.equal(counts.nativeUpdates, 3);
  parent.updateWorldMatrix = THREE.Object3D.prototype.updateWorldMatrix;
  assert.equal(oracle(state, child).ordinary, true);
});

test("custom updateMatrix is preserved and invalidates ordinary phase assumptions", () => {
  const state = new WorldTransformState();
  const parent = new THREE.Group();
  const child = new THREE.Object3D();
  parent.add(child);
  const originalParent = state.resolve(parent).matrix.clone();
  let calls = 0;
  child.updateMatrix = function () {
    calls++;
    parent.position.y += 2;
    THREE.Object3D.prototype.updateMatrix.call(this);
  };
  state.invalidatePhase();
  assert.equal(state.resolve(child).ordinary, false);
  assert.equal(calls, 1);
  assert.notDeepEqual(
    state.resolve(parent).matrix.toArray(),
    originalParent.toArray(),
  );
  assert.equal(state.resolve(parent).matrix.elements[13], 2);
  state.resolve(child);
  assert.equal(calls, 2);
});

test("custom updateMatrixWorld is opaque without invoking an unused override", () => {
  const state = new WorldTransformState();
  const object = new THREE.Object3D();
  let calls = 0;
  object.updateMatrixWorld = function (force) {
    calls++;
    THREE.Object3D.prototype.updateMatrixWorld.call(this, force);
  };
  const counts = diagnostics();
  state.resolve(object, counts);
  state.resolve(object, counts);
  assert.equal(state.resolve(object, counts).ordinary, false);
  assert.equal(calls, 0);
  assert.equal(counts.nativeUpdates, 3);
});
