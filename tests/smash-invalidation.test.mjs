import test from "node:test";
import assert from "node:assert/strict";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
  Texture,
  Vector3,
} from "three";
import { WorldDestruction } from "../src/world-destruction.ts";
import { NativeSmashQueue } from "../src/smash-queue.ts";
import { flushWamSmashQueue } from "../src/damage.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { WorldCollision } from "../src/world.ts";

function effects() {
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

function fixture(mode = "texturechange", additionalSpecs = []) {
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
  mesh.name = "panel";
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
        connotations: effects(),
      },
      {
        threshold: 3,
        flags: 0,
        collisionMode: "passthrough",
        pixelmaps: ["BROKEN"],
        connotations: effects(),
      },
    ],
  };
  let draws = 0;
  const changes = [],
    events = [];
  const runtime = new WorldDestruction(root, [spec, ...additionalSpecs], {
    textures: new Map([
      ["crack", new Texture()],
      ["broken", new Texture()],
    ]),
    random: () => {
      draws++;
      return 0;
    },
    onChange: (change) => changes.push(change),
    onConnotations: (data, contact, suppressed) =>
      events.push({ data, contact, suppressed }),
  });
  const queue = new NativeSmashQueue();
  runtime.configureSmashQueue(queue);
  const hit = (normalImpulse, extra = {}) =>
    runtime.handleContact({
      actor: mesh,
      material: "GLASS",
      faceIndex: 0,
      normalImpulse,
      kind: "body",
      point: new Vector3(0.25, 0.25, 0),
      timeMs: 10,
      ...extra,
    });
  const flush = () => flushWamSmashQueue(queue, () => 200);
  return {
    root,
    mesh,
    geometry,
    runtime,
    spec,
    queue,
    changes,
    events,
    hit,
    flush,
    draws: () => draws,
  };
}

test("smash preparation dirties the first tile while unchanged below-threshold reuse still notifies and restarts", () => {
  const f = fixture();
  const first = f.hit(0.5);
  assert.equal(first.changed, true);
  assert.equal(first.changes[0].requiresRebuild, true);
  assert.equal(first.changes[0].geometryChanged, true);
  assert.equal(f.runtime.geometryRevision, 1);
  assert.deepEqual(f.runtime.drainCollisionChanges(), [f.mesh]);
  assert.deepEqual(f.runtime.drainCollisionChanges(), []);
  const geometry = f.mesh.geometry,
    position = geometry.getAttribute("position"),
    faceIndex = first.changes[0].affectedFaceIndices[0];
  for (let i = 0; i < 3; i++) {
    const reused = f.hit(0.5, { faceIndex });
    assert.equal(reused.changed, true);
    assert.equal(reused.changes[0].requiresRebuild, true);
    assert.equal(reused.changes[0].geometryChanged, false);
    assert.equal(reused.threshold, undefined);
  }
  assert.equal(
    f.changes.length,
    4,
    "every native preparation notification survives",
  );
  assert.equal(f.mesh.geometry, geometry);
  assert.equal(f.mesh.geometry.getAttribute("position"), position);
  assert.equal(position.version, 0);
  assert.equal(f.runtime.geometryRevision, 1);
  assert.deepEqual(f.runtime.drainCollisionChanges(), []);
  assert.equal(f.queue.count, 0);
  assert.equal(f.draws(), 0);
  assert.equal(f.events.length, 0);
});

test("equal and lower pending tiers retain first context; higher tiers defer dirtiness and their native cap until flush", () => {
  const f = fixture();
  const first = f.hit(1),
    faceIndex = first.changes[0].affectedFaceIndices[0],
    geometry = f.mesh.geometry,
    key = f.queue.snapshot()[0].key;
  f.runtime.drainCollisionChanges();
  for (const impulse of [0.5, 1]) {
    const result = f.hit(impulse, { faceIndex, timeMs: 99 });
    assert.equal(result.changed, true);
    assert.equal(result.changes[0].requiresRebuild, true);
    assert.equal(result.changes[0].geometryChanged, false);
    assert.equal(result.threshold, undefined);
  }
  const stronger = f.hit(3, { faceIndex, timeMs: 99 });
  assert.equal(stronger.threshold, 3);
  assert.equal(stronger.changes[0].geometryChanged, false);
  assert.equal(f.hit(3, { faceIndex }).threshold, undefined);
  assert.equal(f.queue.count, 1);
  assert.equal(f.queue.snapshot()[0].key, key);
  assert.equal(f.queue.snapshot()[0].targetTier, 2);
  assert.equal(f.mesh.geometry, geometry);
  assert.deepEqual(f.runtime.drainCollisionChanges(), []);
  assert.equal(f.runtime.geometryRevision, 1);
  assert.equal(f.flush(), 1);
  assert.equal(f.runtime.geometryRevision, 2);
  assert.deepEqual(f.runtime.drainCollisionChanges(), [f.mesh]);
  assert.notEqual(f.mesh.geometry, geometry);
  assert.equal(f.changes.at(-1).collisionMode, "passthrough");
  assert.equal(f.changes.at(-1).geometryChanged, true);
  assert.equal(f.draws(), 1);
  assert.equal(f.events.length, 2);
  assert.ok(
    f.events.every((event) => event.contact.timeMs === 200 && event.suppressed),
  );
  assert.equal(
    f.hit(3, { faceIndex }).changed,
    false,
    "final-tier preparation remains exhausted",
  );
});

test("full shared queue rejects existing upgrades without dirtiness, but still prepares a new rejected tile", () => {
  const f = fixture(),
    first = f.hit(1),
    faceIndex = first.changes[0].affectedFaceIndices[0];
  f.runtime.drainCollisionChanges();
  for (let i = 0; i < 19; i++)
    f.queue.enqueue({
      key: {},
      targetTier: 1,
      getReachedTier: () => 0,
      getLevelCount: () => 2,
      hasModel: () => true,
      context: { execute: () => {} },
    });
  const rejected = f.hit(3, { faceIndex });
  assert.equal(rejected.changed, true);
  assert.equal(rejected.changes[0].requiresRebuild, true);
  assert.equal(rejected.changes[0].geometryChanged, false);
  assert.equal(rejected.threshold, undefined);
  assert.deepEqual(f.runtime.drainCollisionChanges(), []);
  assert.equal(f.queue.snapshot()[0].targetTier, 1);
  const next = f.hit(3, { faceIndex, point: new Vector3(1.25, 0.25, 0) });
  assert.equal(next.changed, true);
  assert.equal(next.changes[0].geometryChanged, true);
  assert.equal(next.threshold, undefined);
  assert.deepEqual(f.runtime.drainCollisionChanges(), [f.mesh]);
  assert.equal(f.queue.count, 20);
  f.flush();
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].data, f.spec.levels[0].connotations);
  assert.equal(f.draws(), 1);
});

test("pending texture effects do not invalidate or resurrect an intervening replacement model", () => {
  const replacementSpec = {
    flags: 0,
    trigger: { kind: "model", name: "panel" },
    mode: "replacemodel",
    reserved: [0, 0, 0, 0],
    levels: [],
    removalThreshold: 4,
    replacement: { model: "replacement", fire: { chance: 0 } },
    connotations: effects(),
  };
  const f = fixture("texturechange", [replacementSpec]);
  const prepared = f.hit(3);
  f.runtime.drainCollisionChanges();
  f.runtime.assets.resolveModel = () => ({ geometry: f.geometry });
  const replacement = f.hit(4, {
    faceIndex: prepared.changes[0].affectedFaceIndices[0],
  });
  assert.ok(
    replacement.changes.some(
      (change) => change.mode === "replacemodel" && change.geometryChanged,
    ),
  );
  assert.deepEqual(f.runtime.drainCollisionChanges(), [f.mesh]);
  const geometry = f.mesh.geometry,
    revision = f.runtime.geometryRevision;
  f.flush();
  assert.equal(f.mesh.geometry, geometry);
  assert.equal(f.mesh.name, "replacement");
  assert.equal(f.changes.at(-1).geometryChanged, false);
  assert.equal(f.runtime.geometryRevision, revision);
  assert.deepEqual(f.runtime.drainCollisionChanges(), []);
  assert.equal(f.events.at(-1).data, f.spec.levels[1].connotations);
});

test("decal creation, reuse and queued effects retain notifications without collision dirtiness", () => {
  const f = fixture("decal");
  const first = f.hit(1),
    decal = first.changes[0].decal;
  const second = f.hit(3);
  assert.equal(first.changed, true);
  assert.equal(second.changed, true);
  assert.equal(second.changes[0].decal, decal);
  assert.equal(
    first.changes[0].requiresRebuild,
    false,
    "retain existing decal solver behavior",
  );
  assert.equal(first.changes[0].geometryChanged, false);
  assert.equal(f.mesh.geometry, f.geometry);
  assert.equal(f.runtime.geometryRevision, 0);
  assert.deepEqual(f.runtime.drainCollisionChanges(), []);
  f.flush();
  assert.equal(f.runtime.geometryRevision, 0);
  assert.deepEqual(f.runtime.drainCollisionChanges(), []);
  assert.equal(f.events.length, 2);
  assert.ok(f.events.every((event) => event.suppressed === false));
});

test("body solver restarts unchanged tiles without rebuilding or invalidating retained world faces", () => {
  const f = fixture(),
    world = new WorldCollision(f.root),
    sim = new VehicleSimulation(world, f.root);
  sim.destruction = f.runtime;
  f.runtime.configureSmashQueue(sim.smashQueue);
  let invalidations = 0,
    notifications = 0;
  sim.invalidateWorldFaceCache = () => invalidations++;
  sim.onWorldGeometryChanged = () => notifications++;
  world.rebuildStatic = () =>
    assert.fail("local smash must not globally rebuild static owners");
  const body = {
    hulls: [],
    actor: new Group(),
    state: { velocity: new Vector3() },
  };
  const collide = (faceIndex) => {
    const row = {
      a: body,
      point: new Vector3(0.25, 0.25, 0),
      normal: new Vector3(0, 0, 1),
      normalImpulse: 0.5,
      sourceType: 1,
      sourceSurface: { actor: f.mesh, faceIndex, material: "GLASS" },
    };
    const restarts = [];
    assert.equal(sim.processWorldSmash([row], restarts), true);
    assert.equal(restarts.length, 1);
    assert.ok(restarts[0].has(body));
    assert.equal(row.sourceType, 9);
    assert.equal(row.normalImpulse, 0);
  };
  collide(0);
  const faceIndex = f.changes[0].affectedFaceIndices[0];
  assert.equal(invalidations, 1);
  assert.equal(notifications, 1);
  collide(faceIndex);
  assert.equal(invalidations, 1);
  assert.equal(notifications, 1);
  assert.equal(f.changes.length, 2);
  assert.equal(sim.smashQueue.count, 0);
});

test("wheel callers synchronize first preparation while unchanged wheel requests preserve notification without cache invalidation", () => {
  const f = fixture(),
    world = new WorldCollision(f.root),
    sim = new VehicleSimulation(world, f.root);
  sim.destruction = f.runtime;
  f.runtime.configureSmashQueue(sim.smashQueue);
  let invalidations = 0;
  sim.invalidateWorldFaceCache = () => invalidations++;
  world.rebuildStatic = () =>
    assert.fail("wheel smash must not globally rebuild static owners");
  const car = { group: new Group(), state: { velocity: new Vector3() } };
  const wheelContact = (faceIndex) =>
    sim.oilGround(car).worldWheelContact([
      {
        hit: { surface: { actor: f.mesh, faceIndex, material: "GLASS" } },
        load: 12.5,
        point: new Vector3(0.25, 0.25, 0),
      },
    ]);
  wheelContact(0);
  const faceIndex = f.changes[0].affectedFaceIndices[0];
  assert.equal(invalidations, 1);
  wheelContact(faceIndex);
  assert.equal(invalidations, 1);
  assert.equal(f.changes.length, 2);
  assert.equal(f.changes[1].geometryChanged, false);
  assert.equal(f.changes[1].requiresRebuild, true);
  assert.equal(sim.smashQueue.count, 0);
});
