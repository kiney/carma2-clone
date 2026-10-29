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
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { nativePedRootPose } from "../src/physics/ped-body.ts";
import { createNativePedPoolSettings } from "../src/ped-body-pool.ts";
import { nativePedBoxInertia } from "../src/ped-form.ts";

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
const complete = () => ({
  status: "complete",
  requiredProviders: [],
  processedFrames: 0,
  completedMove: false,
});
function setup(hooks = {}, capacities = {}, nextCrtInteger) {
  const simulation = sim();
  const runtime = new NativePedRuntime(simulation, {
    levelOut: 0,
    hooks,
    nextCrtInteger,
  });
  runtime.registerPersonality("first", assetsFixture("first", capacities));
  return { simulation, runtime };
}

test("passive bridge runs after BON before passive root/velocity and saved-root stores", () => {
  const events = [];
  const random = () => 17;
  const { runtime, simulation } = setup(
    {
      onRenderPrepared(c, instance) {
        assert.equal(c.instance, instance);
        assert.equal(c.body, null);
        assert.equal(instance.group.parent, simulation.scene);
        assert.equal(instance.nextCrtInteger, random);
        events.push("render");
      },
      beforePose() {
        events.push("before-pose");
      },
      passivePose(ctx) {
        events.push("passive-pose");
        assert.equal(ctx.instance.clock.lastTimeMs, ctx.timeMs);
        assert.equal(simulation.phil.getState(ctx.body), 1);
        ctx.instance.rootPose.set([3, 4, 5], 9);
        ctx.instance.nativeCharacterVelocity.splice(0, 3, 6, 7, 8);
        return complete();
      },
      beforeSaveRoot(ctx) {
        events.push("before-save");
        assert.deepEqual(
          nativePedRootPose(ctx.body).slice(9),
          new Float32Array([3, 4, 5]),
        );
        assert.deepEqual(ctx.body.state.velocity.toArray(), [6, 7, 8]);
        assert.deepEqual(ctx.body.characterVelocity.toArray(), [6, 7, 8]);
      },
      afterPose(ctx) {
        events.push("after-pose");
        assert.deepEqual(ctx.character.position, [3, 4, 5]);
      },
    },
    {},
    random,
  );
  const c = enroll(runtime, {});
  const visit = runtime.prepareFrame(frame(100))[0];
  assert.equal(visit.passivePose.status, "complete");
  assert.deepEqual(events, [
    "render",
    "before-pose",
    "passive-pose",
    "before-save",
    "after-pose",
  ]);
  runtime.activate(c.owner);
  events.length = 0;
  runtime.prepareFrame(frame(200));
  assert.deepEqual(events, ["before-pose", "before-save", "after-pose"]);
  runtime.dispose();
});

test("missing passive bridge retains completed BON but does not commit passive matrix or save root", () => {
  let block = false;
  const { runtime, simulation } = setup({
    passivePose(ctx) {
      if (!block) return complete();
      assert.equal(ctx.instance.clock.lastTimeMs, 200);
      return {
        ...complete(),
        status: "provider-required",
        requiredProviders: ["test-movement-owner"],
      };
    },
  });
  const c = enroll(runtime, {});
  runtime.prepareFrame(frame(100));
  const oldBodyRoot = nativePedRootPose(c.body),
    oldPosition = [...c.position];
  let commits = 0;
  const write = simulation.phil.setPassiveMatrix.bind(simulation.phil);
  simulation.phil.setPassiveMatrix = (...args) => {
    commits++;
    return write(...args);
  };
  block = true;
  const visit = runtime.prepareFrame(frame(200))[0];
  assert.equal(visit.pose.status, "complete");
  assert.equal(visit.passivePose.status, "provider-required");
  assert.equal(c.instance.clock.lastTimeMs, 200);
  assert.equal(commits, 0);
  assert.deepEqual(nativePedRootPose(c.body), oldBodyRoot);
  assert.deepEqual(c.position, oldPosition);
  assert.ok(c.diagnostics.has("test-movement-owner"));
  runtime.dispose();
});

test("render hooks follow reused FORM actors and unbind before ownership release", () => {
  const events = [];
  const { runtime, simulation } = setup({
    onRenderPrepared(c, instance) {
      events.push(["prepare", c.owner, instance]);
    },
    onRenderReleased(c, instance) {
      assert.equal(c.instance, instance);
      assert.ok(instance.bones[0].model);
      assert.equal(
        simulation.phil.registeredBodies.some(
          (body) => body.actor === instance.bones[0].actor,
        ),
        false,
      );
      events.push(["release", c.owner, instance]);
    },
  });
  const a = enroll(runtime, {}),
    b = enroll(runtime, {}, "first", [200, 1, 0]);
  runtime.prepareFrame(frame(100));
  const actor = a.instance.bones[0].actor,
    body = a.body,
    firstInstance = a.instance;
  runtime.setRootPose(a.owner, [...identity.slice(0, 9), 200, 1, 0]);
  runtime.setRootPose(b.owner, [...identity.slice(0, 9), 0, 1, 0]);
  runtime.prepareFrame(frame(200));
  assert.equal(a.instance, null);
  assert.equal(b.body, body);
  assert.equal(b.instance.bones[0].actor, actor);
  assert.notEqual(b.instance, firstInstance);
  assert.deepEqual(
    events.map((e) => e[0]),
    ["prepare", "release", "prepare"],
  );
  runtime.dispose();
  assert.deepEqual(
    events.map((e) => e[0]),
    ["prepare", "release", "prepare", "release"],
  );
});

function severHead(runtime, c) {
  const request = {
    index: 1,
    slot: runtime.reserveBonedSlot(c.owner),
    bone: c.instance.template.form.bones[1],
    snapshot: runtime.readBone(c.owner, 1),
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
  };
  const registered = runtime.registerBone(c.owner, request);
  runtime.commitBone(c.owner, request, registered);
  return registered.body;
}

test("whole-race dispose removes actual simple/part resources once without halt and clears retained pools", () => {
  let released = 0,
    halted = 0;
  const { runtime, simulation } = setup(
    {
      onRenderReleased() {
        released++;
      },
      onHalt() {
        halted++;
        throw new Error("No gameplay halt at teardown");
      },
    },
    { maxBoned: 2 },
  );
  const a = enroll(runtime, {}),
    exhausted = enroll(runtime, {}),
    dormant = enroll(runtime, {}, "first", [200, 1, 0]);
  runtime.prepareFrame(frame(100));
  const body = a.body,
    part = severHead(runtime, a),
    instance = a.instance;
  runtime.activate(a.owner);
  // Even an unsuccessful/empty sever reservation owns a bounded slot.
  assert.equal(runtime.reserveBonedSlot(dormant.owner), 1);
  const bodyPool = runtime.bodyPool,
    bonePool = runtime.bonePool;
  let simpleRemovals = 0,
    partRemovals = 0;
  const removeSimple = simulation.removePedBody.bind(simulation),
    removePart = simulation.removePedBoneBody.bind(simulation);
  simulation.removePedBody = (b) => {
    simpleRemovals++;
    removeSimple(b);
  };
  simulation.removePedBoneBody = (b) => {
    partRemovals++;
    removePart(b);
  };
  runtime.dispose();
  runtime.dispose();
  assert.equal(runtime.bodyPool, bodyPool);
  assert.equal(runtime.bonePool, bonePool);
  assert.equal(simpleRemovals, 1);
  assert.equal(partRemovals, 1);
  assert.equal(released, 1);
  assert.equal(halted, 0);
  assert.equal(simulation.phil.count, 0);
  assert.equal(simulation.pedBodies.length, 0);
  assert.equal(simulation.pedBoneBodies.length, 0);
  assert.equal(runtime.characters.length, 0);
  assert.equal(bodyPool.forms.size, 0);
  assert.equal(bonePool.forms.size, 0);
  assert.equal(bodyPool.allocations.size, 0);
  assert.equal(bonePool.owners.size, 0);
  for (const c of [a, exhausted, dormant]) {
    assert.equal(c.body, null);
    assert.equal(c.instance, null);
    assert.equal(c.physicsFlags, 0);
    assert.equal(c.bonedSlot, -1);
  }
  for (const cb of [
    "contactProvider",
    "onActivated",
    "onContactDamage",
    "onMoved",
    "onHalt",
  ])
    assert.equal(body[cb], undefined);
  assert.equal(body.owner, null);
  assert.equal(part.owner, null);
  assert.equal(part.poseTarget, undefined);
  assert.equal(instance.group.parent, null);
  assert.equal(instance.bones[0].model, null);
  assert.throws(() => runtime.prepareFrame(frame(200)), /disposed/);
});

test("teardown refuses incomplete PHIL removal and can retry after traversal completes", () => {
  const { runtime, simulation } = setup();
  const c = enroll(runtime, {});
  runtime.prepareFrame(frame(100));
  const body = c.body,
    instance = c.instance;
  const remove = simulation.removePedBody.bind(simulation);
  simulation.removePedBody = () => {};
  assert.throws(() => runtime.dispose(), /completed PHIL removal/);
  assert.equal(c.body, body);
  assert.equal(c.instance, instance);
  assert.ok(body.onMoved);
  assert.equal(runtime.characters.length, 1);
  simulation.removePedBody = remove;
  runtime.dispose();
  assert.equal(simulation.phil.count, 0);
});

test("failed admission releases render once and teardown clears partially prepared unowned callbacks", () => {
  let prepared = 0,
    released = 0;
  const { runtime, simulation } = setup({
    onRenderPrepared() {
      prepared++;
    },
    onRenderReleased() {
      released++;
    },
  });
  const body = runtime.bodyPool.forms.get("safe-FORM").simple[0].resource;
  const register = simulation.phil.registerImmediate.bind(simulation.phil);
  simulation.phil.registerImmediate = () => 1;
  const c = enroll(runtime, {});
  const visit = runtime.prepareFrame(frame(100))[0];
  assert.equal(visit.pool.status, "exhausted");
  assert.equal(visit.pool.registrationReturn, 1);
  assert.equal(c.body, null);
  assert.equal(c.instance, null);
  assert.equal(prepared, 1);
  assert.equal(released, 1);
  assert.equal(body.owner, c.owner);
  assert.ok(body.onMoved);
  simulation.phil.registerImmediate = register;
  runtime.dispose();
  assert.equal(released, 1);
  assert.equal(body.owner, null);
  assert.equal(body.onMoved, undefined);
  assert.equal(body.onHalt, undefined);
  assert.equal(body.contactProvider, undefined);
});

test("pool teardown checks actual PHIL release before clearing ownership", () => {
  const { runtime, simulation } = setup();
  const c = enroll(runtime, {});
  runtime.prepareFrame(frame(100));
  const part = severHead(runtime, c);
  assert.throws(
    () =>
      runtime.bodyPool.dispose((body) => simulation.phil.getState(body) === 0),
    /actual PHIL removal/,
  );
  assert.equal(runtime.bodyPool.allocation(c.owner).body, c.body);
  assert.throws(
    () => runtime.bonePool.dispose(() => true),
    /actual PHIL removal/,
  );
  assert.equal(runtime.bonePool.allocation(c).bodies[1], part);
  runtime.dispose();
});
