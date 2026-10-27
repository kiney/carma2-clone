import test from "node:test";
import assert from "node:assert/strict";
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  Vector3,
} from "three";
import { ExplosionRuntime } from "../src/explosion.ts";
import { spawnSmashExplosions } from "../src/smash-explosion.ts";

function modelGeometry(max = 2, valid = true) {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([0, 0, 0, max, 0, 0, 0, max, 0]), 3),
  );
  if (valid) {
    geometry.userData.sourcePositions = new Float32Array([
      0,
      0,
      0,
      max,
      0,
      0,
      0,
      max,
      0,
    ]);
    geometry.userData.c2VertexLayout = "source";
    geometry.userData.modelFlags = 0;
  }
  return geometry;
}
function texture(color) {
  return new DataTexture(
    new Uint8Array([...color, 255]),
    1,
    1,
    RGBAFormat,
    UnsignedByteType,
  );
}
function explosion(pixelmap = "SHARED.PIX", xFactors = [0, 0]) {
  return {
    amount: [1, 1],
    delaySeconds: [0, 0],
    offset: [0, 0, 0],
    xFactor: xFactors,
    yFactor: [0, 0],
    zFactor: [0, 0],
    frameRate: [100, 100],
    scale: [6.9, 6.9],
    rotation: "norotate",
    frames: [{ opacity: 100, pixelmap }],
  };
}
function actorWithModel(name, geometry = modelGeometry()) {
  const actor = new Group();
  actor.name = name;
  actor.add(new Mesh(geometry, new MeshBasicMaterial()));
  return actor;
}
function readWorld(actor) {
  return () => {
    actor.updateWorldMatrix(true, false);
    return actor.matrixWorld.clone();
  };
}

test("offscreen actor-origin gate precedes invalid MODEL validation and RNG", () => {
  let randomCalls = 0;
  const scene = new Scene();
  const runtime = new ExplosionRuntime(scene, new Map(), {
    random: () => {
      randomCalls++;
      return 0.5;
    },
  });
  const actor = actorWithModel("bad-car-part", modelGeometry(2, false));
  actor.position.set(7, 8, 9);
  const checked = [];
  assert.equal(
    spawnSmashExplosions(runtime, [{ ...explosion(), frames: [] }], actor, {
      timeMs: 0,
      isVisible: (point) => {
        checked.push(point.clone());
        return false;
      },
    }),
    0,
  );
  assert.deepEqual(checked[0].toArray(), [7, 8, 9]);
  assert.equal(randomCalls, 0);
  assert.equal(runtime.activeCount, 0);
  runtime.dispose();
});

test("ACT-owned animation follows its live affine frame, independent of another car", () => {
  const globalTexture = texture([255, 0, 0]);
  const scopedTexture = texture([0, 255, 0]);
  const scene = new Scene();
  const runtime = new ExplosionRuntime(
    scene,
    new Map([["SHARED", globalTexture]]),
    {
      random: () => 0.5,
    },
  );
  const unrelatedCar = new Group();
  unrelatedCar.position.x = 1000;
  const actor = actorWithModel("detached-queued-actor");
  actor.position.set(10, 20, 30);
  actor.rotation.z = Math.PI / 2;
  actor.scale.set(2, 3, 1);
  const visibilityOrigin = [];
  const groups = [explosion("SHARED.PIX", [0, 0])];
  assert.equal(
    spawnSmashExplosions(runtime, groups, actor, {
      readMatrix: readWorld(actor),
      timeMs: 0,
      isVisible: (point) => {
        visibilityOrigin.push(point.clone());
        return true;
      },
      textures: new Map([["SHARED.PIX", scopedTexture]]),
    }),
    1,
  );
  assert.deepEqual(visibilityOrigin[0].toArray(), [10, 20, 30]);
  const sprite = scene.children[0];
  assert.equal(sprite.material.map, scopedTexture);
  assert.notEqual(sprite.material.map, globalTexture);
  assert.deepEqual(sprite.position.toArray(), [10, 20, 30]);
  actor.position.set(40, 50, 60);
  runtime.update(1);
  assert.deepEqual(sprite.position.toArray(), [40, 50, 60]);
  runtime.dispose();
  globalTexture.dispose();
  scopedTexture.dispose();
});

test("explosion offsets use the queued ACT direct MODEL bounds, excluding child models", () => {
  const map = texture([255, 255, 255]);
  const scene = new Scene();
  const runtime = new ExplosionRuntime(scene, new Map([["SHARED", map]]), {
    random: () => 0.75,
  });
  const actor = actorWithModel("car-part", modelGeometry(2));
  const child = new Group();
  child.add(new Mesh(modelGeometry(100), new MeshBasicMaterial()));
  actor.add(child);
  actor.position.x = 10;
  assert.equal(
    spawnSmashExplosions(runtime, [explosion("SHARED.PIX", [1, 1])], actor, {
      timeMs: 0,
      isVisible: () => true,
    }),
    1,
  );
  // The random sign is negative; the x offset comes from direct MODEL max=2,
  // not the child MODEL's max=100.
  assert.ok(Math.abs(scene.children[0].position.x - 8) < 1e-6);
  runtime.dispose();
  map.dispose();
});
