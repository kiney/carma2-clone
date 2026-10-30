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
      hitPoints: 37,
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
    hitPoints: 37,
  });
}
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

function sever(runtime, character, index, active = true) {
  const request = {
    index,
    slot: runtime.reserveBonedSlot(character.owner),
    bone: character.instance.template.form.bones[index],
    snapshot: runtime.readBone(character.owner, index),
    rigidType: 5,
    filterA: 0x40000,
    filterB: 0x50000,
    localOmega: [1, 2, 3],
    activation: active
      ? {
          velocity: [4, 5, 6],
          gravity: 1,
          clearProperties: [3, 4, 5],
          clearDoNothing: true,
          enableHalt: true,
        }
      : null,
    clearParentJoint: true,
    clearChildren: true,
    clearLink188: true,
  };
  const registration = runtime.registerBone(character.owner, request);
  assert.ok(registration);
  runtime.commitBone(character.owner, request, registration);
  return registration.body;
}
function trackedSetup(capacities = {}) {
  let draws = 0,
    releases = 0;
  const fixture = setup(
    {
      afterRelease() {
        releases++;
      },
    },
    capacities,
    () => {
      draws++;
      return 17;
    },
  );
  return { ...fixture, draws: () => draws, releases: () => releases };
}
function trackReads(runtime) {
  const indices = [],
    read = runtime.readBone.bind(runtime);
  runtime.readBone = (owner, index) => {
    indices.push(index);
    return read(owner, index);
  };
  return indices;
}
function assertReleased(runtime, simulation, character, mask, vanished) {
  assert.equal(character.hitPoints, 37);
  assert.equal(character.removedBoneMask, mask);
  assert.equal(character.vanishedBoneMask, vanished);
  assert.equal(character.physicsFlags, 0);
  assert.equal(character.bonedSlot, -1);
  assert.equal(character.body, null);
  assert.equal(character.instance, null);
  assert.equal(runtime.allocation(character.owner), null);
  assert.equal(runtime.bonePool.allocation(character), null);
  assert.equal(runtime.bonePool.counts(character.formKey).owned, 0);
  assert.equal(runtime.bonePool.counts(character.formKey).releasePending, 0);
  assert.equal(simulation.phil.count, 0);
  assert.equal(simulation.pedBodies.length, 0);
  assert.equal(simulation.pedBoneBodies.length, 0);
}

test("vanished severed parts survive repeated re-entry and current release without physical reinitialization", () => {
  const fx = trackedSetup(),
    { runtime, simulation } = fx;
  try {
    const c = enroll(runtime, {});
    runtime.prepareFrame(frame(100));
    const head = sever(runtime, c, 1),
      shape = head.shape;
    const draws = fx.draws(),
      reads = trackReads(runtime);
    assert.equal(runtime.releaseCurrent(c.owner).status, "complete");
    assertReleased(runtime, simulation, c, 2, 2);
    assert.equal(head.owner, null);
    assert.equal(head.poseTarget, undefined);
    for (let cycle = 0; cycle < 3; cycle++) {
      assert.equal(
        runtime.prepareFrame(frame(140 + cycle * 40))[0].pool.status,
        "processed",
      );
      assert.equal(c.hitPoints, 37);
      assert.equal(c.body.hitPoints, 37);
      assert.equal(c.removedBoneMask, 2);
      assert.equal(c.vanishedBoneMask, 2);
      assert.equal(c.bonedSlot, 0);
      assert.equal(runtime.bonePool.allocation(c).bodies[1], head);
      assert.equal(head.shape, shape);
      assert.equal(head.owner, null);
      assert.equal(head.poseTarget, undefined);
      assert.equal(simulation.phil.getState(head), 0);
      assert.equal(simulation.phil.count, 1);
      assert.equal(simulation.pedBoneBodies.length, 0);
      assert.deepEqual(reads, [], "vanished parts never request a stored pose");
      assert.equal(
        fx.draws(),
        draws,
        "resource lifecycle consumes no random draws",
      );
      assert.equal(runtime.releaseCurrent(c.owner).status, "complete");
      assertReleased(runtime, simulation, c, 2, 2);
      assert.equal(
        fx.releases(),
        cycle + 2,
        "each allocation releases exactly once",
      );
      assert.equal(runtime.releaseCurrent(c.owner).status, "complete");
      assert.equal(
        fx.releases(),
        cycle + 2,
        "repeated release has no new ownership phase",
      );
    }
    assert.equal(fx.draws(), draws);
  } finally {
    runtime.dispose();
    simulation.dispose();
  }
});

test("mixed vanished and passive removed parts reacquire only the surviving physical part", () => {
  const fx = trackedSetup(),
    { runtime, simulation } = fx;
  try {
    const c = enroll(runtime, {});
    runtime.prepareFrame(frame(100));
    const head = sever(runtime, c, 1),
      hand = sever(runtime, c, 2, false);
    assert.equal(simulation.phil.getState(head), 2);
    assert.equal(simulation.phil.getState(hand), 1);
    const draws = fx.draws(),
      reads = trackReads(runtime);
    assert.equal(runtime.releaseCurrent(c.owner).status, "complete");
    assertReleased(runtime, simulation, c, 6, 2);
    assert.equal(runtime.prepareFrame(frame(140))[0].pool.status, "processed");
    const allocation = runtime.bonePool.allocation(c);
    assert.equal(allocation.bodies[1], head);
    assert.equal(allocation.bodies[2], hand);
    assert.equal(head.owner, null);
    assert.equal(simulation.phil.getState(head), 0);
    assert.equal(hand.owner, c.owner);
    assert.equal(hand.actor, c.instance.bones[2].actor);
    assert.equal(simulation.phil.getState(hand), 1);
    assert.deepEqual(hand.state.velocity.toArray(), [0, 0, 0]);
    assert.deepEqual(hand.state.angularVelocity.toArray(), [0, 0, 0]);
    assert.equal(c.instance.detachedBoneMask, 4);
    assert.equal(simulation.phil.count, 2);
    assert.deepEqual(reads, [2]);
    assert.equal(c.hitPoints, 37);
    assert.equal(c.body.hitPoints, 37);
    assert.equal(fx.draws(), draws);
    assert.equal(runtime.releaseCurrent(c.owner).status, "complete");
    assertReleased(runtime, simulation, c, 6, 2);
    assert.equal(hand.owner, null);
    assert.equal(fx.draws(), draws);
    assert.equal(fx.releases(), 2);
  } finally {
    runtime.dispose();
    simulation.dispose();
  }
});

test("a shared FORM slot can serve another personality before the vanished owner re-enters", () => {
  const fx = trackedSetup({ maxStoredDismembered: 2 }),
    { runtime, simulation } = fx;
  try {
    runtime.registerPersonality(
      "second",
      assetsFixture("second", { maxStoredDismembered: 2 }),
    );
    const first = enroll(runtime, {});
    runtime.prepareFrame(frame(100));
    const head = sever(runtime, first, 1),
      table = runtime.bonePool.allocation(first).bodies;
    assert.equal(runtime.releaseCurrent(first.owner).status, "complete");
    runtime.updateState(first.owner, { flags: first.flags | 0x80 });
    const second = enroll(runtime, {}, "second");
    runtime.prepareFrame(frame(140));
    const hand = sever(runtime, second, 2);
    assert.equal(runtime.bonePool.allocation(second).bodies, table);
    assert.equal(hand, table[2]);
    assert.equal(hand.owner, second.owner);
    assert.equal(head.owner, null);
    assert.equal(runtime.releaseCurrent(second.owner).status, "complete");
    assertReleased(runtime, simulation, second, 4, 4);
    runtime.updateState(second.owner, { flags: second.flags | 0x80 });
    runtime.updateState(first.owner, { flags: 1 });
    const draws = fx.draws(),
      reads = trackReads(runtime);
    runtime.prepareFrame(frame(180));
    assert.equal(runtime.bonePool.allocation(first).bodies, table);
    assert.equal(first.bonedSlot, 0);
    assert.equal(first.removedBoneMask, 2);
    assert.equal(first.vanishedBoneMask, 2);
    assert.equal(head.owner, null);
    assert.equal(hand.owner, null);
    assert.equal(simulation.phil.getState(head), 0);
    assert.equal(simulation.phil.getState(hand), 0);
    assert.equal(simulation.phil.count, 1);
    assert.deepEqual(reads, []);
    assert.equal(first.hitPoints, 37);
    assert.equal(second.hitPoints, 37);
    assert.equal(fx.draws(), draws);
    assert.equal(runtime.releaseCurrent(first.owner).status, "complete");
    assertReleased(runtime, simulation, first, 2, 2);
    assert.equal(second.removedBoneMask, 4);
    assert.equal(second.vanishedBoneMask, 4);
    assert.equal(fx.releases(), 3);
    assert.equal(fx.draws(), draws);
  } finally {
    runtime.dispose();
    simulation.dispose();
  }
});

test("an ownerless bone with a live PHIL header remains invalid and keeps its pool ownership", () => {
  const fx = trackedSetup(),
    { runtime, simulation } = fx;
  let head, c;
  try {
    c = enroll(runtime, {});
    runtime.prepareFrame(frame(100));
    head = sever(runtime, c, 1);
    const draws = fx.draws();
    head.owner = null;
    assert.throws(
      () => runtime.releaseCurrent(c.owner),
      /Prepared native bone resource required/,
    );
    assert.equal(simulation.phil.getState(head), 2);
    assert.equal(runtime.bonePool.allocation(c).bodies[1], head);
    assert.equal(runtime.bonePool.counts(c.formKey).owned, 1);
    assert.equal(c.bonedSlot, 0);
    assert.equal(c.removedBoneMask, 2);
    assert.equal(c.vanishedBoneMask, 2);
    assert.ok(runtime.allocation(c.owner));
    assert.equal(c.hitPoints, 37);
    assert.equal(fx.draws(), draws);
    assert.equal(fx.releases(), 0);
    head.owner = c.owner;
    assert.equal(runtime.releaseCurrent(c.owner).status, "complete");
    assertReleased(runtime, simulation, c, 2, 2);
    assert.equal(fx.releases(), 1);
  } finally {
    if (head && simulation.phil.getState(head) !== 0) head.owner = c.owner;
    runtime.dispose();
    simulation.dispose();
  }
});
