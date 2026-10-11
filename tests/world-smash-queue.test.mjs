import test from "node:test";
import assert from "node:assert/strict";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Texture,
  Vector3,
} from "three";
import { WorldDestruction } from "../src/world-destruction.ts";
import { NativeSmashQueue } from "../src/smash-queue.ts";
import { flushWamSmashQueue } from "../src/damage.ts";

function connotations() {
  return {
    sounds: [],
    shrapnel: [],
    explosions: [],
    slick: null,
    activations: [],
    sideEffects: [],
    extensionFlags: 0,
    roomCode: 0,
    award: { frequency: "none" },
    variableChanges: [],
  };
}
function fixture(mode = "texturechange") {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      [0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 0, 0, 2, 2, 0, 0, 2, 0],
      3,
    ),
  );
  geometry.setAttribute(
    "uv",
    new Float32BufferAttribute([0, 0, 2, 0, 2, 2, 0, 0, 2, 2, 0, 2], 2),
  );
  geometry.computeVertexNormals();
  const material = new MeshLambertMaterial();
  material.name = "GLASS";
  material.map = new Texture();
  const mesh = new Mesh(geometry, material),
    root = new Group();
  root.add(mesh);
  const spec = {
    flags: 0,
    trigger: { kind: "material", name: "GLASS" },
    mode,
    reserved: [0, 0, 0, 0],
    levels: [
      {
        threshold: 1,
        flags: 0,
        collisionMode: "solid",
        pixelmaps: ["CRACK"],
        connotations: connotations(),
      },
      {
        threshold: 3,
        flags: 0,
        collisionMode: "passthrough",
        pixelmaps: ["BROKEN"],
        connotations: connotations(),
      },
    ],
  };
  const events = [],
    changes = [];
  let draws = 0;
  const runtime = new WorldDestruction(root, [spec], {
    textures: new Map([
      ["crack", new Texture()],
      ["broken", new Texture()],
    ]),
    random: () => {
      draws++;
      return 0;
    },
    onConnotations: (data, contact, suppressed) =>
      events.push({
        data,
        contact,
        suppressed,
        tier: mesh.material.find?.((m) => m.userData.worldSmashLevel > 0)
          ?.userData.worldSmashLevel,
      }),
    onChange: (change) => changes.push(change),
  });
  const queue = new NativeSmashQueue();
  runtime.configureSmashQueue(queue);
  const hit = (impulse, extra = {}) =>
    runtime.handleContact({
      actor: mesh,
      material: "GLASS",
      faceIndex: 0,
      normalImpulse: impulse,
      kind: "body",
      point: new Vector3(0.25, 0.25, 0),
      timeMs: 10,
      ...extra,
    });
  return {
    mesh,
    geometry,
    material,
    spec,
    events,
    changes,
    runtime,
    queue,
    hit,
    draws: () => draws,
  };
}
function addCar(queue, log = []) {
  let tier = 0;
  const key = {};
  queue.enqueue({
    key,
    targetTier: 1,
    getReachedTier: () => tier,
    getLevelCount: () => 2,
    hasModel: () => true,
    context: {
      execute: (target, reached, time) => {
        tier = target;
        log.push({ target, reached, time });
      },
    },
  });
  return key;
}

test("world geometry prepares immediately; mixed queue retains first snapshots and final-tier payload", () => {
  const f = fixture(),
    car = [];
  addCar(f.queue, car);
  const point = new Vector3(0.25, 0.25, 0),
    velocity = new Vector3(1, 2, 3),
    transform = new Matrix4().makeTranslation(4, 5, 6);
  const first = f.hit(1, {
    point,
    impacteeVelocity: velocity,
    impacteeTransform: transform,
  });
  assert.notEqual(f.mesh.geometry, f.geometry);
  assert.equal(first.changed, true);
  assert.equal(first.changes[0].level, 0);
  assert.equal(f.draws(), 0);
  assert.equal(f.events.length, 0);
  assert.equal(f.queue.count, 2);
  const patchFace = first.changes[0].affectedFaceIndices[0];
  const stableKey = f.queue.snapshot()[1].key;
  point.set(99, 99, 99);
  velocity.set(9, 9, 9);
  transform.makeTranslation(9, 9, 9);
  const stronger = f.hit(3, { faceIndex: patchFace, timeMs: 20 });
  assert.equal(stronger.threshold, 3);
  assert.equal(f.queue.snapshot()[1].key, stableKey);
  assert.equal(f.queue.count, 2);
  assert.equal(f.hit(3, { faceIndex: patchFace }).threshold, undefined);
  let clock = 100;
  flushWamSmashQueue(f.queue, () => clock++);
  assert.deepEqual(car, [{ target: 1, reached: 0, time: 100 }]);
  assert.equal(f.draws(), 1);
  assert.equal(f.events.length, 2);
  for (const event of f.events) {
    assert.equal(event.data, f.spec.levels[1].connotations);
    assert.equal(event.tier, 2);
    assert.equal(event.suppressed, true);
    assert.equal(event.contact.timeMs, 101);
    assert.deepEqual(event.contact.point.toArray(), [0.25, 0.25, 0]);
    assert.deepEqual(event.contact.impacteeVelocity.toArray(), [1, 2, 3]);
    assert.deepEqual(
      event.contact.impacteeTransform.elements.slice(12, 15),
      [4, 5, 6],
    );
  }
  assert.equal(f.queue.count, 0);
});

test("full mixed queue rejects an upgrade and new tile without returning an impulse cap", () => {
  const f = fixture();
  const prepared = f.hit(1),
    faceIndex = prepared.changes[0].affectedFaceIndices[0];
  for (let i = 0; i < 19; i++) addCar(f.queue);
  const upgrade = f.hit(3, { faceIndex });
  assert.equal(upgrade.changed, true);
  assert.equal(upgrade.threshold, undefined);
  assert.equal(f.queue.snapshot()[0].targetTier, 1);
  const newTile = f.hit(3, { faceIndex, point: new Vector3(1.25, 0.25, 0) });
  assert.equal(newTile.changed, true);
  assert.equal(newTile.threshold, undefined);
  assert.equal(f.queue.count, 20);
  flushWamSmashQueue(f.queue, () => 200);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].data, f.spec.levels[0].connotations);
});

test("below-threshold preparation consumes no queue slots or random draws", () => {
  const f = fixture();
  const result = f.hit(0.5);
  assert.equal(result.changed, true);
  assert.equal(result.changes[0].level, 0);
  assert.equal(result.threshold, undefined);
  assert.equal(f.queue.count, 0);
  assert.equal(f.draws(), 0);
});

test("live tier/count/model gates apply at flush and replacement geometry survives", () => {
  const f = fixture();
  f.hit(3);
  f.spec.levels.pop();
  const replacement = new BufferGeometry();
  f.mesh.geometry = replacement;
  f.mesh.visible = false;
  flushWamSmashQueue(f.queue, () => 300);
  assert.equal(f.mesh.geometry, replacement);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].data, f.spec.levels[0].connotations);
  assert.equal(f.changes.at(-1).level, 1);
  const missing = fixture();
  missing.hit(3);
  missing.mesh.geometry = null;
  flushWamSmashQueue(missing.queue, () => {
    throw Error("Model gate must precede clock");
  });
  assert.equal(missing.events.length, 0);
  const exhausted = fixture();
  exhausted.hit(3);
  exhausted.queue.snapshot()[0].key.level = 2;
  flushWamSmashQueue(exhausted.queue, () => 301);
  assert.equal(exhausted.events.length, 0);
});

test("decal permits activation callbacks; direct nochange does not occupy shared queue", () => {
  const f = fixture("decal");
  f.spec.levels[1].connotations.activations.push({});
  const activations = [];
  f.runtime.assets.onActivation = (data, contact) =>
    activations.push({ data, contact });
  const hit = f.hit(3);
  assert.equal(f.mesh.geometry, f.geometry);
  assert.ok(hit.changes[0].decal);
  assert.equal(activations.length, 0);
  flushWamSmashQueue(f.queue, () => 400);
  assert.equal(activations.length, 2);
  assert.equal(f.events[0].suppressed, false);
  const direct = fixture();
  direct.spec.mode = "nochange";
  direct.spec.removalThreshold = 1;
  direct.spec.connotations = connotations();
  assert.equal(direct.hit(1).changed, true);
  assert.equal(direct.events.length, 1);
  assert.equal(direct.queue.count, 0);
});
