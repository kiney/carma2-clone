import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { WorldCollision } from "../src/world.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { createNonCarBody } from "../src/physics/noncar-body.ts";
import { parseNonCarMechanics } from "../src/noncars.ts";
import { resolveContacts } from "../src/physics/contact.ts";
import { createModelGeometry } from "../src/render-geometry.ts";
import {
  createNativeActorOrder,
  knownNativeActorValue as known,
  removeNativeActor,
  prependNativeActor,
} from "../src/native-actor-order.ts";
import {
  createNativeTrackModelResource,
  prepareNativeTrackResource,
} from "../src/native-track-resources.ts";

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const model = {
  name: "participation-box",
  flags: 0x80,
  pivot: [0, 0, 0],
  positions: Float32Array.from([
    -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1,
    -1, 1, 1,
  ]),
  uvs: new Float32Array(16),
  materials: ["fixture-solid"],
  faces: [
    [0, 3, 2],
    [0, 2, 1],
    [4, 5, 6],
    [4, 6, 7],
    [0, 4, 7],
    [0, 7, 3],
    [1, 2, 6],
    [1, 6, 5],
    [0, 1, 5],
    [0, 5, 4],
    [3, 7, 6],
    [3, 6, 2],
  ].map((indices) => ({ indices, material: 1, flags: 0, smoothing: 0 })),
};
function mechanics(index = 7) {
  return parseNonCarMechanics(
    `101\n${index}\n0,0,0\n0,0,0\n1\nbox\n-1,-1,-1\n1,1,1\n1,1\n2,2,2\n0\n0\n0\nEND`,
  );
}
function fixture(count = 1, resetClock = true) {
  const mat = {
    name: "fixture-solid",
    rgba: [80, 80, 80, 255],
    flags: 4096,
    ambient: 1,
    diffuse: 0,
    specular: 0,
    power: 20,
    uvTransform: [1, 0, 0, 1, 0, 0],
  };
  const resource = createNativeTrackModelResource(
    model,
    () => known(mat),
    4,
  ).value;
  assert.equal(prepareNativeTrackResource(resource).resolved, true);
  const raw = {
    name: "column",
    type: 0,
    renderStyle: 0,
    transform: I,
    children: Array.from({ length: count }, (_, i) => ({
      name: `&07!${String(i + 1).padStart(4, "0")}.ACT`,
      type: 1,
      renderStyle: 4,
      transform: [...I.slice(0, 9), i * 4, 0, 0],
      model: model.name,
      children: [],
    })),
  };
  const state = createNativeActorOrder([raw], { model: () => known(resource) });
  const root = new THREE.Group(),
    objects = new Map([[state.roots[0], root]]),
    meshes = new Map(),
    initialGeometries = new Map();
  const bodies = state.actors.slice(1).map((actor, i) => {
    const object = new THREE.Group();
    object.name = actor.name;
    object.position.x = i * 4;
    const geometry = createModelGeometry(model),
      mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.name = model.name;
    object.add(mesh);
    root.add(object);
    objects.set(actor, object);
    meshes.set(actor, mesh);
    initialGeometries.set(actor, geometry);
    return createNonCarBody(object, mechanics(), { immutableHulls: true });
  });
  const scene = {
    layout: {
      originX: -10,
      originZ: -10,
      columnSizeX: 200,
      columnSizeZ: 20,
      countX: 1,
      countZ: 1,
    },
    columns: [[state.roots[0]]],
    additionalActors: null,
    nonTrackActors: createNativeActorOrder([
      { name: "nontrack", type: 0, renderStyle: 0, transform: I, children: [] },
    ]).roots[0],
    blackMaterial: mat,
    resources: new Map([
      [resource, resource],
      [model, resource],
    ]),
    actorObjects: objects,
    faceActors: objects,
    meshes,
    initialGeometries,
    actors: state.actors,
    noncars: [],
    initialBounds: { min: [-1, -1, -1], max: [180, 1, 1] },
    provenance: "native-query-with-host-resource-addresses",
  };
  const world = new WorldCollision(root, undefined, undefined, scene),
    simulation = new VehicleSimulation(world, root);
  // Each conformance case starts a fresh source process clock explicitly;
  // constructing a race itself deliberately does not reset native BSS.
  if (resetClock) simulation.noncarReclaim.accumulatorMs = 0;
  for (const body of bodies) simulation.addNonCar(body);
  const query = {
    bounds: new THREE.Box3(
      new THREE.Vector3(-2, -2, -2),
      new THREE.Vector3(2, 2, 2),
    ),
    matrix: new THREE.Matrix4(),
  };
  return { root, state, bodies, world, simulation, query };
}
function physicsCollection(f) {
  f.simulation.physicsQueryDepth++;
  try {
    return f.simulation.collectWorldFaces(f.query, 300, true);
  } finally {
    f.simulation.physicsQueryDepth--;
  }
}
function externalBody() {
  return {
    state: {
      position: new THREE.Vector3(),
      orientation: new THREE.Quaternion(),
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
    },
    properties: {
      mass: 1,
      inertia: new THREE.Vector3(1, 1, 1),
      centerOfMass: new THREE.Vector3(),
      worldFriction: 0,
    },
  };
}

test("retained noncar ACT remains static in both collectors without physics participation", () => {
  const f = fixture(),
    body = f.bodies[0];
  assert.equal(f.simulation.isNonCarPhysicsActive(body), false);
  assert.deepEqual(f.simulation.activeNonCars(), []);
  assert.deepEqual(f.simulation.allBodies(), []);
  assert.equal(f.simulation.phil.count, 0);
  assert.equal(f.simulation.nonCarSlots.count, 0);
  assert.equal(f.world.minimumWorldY, -1);
  assert.deepEqual(
    f.world.getNonCarModelBounds(body.actor).min.toArray(),
    [-1, -1, -1],
  );
  assert.equal(
    f.world.querySurfaces(f.query.bounds.min, f.query.bounds.max).length,
    12,
  );
  assert.equal(f.world.collectFaces(f.query, 300, true).length, 12);
  assert.equal(body.actor.userData.noncarPulled, false);
});

test("collection-time pull replaces static faces with an immediate quiet candidate and wakes before zero lambda", () => {
  const f = fixture(),
    body = f.bodies[0];
  assert.deepEqual(physicsCollection(f), []);
  assert.equal(f.simulation.isNonCarPhysicsActive(body), true);
  assert.deepEqual(f.simulation.activeNonCars(), [body]);
  assert.deepEqual(f.simulation.allBodies(), [body]);
  assert.deepEqual(f.simulation.nonCarSlots.get(body), {
    kind: "dedicated",
    mechanicsIndex: 7,
  });
  assert.equal(f.simulation.phil.getState(body), 2);
  assert.equal(f.simulation.nativeNonCarQuietState(body).doNothing, true);
  f.simulation.predictHierarchy(f.simulation.allBodies());
  assert.deepEqual(
    body.state.predictedPosition.toArray(),
    body.state.position.toArray(),
  );
  assert.equal(
    f.world
      .querySurfaces(f.query.bounds.min, f.query.bounds.max)
      .filter((s) => !s.owner).length,
    0,
  );
  assert.equal(f.world.collectFaces(f.query, 300, true).length, 0);
  const opposite = externalBody(),
    row = {
      a: opposite,
      b: body,
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(1, 0, 0),
      sourceType: 5,
    };
  const prepared = f.simulation.preparePedContacts([row]);
  assert.equal(f.simulation.nativeNonCarQuietState(body).doNothing, false);
  assert.equal(body.properties.immovable, false);
  assert.equal(body.motor.sleeping, false);
  assert.deepEqual(
    body.state.velocity.toArray(),
    [0, 0, 0],
    "wake applies no force or manufactured velocity",
  );
  // A stronger coupled row makes the first geometric row's lambda zero;
  // preserve the solver's real .01 rest minimum instead of overriding it.
  opposite.state.angularVelocity.z = 1;
  const stronger = { ...row, point: new THREE.Vector3(0, 1, 0) };
  const impacts = resolveContacts([...prepared, stronger], 0.04);
  assert.equal(impacts[0].normalImpulse, 0);
  assert.ok(impacts[1].normalImpulse > 0);
});

test("physical capacity defers a valid ACT and retries after a slot becomes free", () => {
  const f = fixture(),
    body = f.bodies[0],
    owners = Array.from({ length: 41 }, () => ({}));
  for (const owner of owners)
    assert.ok(f.simulation.nonCarSlots.claim(owner, 7));
  assert.equal(physicsCollection(f).length, 12);
  assert.equal(body.actor.name[1], "0");
  assert.equal(f.state.actors[1].name[1], "0");
  assert.equal(f.simulation.phil.count, 0);
  assert.equal(f.simulation.isNonCarPhysicsActive(body), false);
  assert.equal(f.simulation.nonCarAdmissionFailures.capacity, 1);
  assert.equal(f.simulation.nonCarSlots.count, 41);
  assert.equal(
    f.world.querySurfaces(f.query.bounds.min, f.query.bounds.max).length,
    12,
    "deferred ACT still supplies static collision faces",
  );
  f.simulation.nonCarSlots.release(owners[0]);
  assert.deepEqual(physicsCollection(f), []);
  assert.equal(f.simulation.isNonCarPhysicsActive(body), true);
  assert.equal(f.simulation.nonCarSlots.count, 41);
  assert.equal(f.simulation.phil.count, 1);
  assert.equal(
    f.world.querySurfaces(f.query.bounds.min, f.query.bounds.max).length,
    0,
    "successful retry replaces static faces instead of duplicating them",
  );
});

test("missing mechanics keeps the native permanent static failure separately from capacity", () => {
  const f = fixture();
  f.simulation.noncarsByActor.delete(f.bodies[0].actor);
  assert.equal(physicsCollection(f).length, 12);
  assert.equal(f.bodies[0].actor.name[1], "x");
  assert.equal(f.state.actors[1].name[1], "x");
  assert.equal(f.simulation.nonCarAdmissionFailures.missingMechanics, 1);
  assert.equal(f.simulation.nonCarAdmissionFailures.capacity, 0);
  assert.equal(f.simulation.nonCarSlots.count, 0);
});

test("ordinary reclaim invalidates a waiting ACT cache and the next local collection retries", () => {
  const f = fixture(42),
    waiting = f.bodies.at(-1),
    observer = externalBody();
  observer.state.position.copy(waiting.state.position);
  for (const body of f.bodies.slice(0, 41))
    assert.equal(f.simulation.admitNonCar(body), true);
  const collect = () => {
    f.simulation.physicsQueryDepth++;
    try {
      return f.simulation.facesNearBody(observer, waiting.hulls);
    } finally {
      f.simulation.physicsQueryDepth--;
    }
  };
  assert.equal(collect().length, 12);
  const cache = f.simulation.worldFaceStates.get(observer);
  assert.equal(f.simulation.worldFaceCache.valid(cache), true);
  assert.equal(f.simulation.nonCarSlots.count, 41);
  assert.equal(f.simulation.isNonCarPhysicsActive(waiting), false);
  const attempts = f.simulation.nonCarAdmissionFailures.capacity;
  assert.equal(collect().length, 12);
  assert.equal(
    f.simulation.nonCarAdmissionFailures.capacity,
    attempts,
    "a cache hit does not spin on a full pool",
  );
  f.simulation.finishNonCarReclaim(1000);
  assert.equal(f.simulation.nonCarSlots.count, 0);
  assert.equal(f.simulation.worldFaceCache.valid(cache), false);
  assert.deepEqual(collect(), []);
  assert.equal(f.simulation.isNonCarPhysicsActive(waiting), true);
  assert.equal(f.simulation.nonCarSlots.count, 1);
});

test("PHIL header exhaustion rolls back ownership and retains retryable static ACT", () => {
  const f = fixture(),
    body = f.bodies[0],
    headers = Array.from({ length: 100 }, externalBody);
  for (const header of headers)
    assert.equal(f.simulation.phil.registerImmediate(header), 0);
  body.state.velocity.set(3, 4, 5);
  body.state.angularVelocity.set(6, 7, 8);
  assert.equal(physicsCollection(f).length, 12);
  assert.equal(
    body.actor.name[1],
    "0",
    "header failure is distinct from native sticky physical exhaustion",
  );
  assert.equal(f.simulation.nonCarSlots.count, 0);
  assert.equal(f.simulation.nativeNonCarQuietState(body), null);
  assert.deepEqual(body.state.velocity.toArray(), [3, 4, 5]);
  assert.deepEqual(body.state.angularVelocity.toArray(), [6, 7, 8]);
  assert.equal(
    f.world.querySurfaces(f.query.bounds.min, f.query.bounds.max).length,
    12,
  );
  f.simulation.phil.remove(headers[0]);
  assert.deepEqual(physicsCollection(f), []);
  assert.equal(f.simulation.nonCarSlots.count, 1);
  assert.equal(f.simulation.phil.count, 100);
  assert.equal(f.simulation.isNonCarPhysicsActive(body), true);
});

test("explicit debris reservation and ordinary ACT pulls share one dedicated/extra pool", () => {
  const f = fixture(2),
    [debris, prop] = f.bodies;
  const dedicated = { kind: "dedicated", mechanicsIndex: 7 };
  assert.equal(
    f.simulation.admitNonCar(debris, { slot: dedicated, wake: true }),
    true,
  );
  assert.equal(
    f.simulation.admitNonCar(debris, { slot: { kind: "extra", index: 1 } }),
    false,
  );
  assert.equal(f.simulation.nonCarSlots.count, 1);
  assert.equal(f.simulation.phil.count, 1);
  // Production debris host.pull admits before host.registerBody catalogs it.
  f.simulation.addNonCar(debris);
  assert.equal(debris.actor.userData.noncarPulled, true);
  assert.equal(debris.actor.userData.c2ActorTypeData, debris);
  assert.equal(f.simulation.nativeNonCarQuietState(debris).doNothing, false);
  f.query.matrix.makeTranslation(4, 0, 0);
  assert.deepEqual(physicsCollection(f), []);
  assert.deepEqual(f.simulation.nonCarSlots.get(prop), {
    kind: "extra",
    index: 0,
  });
  assert.equal(f.simulation.nonCarSlots.ownerOf(dedicated), debris);
  assert.equal(f.simulation.nonCarSlots.count, 2);
  assert.equal(f.simulation.phil.count, 2);
});

test("an approaching registered prop pulls a static ACT during the real fixed step", () => {
  const f = fixture(2),
    [target, source] = f.bodies;
  source.state.position.set(2.005, 0, 0);
  source.actor.position.copy(source.state.position);
  assert.equal(f.simulation.admitNonCar(source, { wake: true }), true);
  source.state.velocity.set(-1, 0, 0);
  assert.equal(f.simulation.isNonCarPhysicsActive(target), false);
  f.simulation.step();
  assert.equal(f.simulation.isNonCarPhysicsActive(target), true);
  assert.equal(f.simulation.nativeNonCarQuietState(target).doNothing, false);
  assert.equal(f.simulation.nonCarSlots.count, 2);
  assert.ok(
    f.simulation.lastImpacts.some(
      (row) => row.a === target || row.b === target,
    ),
  );
  assert.ok(Number.isFinite(target.state.position.x));
  assert.equal(f.world.collectFaces(f.query, 300, true).length, 0);
});

test("outer-frame reclaim retains ACT/MODEL, frees participation, and permits collection-time repull", () => {
  const f = fixture(2),
    [target, source] = f.bodies;
  assert.deepEqual(physicsCollection(f), []);
  const nativeTarget = f.state.actors[1],
    resource = nativeTarget.localModel.value;
  const initialCount = f.simulation.noncars.length;
  source.state.position.set(40, 0, 0);
  source.actor.position.copy(source.state.position);
  assert.equal(f.simulation.admitNonCar(source, { wake: true }), true);
  f.simulation.facesNearBody(source, source.hulls);
  target.motor.sleeping = false; // Reclaim follows authoritative ec, not this flag.
  f.simulation.finishNonCarReclaim(999);
  assert.equal(f.simulation.isNonCarPhysicsActive(target), true);
  f.simulation.finishNonCarReclaim(1);
  assert.equal(f.simulation.isNonCarPhysicsActive(target), false);
  assert.equal(f.simulation.isNonCarPhysicsActive(source), true);
  assert.equal(f.simulation.nonCarSlots.get(target), null);
  assert.equal(f.simulation.noncars.length, initialCount);
  assert.equal(nativeTarget.localModel.value, resource);
  assert.equal(nativeTarget.parent, f.state.roots[0]);
  assert.equal(target.actor.userData.noncarPulled, false);
  assert.equal(target.actor.userData.c2ActorTypeData, undefined);
  assert.equal(
    f.world
      .querySurfaces(f.query.bounds.min, f.query.bounds.max)
      .filter((row) => !row.owner).length,
    12,
  );
  assert.equal(f.world.collectFaces(f.query, 300, true).length, 12);
  assert.deepEqual(physicsCollection(f), []);
  assert.equal(f.simulation.isNonCarPhysicsActive(target), true);
  assert.equal(f.simulation.nonCarSlots.count, 2);
});

test("reclaim preserves the additional-actor return sentinel captured before pull reparenting", () => {
  const f = fixture(),
    body = f.bodies[0],
    actor = f.state.actors[1];
  const additional = createNativeActorOrder([
    { name: "additional", type: 0, renderStyle: 0, transform: I, children: [] },
  ]).roots[0];
  f.world.nativeScene.additionalActors = additional;
  removeNativeActor(actor);
  prependNativeActor(additional, actor);
  assert.equal(f.world.collectFaces(f.query, 300, true).length, 12);
  assert.deepEqual(physicsCollection(f), []);
  assert.equal(actor.parent, f.world.nativeScene.nonTrackActors);
  f.simulation.finishNonCarReclaim(1000);
  assert.equal(f.simulation.isNonCarPhysicsActive(body), false);
  assert.equal(actor.parent, additional);
  assert.equal(f.world.collectFaces(f.query, 300, true).length, 12);
});

test("unsupported active owners advance reclaim cadence while missing caches conservatively retain slots", () => {
  const f = fixture(2),
    [target, unsupported] = f.bodies;
  unsupported.mechanics = {
    ...unsupported.mechanics,
    tumble: { factor: 1, threshold: 1 },
  };
  unsupported.state.position.set(40, 0, 0);
  unsupported.actor.position.copy(unsupported.state.position);
  assert.equal(f.simulation.admitNonCar(unsupported, { wake: true }), true);
  assert.equal(f.simulation.nativeNonCarQuietState(unsupported), null);
  // These active frames have no supported reclaim candidates or query cache.
  // The native clock still reaches its boundary and discards excess.
  f.simulation.finishNonCarReclaim(600);
  assert.equal(f.simulation.isNonCarPhysicsActive(unsupported), true);
  assert.equal(f.simulation.admitNonCar(target), true);
  f.simulation.finishNonCarReclaim(400);
  assert.equal(
    f.simulation.isNonCarPhysicsActive(target),
    true,
    "missing awake query cache blocks removal at the clock boundary",
  );
  f.simulation.facesNearBody(unsupported, unsupported.hulls);
  f.simulation.finishNonCarReclaim(999);
  assert.equal(f.simulation.isNonCarPhysicsActive(target), true);
  f.simulation.finishNonCarReclaim(1);
  assert.equal(f.simulation.isNonCarPhysicsActive(target), false);
  assert.equal(f.simulation.isNonCarPhysicsActive(unsupported), true);
});

test("the source reclaim clock survives race disposal and a new simulation", () => {
  const first = fixture(),
    oldBody = first.bodies[0];
  assert.equal(first.simulation.admitNonCar(oldBody), true);
  first.simulation.finishNonCarReclaim(600);
  assert.equal(first.simulation.isNonCarPhysicsActive(oldBody), true);
  first.simulation.dispose();
  const second = fixture(1, false),
    body = second.bodies[0];
  assert.equal(second.simulation.admitNonCar(body), true);
  second.simulation.finishNonCarReclaim(399);
  assert.equal(second.simulation.isNonCarPhysicsActive(body), true);
  second.simulation.finishNonCarReclaim(1);
  assert.equal(second.simulation.isNonCarPhysicsActive(body), false);
  assert.equal(second.world.collectFaces(second.query, 300, true).length, 12);
});

test("ignored-world noncar still collects and retains predictive ACT bounds for reclaim", () => {
  const f = fixture(3),
    [far, near, source] = f.bodies;
  // Keep one sleeping prop at the origin, one beside the source's predictive
  // query, and the ignored-world source 40 units away from its authored pose.
  far.state.position.set(0, 0, 0);
  near.state.position.set(40, 0, 0);
  source.state.position.set(40, 0, 0);
  for (const body of f.bodies) body.actor.position.copy(body.state.position);
  source.mechanics = { ...source.mechanics, ignoreWorldCollisions: true };

  // Quiet props are eligible for ordinary outer-frame reclaim.
  assert.equal(f.simulation.admitNonCar(far), true);
  assert.equal(f.simulation.admitNonCar(near), true);
  assert.equal(f.simulation.admitNonCar(source, { wake: true }), true);
  source.motor.sleeping = true; // ec remains awake, like the native path.
  assert.equal(source.properties.immovable, false);

  const gathers = [],
    collectFaces = f.world.collectFaces.bind(f.world);
  f.world.collectFaces = (query, maximum, gatherModels, options) => {
    gathers.push(gatherModels);
    return collectFaces(query, maximum, gatherModels, options);
  };

  // Exercise the production contact entry point. The ignored-world flag must
  // suppress contacts while still running GetFacesNearObject's cache query.
  assert.deepEqual(f.simulation.worldContacts(source, source.hulls), []);
  const cache = f.simulation.worldFaceStates.get(source);
  assert.ok(cache, "world contact query creates predictive face state");
  assert.equal(f.simulation.worldFaceCache.valid(cache), true);
  assert.ok(gathers.length > 0, "ordinary world face collector ran");
  assert.ok(gathers.every((gatherModels) => gatherModels === false));
  assert.ok(cache.bounds.min.x < -1 && cache.bounds.max.x > 1);
  assert.ok(Math.abs(cache.inverse.elements[12] + 40) < 1e-5);
  assert.equal(
    cache.start,
    cache.end,
    "ignore-world query retains no physical faces",
  );

  // The ordinary collection callback was invoked without gathering models;
  // the synthetic fixture has no native owner faces, so retained bounds are
  // the important output of this zero-face GetFacesNearObject pass.
  const quietState = f.simulation.nativeNonCarQuietState(near);
  assert.equal(quietState.doNothing, true);
  assert.equal(f.simulation.nativeNonCarQuietState(far).doNothing, true);
  f.simulation.finishNonCarReclaim(1000);
  assert.equal(
    f.simulation.isNonCarPhysicsActive(near),
    true,
    "a quiet prop intersecting another body's valid retained bounds stays admitted",
  );
  assert.equal(
    f.simulation.isNonCarPhysicsActive(far),
    false,
    "a quiet prop outside every retained query can be reclaimed",
  );
  assert.equal(f.simulation.isNonCarPhysicsActive(source), true);
});

test("immovable bodies still suppress world-face cache collection", () => {
  const f = fixture(),
    body = f.bodies[0];
  body.properties.immovable = true;
  assert.deepEqual(f.simulation.worldContacts(body, body.hulls), []);
  assert.equal(f.simulation.worldFaceStates.has(body), false);
});

test("production reclaim does not read MODEL providers on inactive or sub-threshold frames", () => {
  const f = fixture(),
    body = f.bodies[0];
  const original = f.world.getNonCarModelBounds.bind(f.world);
  let modelReads = 0;
  f.world.getNonCarModelBounds = (actor) => {
    modelReads++;
    return original(actor);
  };
  f.simulation.finishNonCarReclaim(5000);
  assert.equal(modelReads, 0);
  assert.equal(f.simulation.admitNonCar(body), true);
  f.simulation.finishNonCarReclaim(999);
  assert.equal(modelReads, 0);
  assert.equal(f.simulation.isNonCarPhysicsActive(body), true);
  f.simulation.finishNonCarReclaim(1);
  assert.equal(modelReads, 1);
  assert.equal(f.simulation.isNonCarPhysicsActive(body), false);
  f.simulation.finishNonCarReclaim(5000);
  assert.equal(modelReads, 1);
});
