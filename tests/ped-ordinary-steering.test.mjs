import assert from "node:assert/strict";
import test from "node:test";
import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { OrdinaryPedSteering } from "../src/ped-ordinary-steering.ts";
import { scanNativeOrdinaryPedObjects } from "../src/ped-ordinary-object-scan.ts";
import { NativeRandom } from "../src/native-random.ts";
import { sharedNativeRandom } from "../src/native-random.ts";
import { NativeResourceArena } from "../src/native-resource-arena.ts";
import { WorldCollision } from "../src/world.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { NativePedRuntime } from "../src/ped-native-runtime.ts";
import { NativePedGameplay } from "../src/ped-native-gameplay.ts";
import { NativePedProcessCachePool } from "../src/ped-process-cache.ts";
import { createNativePedPoolSettings } from "../src/ped-body-pool.ts";
import { nativePedBoxInertia } from "../src/ped-form.ts";
import { createModelGeometry } from "../src/render-geometry.ts";
import {
  createNativeActorOrder,
  knownNativeActorValue as known,
} from "../src/native-actor-order.ts";
import {
  createNativeTrackModelResource,
  prepareNativeTrackResource,
} from "../src/native-track-resources.ts";
const f = Math.fround,
  identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  I = identity;
function assetsFixture(name = "first", capacities = {}) {
  const material = new MeshBasicMaterial(),
    geometry = new BoxGeometry(0.1, 0.1, 0.1),
    bounds = new Box3(
      new Vector3(-0.05, -0.05, -0.05),
      new Vector3(0.05, 0.05, 0.05),
    );
  geometry.userData.nativePedModelBounds = bounds;
  const model = (identifier) => {
    const actor = new Group();
    actor.name = identifier;
    actor.add(new Mesh(geometry, material));
    return {
      identifier,
      actor,
      sourceModels: [identifier],
      modelBounds: new Map([[identifier, bounds]]),
    };
  };
  const formBones = [
      {
        name: "ROOT",
        massKg: 0,
        mass: 0,
        parent: -1,
        collisionType: null,
        jointType: null,
        jointRecords: [],
      },
      {
        name: "HEAD",
        massKg: 4,
        mass: f(0.004),
        parent: 0,
        collisionType: "SPHERE",
        jointType: "NONE",
        jointRecords: [],
      },
      {
        name: "HAND",
        massKg: 1,
        mass: f(0.001),
        parent: 0,
        collisionType: "BOX",
        jointType: "NONE",
        jointRecords: [],
      },
    ],
    moveForm = {
      id: 30,
      periodMs: 100,
      resetAxes: "",
      direction: [1, 0, 0],
      filename: "safe.BON",
      flags: 1,
    },
    form = {
      maxSimple: 60,
      maxRender: 60,
      maxBoned: 1,
      maxStoredDismembered: 1,
      remapFilename: null,
      bones: formBones,
      mass: f(0.005),
      moves: [moveForm, { ...moveForm, id: 72 }, { ...moveForm, id: 94 }],
      nonHumanoid: false,
      headBone: 1,
      lyingAxes: [1, 3],
      ...capacities,
    },
    bones = formBones.map((bone, index) => {
      const variants = [
        model(`${name}-${bone.name}`),
        model(`${name}-${bone.name}-pose1`),
      ];
      return {
        ...bone,
        index,
        actor: variants[0].actor,
        variants,
        attachments: index ? { child: [0, 0, 0], parent: [0, 0.1, 0] } : null,
      };
    }),
    motion = {
      bones: bones.map((bone) => ({ name: bone.name, children: [] })),
      frameCount: 3,
      matrices: new Float32Array(3 * bones.length * 12),
    };
  for (let fr = 0; fr < 3; fr++)
    for (let b = 0; b < bones.length; b++) {
      motion.matrices.set(identity, (fr * bones.length + b) * 12);
      if (!b) motion.matrices[(fr * bones.length + b) * 12 + 9] = fr * 0.01;
    }
  const move = {
      id: 30,
      form: moveForm,
      personality: { scale: 1, groundingMode: -1, groundingOffset: 0.25 },
      motion,
    },
    bodyBounds = { min: [-0.03, -0.1, -0.03], max: [0.03, 0.1, 0.03] };
  return {
    form,
    bones,
    group: new Group(),
    inheritedActorMaterial: material,
    profile: {
      formName: "safe-FORM",
      defaultMovesName: "safe",
      rootName: "ROOT",
      rootRemap: null,
      mass: f(0.005),
      bounds: bodyBounds,
      centreOfMass: [0, 0, 0],
      radius: 0.11,
      inertia: nativePedBoxInertia(f(0.005), bodyBounds),
      modelsByBone: new Map(),
      attachmentsByBone: new Map(),
      movement: new Map([
        [30, { scale: 1, groundingMode: -1, groundingOffset: 0.25 }],
      ]),
      jumpHeight: 0,
      soundFilename: "safe.TXT",
    },
    moves: new Map([
      [30, move],
      [72, { ...move, id: 72, form: { ...moveForm, id: 72 } }],
      [94, { ...move, id: 94, form: { ...moveForm, id: 94 } }],
    ]),
    scene: { materials: new Map(), textures: new Map() },
  };
}
function fixtureWorld(count = 1) {
  const material = { name: "road", flags: 0 };
  const model = {
    name: "safe-ground",
    flags: 0,
    pivot: [0, 0, 0],
    positions: Float32Array.from([-2, 0, -2, 0, 0, 2, 2, 0, -2]),
    uvs: new Float32Array(6),
    materials: ["road"],
    faces: Array.from({ length: count }, () => ({
      indices: [0, 1, 2],
      flags: 0,
      material: 1,
      smoothing: 0,
    })),
  };
  const resource = createNativeTrackModelResource(
    model,
    () => known(material),
    4,
  ).value;
  assert.equal(prepareNativeTrackResource(resource).resolved, true);
  const raw = (name, own) => ({
    name,
    type: own ? 1 : 0,
    renderStyle: own ? 4 : 0,
    transform: I,
    ...(own ? { model: model.name } : {}),
    children: [],
  });
  const state = createNativeActorOrder([raw("ground-actor", true)], {
    model: () => known(resource),
  });
  const actor = state.roots[0],
    root = new Group(),
    object = new Group();
  object.name = actor.name;
  const geometry = createModelGeometry(model),
    mesh = new Mesh(geometry, new MeshBasicMaterial({ name: "road" }));
  mesh.name = model.name;
  object.add(mesh);
  root.add(object);
  const native = {
    layout: {
      originX: -10,
      originZ: -10,
      columnSizeX: 20,
      columnSizeZ: 20,
      countX: 1,
      countZ: 1,
    },
    columns: [[actor]],
    additionalActors: null,
    nonTrackActors: createNativeActorOrder([raw("nontrack", false)]).roots[0],
    blackMaterial: material,
    resources: new Map([[resource, resource]]),
    arena: {
      materialOrder: (faces) => ({
        kind: "verified-pointer-order",
        keys: faces.map(() => 1),
        evidence: "single actual MAT",
      }),
    },
    actorObjects: new Map([[actor, object]]),
    faceActors: new Map([[actor, object]]),
    meshes: new Map([[actor, mesh]]),
    initialGeometries: new Map([[actor, geometry]]),
    actors: state.actors,
    noncars: [],
    provenance: "native-query-with-host-resource-addresses",
  };
  const world = new WorldCollision(root, undefined, undefined, native);
  return {
    material,
    model,
    resource,
    actor,
    native,
    world,
  };
}
function host(changes = {}) {
  const world = fixtureWorld(),
    simulation = new VehicleSimulation(world.world, new Group());
  simulation.collectPedestrianFaces = (query, capacity = 76) =>
    simulation.world.collectFaces(query, capacity, true);
  const warnings = [];
  const gameplay = new NativePedGameplay({
    settings: {},
    nextCrtInteger: () => 0,
    readGlobals: () => ({
      immortal: false,
      exploding: false,
      brittle: false,
      goreLevel: 1,
      dismemberSpurtCount: 0,
      mutantSpeed: 0,
      blind: false,
      valiumTimeMs: 0,
      replay: false,
    }),
  });
  let steering,
    enabled = false;
  const runtime = new NativePedRuntime(simulation, {
    levelOut: 0,
    hooks: {
      ...gameplay.hooks,
      beforePose: (ctx) => (enabled ? steering.prepare(ctx) : undefined),
    },
  });
  runtime.registerPersonality("safe", assetsFixture());
  gameplay.bindRuntime(runtime);
  const owner = new Group();
  runtime.enroll({
    owner,
    personality: "safe",
    rootPose: [...I.slice(0, 9), 0, 0.3, 0],
    moveId: 30,
    direction: [1, 0, 0],
    groundNormal: [0, 1, 0],
    timeMs: 0,
    flags: 0x41,
  });
  gameplay.enroll(owner, { action: 0, cache: null });
  const processPool = new NativePedProcessCachePool({
    readCache: (key) => gameplay.state(key).cache,
    writeCache: (key, cache) => {
      gameplay.state(key).cache = cache;
    },
    releaseFaceCache: (slot) => steering.releaseBorrowed(slot),
  });
  const ped = {
    object: owner,
    personality: "safe",
    alive: true,
    action: 0,
    moveId: 30,
    heading: Math.PI / 2,
    spec: { exclusions: [], exceptions: [] },
    movement: { minTurnMs: 0, maxTurnMs: 0, maxTurnRadians: Math.PI },
  };
  const frame = { framePeriodMs: 20 };
  const options = {
    runtime,
    gameplay,
    simulation,
    readPed: () => ped,
    settings: {
      processDistance: 100,
      popupDistance: 0,
      maxSlopeDegrees: 25,
      reach: 0.5,
      avoidDistance: 4,
    },
    readFrame: () => frame,
    warn: (message) => warnings.push(message),
    ...changes,
  };
  steering = new OrdinaryPedSteering(options);
  const poolSettings = createNativePedPoolSettings(100, 0);
  const outerFrame = (timeMs) => ({
    cameraOrigin: [0, 0, -10],
    timeMs,
    settings: poolSettings,
  });
  runtime.prepareFrame(outerFrame(1000));
  const visit = processPool.visit(owner, {
    timeMs: 1000,
    replay: false,
    minTurnIntervalMs: 0,
    maxTurnIntervalMs: 0,
    spurtingPeriodMs: 100,
  });
  assert.equal(visit.status, "complete");
  const context = (timeMs = 1000) => {
    const character = runtime.character(owner);
    return {
      character,
      owner,
      instance: character.instance,
      body: character.body,
      timeMs,
      framePeriodMs: 0,
    };
  };
  return {
    world,
    simulation,
    runtime,
    gameplay,
    steering,
    owner,
    ped,
    frame,
    warnings,
    process: visit.cache,
    processPool,
    context,
    outerFrame,
    enable: () => {
      enabled = true;
    },
    dispose: () => {
      steering.dispose();
      runtime.dispose();
    },
  };
}

test("production steering grounds actual FORM/PHIL owner through canonical100/85 slots", () => {
  const h = host();
  try {
    const ctx = h.context(),
      clock = { ...ctx.instance.clock };
    assert.equal(h.steering.prepare(ctx).status, "complete");
    assert.equal(h.steering.ready(h.owner), true);
    assert.equal(h.steering.grounding.pool.size, 85);
    assert.equal(h.processPool.slots.length, 100);
    assert.equal(
      h.process.faceCache,
      h.steering.grounding.state(h.owner).cache.identity,
    );
    assert.ok(
      h.process.faceCache.faces.includes(h.process.faceCache.selectedFace),
    );
    assert.deepEqual(h.process.floorNormal, [0, 1, 0]);
    assert.equal(ctx.instance.rootPose[10], 0.25);
    assert.deepEqual(ctx.instance.clock, clock);
    assert.ok(
      h.warnings.some((message) =>
        message.includes("source-PedScanForObjects-pointer-CRT-provider"),
      ),
    );
    const count = h.warnings.length;
    h.steering.prepare(h.context(1001));
    assert.equal(h.warnings.length, count);
  } finally {
    h.dispose();
  }
});

test("outer frame acceleration precedes supported grounding and same move retains BON clock", () => {
  const h = host();
  try {
    h.frame.framePeriodMs = 200;
    h.process.runSpeed = 100;
    h.process.runFactor = f(0.09);
    const ctx = h.context(),
      before = { ...ctx.instance.clock };
    assert.equal(h.steering.prepare(ctx).status, "complete");
    assert.equal(h.process.runSpeed, 81);
    assert.equal(ctx.instance.clock.periodMs, 81);
    assert.equal(ctx.instance.clock.frame, before.frame);
    assert.equal(ctx.instance.clock.fraction, before.fraction);
    assert.equal(ctx.instance.clock.lastTimeMs, before.lastTimeMs);
  } finally {
    h.dispose();
  }
});

test("supported steering leaves actual BON root displacement and passive velocity to runtime", () => {
  const h = host();
  try {
    h.steering.prepare(h.context());
    h.enable();
    const ctx = h.context(),
      root = ctx.instance.rootPose.slice();
    const result = h.runtime.prepareFrame(h.outerFrame(1100));
    assert.equal(result[0].pose.status, "complete");
    assert.equal(h.steering.ready(h.owner), true);
    assert.notEqual(ctx.instance.rootPose[9], root[9]);
    assert.equal(
      ctx.body.state.velocity.x,
      ctx.instance.nativeCharacterVelocity[0],
    );
    assert.equal(
      ctx.body.state.velocity.z,
      ctx.instance.nativeCharacterVelocity[2],
    );
  } finally {
    h.dispose();
  }
});

test("actual excluded raw-group floor reports missing native storage and clears readiness", () => {
  const h = host();
  try {
    h.ped.spec.exclusions = ["road"];
    h.steering.options.resolveMaterial = () => h.world.material;
    const result = h.steering.prepare(h.context());
    assert.equal(result.status, "provider-required");
    assert.ok(
      result.requiredProviders.includes(
        "source-proximity-unchecked-negative-prepared-group-storage",
      ),
    );
    assert.equal(h.steering.ready(h.owner), false);
    assert.equal(h.process.faceCache.selectedFace, null);
  } finally {
    h.dispose();
  }
});

test("unresolved exclusion material is explicit and active owners never receive a ground warp", () => {
  const h = host();
  try {
    h.ped.spec.exceptions = ["missing.MAT"];
    const result = h.steering.prepare(h.context());
    assert.equal(result.status, "provider-required");
    assert.ok(
      result.requiredProviders.includes(
        "source-pedestrian-exclusion-MAT:missing.MAT",
      ),
    );
    h.ped.spec.exceptions = [];
    assert.equal(h.runtime.activate(h.owner), true);
    const ctx = h.context(),
      root = ctx.instance.rootPose.slice();
    assert.equal(h.steering.prepare(ctx).status, "complete");
    assert.deepEqual(ctx.instance.rootPose, root);
    assert.equal(h.steering.ready(h.owner), false);
  } finally {
    h.dispose();
  }
});

test("source object-scan position permits explicit adapter and borrowed release/invalidation remain bounded", () => {
  const events = [],
    h = host({
      scanForObjectsAdapter: (ctx, input) => {
        events.push([ctx.owner, input.process, input.selectedFloorNormal]);
        return { status: "complete", requiredProviders: [] };
      },
    });
  try {
    h.steering.prepare(h.context());
    assert.equal(events.length, 1);
    assert.equal(events[0][0], h.owner);
    assert.equal(events[0][1], h.process);
    assert.deepEqual(events[0][2], [0, 1, 0]);
    const slot = h.process.faceCache;
    h.steering.invalidateAll();
    assert.equal(h.steering.ready(h.owner), false);
    h.steering.prepare(h.context(1001));
    assert.equal(h.steering.ready(h.owner), true);
    h.steering.releaseBorrowed(slot);
    assert.equal(slot.owner, null);
    h.process.faceCache = null;
    assert.equal(h.steering.ready(h.owner), false);
    h.steering.reset();
    assert.equal(h.steering.grounding.pool.size, 85);
    assert.equal(h.steering.grounding.state(h.owner), null);
  } finally {
    h.dispose();
  }
});

test("unsupported drop activates actual body velocity and source fall move without a second launch", () => {
  const h = host();
  try {
    const ctx = h.context(),
      root = ctx.instance.rootPose.slice();
    root[9] = 20;
    assert.equal(h.runtime.setRootPose(h.owner, root).status, "complete");
    ctx.instance.nativeCharacterVelocity.splice(0, 3, 2, 0, -1);
    assert.equal(h.steering.prepare(ctx).status, "complete");
    assert.equal(ctx.instance.physicsActive, true);
    assert.equal(h.simulation.phil.getState(ctx.body), 2);
    assert.deepEqual(ctx.body.state.velocity.toArray(), [2, 0, -1]);
    assert.equal(ctx.character.moveId, 72);
    assert.equal(h.gameplay.state(h.owner).action, 3);
    assert.equal(h.steering.ready(h.owner), false);
    assert.ok(
      h.warnings.some((message) =>
        message.includes("source-PED07-fall-and-recovery-production-owner"),
      ),
    );
  } finally {
    h.dispose();
  }
});

function sourceScanner(objects = []) {
  const arena = new NativeResourceArena({
    classProvider: () => ({
      resolved: true,
      value: { alignment: 4, free: null },
    }),
  });
  const pedStorage = new Uint8Array(0x54),
    block = arena.allocate({ size: 0x54, classId: 0xc1, payload: pedStorage });
  const random = new NativeRandom(),
    seeds = [];
  const callback = (ctx, movement) => {
    const ped = new DataView(pedStorage.buffer);
    ped.setInt8(4, ctx.character.hitPoints);
    ped.setInt32(0x10, movement.action, true);
    movement.character.rootPosition.forEach((n, i) =>
      ped.setFloat32(0x1c + i * 4, n, true),
    );
    arena.write(block, 0, pedStorage);
    const result = scanNativeOrdinaryPedObjects({
      pedAddress: block.address,
      pedStorage,
      processStorage: movement.process.storage,
      timeMs: ctx.timeMs,
      characterVelocity: movement.character.velocity,
      removedBoneMask: ctx.character.removedBoneMask,
      objects: typeof objects === "function" ? objects(ctx) : objects,
      playerObject: null,
      globals: {
        immortal: false,
        suicidal: false,
        blind: false,
        valiumTimeMs: 0,
        playerThreatOverride: false,
      },
      crt: {
        seed(value) {
          seeds.push(value);
          random.seed(value);
        },
        nextInteger: () => random.nextInteger(),
      },
    });
    arena.write(block, 0, pedStorage);
    return result;
  };
  return { callback, seeds, block };
}

test("actual source object scanner takes precedence over adapter and clears stale boundary diagnostics", () => {
  const scan = sourceScanner(),
    h = host({
      scanForObjects: scan.callback,
      scanForObjectsAdapter: () => {
        throw new Error("compatibility adapter must not run");
      },
    });
  try {
    const ctx = h.context();
    ctx.character.diagnostics.add(
      "source-PedScanForObjects-pointer-CRT-provider",
    );
    assert.equal(h.steering.prepare(ctx).status, "complete");
    assert.equal(h.steering.ready(h.owner), true);
    assert.deepEqual(scan.seeds, [
      scan.block.address,
      (1000 ^ scan.block.address) >>> 0,
    ]);
    assert.equal(
      ctx.character.diagnostics.has(
        "source-PedScanForObjects-pointer-CRT-provider",
      ),
      false,
    );
    assert.equal(
      h.warnings.some((message) =>
        message.includes("source-PedScanForObjects-pointer-CRT-provider"),
      ),
      false,
    );
  } finally {
    h.dispose();
  }
});

test("real source scan provider requirements stop steering without silently invoking compatibility adapter", () => {
  const scan = sourceScanner((ctx) => [
    {
      body: {},
      actorPosition: [
        ctx.instance.rootPose[9],
        ctx.instance.rootPose[10],
        ctx.instance.rootPose[11] + 2,
      ],
      velocity: [0, 0, -2],
      radiusSquared: 0.1,
      typeByte: 1,
      owner: {},
    },
  ]);
  let fallback = 0;
  const h = host({
    scanForObjects: scan.callback,
    scanForObjectsAdapter: () => {
      fallback++;
    },
  });
  try {
    const result = h.steering.prepare(h.context());
    assert.equal(result.status, "provider-required");
    assert.deepEqual(result.requiredProviders, [
      "source-ped-scan-electric-driver-owner",
    ]);
    assert.equal(h.steering.ready(h.owner), false);
    assert.equal(fallback, 0);
  } finally {
    h.dispose();
  }
});

test("readiness is available before legacy update after first support and survives source fear bypass", () => {
  const h = host({ scanForObjects: sourceScanner().callback });
  try {
    assert.equal(h.steering.ready(h.owner), false);
    h.steering.prepare(h.context());
    assert.equal(h.steering.ready(h.owner), true);
    h.gameplay.state(h.owner).action = 2;
    assert.equal(h.steering.prepare(h.context(1001)).status, "complete");
    assert.equal(h.steering.ready(h.owner), true);
    const flags = h.runtime.character(h.owner).flags;
    h.runtime.updateState(h.owner, { flags: flags & ~1 });
    assert.equal(h.steering.ready(h.owner), false);
    h.runtime.updateState(h.owner, { flags });
    assert.equal(h.steering.ready(h.owner), true);
    h.ped.alive = false;
    assert.equal(h.steering.ready(h.owner), false);
  } finally {
    h.dispose();
  }
});

test("recovery recache uses actual85-slot owner without spoofing action or changing active root", () => {
  const h = host();
  try {
    assert.equal(h.steering.prepare(h.context()).status, "complete");
    h.gameplay.state(h.owner).action = 4;
    assert.equal(h.runtime.activate(h.owner), true);
    const ctx = h.context(),
      root = ctx.instance.rootPose.slice(),
      clock = { ...ctx.instance.clock },
      flags = ctx.character.flags;
    assert.equal(
      h.steering.recacheForRecovery(ctx, true, 1234).status,
      "complete",
    );
    const slot = h.process.faceCache;
    assert.equal(slot.timeMs, 1234);
    assert.ok(slot.selectedFace);
    assert.equal(slot.owner, h.owner);
    assert.equal(h.steering.grounding.state(h.owner).cache.identity, slot);
    assert.equal(h.gameplay.state(h.owner).action, 4);
    assert.equal(ctx.character.flags, flags);
    assert.equal(ctx.instance.physicsActive, true);
    assert.deepEqual(ctx.instance.rootPose, root);
    assert.deepEqual(ctx.instance.clock, clock);
    const recache = h.steering.grounding.recache(
      { ...ctx, timeMs: 1235 },
      false,
    );
    assert.equal(recache.status, "complete");
    assert.equal(recache.rebuilt, false);
    assert.equal(recache.needGround, false);
    assert.equal(slot.timeMs, 1234);
  } finally {
    h.dispose();
  }
});

test("recovery movement wrappers expose canonical process and retain the selected floor", () => {
  const h = host();
  try {
    h.steering.prepare(h.context());
    const ctx = h.context(),
      input = h.steering.movementInput(ctx);
    assert.equal(input.process, h.process);
    const slot = h.process.faceCache;
    assert.equal(
      h.steering.directionForRecovery(ctx, [0, 0, 1], 0, 1010).status,
      "complete",
    );
    assert.deepEqual(ctx.instance.direction, [0, 0, 1]);
    assert.equal(h.steering.rescanForRecovery(ctx).status, "complete");
    assert.equal(h.process.faceCache, slot);
    assert.deepEqual(h.process.retainedDirection, [0, 0, 1]);
  } finally {
    h.dispose();
  }
});

test("recovery preflight stages native negative-group scan without changing canonical owners, faces or CRT", () => {
  const h = host();
  try {
    h.steering.prepare(h.context());
    const slot = h.process.faceCache;
    const captured = h.simulation.collectPedestrianFaces({
      bounds: new Box3(new Vector3(-2, -1, -2), new Vector3(2, 1, 2)),
      matrix: new Group().matrix,
    });
    h.steering.options.previewWorldFaces = () => captured;
    h.ped.spec.exclusions = ["road"];
    h.ped.spec.exclusionFlags = [0];
    h.steering.options.resolveMaterial = () => h.world.material;
    const ctx = h.context(),
      root = ctx.instance.rootPose.slice(),
      direction = [...ctx.instance.direction],
      storage = h.process.storage.slice(),
      faces = slot.faces.map((face) => ({
        ...face,
        normal: [...face.normal],
        a: [...face.a],
        b: [...face.b],
        c: [...face.c],
      })),
      rings = [5, 10, 40, 75].map((capacity) =>
        h.steering.grounding.pool.order(capacity),
      ),
      crt = sharedNativeRandom.state;
    assert.deepEqual(h.steering.preflightRecovery(ctx, [0, 0, 1], 4), [
      "source-proximity-unchecked-negative-prepared-group-storage",
    ]);
    h.ped.spec.exclusionFlags = [1];
    assert.deepEqual(h.steering.preflightRecovery(ctx, [0, 0, 1], 1), []);
    assert.deepEqual(h.steering.preflightRecovery(ctx, [0, 0, 1], 4), [
      "source-proximity-unchecked-negative-prepared-group-storage",
    ]);
    assert.deepEqual(h.process.storage, storage);
    assert.equal(h.process.faceCache, slot);
    assert.deepEqual(slot.faces, faces);
    assert.deepEqual(ctx.instance.rootPose, root);
    assert.deepEqual(ctx.instance.direction, direction);
    assert.equal(sharedNativeRandom.state, crt);
    for (const [i, capacity] of [5, 10, 40, 75].entries())
      assert.deepEqual(h.steering.grounding.pool.order(capacity), rings[i]);
    h.steering.options.previewWorldFaces = () => [];
    assert.deepEqual(h.steering.preflightRecovery(ctx, [0, 0, 1], 4), []);
    assert.deepEqual(h.process.storage, storage);
    assert.equal(h.process.faceCache, slot);
    assert.deepEqual(ctx.instance.rootPose, root);
  } finally {
    h.dispose();
  }
});

test("recovery NULL selected support is a no-op while absent canonical process remains unsupported", () => {
  const h = host();
  try {
    const ctx = h.context(),
      root = ctx.instance.rootPose.slice(),
      direction = [...ctx.instance.direction],
      storage = h.process.storage.slice();
    assert.equal(h.process.faceCache, null);
    h.ped.spec.exclusions = ["unresolved-MAT"];
    assert.equal(h.steering.rescanForRecovery(ctx).status, "complete");
    assert.equal(
      h.steering.directionForRecovery(ctx, [1, 0, 1]).status,
      "complete",
    );
    assert.deepEqual(ctx.instance.rootPose, root);
    assert.deepEqual(ctx.instance.direction, direction);
    assert.deepEqual(h.process.storage, storage);
    assert.deepEqual(h.steering.preflightRecovery(ctx, [1, 0, 1], 4), [
      "source-recovery-readonly-world-face-provider",
    ]);
    h.gameplay.state(h.owner).cache = null;
    assert.deepEqual(
      h.steering.directionForRecovery(ctx, [1, 0, 1]).requiredProviders,
      ["source-ground-current-process-cache-owner"],
    );
    assert.deepEqual(h.steering.preflightRecovery(ctx, [1, 0, 1], 4), [
      "source-ground-current-process-cache-owner",
    ]);
  } finally {
    h.dispose();
  }
});

test("production vanish outlet executes once and outer runtime skips BON after flag80", () => {
  const events = [];
  const h = host({
    vanish: (ctx, effect) => {
      events.push([ctx.owner, effect, ctx.character.flags]);
      h.runtime.updateState(ctx.owner, { flags: effect.flags });
    },
  });
  try {
    const ctx = h.context(),
      root = ctx.instance.rootPose.slice();
    root[9] = 20;
    h.runtime.setRootPose(h.owner, root);
    h.runtime.updateState(h.owner, { flags: 1 });
    const clock = { ...ctx.instance.clock };
    assert.equal(h.steering.prepare(ctx).status, "complete");
    assert.equal(events.length, 1);
    assert.equal(events[0][2] & 0x80, 0);
    assert.equal(ctx.character.flags & 0x80, 0x80);
    assert.equal(ctx.instance.physicsActive, false);
    assert.deepEqual(ctx.instance.clock, clock);
    h.enable();
    h.runtime.prepareFrame(h.outerFrame(1020));
    assert.equal(events.length, 1);
    assert.deepEqual(ctx.instance.clock, clock);
    assert.ok(
      !h.warnings.some((message) => message.includes("source-ground-vanish")),
    );
  } finally {
    h.dispose();
  }
});
