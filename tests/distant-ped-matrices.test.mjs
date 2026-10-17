import test from "node:test";
import assert from "node:assert/strict";
import { Scene, Group, Object3D } from "three";
import { prepareSceneMatrices } from "../src/render-matrices.ts";
test("distant frozen pedestrian descendants skip repeat preparation, with root/parent/reset and activation invalidation", () => {
  const scene = new Scene(),
    peds = new Group(),
    actor = new Group(),
    limb = new Object3D();
  scene.add(peds);
  peds.add(actor);
  actor.add(limb);
  actor.position.x = 3;
  limb.position.y = 2;
  const registered = new Set([actor]),
    dormant = { actors: new Set([actor]), revision: 0 };
  let calls = 0;
  const original = limb.updateMatrixWorld;
  limb.updateMatrixWorld = function (...args) {
    calls++;
    return original.apply(this, args);
  };
  const prepare = () =>
    prepareSceneMatrices(scene, peds, registered, undefined, dormant);
  prepare();
  assert.equal(calls, 1);
  assert.equal(limb.matrixWorld.elements[12], 3);
  prepare();
  assert.equal(calls, 1);
  peds.position.x = 7;
  prepare();
  assert.equal(calls, 2);
  assert.equal(limb.matrixWorld.elements[12], 10);
  limb.position.y = 4;
  dormant.revision++;
  prepare();
  assert.equal(calls, 3);
  assert.equal(limb.matrixWorld.elements[13], 4);
  dormant.actors.clear();
  limb.position.y = 5;
  prepare();
  assert.equal(calls, 4);
  dormant.actors.add(actor);
  limb.position.y = 6;
  prepare();
  assert.equal(calls, 5);
  assert.equal(limb.matrixWorld.elements[13], 6);
  prepare();
  assert.equal(calls, 5);
  limb.position.z = 8;
  limb.updateWorldMatrix(true, false);
  assert.equal(
    limb.matrixWorld.elements[14],
    8,
    "explicit native matrix APIs remain live",
  );
});
