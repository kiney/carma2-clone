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
import { OrdinaryPedRuntime } from "../src/ped-ordinary-runtime.ts";
import { NativePedPresentation } from "../src/ped-presentation.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { PedAction } from "../src/ped-rules.ts";
import { nativePedBoxInertia } from "../src/ped-form.ts";
import { acceptNativePedHalt } from "../src/physics/ped-body.ts";

const f = Math.fround,
  identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const world = { raycast: () => null, querySurfaces: () => [] };
function assets(name) {
  const material = new MeshBasicMaterial(),
    geometry = new BoxGeometry(0.1, 0.1, 0.1),
    bounds = new Box3(
      new Vector3(-0.05, -0.05, -0.05),
      new Vector3(0.05, 0.05, 0.05),
    );
  geometry.userData.nativePedModelBounds = bounds;
  const model = (id) => {
    const actor = new Group();
    actor.add(new Mesh(geometry, material));
    return {
      identifier: id,
      actor,
      sourceModels: [id],
      modelBounds: new Map([[id, bounds]]),
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
  ];
  const moveForm = {
    id: 30,
    periodMs: 100,
    resetAxes: "",
    direction: [1, 0, 0],
    filename: "fixture.BON",
    flags: 1,
  };
  const repulseMoveForm = {
    ...moveForm,
    id: 91,
    filename: "fixture-repulse.BON",
  };
  const form = {
    maxSimple: 1,
    maxRender: 1,
    maxBoned: 1,
    maxStoredDismembered: 1,
    remapFilename: null,
    bones: formBones,
    mass: f(0.005),
    moves: [moveForm, repulseMoveForm],
    nonHumanoid: false,
    headBone: 1,
    lyingAxes: [1, 3],
  };
  const bones = formBones.map((bone, index) => ({
    ...bone,
    index,
    actor: model(`${name}-${bone.name}`).actor,
    variants: [model(`${name}-${bone.name}`), model(`${name}-${bone.name}-p1`)],
    attachments: index ? { child: [0, 0, 0], parent: [0, 0.1, 0] } : null,
  }));
  const motion = {
    bones: bones.map((b) => ({ name: b.name, children: [] })),
    frameCount: 3,
    matrices: new Float32Array(3 * bones.length * 12),
  };
  for (let fr = 0; fr < 3; fr++)
    for (let b = 0; b < bones.length; b++)
      motion.matrices.set(identity, (fr * bones.length + b) * 12);
  const move = {
    id: 30,
    form: moveForm,
    personality: { scale: 1, groundingMode: 1, groundingOffset: 0 },
    motion,
  };
  const repulseMove = {
    ...move,
    id: 91,
    form: repulseMoveForm,
  };
  const bodyBounds = { min: [-0.03, -0.1, -0.03], max: [0.03, 0.1, 0.03] };
  return {
    form,
    bones,
    group: new Group(),
    inheritedActorMaterial: material,
    profile: {
      formName: name,
      defaultMovesName: name,
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
    moves: new Map([
      [30, move],
      [91, repulseMove],
    ]),
    scene: { materials: new Map(), textures: new Map() },
    dispose() {},
  };
}
function makePed(template, name, x = 0) {
  const object = new Group(),
    visual = new Group();
  object.name = name;
  object.position.set(x, 0, 0);
  object.add(visual);
  const presentation = new NativePedPresentation(template);
  const box = new Box3(new Vector3(-0.1, 0, -0.1), new Vector3(0.1, 1, 0.1));
  return {
    personality: name,
    object,
    visual,
    presentation,
    limbs: [],
    footOffset: 0,
    home: object.position.clone(),
    initialYaw: 0,
    heading: 0,
    phase: 0,
    alive: true,
    vanished: false,
    fallTime: 0,
    velocity: new Vector3(),
    spec: {
      material: "fixture",
      movement: 0,
      group: 1,
      density: 1,
      exclusions: [],
      exclusionFlags: [],
      exceptions: [],
    },
    movement: {
      minTurnMs: 0,
      maxTurnMs: 0,
      maxTurnRadians: 0,
      minWalkPeriod: 100,
      maxWalkPeriod: 100,
    },
    walkPeriod: 100,
    nextTurnMs: 0,
    lastScareMs: 0,
    firstScareMs: 0,
    nextAvoidMs: 0,
    turnFrom: 0,
    turnTo: 0,
    turnStart: 0,
    turnEnd: 0,
    actionSinceMs: 0,
    runPeriod: 80,
    action: PedAction.Panicking,
    moveId: 30,
    active: true,
    corporeal: false,
    angularVelocity: new Vector3(),
    networkStateCutoffMs: 0,
    awardCauseFlags: 0,
    startingVelocity: new Vector3(),
    burningUntilMs: 0,
    napalmSlot: -1,
    settled: false,
    profile: {
      available: new Set([30]),
      movePeriod: new Map([[30, 100]]),
      groundingOffset: new Map([[30, 0]]),
      bounds: box,
      jumpHeight: 0,
      moveDistance: new Map([[30, 0.1]]),
      moveDuration: new Map([[30, 100]]),
      mass: 0.005,
    },
    proximity: { flags: 0, distance: 10000, position: object.position.clone() },
  };
}
function harness(count = 2) {
  const simulation = new VehicleSimulation(world, new Group()),
    templates = new Map(),
    peds = [];
  const template = assets("fixture");
  templates.set("fixture", template);
  for (let i = 0; i < count; i++)
    peds.push(makePed(template, `ped${i}`, i * 0.2));
  const settings = {
    processDistance: 20,
    popupDistance: 30,
    maxSlopeDegrees: 50,
    reach: 2,
    avoidDistance: 1,
    buoyancyFactor: 0,
    movements: [
      {
        minTurnMs: 0,
        maxTurnMs: 0,
        maxTurnRadians: 0,
        minWalkPeriod: 100,
        maxWalkPeriod: 100,
      },
    ],
  };
  const movementFSM = {
    rows: Array.from({ length: 118 }, (_, id) => [
      id,
      30,
      id,
      id,
      111,
      31,
      112,
    ]),
    sourceAddress: 0,
    sourceOffset: 0,
  };
  for (const ped of peds) ped.personality = "fixture";
  const bridge = new OrdinaryPedRuntime({
    simulation,
    peds,
    templates,
    effects: new Map(),
    noises: new Map([["fixture", Array.from({ length: 11 }, () => [])]]),
    settings,
    contactSettings: {
      severDamage: 100,
      severChance: 10,
      maxSurvivableInitialImpact: 8,
      damagePerForce: 250,
    },
    moveFSM: movementFSM,
    spurtingPeriodMs: 1000,
    frame: () => ({ framePeriodMs: 40 }),
    readSlick: () => null,
    readSlickMaterials: () => null,
    groundAt: () => 0,
    bind: () => {},
    oneLess: () => {},
    scoreDeath: () => {},
    killGiblets: () => {},
    contactEffects: () => {},
    electric: () => {},
    playNoise: () => {},
    warn: () => {},
  });
  return { simulation, bridge, peds };
}

test("ordinary bridge enrolls original population owners and admits one canonical PHIL body per owner", () => {
  const h = harness(2),
    camera = new Vector3(0, 0, 0);
  try {
    assert.equal(h.bridge.stats.enrolled, 2);
    for (const ped of h.peds)
      assert.equal(h.bridge.runtime.character(ped.object).owner, ped.object);
    h.bridge.prepare(camera, 40, true);
    const admitted = h.peds.filter((p) => h.bridge.admitted(p));
    assert.equal(
      admitted.length,
      1,
      "fixture FORM pool has one simple body slot",
    );
    const exhaustedOwner = h.peds.find((p) => p !== admitted[0]);
    assert.equal(
      h.bridge.canShowRetained(admitted[0]),
      true,
      "admitted presentation remains visible",
    );
    assert.equal(
      h.bridge.canShowRetained(exhaustedOwner),
      false,
      "capacity-exhausted nearby substitute is hidden",
    );
    const owner = admitted[0],
      character = h.bridge.runtime.character(owner.object),
      body = character.body;
    assert.ok(body);
    assert.equal(body.owner, owner.object);
    assert.equal(h.simulation.phil.getState(body), 1);
    assert.equal(h.bridge.stats.physical, 1);
    assert.equal(
      h.simulation.phil.registeredBodies.filter((b) => b.owner === owner.object)
        .length,
      1,
    );
    assert.equal(owner.visual.visible, false);
    const saved = character.instance.rootPose.slice(9, 12);
    assert.deepEqual(
      Array.from(saved),
      owner.object.position.toArray().map(Math.fround),
    );
    const priorX = owner.object.position.x;
    owner.object.position.x = priorX + 0.4;
    h.bridge.prepare(camera, 80, true);
    assert.equal(
      character.body,
      body,
      "passive ordinary movement keeps the enrolled PHIL body",
    );
    assert.equal(
      Math.fround(character.position[0]),
      Math.fround(priorX),
      "presentation-only writes cannot move the canonical native root",
    );
    assert.equal(
      Math.fround(character.instance.nativeCharacterVelocity[0]),
      0,
      "static authored BON gives zero native transport, not a second estimated launch",
    );
    assert.equal(
      h.simulation.phil.registeredBodies.filter((b) => b.owner === owner.object)
        .length,
      1,
    );
    const census = h.bridge.runtime.characters.map((row) => row.owner),
      oldBody = body;
    h.bridge.prepare(new Vector3(1000, 0, 1000), 120, true);
    assert.equal(
      character.body,
      null,
      "far camera releases the simple body from the original owner",
    );
    assert.equal(
      h.simulation.phil.registeredBodies.includes(oldBody),
      false,
      "released body leaves PHIL",
    );
    assert.equal(h.bridge.stats.physical, 0);
    assert.equal(
      h.bridge.canShowRetained(owner),
      true,
      "far released owner may retain its presentation",
    );
    assert.equal(
      h.bridge.canShowRetained(exhaustedOwner),
      true,
      "the prior-frame capacity denial expires after both owners leave scope",
    );
    h.bridge.prepare(camera, 160, true);
    assert.deepEqual(
      h.bridge.runtime.characters.map((row) => row.owner),
      census,
      "reacquisition does not duplicate or replace population identities",
    );
    assert.equal(
      character.body,
      oldBody,
      "bounded FORM slot is reused by the same source owner",
    );
    assert.equal(character.body.owner, owner.object);
    assert.equal(h.simulation.phil.getState(oldBody), 1);
    assert.equal(
      h.simulation.phil.registeredBodies.filter((b) => b.owner === owner.object)
        .length,
      1,
    );
    assert.equal(
      h.bridge.stats.physical,
      1,
      "second owner remains capacity-exhausted; release did not resurrect identities",
    );
    assert.equal(h.bridge.canShowRetained(owner), true);
    assert.equal(
      h.bridge.canShowRetained(exhaustedOwner),
      false,
      "visible fallback is suppressed again for this frame's capacity denial",
    );
  } finally {
    h.bridge.dispose();
  }
});

test("repulse on an already-active owner adds velocity and angular impulse without resetting its body", () => {
  const h = harness(1),
    ped = h.peds[0],
    camera = new Vector3();
  try {
    h.bridge.prepare(camera, 40, true);
    const character = h.bridge.runtime.character(ped.object),
      body = character.body;
    assert.ok(body);
    assert.equal(h.bridge.runtime.activate(ped.object), true);
    assert.equal(h.simulation.phil.getState(body), 2);
    body.state.velocity.set(1.25, -0.5, 2);
    body.state.angularVelocity.set(-0.25, 0.75, 1.5);
    const oldVelocity = body.state.velocity.clone(),
      oldOmega = body.state.angularVelocity.clone();
    const deltaV = new Vector3(3, 2, -1),
      deltaOmega = new Vector3(0.5, -2, 4);
    assert.equal(h.bridge.repel(ped, 100, deltaV, deltaOmega, 80), true);
    assert.equal(
      character.body,
      body,
      "repulsion retains the original native body",
    );
    assert.equal(
      h.simulation.phil.getState(body),
      2,
      "repulsion keeps the existing active PHIL state",
    );
    assert.deepEqual(
      body.state.velocity.toArray(),
      oldVelocity.add(deltaV).toArray(),
    );
    assert.deepEqual(
      body.state.angularVelocity.toArray(),
      oldOmega.add(deltaOmega).toArray(),
    );
    acceptNativePedHalt(body);
    assert.equal(
      h.simulation.phil.makePassive(body),
      0,
      "settle the test body through native halt and PHIL passive transitions before testing scope expiry",
    );
    h.bridge.prepare(camera, 120, true);
    h.bridge.finishRepulsion(ped, 120);
    assert.equal(
      character.cacheEventTimeMs,
      120,
      "finishRepulsion records source +0x8c on the canonical process cache",
    );
    h.bridge.prepare(new Vector3(1000, 0, 1000), 120 + 7499, true);
    assert.equal(
      character.body,
      body,
      "the far owner is retained through 7,499 ms of repulsion grace",
    );
    assert.equal(character.cacheEventTimeMs, 120);
    h.bridge.prepare(new Vector3(1000, 0, 1000), 120 + 7500, true);
    assert.equal(
      character.body,
      null,
      "the exact 7,500 ms boundary releases the out-of-scope owner",
    );
    assert.equal(h.simulation.phil.registeredBodies.includes(body), false);
  } finally {
    h.bridge.dispose();
  }
});
