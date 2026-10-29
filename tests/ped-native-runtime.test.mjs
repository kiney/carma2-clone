import test from "node:test";
import assert from "node:assert/strict";
import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { NativePedRuntime } from "../src/ped-native-runtime.ts";
import { createNativeActivePedMoveCallback } from "../src/physics/ped-active-move.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { nativePedRootPose } from "../src/physics/ped-body.ts";
import { resolvePedContactDamage } from "../src/physics/ped-contact.ts";
import { advanceNativePedPose } from "../src/ped-native-instance.ts";
import { createNativePedPoolSettings } from "../src/ped-body-pool.ts";
import { nativePedBoxInertia } from "../src/ped-form.ts";
import { Assets } from "../src/content.ts";
import { createAssetStore } from "../server/assets.mjs";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";
import {
  prepareNativePedDeadModels,
  NativePedDeadMaterialRegistry,
} from "../src/ped-dead-models.ts";

const f = Math.fround,
  identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  settings = createNativePedPoolSettings(100, 0);
const world = { raycast: () => null, querySurfaces: () => [] };
const frame = (timeMs = 0) => ({ cameraOrigin: [0, 0, -10], timeMs, settings });
const sim = () => new VehicleSimulation(world, new Group());
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
      maxSimple: 1,
      maxRender: 1,
      maxBoned: 1,
      maxStoredDismembered: 1,
      remapFilename: null,
      bones: formBones,
      mass: f(0.005),
      moves: [moveForm],
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
      personality: { scale: 1, groundingMode: 1, groundingOffset: 0 },
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
      movement: new Map(),
    },
    moves: new Map([[30, move]]),
    scene: { materials: new Map(), textures: new Map() },
  };
}
function enroll(runtime, owner, personality = "first", root = [0, 1, 0]) {
  return runtime.enroll({
    owner,
    personality,
    rootPose: [...identity.slice(0, 9), ...root],
    moveId: 30,
    direction: [1, 0, 0],
    groundNormal: [0, 1, 0],
    timeMs: 0,
    flags: 1,
  });
}
function host(options = {}, capacities = {}) {
  const simulation = sim(),
    runtime = new NativePedRuntime(simulation, { levelOut: 0, ...options });
  runtime.registerPersonality("first", assetsFixture("first", capacities));
  return { simulation, runtime };
}

test("FORM resources are allocated once, start with zero retained policy/friction and no fabricated PHIL header", () => {
  const { runtime, simulation } = host(),
    form = runtime.bodyPool.forms.get("safe-FORM"),
    body = form.simple[0].resource,
    hull = body.hulls[0],
    vertices = [...hull.vertices];
  assert.equal(simulation.phil.count, 0);
  assert.equal(body.headerState, 0);
  assert.equal(body.rigidFlags, 0);
  assert.equal(body.properties.objectFriction, 0);
  assert.equal(body.properties.worldFriction, 0);
  assert.equal(body.owner, null);
  const owner = {},
    c = enroll(runtime, owner);
  const visits = runtime.prepareFrame(frame());
  assert.equal(visits[0].pool.status, "processed");
  assert.equal(visits[0].pool.registrationReturn, 0);
  assert.equal(c.body, body);
  assert.equal(c.body.hulls[0], hull);
  vertices.forEach((vertex, i) => assert.equal(vertex, hull.vertices[i]));
  assert.equal(c.body.actor, c.instance.bones[0].actor);
  assert.equal(c.body.owner, owner);
  assert.equal(simulation.phil.getState(body), 1);
  assert.equal(simulation.phil.getHeader(body).gravity, 1);
  assert.equal(simulation.phil.getHeader(body).drag, 0);
  assert.equal(simulation.phil.getHeader(body).flags, 8);
  assert.equal(body.rigidFlags, 0x78);
  assert.equal(runtime.bonePool.counts("safe-FORM").physicalResources, 2);
});

test("processed pre-pose grounding owns position before a single BON advance and passive PHIL commit", () => {
  const events = [];
  let runtime;
  const h = host({
    hooks: {
      beforePose: (ctx) => {
        const clock = { ...ctx.instance.clock };
        const oldPedPosition = [...ctx.character.position];
        const orientation = [...ctx.instance.characterOrientation];
        const motion = [...ctx.instance.movement];
        const result = runtime.setGroundPosition(ctx.owner, [2, 3, 4]);
        assert.equal(result.status, "complete");
        assert.equal(result.physicsMatrixWritten, true);
        assert.deepEqual(ctx.instance.clock, clock);
        assert.deepEqual(ctx.character.position, oldPedPosition);
        assert.deepEqual([...ctx.instance.characterOrientation], orientation);
        assert.deepEqual([...ctx.instance.movement], motion);
        events.push([ctx.timeMs, clock.lastTimeMs, clock.frame]);
        return result;
      },
    },
  });
  runtime = h.runtime;
  const c = enroll(runtime, {});
  runtime.prepareFrame(frame(100));
  assert.equal(c.instance.clock.lastTimeMs, 100);
  runtime.prepareFrame(frame(140));
  assert.deepEqual(events, [
    [100, 100, 0],
    [140, 100, 0],
  ]);
  assert.equal(c.instance.clock.lastTimeMs, 140);
  assert.equal(c.instance.clock.frame, 0);
  assert.equal(c.instance.clock.fraction, f(0.4));
  assert.equal(c.rootPose[10], 3);
  assert.equal(c.position[1], 3);
  assert.deepEqual([...nativePedRootPose(c.body)], [...c.instance.rootPose]);
  assert.equal(c.body.state.position.y, 3);
  assert.equal(c.diagnostics.size, 0);
});

test("missing current-root provider stops pose advancement explicitly, and unprocessed characters do not invoke it", () => {
  let calls = 0;
  const { runtime } = host({
    hooks: {
      beforePose: () => {
        calls++;
        return {
          status: "provider-required",
          requiredProviders: ["test-current-root-owner"],
          processedFrames: 0,
          completedMove: false,
        };
      },
    },
  });
  const near = enroll(runtime, {});
  const far = enroll(runtime, {}, "first", [1000, 1, 0]);
  const visits = runtime.prepareFrame(frame(100));
  assert.equal(calls, 1);
  assert.equal(visits[0].pose.status, "provider-required");
  assert.equal(visits[1].pool.status, "out-of-scope");
  assert.equal(far.instance, null);
  assert.equal(near.instance.clock.lastTimeMs, 100);
  assert.equal(near.instance.clock.fraction, 0);
  assert.ok(near.diagnostics.has("test-current-root-owner"));
});

test("successful pre-pose vanish releases actual resources without a later BON or passive write", () => {
  let runtime, body, oldInstance;
  const h = host({
    hooks: {
      beforePose: (ctx) => {
        body = ctx.body;
        oldInstance = ctx.instance;
        runtime.updateState(ctx.owner, { flags: ctx.character.flags | 0x80 });
        // The same actual resource host performs ordinary flagged-owner removal.
        runtime.prepareFrame(frame(ctx.timeMs));
        return {
          status: "complete",
          requiredProviders: [],
          processedFrames: 0,
          completedMove: false,
        };
      },
    },
  });
  runtime = h.runtime;
  const c = enroll(runtime, {});
  const visits = runtime.prepareFrame(frame(100));
  assert.equal(visits[0].pose.status, "complete");
  assert.equal(c.instance, null);
  assert.equal(c.body, null);
  assert.equal(runtime.allocation(c.owner), null);
  assert.equal(h.simulation.phil.getState(body), 0);
  assert.equal(oldInstance.clock.lastTimeMs, 100);
  assert.equal(oldInstance.clock.fraction, 0);
});

test("two personalities share first-free FORM capacity, then reuse stable ACT/object/BOX with retained fields", () => {
  const { runtime, simulation } = host();
  runtime.registerPersonality("second", assetsFixture("second"));
  const a = enroll(runtime, {}),
    b = enroll(runtime, {}, "second"),
    visits = runtime.prepareFrame(frame());
  assert.equal(visits[0].pool.status, "processed");
  assert.equal(visits[1].pool.status, "exhausted");
  const old = a.instance,
    body = a.body,
    actor = body.actor,
    hull = body.hulls[0],
    model = a.instance.bones[1].model;
  body.rigidFlags |= 0x80000000;
  body.properties.objectFriction = f(0.7);
  runtime.updateState(a.owner, { flags: 0x80 });
  runtime.updateState(b.owner, { flags: 1 });
  const again = runtime.prepareFrame(frame(100));
  assert.equal(again[0].pool.status, "out-of-scope");
  assert.equal(again[1].pool.status, "processed");
  assert.equal(b.body, body);
  assert.equal(b.body.actor, actor);
  assert.equal(b.body.hulls[0], hull);
  assert.equal(b.body.owner, b.owner);
  assert.equal(b.body.rigidFlags >>> 0, 0x80000078);
  assert.equal(b.body.properties.objectFriction, f(0.7));
  assert.notEqual(b.instance.bones[1].model, model);
  assert.match(b.instance.bones[1].model.name, /^second/);
  assert.equal(advanceNativePedPose(old, 100).status, "provider-required");
  assert.equal(simulation.phil.count, 1);
  assert.deepEqual(runtime.bodyPool.counts("safe-FORM"), {
    renderCapacity: 1,
    simpleCapacity: 1,
    renderOwned: 1,
    simpleOwned: 1,
  });
});

test("actual shared normal100 header exhaustion releases attempted render without property/fill tail or eviction", () => {
  const { runtime, simulation } = host();
  for (let i = 0; i < 100; i++) {
    const body = {
      state: {
        position: new Vector3(),
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        velocity: new Vector3(),
        angularVelocity: new Vector3(),
      },
      properties: {
        mass: 1,
        inertia: new Vector3(1, 1, 1),
        centerOfMass: new Vector3(),
        worldFriction: 0,
      },
    };
    assert.equal(simulation.phil.registerImmediate(body), 0);
  }
  const c = enroll(runtime, {}),
    result = runtime.prepareFrame(frame())[0],
    raw = runtime.bodyPool.forms.get("safe-FORM").simple[0].resource;
  assert.equal(result.pool.registrationReturn, 1);
  assert.equal(result.pool.collideworthyReturn, 21);
  assert.equal(c.instance, null);
  assert.equal(c.body, null);
  assert.equal(simulation.phil.count, 100);
  assert.equal(raw.rigidFlags, 0);
  assert.equal(raw.headerState, 0);
  assert.equal(runtime.bodyPool.counts("safe-FORM").renderOwned, 0);
});

test("authored BON advance and explicit root/state/freeze providers keep passive BOX synchronized", () => {
  const { runtime, simulation } = host(),
    c = enroll(runtime, {});
  runtime.prepareFrame(frame(100));
  const first = c.instance.rootPose[9];
  runtime.prepareFrame(frame(200));
  assert.ok(c.instance.rootPose[9] > first);
  assert.deepEqual(
    Array.from(nativePedRootPose(c.body)),
    Array.from(c.instance.rootPose),
  );
  assert.equal(
    runtime.setRootPose(c.owner, [...identity.slice(0, 9), 2, 3, 4]).status,
    "complete",
  );
  assert.deepEqual(c.body.state.position.toArray(), [2, 3, 4]);
  runtime.updateState(c.owner, {
    movementDisabled: true,
    hitPoints: 73,
    flags: 0x41,
  });
  runtime.prepareFrame(frame(300));
  assert.deepEqual(c.body.state.position.toArray(), [2, 3, 4]);
  assert.equal(c.body.hitPoints, 73);
  assert.equal(c.body.pedestrianFlags, c.flags);
  assert.equal(simulation.phil.getState(c.body), 1);
});

test("real PHIL activation copies source V and moved wrapper takes actual physical ACT root; halt provider owns native result", () => {
  const events = [],
    { runtime, simulation } = host({
      hooks: {
        onActivated: (context) => events.push(["activate", context.owner]),
        onMoved: (context) =>
          events.push(["moved", context.owner, context.framePeriodMs]),
        onHalt: (context, reason) => {
          assert.equal(context.instance.physicsActive, false);
          assert.equal(context.character.physicsFlags & 4, 0);
          events.push(["halt", context.owner, reason]);
          return { returnValue: 1 };
        },
      },
    }),
    c = enroll(runtime, {});
  runtime.prepareFrame(frame());
  c.instance.nativeCharacterVelocity.splice(0, 3, 1, 2, 3);
  assert.equal(runtime.activate(c.owner), true);
  assert.equal(simulation.phil.getState(c.body), 2);
  assert.equal(simulation.phil.getHeader(c.body).flags & 2, 2);
  assert.deepEqual(c.body.state.velocity.toArray(), [1, 2, 3]);
  c.body.state.position.set(4, 5, 6);
  c.body.onMoved(c.body, 40);
  assert.deepEqual(Array.from(c.instance.rootPose).slice(9), [4, 5, 6]);
  assert.deepEqual(c.instance.nativeCharacterVelocity, [1, 2, 3]);
  assert.deepEqual(events[1], ["moved", c.owner, 40]);
  assert.equal(
    runtime.setRootPose(c.owner, identity).status,
    "provider-required",
  );
  assert.equal(
    runtime.setMove(c.owner, 30, [0, 0, 1], [0, 1, 0], 0).status,
    "provider-required",
  );
  assert.equal(c.body.onHalt(c.body, 40), true);
  assert.equal(c.instance.physicsActive, false);
  assert.deepEqual(events[2], ["halt", c.owner, "quiet"]);
});

test("gameplay provider receives each real dispatch and sees the passive WORD before damage", () => {
  const events = [],
    { runtime, simulation } = host({
      hooks: {
        contactProvider: (context, event) => {
          events.push(event);
          return {
            settings: {
              severDamage: 40,
              severChance: 10,
              maxSurvivableInitialImpact: 8,
              damagePerForce: 250,
            },
            form: {
              personalityMass: context.body.properties.mass,
              simpleBodyMass: context.body.properties.mass,
              boneCount: 3,
              nonHumanoid: false,
            },
            state: {
              hitPoints: context.character.hitPoints,
              flags: 0x40,
              immortal: false,
              exploding: false,
              brittle: false,
              goreLevel: 0,
              removedBoneMask: 0,
              headMissing: false,
            },
            passivePrelude: () => {
              assert.equal(context.body.impactCount, 0);
              assert.equal(context.character.impactCount, 0);
            },
            damageTail: (input) => {
              assert.equal(context.body.impactCount, 0);
              assert.equal(context.character.impactCount, 0);
              return {
                health: resolvePedContactDamage(
                  input.damage,
                  input.form,
                  input.state,
                  input.aliveMove,
                  input.deadMove,
                ),
                unresolved: [],
              };
            },
          };
        },
      },
    }),
    c = enroll(runtime, {});
  runtime.updateState(c.owner, { flags: 0x41, impactCount: 0xffff });
  runtime.prepareFrame(frame());
  const other = {
    rigidType: 1,
    owner: {},
    state: {
      position: new Vector3(),
      orientation: c.body.state.orientation.clone(),
      velocity: new Vector3(1, 0, 0),
      angularVelocity: new Vector3(),
    },
    properties: {
      mass: 1,
      centerOfMass: new Vector3(),
      inertia: new Vector3(1, 1, 1),
      worldFriction: 1,
    },
  };
  const contact = {
    a: c.body,
    b: other,
    normal: new Vector3(1, 0, 0),
    point: new Vector3(),
  };
  simulation.preparePedContacts([contact]);
  assert.equal(events[0].phase, "passive");
  assert.equal(events[0].other, other);
  assert.equal(events[0].contact, contact);
  assert.equal(c.impactCount, 0);
  const worldRow = {
    a: c.body,
    normal: new Vector3(0, 1, 0),
    point: new Vector3(),
    sourceType: 3,
    normalImpulse: 0.0006,
    closingSpeed: 0,
    tangentImpulse: new Vector3(),
  };
  simulation.processPedContactDamage([worldRow]);
  assert.equal(events[1].phase, "active");
  assert.equal(events[1].other, undefined);
  assert.equal(events[1].firstRow, worldRow);
  assert.equal(events[1].totalLambda, Math.fround(0.0006));
  assert.deepEqual(events[1].force.toArray(), [0, 0.0006, 0]);
  assert.equal(
    events[0].other,
    other,
    "later world contact does not replace earlier attribution snapshot",
  );
});

test("native active move hook retains heading and actual move ID across period-only and forced selection", () => {
  const { runtime, simulation } = host({
    hooks: { activeSetMove: createNativeActivePedMoveCallback() },
  });
  const c = enroll(runtime, {});
  runtime.prepareFrame(frame());
  runtime.activate(c.owner);
  c.body.state.position.set(3, 4, 5);
  c.body.state.orientation.setFromAxisAngle(new Vector3(0, 0, 1), 0.4);
  c.body.state.velocity.set(1, 2, 3);
  c.body.state.angularVelocity.set(4, 5, 6);
  const pose = Array.from(nativePedRootPose(c.body)),
    heading = [...c.direction],
    up = [...c.groundNormal];
  const header = simulation.phil.getHeader(c.body);
  c.instance.clock.lastTimeMs = 123;
  assert.equal(
    runtime.setMove(c.owner, -1, [0, 0, -1], [0, 0, 1], 200, { periodMs: 220 })
      .status,
    "complete",
  );
  assert.equal(c.moveId, 30);
  assert.equal(c.instance.clock.periodMs, 220);
  assert.equal(c.instance.clock.lastTimeMs, 123);
  assert.deepEqual(c.direction, heading);
  assert.deepEqual(c.groundNormal, up);
  assert.equal(
    runtime.setMove(c.owner, 30 | 0x40000000, [0, 0, -1], [0, 0, 1], 300, {
      retainRoot: true,
    }).status,
    "complete",
  );
  assert.equal(c.moveId, 30);
  assert.equal(c.instance.clock.lastTimeMs, 0);
  assert.deepEqual(Array.from(c.rootPose), pose);
  assert.deepEqual(c.direction, heading);
  assert.deepEqual(c.groundNormal, up);
  assert.deepEqual(c.body.state.velocity.toArray(), [1, 2, 3]);
  assert.deepEqual(c.body.state.angularVelocity.toArray(), [4, 5, 6]);
  assert.equal(simulation.phil.getHeader(c.body), header);
  assert.equal(header.state, 2);
  assert.equal(c.instance.physicsActive, true);
});

test("scope release calls source halt then removes even callback0; missing halt retains ownership explicitly", () => {
  const { runtime, simulation } = host({
      hooks: { onHalt: () => ({ returnValue: 0 }) },
    }),
    c = enroll(runtime, {});
  runtime.prepareFrame(frame());
  runtime.activate(c.owner);
  const body = c.body;
  runtime.updateState(c.owner, { flags: 0x80 });
  assert.equal(runtime.prepareFrame(frame(100))[0].pool.status, "out-of-scope");
  assert.equal(simulation.phil.getState(body), 0);
  assert.equal(body.owner, null);
  const second = host(),
    d = enroll(second.runtime, {});
  second.runtime.prepareFrame(frame());
  second.runtime.activate(d.owner);
  second.runtime.updateState(d.owner, { flags: 0x80 });
  const retained = second.runtime.prepareFrame(frame(100))[0];
  assert.equal(retained.pool.status, "provider-required");
  assert.ok(
    retained.pool.requiredProviders.includes("native-active-halt-continuation"),
  );
  assert.equal(second.simulation.phil.count, 1);
});

test("actual pre-lambda simulation callback uses current source flags, real owner and one HP tail", () => {
  const events = [],
    { runtime, simulation } = host({
      hooks: {
        onActivated: (context) => events.push(["activated", context.owner]),
        contactProvider: ({ character, body, owner }) => ({
          settings: {
            severDamage: 1000,
            severChance: 0,
            maxSurvivableInitialImpact: 1,
            damagePerForce: 1,
          },
          form: {
            personalityMass: body.properties.mass,
            simpleBodyMass: body.properties.mass,
            boneCount: 3,
            nonHumanoid: false,
          },
          state: {
            hitPoints: character.hitPoints,
            flags: character.flags,
            immortal: false,
            exploding: false,
            brittle: false,
            goreLevel: 0,
            removedBoneMask: 0,
            headMissing: false,
          },
          damageTail: (packet) => {
            events.push(["tail", owner, packet.damage]);
            return {
              health: resolvePedContactDamage(
                packet.damage,
                packet.form,
                packet.state,
                packet.aliveMove,
                packet.deadMove,
              ),
              unresolved: [],
            };
          },
        }),
        onDamage: (context, result, phase) =>
          events.push(["damage", context.owner, phase, result.eligible]),
      },
    }),
    c = enroll(runtime, {});
  runtime.prepareFrame(frame(100));
  runtime.updateState(c.owner, { flags: 0x41, hitPoints: 73 });
  const other = {
    rigidType: 1,
    owner: {},
    state: {
      position: new Vector3(),
      velocity: new Vector3(0.1, 0, 0),
      angularVelocity: new Vector3(),
    },
    properties: {
      mass: 1,
      inertia: new Vector3(1, 1, 1),
      centerOfMass: new Vector3(),
      worldFriction: 0,
    },
  };
  // Feed an actual emitted geometry contact into the installed-order simulation
  // dispatcher, before any lambda exists; do not fabricate a damage result.
  simulation.preparePedContacts([
    { a: c.body, b: other, point: new Vector3(), normal: new Vector3(1, 0, 0) },
  ]);
  assert.equal(simulation.phil.getState(c.body), 2);
  assert.equal(c.physicsFlags & 4, 4);
  assert.deepEqual(
    events.map((event) => event[0]),
    ["activated", "tail", "damage"],
  );
  assert.ok(events.every((event) => event[1] === c.owner));
  assert.equal(events[1][2], Math.trunc((0.068 / c.body.properties.mass) ** 2));
  assert.equal(c.hitPoints, 0);
  assert.equal(c.body.hitPoints, 0);
  assert.equal(c.impactCount, 1);
});

test("severed current MODEL uses shared boned resources/header, source launch and state2 vanished release", () => {
  const stored = [],
    { runtime, simulation } = host({
      hooks: {
        storeRemovedPoses: (c, instance) =>
          stored.push([c.owner, instance.bones[1].actor]),
        restoreRemovedPoses: () => [],
      },
    }),
    c = enroll(runtime, {});
  runtime.prepareFrame(frame());
  const slot = runtime.reserveBonedSlot(c.owner),
    snapshot = runtime.readBone(c.owner, 1),
    request = {
      index: 1,
      slot,
      bone: c.instance.template.form.bones[1],
      snapshot,
      rigidType: 5,
      filterA: 0x40000,
      filterB: 0x50000,
      localOmega: [1, 2, 3],
      activation: {
        velocity: [4, 5, 6],
        gravity: 1,
        clearProperties: [3, 4, 5],
        clearDoNothing: true,
        enableHalt: true,
      },
      clearParentJoint: true,
      clearChildren: true,
      clearLink188: true,
    },
    registration = runtime.registerBone(c.owner, request),
    body = registration.body,
    shape = body.shape;
  assert.equal(body.shape.type, "SPHERE");
  assert.equal(body.actor, c.instance.bones[1].actor);
  assert.equal(simulation.phil.getState(body), 1);
  runtime.commitBone(c.owner, request, registration);
  assert.equal(simulation.phil.count, 2);
  assert.equal(simulation.phil.getState(body), 2);
  assert.equal(simulation.phil.getHeader(body).flags & 2, 0);
  assert.deepEqual(body.state.velocity.toArray(), [4, 5, 6]);
  assert.equal(c.instance.detachedBoneMask, 2);
  assert.equal(c.removedBoneMask, 2);
  const nativePose = c.instance.bones[1].pose;
  assert.equal(body.poseTarget, nativePose);
  const initialX = body.state.position.x;
  simulation.update(0.04);
  assert.ok(body.state.position.x > initialX);
  assert.equal(body.actor.matrix.elements[12], body.state.position.x);
  assert.equal(nativePose[9], f(body.state.position.x));
  assert.equal(body.poseTarget, nativePose);
  assert.equal(
    body.nativeMatrix.elements[12],
    body.actor.matrixWorld.elements[12],
  );
  const detachedMatrix = body.actor.matrix.clone();
  runtime.prepareFrame(frame(80));
  assert.ok(body.actor.matrix.equals(detachedMatrix));
  body.doNothing = true;
  runtime.updateState(c.owner, { flags: 0x80 });
  const released = runtime.prepareFrame(frame(100))[0];
  assert.equal(released.pool.status, "out-of-scope");
  assert.equal(simulation.phil.count, 0);
  assert.equal(c.vanishedBoneMask, 2);
  assert.equal(c.bonedSlot, -1);
  assert.equal(body.owner, null);
  assert.equal(body.poseTarget, undefined);
  assert.equal(body.shape, shape);
  assert.equal(runtime.bonePool.counts("safe-FORM").owned, 0);
  assert.equal(stored.length, 1);
});

test("bounded stored removed poses restore before PHIL admission and survive failed admission", () => {
  const { runtime, simulation } = host(),
    c = enroll(runtime, {});
  runtime.prepareFrame(frame());
  runtime.updateState(c.owner, { removedBoneMask: 2 });
  c.instance.bones[1].pose.set([...identity.slice(0, 9), 7, 8, 9]);
  const pose = [...c.instance.bones[1].pose];
  assert.equal(runtime.releaseCurrent(c.owner).status, "complete");
  assert.equal(runtime.storedPoses.stats.occupied, 1);
  assert.equal(c.vanishedBoneMask, 0);
  const register = simulation.phil.registerImmediate.bind(simulation.phil);
  let sawRestored = false;
  simulation.phil.registerImmediate = (body) => {
    sawRestored = [...c.instance.bones[1].pose].every((n, i) => n === pose[i]);
    assert.equal(c.instance.bones[1].actor.matrix.elements[12], 7);
    assert.equal(runtime.storedPoses.stats.occupied, 0);
    return 1;
  };
  assert.equal(runtime.prepareFrame(frame(100))[0].pool.status, "exhausted");
  assert.equal(sawRestored, true);
  assert.equal(
    runtime.storedPoses.stats.occupied,
    1,
    "failed admission stores restored render state again",
  );
  assert.equal(c.vanishedBoneMask, 0);
  simulation.phil.registerImmediate = register;
  runtime.updateState(c.owner, { flags: 1 });
  const visits = runtime.prepareFrame(frame(140));
  assert.equal(visits[0].pool.status, "processed");
  assert.equal(runtime.storedPoses.stats.occupied, 0);
  assert.equal(c.removedBoneMask, 2);
  assert.equal(c.vanishedBoneMask, 0);
  const body = runtime.bonePool.allocation(c).bodies[1];
  assert.deepEqual(body.state.velocity.toArray(), [0, 0, 0]);
  assert.deepEqual(body.state.angularVelocity.toArray(), [0, 0, 0]);
  assert.equal(c.instance.detachedBoneMask, 2);
  assert.equal(body.actor, c.instance.bones[1].actor);
  runtime.dispose();
  assert.equal(simulation.phil.count, 0);
  assert.equal(runtime.storedPoses.stats.occupied, 0);
});

test("retained joint2 is rejected before native bone admission or mask mutation", () => {
  const { runtime, simulation } = host(),
    c = enroll(runtime, {});
  runtime.prepareFrame(frame());
  const resource = runtime.bonePool.previewBodies(c)[1];
  resource.nativeJoint2 = { quietOrientationY: 1 };
  const before = simulation.phil.count;
  assert.deepEqual(runtime.preflightSeverBones(c.owner, [1]), [
    "native-retained-joint2-constraint",
  ]);
  assert.equal(runtime.bonePool.counts(c.formKey).owned, 0);
  assert.equal(simulation.phil.count, before);
  assert.equal(c.removedBoneMask, 0);
  assert.equal(resource.owner, null);
  assert.deepEqual(runtime.preflightSeverBones(c.owner, [2]), []);
  runtime.dispose();
});

for (const tree of ["data", "adv_data"])
  test(`original ${tree} Blokebl/Bandsman share actual BIPED1 resources and independent dead MODELs`, async (t) => {
    let store;
    try {
      store = await createAssetStore(process.env.CARMA2_ROOT ?? "carma2_orig");
    } catch (error) {
      if (
        error?.code === "ENOENT" ||
        /Original installation/.test(String(error))
      ) {
        t.skip("Original installation unavailable");
        return;
      }
      throw error;
    }
    const assets = new Assets();
    assets.manifest = store.manifest;
    assets.lookup = new Map(
      store.manifest.map((item) => [item.path.toLowerCase(), item.path]),
    );
    assets.bytes = async (path) => new Uint8Array(await store.read(path));
    const simulation = sim(),
      runtime = new NativePedRuntime(simulation, { levelOut: 0 }),
      registry = new NativePedDeadMaterialRegistry(),
      loaded = [],
      dead = [];
    for (const name of ["Blokebl", "Bandsman"]) {
      const native = await loadNativePedAssets(
          assets,
          `PEDS/PEEPS/${name}`,
          name,
          tree,
        ),
        deadModels = prepareNativePedDeadModels(name, native, {
          materialRegistry: registry,
          nullFaceMaterial: () => native.inheritedActorMaterial,
        });
      runtime.registerPersonality(name, native, { deadModels });
      loaded.push(native);
      dead.push(deadModels);
    }
    assert.equal(loaded[0].profile.formName, loaded[1].profile.formName);
    const a = enroll(runtime, {}, "Blokebl"),
      b = enroll(runtime, {}, "Bandsman", [1, 1, 0]),
      visits = runtime.prepareFrame(frame());
    assert.ok(
      visits.every(
        (visit) =>
          visit.pool.status === "processed" && visit.pose.status === "complete",
      ),
    );
    assert.equal(simulation.phil.count, 2);
    const counts = runtime.bodyPool.counts(a.formKey);
    assert.equal(counts.simpleCapacity, 30);
    assert.equal(counts.simpleOwned, 2);
    assert.equal(counts.renderCapacity, 30);
    assert.equal(runtime.bonePool.counts(a.formKey).capacity, 10);
    const actor = a.instance.bones[loaded[0].form.headBone].actor,
      body = a.body,
      selected = runtime.selectModel(a.owner, loaded[0].form.headBone, 0, 1);
    assert.equal(selected.nativeModelReturn, 1);
    assert.equal(a.instance.bones[loaded[0].form.headBone].actor, actor);
    assert.equal(a.body, body);
    assert.notEqual(
      a.instance.bones[loaded[0].form.headBone].model.children[0].geometry,
      b.instance.bones[loaded[1].form.headBone].model.children[0].geometry,
    );
    runtime.updateState(a.owner, { flags: 0x80 });
    runtime.updateState(b.owner, { flags: 0x80 });
    assert.ok(
      runtime
        .prepareFrame(frame(100))
        .every((visit) => visit.pool.status === "out-of-scope"),
    );
    assert.equal(simulation.phil.count, 0);
    runtime.updateState(a.owner, { flags: 1 });
    const scoped = runtime.prepareFrame(frame(200));
    assert.equal(scoped[0].pool.status, "processed");
    assert.equal(a.body, body);
    assert.equal(a.instance.bones[loaded[0].form.headBone].actor, actor);
    assert.equal(a.instance.modelSet, 1);
    assert.equal(simulation.phil.count, 1);
    runtime.updateState(a.owner, { flags: 0x80 });
    runtime.prepareFrame(frame(300));
    assert.equal(simulation.phil.count, 0);
    for (const resource of dead) resource.dispose();
    registry.dispose();
  });

test("post-pose outer hook observes saved root/passive V and active retained root exactly once; unresolved tail preserves BON", () => {
  const calls = [];
  const { runtime, simulation } = host({
    hooks: {
      afterPose: (ctx) => {
        assert.deepEqual(
          ctx.character.position,
          [...ctx.instance.rootPose].slice(9),
        );
        assert.deepEqual(
          [...ctx.character.rootPose],
          [...ctx.instance.rootPose],
        );
        assert.deepEqual(
          [...nativePedRootPose(ctx.body)],
          [...ctx.instance.rootPose],
        );
        if (!ctx.instance.physicsActive)
          assert.deepEqual(
            ctx.body.characterVelocity.toArray(),
            ctx.instance.nativeCharacterVelocity,
          );
        calls.push([
          ctx.timeMs,
          ctx.instance.clock.lastTimeMs,
          ctx.instance.physicsActive,
        ]);
        return {
          status: "provider-required",
          requiredProviders: ["actual-post-pose-owner"],
          processedFrames: 0,
          completedMove: false,
        };
      },
    },
  });
  const c = enroll(runtime, {});
  const first = runtime.prepareFrame(frame(100))[0];
  assert.equal(first.pose.status, "complete");
  assert.equal(first.afterPose.status, "provider-required");
  const second = runtime.prepareFrame(frame(140))[0];
  assert.equal(second.pose.status, "complete");
  assert.equal(c.instance.clock.lastTimeMs, 140);
  assert.equal(c.instance.clock.fraction, f(0.4));
  assert.deepEqual(calls, [
    [100, 100, false],
    [140, 140, false],
  ]);
  runtime.activate(c.owner);
  const root = [...nativePedRootPose(c.body)];
  c.body.state.velocity.set(0.2, -0.1, 0.3);
  runtime.prepareFrame(frame(160));
  assert.deepEqual([...c.instance.rootPose], root);
  assert.deepEqual(calls[2], [160, 160, true]);
  assert.equal(simulation.phil.getState(c.body), 2);
  runtime.updateState(c.owner, { flags: 0x80 });
  // Active resource release legitimately needs source halt; retain an explicit
  // unresolved release rather than inventing an accepted callback in this test.
  runtime.prepareFrame(frame(200));
  assert.equal(calls.length, 3);
});

test("post-pose hook is skipped after pre-pose failure and retains source MODEL set on knownNULL return0", () => {
  let calls = 0,
    blocked = true;
  const { runtime } = host({
    hooks: {
      beforePose: () =>
        blocked
          ? {
              status: "provider-required",
              requiredProviders: ["actual-ground-owner"],
              processedFrames: 0,
              completedMove: false,
            }
          : undefined,
      afterPose: () => {
        calls++;
      },
    },
  });
  const c = enroll(runtime, {});
  runtime.prepareFrame(frame(100));
  assert.equal(calls, 0);
  blocked = false;
  runtime.prepareFrame(frame(120));
  assert.equal(calls, 1);
  const model = c.instance.bones[1].model;
  // Actual set1 provider with a known-NULL pose is distinct from absent set1.
  c.instance.bones[1].modelSets[1] = [model, null, null, null];
  const result = runtime.selectModel(c.owner, 1, 1, 1);
  assert.equal(result.status, "complete");
  assert.equal(result.nativeModelReturn, 0);
  assert.equal(c.instance.bones[1].model, model);
  assert.equal(c.instance.bones[1].poseIndex, 0);
  assert.equal(c.modelSet, 1);
  assert.equal(c.instance.modelSet, 1);
});
