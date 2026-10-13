import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  prepareSceneMatrices,
  renderScenePasses,
} from "../src/render-matrices.ts";
import { hasGraphicalPoseOwner } from "../src/render-ownership.ts";

test("frame-local dormant roots prune presentation but retain native explicit updates", () => {
  const scene = new THREE.Scene();
  const world = new THREE.Group();
  const dormant = new THREE.Group();
  const leaf = new THREE.Object3D();
  const moving = new THREE.Object3D();
  scene.add(world);
  world.add(dormant, moving);
  dormant.add(leaf);
  scene.updateMatrixWorld(true);
  let visits = 0;
  const native = dormant.updateMatrixWorld;
  dormant.updateMatrixWorld = function (...args) {
    visits++;
    return native.apply(this, args);
  };
  const certificate = {
    matrixSkipRoots: new Set([dormant]),
    matrixSkipAncestors: new Set([world]),
  };
  moving.position.x = 4;
  prepareSceneMatrices(scene, undefined, undefined, certificate);
  assert.equal(visits, 0);
  assert.equal(moving.matrixWorld.elements[12], 4);
  scene.updateMatrixWorld(true);
  assert.equal(visits, 1, "explicit physics matrix queries remain native");
  certificate.matrixSkipRoots.clear();
  leaf.position.y = 3;
  prepareSceneMatrices(scene, undefined, undefined, certificate);
  assert.equal(
    visits,
    2,
    "expired certificates refresh the subtree immediately",
  );
  assert.equal(leaf.matrixWorld.elements[13], 3);
});

test("custom ancestor matrix updates keep their ordinary subtree behavior", () => {
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  const child = new THREE.Object3D();
  scene.add(parent);
  parent.add(child);
  let updates = 0;
  const native = parent.updateMatrixWorld;
  parent.updateMatrixWorld = function (...args) {
    updates++;
    child.position.x = updates;
    return native.apply(this, args);
  };
  prepareSceneMatrices(scene, undefined, undefined, {
    matrixSkipRoots: new Set(),
    matrixSkipAncestors: new Set([parent]),
  });
  assert.equal(updates, 1);
  assert.equal(child.matrixWorld.elements[12], 1);
});

test("GROOVE graphical ownership follows the live ACT parent chain", () => {
  const scene = new THREE.Scene();
  const groove = new THREE.Group();
  const nested = new THREE.Group();
  const actor = new THREE.Object3D();
  scene.add(groove);
  groove.add(nested);
  nested.add(actor);
  const owners = new Set([groove]);
  assert.ok(hasGraphicalPoseOwner(actor, owners));
  assert.ok(hasGraphicalPoseOwner(groove, owners));
  assert.equal(
    hasGraphicalPoseOwner(actor, owners, false),
    false,
    "native pulled children stop inheriting retained Three GROOVE ancestry",
  );
  assert.ok(
    hasGraphicalPoseOwner(groove, owners, false),
    "exact GROOVE ACT ownership survives native physical admission",
  );
  scene.add(actor);
  assert.equal(hasGraphicalPoseOwner(actor, owners), false);
  assert.equal(hasGraphicalPoseOwner(actor, undefined), false);
});

const matrix = (object) => object.matrixWorld.toArray();
const closeMatrix = (actual, expected, message) => {
  assert.equal(actual.length, expected.length, message);
  for (let i = 0; i < actual.length; i++) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) < 1e-9,
      `${message}: element ${i}: ${actual[i]} != ${expected[i]}`,
    );
  }
};

function transform(object, position, rotation, scale) {
  object.position.set(...position);
  object.rotation.set(...rotation);
  object.scale.set(...scale);
}

test("prepared matrices match Three.js full updates through live transforms and manual matrices", () => {
  const scene = new THREE.Scene();
  const ancestor = new THREE.Group();
  const parent = new THREE.Group();
  const child = new THREE.Object3D();
  scene.add(ancestor);
  ancestor.add(parent);
  parent.add(child);

  transform(ancestor, [7, -2, 4], [0.31, -0.7, 0.2], [2, 0.75, 1.4]);
  transform(parent, [-3, 5, 1], [-0.2, 0.45, 0.8], [0.6, 1.8, 0.9]);
  transform(child, [2, 1, -4], [0.6, 0.3, -0.1], [1.2, 0.8, 2.1]);

  // Actors may carry an authored matrix with auto composition disabled.
  parent.matrixAutoUpdate = false;
  parent.matrix.set(
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
    0,
    0,
    0,
    1,
  );
  ancestor.updateMatrix();
  child.updateMatrix();

  prepareSceneMatrices(scene);
  const prepared = [
    matrix(scene),
    matrix(ancestor),
    matrix(parent),
    matrix(child),
  ];

  scene.updateMatrixWorld(true);
  const standard = [
    matrix(scene),
    matrix(ancestor),
    matrix(parent),
    matrix(child),
  ];
  prepared.forEach((value, index) =>
    closeMatrix(value, standard[index], `world matrix ${index}`),
  );

  transform(ancestor, [-5, 3, 9], [-0.4, 0.12, 1.1], [0.5, 2.3, 1.1]);
  ancestor.updateMatrix();
  transform(child, [-1, 8, 2], [0.1, 0.9, -0.3], [2, 0.7, 1.3]);
  child.updateMatrix();
  prepareSceneMatrices(scene);
  const moved = [
    matrix(scene),
    matrix(ancestor),
    matrix(parent),
    matrix(child),
  ];
  scene.updateMatrixWorld(true);
  moved.forEach((value, index) =>
    closeMatrix(
      value,
      matrix([scene, ancestor, parent, child][index]),
      `moved world matrix ${index}`,
    ),
  );
});

test("dormant hidden actor updates its root and skips only its descendants until reactivated", () => {
  const scene = new THREE.Scene();
  const pedestrianGroup = new THREE.Group();
  const actor = new THREE.Group();
  const actorChild = new THREE.Group();
  const actorLeaf = new THREE.Object3D();
  const hiddenNonActor = new THREE.Group();
  const visibleChild = new THREE.Object3D();
  scene.add(pedestrianGroup);
  pedestrianGroup.add(hiddenNonActor);
  pedestrianGroup.add(actor);
  actor.add(actorChild);
  actorChild.add(actorLeaf);
  hiddenNonActor.add(visibleChild);
  hiddenNonActor.visible = false;
  actor.visible = false;
  const dormant = new Set([actor]);

  prepareSceneMatrices(scene, pedestrianGroup, dormant);
  const staleActorRoot = matrix(actor);
  const staleActorChild = matrix(actorChild);
  const staleActorLeaf = matrix(actorLeaf);
  const staleNonActorChild = matrix(visibleChild);
  transform(pedestrianGroup, [9, 2, -3], [0.2, 0.7, -0.1], [1.7, 0.8, 2.2]);
  pedestrianGroup.updateMatrix();
  transform(actor, [1, -4, 2], [-0.6, 0.1, 0.4], [0.7, 2, 1.3]);
  actor.updateMatrix();
  transform(hiddenNonActor, [-2, 3, 5], [0.3, -0.2, 0.9], [1.1, 0.6, 1.9]);
  hiddenNonActor.updateMatrix();

  prepareSceneMatrices(scene, pedestrianGroup, dormant);
  assert.notDeepEqual(
    matrix(actor),
    staleActorRoot,
    "actor root follows its moving parent",
  );
  assert.deepEqual(
    matrix(actorChild),
    staleActorChild,
    "dormant actor descendants stay untouched",
  );
  assert.deepEqual(
    matrix(actorLeaf),
    staleActorLeaf,
    "the skipped subtree remains untouched",
  );
  const preparedNonActorChild = matrix(visibleChild);
  assert.notDeepEqual(preparedNonActorChild, staleNonActorChild);
  hiddenNonActor.updateMatrixWorld(true);
  closeMatrix(
    preparedNonActorChild,
    matrix(visibleChild),
    "hidden nonpopulation branch remains current",
  );

  actor.visible = true;
  transform(actorChild, [3, 1, -2], [0.4, 0.8, 0.2], [1.2, 0.9, 1.4]);
  actorChild.updateMatrix();
  prepareSceneMatrices(scene, pedestrianGroup, dormant);
  const preparedChild = matrix(actorChild);
  const preparedLeaf = matrix(actorLeaf);
  scene.updateMatrixWorld(true);
  closeMatrix(preparedChild, matrix(actorChild), "reactivated actor child");
  closeMatrix(preparedLeaf, matrix(actorLeaf), "reactivated actor leaf");
});

test("preparation preserves object structure, visibility, and update flags", () => {
  const scene = new THREE.Scene();
  const pedestrianGroup = new THREE.Group();
  const actor = new THREE.Group();
  const child = new THREE.Object3D();
  scene.add(pedestrianGroup);
  pedestrianGroup.add(actor);
  actor.add(child);
  actor.visible = false;
  const objects = [scene, actor, child];
  const before = objects.map((object) => ({
    parent: object.parent,
    children: [...object.children],
    visible: object.visible,
    matrixAutoUpdate: object.matrixAutoUpdate,
    matrixWorldAutoUpdate: object.matrixWorldAutoUpdate,
  }));
  prepareSceneMatrices(scene, pedestrianGroup, new Set([actor]));
  objects.forEach((object, i) => {
    assert.equal(object.parent, before[i].parent);
    assert.deepEqual(object.children, before[i].children);
    assert.equal(object.visible, before[i].visible);
    assert.equal(object.matrixAutoUpdate, before[i].matrixAutoUpdate);
    assert.equal(object.matrixWorldAutoUpdate, before[i].matrixWorldAutoUpdate);
  });
});

test("ordinary scene children retain custom updateMatrixWorld overrides", () => {
  const scene = new THREE.Scene();
  const object = new THREE.Object3D();
  let calls = 0;
  const original = object.updateMatrixWorld;
  object.updateMatrixWorld = function (force) {
    calls++;
    return original.call(this, force);
  };
  scene.add(object);
  prepareSceneMatrices(scene);
  assert.equal(calls, 1);
});

test("a nested pedestrian group falls back to full ordinary traversal", () => {
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  const pedestrianGroup = new THREE.Group();
  const actor = new THREE.Group();
  const child = new THREE.Object3D();
  scene.add(parent);
  parent.add(pedestrianGroup);
  pedestrianGroup.add(actor);
  actor.add(child);
  actor.visible = false;
  prepareSceneMatrices(scene, pedestrianGroup, new Set([actor]));
  transform(parent, [5, 2, -1], [0.3, 0.6, -0.2], [1.4, 0.8, 2]);
  parent.updateMatrix();

  prepareSceneMatrices(scene, pedestrianGroup, new Set([actor]));
  const prepared = matrix(child);
  scene.updateMatrixWorld(true);
  closeMatrix(
    prepared,
    matrix(child),
    "nested group keeps normal full traversal",
  );
  assert.notDeepEqual(
    prepared,
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  );
});

test("explicit updateMatrixWorld(true) still updates hidden dormant descendants", () => {
  const scene = new THREE.Scene();
  const pedestrianGroup = new THREE.Group();
  const actor = new THREE.Group();
  const child = new THREE.Object3D();
  scene.add(pedestrianGroup);
  pedestrianGroup.add(actor);
  actor.add(child);
  actor.visible = false;
  prepareSceneMatrices(scene, pedestrianGroup, new Set([actor]));
  transform(actor, [4, 0, 0], [0, 0.4, 0], [1.5, 1, 1]);
  actor.updateMatrix();
  const stale = matrix(child);

  scene.updateMatrixWorld(true);
  assert.notDeepEqual(matrix(child), stale);
  closeMatrix(
    matrix(child),
    matrix(actor),
    "explicit standard update includes hidden descendant",
  );
});

test("two render passes share one prepared matrix update and restore renderer flags", () => {
  const scene = new THREE.Scene();
  const object = new THREE.Object3D();
  scene.add(object);
  const cameras = [
    new THREE.PerspectiveCamera(),
    new THREE.OrthographicCamera(),
  ];
  const observations = [];
  const renderer = {
    autoClear: true,
    render(renderedScene, camera) {
      observations.push({
        camera,
        autoClear: this.autoClear,
        sceneAutoUpdate: renderedScene.matrixWorldAutoUpdate,
        matrix: matrix(object),
      });
    },
  };
  let preparations = 0;
  renderScenePasses(renderer, scene, cameras, () => {
    preparations++;
    transform(object, [3, 4, 5], [0.4, -0.7, 0.2], [2, 0.6, 1.3]);
    object.updateMatrix();
    return prepareSceneMatrices(scene);
  });

  assert.equal(preparations, 1);
  assert.deepEqual(
    observations.map((item) => item.camera),
    cameras,
  );
  assert.deepEqual(
    observations.map((item) => item.autoClear),
    [true, false],
  );
  assert.deepEqual(
    observations.map((item) => item.sceneAutoUpdate),
    [false, false],
  );
  closeMatrix(
    observations[0].matrix,
    observations[1].matrix,
    "both passes observe the same matrix",
  );
  assert.equal(renderer.autoClear, true);
  assert.equal(scene.matrixWorldAutoUpdate, true);
});

test("render passes restore exact flags when autoClear starts false", () => {
  const scene = new THREE.Scene();
  const renderer = {
    autoClear: false,
    calls: 0,
    render() {
      this.calls++;
    },
  };
  renderScenePasses(renderer, scene, [new THREE.Camera(), new THREE.Camera()]);
  assert.equal(renderer.calls, 2);
  assert.equal(renderer.autoClear, false);
  assert.equal(scene.matrixWorldAutoUpdate, true);
});

test("render and preparation exceptions restore scene and renderer flags", () => {
  for (const failure of ["prepare", "render"]) {
    const scene = new THREE.Scene();
    scene.matrixWorldAutoUpdate = false;
    const renderer = {
      autoClear: false,
      calls: 0,
      render() {
        this.calls++;
        throw new Error("render failure");
      },
    };
    assert.throws(
      () =>
        renderScenePasses(
          renderer,
          scene,
          [new THREE.Camera(), new THREE.Camera()],
          failure === "prepare"
            ? () => {
                throw new Error("prepare failure");
              }
            : undefined,
        ),
      new RegExp(`${failure} failure`),
    );
    assert.equal(
      scene.matrixWorldAutoUpdate,
      false,
      `${failure}: restore original scene flag`,
    );
    assert.equal(
      renderer.autoClear,
      false,
      `${failure}: restore original autoClear`,
    );
    if (failure === "render") assert.equal(renderer.calls, 1);
  }
});
