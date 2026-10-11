import test from "node:test";
import assert from "node:assert/strict";
import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from "three";
import { NativePedGameplay } from "../src/ped-native-gameplay.ts";
import { NativePedRuntime } from "../src/ped-native-runtime.ts";
import { createNativePedPoolSettings } from "../src/ped-body-pool.ts";
import { nativePedBoxInertia } from "../src/ped-form.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import {
  acceptNativePedHalt,
  activateNativePedBody,
  createNativePedBody,
  resetNativePedWaterPlane,
} from "../src/physics/ped-body.ts";

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const bounds = { min: [-0.03, -0.1, -0.03], max: [0.03, 0.1, 0.03] };
const profile = () => ({
  formName: "safe-halt",
  defaultMovesName: "safe-halt",
  rootName: "ROOT",
  rootRemap: null,
  mass: Math.fround(0.068),
  bounds,
  centreOfMass: [0, 0, 0],
  radius: 0.11,
  inertia: nativePedBoxInertia(Math.fround(0.068), bounds),
  modelsByBone: new Map(),
  attachmentsByBone: new Map(),
  movement: new Map(),
  jumpHeight: 0,
});
function cache() {
  return {
    volume: { gravityMultiplier: 1 },
    automatic: { gravityMultiplier: 0.5 },
    depth: Math.fround(0.25),
    waterDistance: Math.fround(-0.125),
    waterNormal: new Vector3(0, 1, 0),
  };
}
function assets() {
  // Safe authored FORM/BON stand-ins; no original model data is embedded.
  const material = new MeshBasicMaterial(),
    geometry = new BoxGeometry(0.1, 0.1, 0.1);
  const modelBounds = new Box3(
    new Vector3(-0.05, -0.05, -0.05),
    new Vector3(0.05, 0.05, 0.05),
  );
  geometry.userData.nativePedModelBounds = modelBounds;
  const bones = ["ROOT", "HEAD"].map((name, index) => {
    const actor = new Group();
    actor.name = name;
    actor.add(new Mesh(geometry, material));
    return {
      index,
      name,
      parent: index ? 0 : -1,
      massKg: index ? 4 : 64,
      mass: Math.fround(index ? 0.004 : 0.064),
      collisionType: "BOX",
      jointType: "NONE",
      jointRecords: [],
      actor,
      variants: [
        {
          identifier: name,
          actor,
          sourceModels: [name],
          modelBounds: new Map([[name, modelBounds]]),
        },
      ],
      attachments: index ? { child: [0, 0, 0], parent: [0, 0.1, 0] } : null,
    };
  });
  const move = {
    id: 94,
    periodMs: 100,
    resetAxes: "XYZ",
    direction: [0, 0, 1],
    filename: "SAFE.BON",
    flags: 1,
  };
  const matrices = new Float32Array(2 * 2 * 12);
  for (let i = 0; i < 4; i++) matrices.set(identity, i * 12);
  return {
    group: new Group(),
    bones,
    inheritedActorMaterial: material,
    profile: profile(),
    scene: { materials: new Map(), textures: new Map() },
    form: {
      maxSimple: 2,
      maxRender: 2,
      maxBoned: 1,
      maxStoredDismembered: 1,
      remapFilename: null,
      bones,
      mass: Math.fround(0.068),
      nonHumanoid: false,
      headBone: 1,
      lyingAxes: [-1, 1],
      moves: [move],
    },
    moves: new Map([
      [
        94,
        {
          id: 94,
          form: move,
          personality: { scale: 1, groundingMode: 1, groundingOffset: 0 },
          motion: {
            bones: bones.map((b) => ({ name: b.name, children: [] })),
            frameCount: 2,
            matrices,
          },
        },
      ],
    ]),
  };
}
function host(preflight) {
  let draws = 0,
    effects = 0;
  const simulation = new VehicleSimulation(
    { raycast: () => null, querySurfaces: () => [] },
    new Group(),
  );
  const gameplay = new NativePedGameplay({
    settings: {
      severDamage: 40,
      severChance: 10,
      maxSurvivableInitialImpact: Math.fround(8),
      damagePerForce: Math.fround(250),
    },
    readGlobals: () => ({
      immortal: false,
      exploding: false,
      brittle: false,
      goreLevel: 0,
      dismemberSpurtCount: 100,
      mutantSpeed: 0,
      blind: false,
      valiumTimeMs: 0,
      replay: false,
    }),
    nextCrtInteger: () => {
      draws++;
      return 0;
    },
    headModelRecording: "disabled",
    sharedHalt: { retryScalar: 8 },
    onRecoveryEffect: () => {
      effects++;
    },
    preflightRecoveryEffects: preflight,
    readHaltInput: (ctx) => ({
      actorRootPose: identity,
      characterOrientation: identity,
      worldFaceNormals: [[0, 1, 0]],
      mass: ctx.body.properties.mass,
      inertia: [1, 3, 2],
      bounds,
      lyingAxes: [-1, 1],
      collisionFlag: false,
      nowMs: 100,
      immortal: false,
      volumeGravity: 1,
      goreLevel: 0,
      mutantSpeed: 0,
    }),
  });
  const runtime = new NativePedRuntime(simulation, {
    levelOut: 0,
    hooks: gameplay.hooks,
  });
  gameplay.bindRuntime(runtime);
  const resource = assets();
  runtime.registerPersonality("safe-halt", resource, {
    modelSet1: resource.bones.map((b) => [b.actor.clone()]),
  });
  const owner = {},
    character = runtime.enroll({
      owner,
      personality: "safe-halt",
      rootPose: identity,
      moveId: 94,
      direction: [0, 0, 1],
      groundNormal: [0, 1, 0],
      timeMs: 0,
      flags: 0x110,
      hitPoints: 0,
    });
  gameplay.enroll(owner, {
    action: 6,
    cache: {
      retryCount: 0,
      flags: 0,
      stumpCounters: new Uint8Array(2),
      directionInterpolationMs: 0,
      killer: null,
      napalmDeadlineMs: 0,
    },
  });
  runtime.prepareFrame({
    cameraOrigin: [0, 0, -10],
    timeMs: 100,
    settings: createNativePedPoolSettings(100, 0),
  });
  assert.ok(character.body);
  assert.equal(runtime.activate(owner), true);
  character.body.doNothing = true;
  character.body.specialVolume = cache();
  return {
    simulation,
    gameplay,
    runtime,
    owner,
    character,
    draws: () => draws,
    effects: () => effects,
  };
}

test("installed4fec00 sentinel reset retains selected and automatic volume identity and all neighboring fields", () => {
  const body = createNativePedBody({
    actor: new Object3D(),
    profile: profile(),
    rootPose: identity,
    levelOut: 0,
  });
  const retained = (body.specialVolume = cache()),
    { volume, automatic, depth, waterNormal } = retained;
  activateNativePedBody(body, new Vector3(0.25, 0.5, 0.75));
  acceptNativePedHalt(body);
  assert.equal(body.specialVolume, retained);
  assert.deepEqual(
    [retained.volume, retained.automatic, retained.depth, retained.waterNormal],
    [volume, automatic, depth, waterNormal],
  );
  assert.equal(retained.volume, volume);
  assert.equal(retained.automatic, automatic);
  assert.equal(retained.waterNormal, waterNormal);
  assert.equal(retained.waterDistance, 10000);
  assert.equal(body.headerState, 1);
  assert.deepEqual(
    body.characterVelocity.toArray(),
    body.state.velocity.toArray(),
  );
  resetNativePedWaterPlane(body);
  assert.equal(body.specialVolume, retained);
  delete body.specialVolume;
  resetNativePedWaterPlane(body);
  assert.equal(
    body.specialVolume,
    undefined,
    "reset does not manufacture a cache",
  );
});

test("already-sentinel native reset returns before another field store", () => {
  const body = createNativePedBody({
    actor: new Object3D(),
    profile: profile(),
    rootPose: identity,
    levelOut: 0,
  });
  const retained = (body.specialVolume = cache());
  let distance = retained.waterDistance,
    writes = 0;
  Object.defineProperty(retained, "waterDistance", {
    get: () => distance,
    set: (value) => {
      writes++;
      distance = value;
    },
  });
  resetNativePedWaterPlane(body);
  resetNativePedWaterPlane(body);
  assert.equal(distance, 10000);
  assert.equal(writes, 1);
});

test("real runtime corpse halt acceptance retains PHIL resource and volume cache through both reset call sites", () => {
  const h = host(),
    body = h.character.body,
    retained = body.specialVolume;
  const shape = body.hulls[0],
    state = body.state,
    owner = body.owner;
  h.simulation.finishPedFrame(40);
  assert.equal(h.simulation.phil.getState(body), 1);
  assert.equal(h.character.body, body);
  assert.equal(body.hulls[0], shape);
  assert.equal(body.state, state);
  assert.equal(body.owner, owner);
  assert.equal(body.specialVolume, retained);
  assert.equal(retained.waterDistance, 10000);
  assert.equal(retained.volume.gravityMultiplier, 1);
  assert.equal(retained.automatic.gravityMultiplier, 0.5);
  assert.equal(retained.depth, 0.25);
  assert.deepEqual(retained.waterNormal.toArray(), [0, 1, 0]);
  assert.equal(h.character.instance.clock.periodMs, 0);
  assert.equal(
    h.draws(),
    1,
    "ordinary dead halt chance draw remains before the gore gate",
  );
});

test("recovery preflight rejects before halt CRT, masks, animation and water-plane mutation", () => {
  const calls = [];
  const h = host((ctx, state, input, decision) => {
    calls.push([ctx.owner, state.hitPoints, input.replay, decision.kind]);
    return ["actual-corpse-effect-owner"];
  });
  const body = h.character.body,
    retained = body.specialVolume,
    flags = body.rigidFlags,
    period = h.character.instance.clock.periodMs;
  h.simulation.finishPedFrame(40);
  assert.deepEqual(calls, [[h.owner, 0, false, "dead"]]);
  assert.equal(h.draws(), 0);
  assert.equal(h.effects(), 0);
  assert.equal(body.rigidFlags, flags);
  assert.equal(h.character.instance.clock.periodMs, period);
  assert.equal(body.specialVolume, retained);
  assert.equal(retained.waterDistance, -0.125);
  assert.equal(h.simulation.phil.getState(body), 2);
});
