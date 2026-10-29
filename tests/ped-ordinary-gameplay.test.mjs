import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { createOrdinaryNativePedGameplay } from "../src/ped-ordinary-gameplay.ts";
import { NativeRandom, sharedNativeRandom } from "../src/native-random.ts";

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function fixture() {
  const globals = {
    immortal: false,
    exploding: false,
    brittle: false,
    goreLevel: 1,
    dismemberSpurtCount: 100,
    mutantSpeed: 0,
    blind: false,
    valiumTimeMs: 0,
    replay: false,
    drunk: false,
    dancing: false,
    panicking: false,
    pedestrianSpeedFactor: 1,
  };
  const groups = Array.from({ length: 11 }, () => []);
  groups[1] = [4100, 4102, 4104];
  const owner = {},
    caches = new Map(),
    plays = [],
    calls = [];
  const moveFSM = {
    rows: Array.from({ length: 118 }, (_, id) => [id, 0, id, id, 111, 31, 112]),
    sourceAddress: 0,
    sourceOffset: 0,
  };
  const options = {
    simulation: {
      pedestrianAttributionDriver: (car) => car.driver,
      pedestrianAttributionCulprit: (car) => car.culprit,
    },
    contactSettings: {
      severDamage: 100,
      severChance: 10,
      maxSurvivableInitialImpact: 8,
      damagePerForce: 250,
    },
    moveFSM,
    readGlobals: () => globals,
    readCache: (owner) => caches.get(owner) ?? null,
    readNoiseGroups: () => groups,
    playNoise: (id, position) => plays.push({ id, position }),
    readAllocation: () => ({ renderSlot: 7 }),
    oneLess: (...args) => {
      calls.push(["count", ...args]);
    },
    scoreDeath: (...args) => {
      calls.push(["score", ...args]);
    },
    killGiblets: (...args) => {
      calls.push(["giblets", ...args]);
    },
    contactEffects: (...args) => {
      calls.push(["effects", ...args]);
    },
  };
  const context = {
    owner,
    timeMs: 345,
    framePeriodMs: 40,
    character: { position: [10, 20, 30], removedBoneMask: 0 },
    instance: {
      characterOrientation: Float32Array.from(identity),
      template: {
        form: { headBone: 1, lyingAxes: [1, 3] },
        moves: new Map([
          [30, {}],
          [31, {}],
        ]),
      },
    },
    body: {
      state: { position: new Vector3(1, 2, 3), orientation: new Quaternion() },
      worldFaceNormals: [new Vector3(0, 0.6, 0.8)],
      firstWorldFaceNormal: new Vector3(1, 0, 0),
      properties: { mass: 0.07, inertia: new Vector3(0.1, 0.2, 0.3) },
      profile: { bounds: { min: [-0.1, -0.2, -0.1], max: [0.1, 0.2, 0.1] } },
      collisionFlags: 2,
    },
  };
  return { options, context, globals, groups, caches, plays, calls };
}

test("ordinary noise selects authored IDs with one actual shared CRT draw and uses retained ped position", () => {
  const h = fixture(),
    gameplay = createOrdinaryNativePedGameplay(h.options);
  const previous = sharedNativeRandom.state,
    expected = new NativeRandom(123);
  try {
    sharedNativeRandom.seed(123);
    const id = h.groups[1][Math.trunc((expected.nextInteger() * 3) / 32768)];
    gameplay.options.onNoise({ context: h.context, index: 1 });
    assert.equal(h.plays[0].id, id);
    assert.deepEqual(h.plays[0].position.toArray(), [10, 20, 30]);
    assert.equal(sharedNativeRandom.state, expected.state);
    gameplay.options.onNoise({ context: h.context, index: 0 });
    assert.equal(h.plays.length, 1);
    assert.equal(sharedNativeRandom.state, expected.state);
    assert.equal(gameplay.options.nextCrtInteger(), expected.nextInteger());
    h.options.readNoiseGroups = () => null;
    assert.deepEqual(
      gameplay.options.onNoise({ context: h.context, index: 1 }),
      ["source-personality-noise-table-owner"],
    );
  } finally {
    sharedNativeRandom.seed(previous);
  }
});

test("ordinary attribution inherits actual contacted character cache and refreshes current driver", () => {
  const h = fixture(),
    gameplay = createOrdinaryNativePedGameplay(h.options);
  const car = { damage: {}, driver: 8 },
    otherOwner = {},
    state = { cache: { flags: 0, killer: null } };
  h.caches.set(otherOwner, { killer: car });
  assert.deepEqual(
    gameplay.options.attributeContact(
      h.context,
      { other: { kind: "pedestrian", rigidType: 2, owner: otherOwner } },
      state,
    ),
    [],
  );
  assert.equal(state.cache.killer, car);
  assert.equal(state.cache.killerDriver, 8);
  car.driver = 6;
  gameplay.options.attributeContact(h.context, { other: undefined }, state);
  assert.equal(state.cache.killerDriver, 6);
  state.cache.killer = null;
  gameplay.options.attributeContact(h.context, { other: car }, state);
  assert.equal(state.cache.killer, car);
  assert.equal(state.cache.flags, 0);
});

test("halt reads actual root, contacts, allocation, physical properties and selected volume without synthetic floor", () => {
  const h = fixture(),
    gameplay = createOrdinaryNativePedGameplay(h.options);
  const input = gameplay.options.readHaltInput(h.context);
  assert.deepEqual([...input.actorRootPose].slice(9), [1, 2, 3]);
  assert.equal(
    input.characterOrientation,
    h.context.instance.characterOrientation,
  );
  assert.deepEqual(input.worldFaceNormals, [[0, 0.6, 0.8]]);
  assert.deepEqual(input.optionalFaceNormal, [1, 0, 0]);
  assert.deepEqual(input.inertia, [0.1, 0.2, 0.3]);
  assert.equal(input.mass, 0.07);
  assert.equal(input.bounds, h.context.body.profile.bounds);
  assert.deepEqual(input.head, { boneIndex: 1, renderSlot: 7, modelState: 7 });
  assert.equal(input.volumeGravity, null);
  assert.equal(gameplay.options.readVolumeGravity(h.context), null);
  h.context.body.specialVolume = { volume: { gravityMultiplier: 0.25 } };
  h.context.body.worldFaceNormals = [];
  h.context.body.firstWorldFaceNormal = null;
  h.options.readAllocation = () => null;
  const next = gameplay.options.readHaltInput(h.context);
  assert.deepEqual(next.worldFaceNormals, []);
  assert.equal(next.optionalFaceNormal, null);
  assert.equal(next.head.renderSlot, -1);
  assert.equal(next.volumeGravity, 0.25);
  assert.equal(gameplay.options.readVolumeGravity(h.context), 0.25);
  assert.equal(gameplay.options.headModelRecording, "disabled");
  assert.equal(gameplay.options.onRecoveryEffect, undefined);
  assert.equal(gameplay.options.preflightRecoveryEffects, undefined);
});

test("factory keeps real effect outlets and live FSM powerup substitutions", () => {
  const h = fixture(),
    readGroundHeight = () => 4,
    writeGroundedRoot = () => {};
  const gameplay = createOrdinaryNativePedGameplay({
    ...h.options,
    readGroundHeight,
    writeGroundedRoot,
  });
  assert.equal(gameplay.options.onOneLessPed, h.options.oneLess);
  assert.equal(gameplay.options.onScoreDeath, h.options.scoreDeath);
  assert.equal(gameplay.options.onKillGiblets, h.options.killGiblets);
  assert.equal(gameplay.options.onContactEffects, h.options.contactEffects);
  assert.equal(gameplay.options.readGroundHeight, readGroundHeight);
  assert.equal(gameplay.options.writeGroundedRoot, writeGroundedRoot);
  const request = {
    id: 30,
    speed: 100,
    completion: false,
    action: 0,
    retainRoot: false,
  };
  assert.equal(
    gameplay.options.planMove(h.context, request, { action: 0 }).moveId,
    30,
  );
  h.globals.drunk = true;
  h.globals.pedestrianSpeedFactor = 2;
  const plan = gameplay.options.planMove(h.context, request, { action: 0 });
  assert.equal(plan.moveId, 31);
  assert.equal(plan.speed, 50);
  assert.equal(plan.action, 1);
});
