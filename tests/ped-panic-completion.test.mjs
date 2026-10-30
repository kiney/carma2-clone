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
import { NativePedGameplay } from "../src/ped-native-gameplay.ts";
import { NativePedRuntime } from "../src/ped-native-runtime.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { createNativePedPoolSettings } from "../src/ped-body-pool.ts";
import { nativePedBoxInertia } from "../src/ped-form.ts";
import { createNativePedMovePlanner } from "../src/ped-move-fsm.ts";
const f = Math.fround,
  identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const frame = (timeMs) => ({
  cameraOrigin: [0, 0, -10],
  timeMs,
  settings: createNativePedPoolSettings(100, 0),
});
function fixture() {
  const geometry = new BoxGeometry(0.1, 0.1, 0.1),
    material = new MeshBasicMaterial(),
    bounds = new Box3(
      new Vector3(-0.05, -0.05, -0.05),
      new Vector3(0.05, 0.05, 0.05),
    );
  geometry.userData.nativePedModelBounds = bounds;
  const model = (name) => {
    const actor = new Group();
    actor.name = name;
    actor.add(new Mesh(geometry, material));
    return {
      identifier: name,
      actor,
      sourceModels: [name],
      modelBounds: new Map([[name, bounds]]),
    };
  };
  const names = ["ROOT", "HEAD", "HAND", "LEFT_LEG", "AUX", "RIGHT_LEG"],
    masses = [60, 4, 4, 4, 4, 4],
    bones = names.map((name, index) => ({
      name,
      parent: index ? 0 : -1,
      massKg: masses[index],
      mass: f(masses[index] * 0.001),
      collisionType: index === 1 ? "SPHERE" : "BOX",
      jointType: "NONE",
      jointRecords: [],
    }));
  const form = {
    maxSimple: 3,
    maxRender: 3,
    maxBoned: 2,
    maxStoredDismembered: 2,
    remapFilename: null,
    bones,
    mass: f(0.068),
    nonHumanoid: false,
    headBone: 1,
    lyingAxes: [-1, 1],
    moves: [],
  };
  const variants = bones.map((b, index) => ({
    ...b,
    index,
    actor: null,
    variants: [0, 1, 2].map((p) => model(`${b.name}-${p}`)),
    attachments: index ? { child: [0, 0, 0], parent: [0, 0.1, 0] } : null,
  }));
  for (const b of variants) b.actor = b.variants[0].actor;
  const moves = new Map();
  for (const id of [2, 3, 4, 5, 6, 10, 11, 13, 30, 31, 40, 41, 50, 51, 112]) {
    const move = {
      id,
      periodMs: id === 40 || id === 41 ? 180 : 100,
      resetAxes: "XYZ",
      direction: [0, 0, 1],
      filename: `${id}.BON`,
      flags: 1,
    };
    form.moves.push(move);
    const matrices = new Float32Array(3 * bones.length * 12);
    for (let fr = 0; fr < 3; fr++)
      for (let b = 0; b < bones.length; b++)
        matrices.set(identity, (fr * bones.length + b) * 12);
    moves.set(id, {
      id,
      form: move,
      personality: { scale: 1, groundingMode: 1, groundingOffset: 0 },
      motion: {
        bones: bones.map((b) => ({ name: b.name, children: [] })),
        frameCount: 3,
        matrices,
      },
    });
  }
  const bodyBounds = { min: [-0.03, -0.1, -0.03], max: [0.03, 0.1, 0.03] };
  return {
    group: new Group(),
    form,
    bones: variants,
    inheritedActorMaterial: material,
    moves,
    scene: { materials: new Map(), textures: new Map() },
    profile: {
      formName: "fixture",
      defaultMovesName: "fixture",
      rootName: "ROOT",
      rootRemap: null,
      mass: f(0.068),
      bounds: bodyBounds,
      centreOfMass: [0, 0, 0],
      radius: 0.11,
      inertia: nativePedBoxInertia(f(0.068), bodyBounds),
      modelsByBone: new Map(),
      attachmentsByBone: new Map(),
      movement: new Map(),
    },
  };
}
function create(
  moveId,
  {
    cache = true,
    blind = false,
    valiumTimeMs = 0,
    suicidal = false,
    planMove,
  } = {},
) {
  const assets = fixture(),
    events = [];
  const simulation = new VehicleSimulation(
    { raycast: () => null, querySurfaces: () => [] },
    new Group(),
  );
  const gameplay = new NativePedGameplay({
    headModelRecording: "disabled",
    sharedHalt: { retryScalar: 8 },
    settings: {
      severDamage: 40,
      severChance: 10,
      maxSurvivableInitialImpact: f(8),
      damagePerForce: f(250),
    },
    readGlobals: () => ({
      immortal: false,
      exploding: false,
      brittle: false,
      goreLevel: 0,
      dismemberSpurtCount: 100,
      mutantSpeed: 0,
      blind,
      valiumTimeMs,
      suicidal,
      replay: false,
    }),
    nextCrtInteger: () => {
      throw new Error("fear completion must not draw RNG");
    },
    ...(planMove ? { planMove } : {}),
    onRecoveryEffect: (ctx, e) => {
      // The application outlet owns SetPedXZDirection. Consume that explicit
      // effect here; the subsequent real SetMove selects the new BON direction.
      if (e.kind === "direction") {
        ctx.character.direction = [...e.vector];
        ctx.instance.direction = [...e.vector];
      }
      events.push({
        kind: e.kind,
        direction: [...ctx.character.direction],
        timeMs: ctx.timeMs,
      });
    },
  });
  const runtime = new NativePedRuntime(simulation, {
    levelOut: 0,
    hooks: gameplay.hooks,
  });
  gameplay.bindRuntime(runtime);
  runtime.registerPersonality("fixture", assets);
  const c = runtime.enroll({
    owner: {},
    personality: "fixture",
    rootPose: [...identity.slice(0, 9), 0, 1, 0],
    moveId,
    direction: [0.6, 0, 0.8],
    groundNormal: [0, 1, 0],
    timeMs: 0,
    flags: 0x40,
  });
  const state = gameplay.enroll(c.owner, {
    action: 2,
    runningTimeMs: 17,
    cache: cache
      ? {
          retryCount: 2,
          flags: 0,
          stumpCounters: new Uint8Array(assets.form.bones.length),
          directionInterpolationMs: 50,
          killer: null,
          napalmDeadlineMs: 0,
          runSpeed: 321,
          runFactor: f(0.25),
        }
      : null,
  });
  runtime.prepareFrame(frame(100));
  const result = runtime.setMove(
    c.owner,
    moveId,
    c.direction,
    c.groundNormal,
    100,
    { completionRequested: true },
  );
  assert.equal(result.status, "complete");
  const instance = c.instance;
  const advance = (timeMs) => runtime.prepareFrame(frame(timeMs));
  advance(100);
  assert.equal(
    c.moveId,
    moveId,
    "requesting completion must not finish BON immediately",
  );
  assert.equal(instance.completionRequested, true);
  assert.equal(events.length, 0);
  return { c, state, events, advance, instance, runtime };
}

for (const moveId of [2, 3, 4, 5, 6, 10, 11]) {
  test(`actual fear BON${moveId} completion turns back and resumes RUN41 once`, () => {
    const h = create(moveId);
    const direction = [...h.c.direction],
      body = h.c.body;
    h.advance(399);
    assert.equal(h.c.moveId, moveId, "three-frame BON has not ended at 299ms");
    h.advance(400);
    assert.equal(h.c.moveId, 41);
    assert.deepEqual(
      h.c.direction,
      direction.map((n) => f(-n)),
    );
    assert.deepEqual(h.instance.direction, h.c.direction);
    assert.equal(h.state.action, 1);
    assert.equal(h.state.cache.runSpeed, 100);
    assert.equal(h.state.cache.runFactor, f(0.09));
    assert.equal(
      h.state.runningTimeMs,
      17,
      "fear completion does not call StartPedRunning",
    );
    assert.equal(h.instance.clock.periodMs, 100);
    assert.equal(h.instance.completionRequested, false);
    assert.equal(h.c.body, body);
    assert.equal(h.c.diagnostics.size, 0);
    const release = h.events.filter(
      (e) => e.kind === "release-selected-face-cache",
    );
    assert.equal(release.length, 1);
    assert.equal(release[0].timeMs, 400);
    assert.deepEqual(
      release[0].direction,
      h.c.direction,
      "turn occurs before source ground-cache release",
    );
    h.advance(800);
    assert.equal(
      h.events.filter((e) => e.kind === "release-selected-face-cache").length,
      1,
    );
    assert.deepEqual(
      h.c.direction,
      direction.map((n) => f(-n)),
      "looping run must not reverse again",
    );
  });
}

test("actual move13 BON completion resumes RUN40 without turning", () => {
  const h = create(13),
    direction = [...h.c.direction];
  h.advance(400);
  assert.equal(h.c.moveId, 40);
  assert.deepEqual(h.c.direction, direction);
  assert.equal(h.state.action, 1);
  assert.equal(h.state.cache.runSpeed, 100);
  assert.equal(h.state.cache.runFactor, f(0.09));
  assert.equal(h.state.runningTimeMs, 17);
  assert.equal(h.instance.completionRequested, false);
  assert.equal(h.c.diagnostics.size, 0);
});

for (const options of [{ blind: true }, { valiumTimeMs: 1000 }]) {
  test(`fear BON completion ignores recovery walk gate ${JSON.stringify(options)}`, () => {
    const h = create(2, options);
    h.advance(400);
    assert.equal(h.c.moveId, 41);
    assert.equal(h.state.action, 1);
  });
}

for (const moveId of [2, 13]) {
  test(`actual fear BON${moveId} completion without process cache uses authored run period`, () => {
    const h = create(moveId, { cache: false });
    h.advance(400);
    assert.equal(h.c.moveId, moveId === 13 ? 40 : 41);
    assert.equal(h.state.cache, null);
    assert.equal(h.state.runningTimeMs, 17);
    assert.equal(h.instance.clock.periodMs, 180);
    assert.equal(h.c.diagnostics.size, 0);
  });
}

test("suicidal fear completion resumes run without the turn-back effect", () => {
  const h = create(2, { suicidal: true }),
    direction = [...h.c.direction];
  h.advance(400);
  assert.equal(h.c.moveId, 41);
  assert.deepEqual(h.c.direction, direction);
  assert.equal(h.events.filter((e) => e.kind === "direction").length, 0);
});

for (const [mask, target] of [
  [8, 50],
  [32, 51],
  [40, 50],
]) {
  for (const moveId of [2, 13]) {
    test(`fear BON${moveId} missing-leg mask${mask} preserves SetPedMove substitution`, () => {
      // Only the two audited missing-leg cells are needed; the remaining
      // synthetic rows are identity rows, not a proprietary table fixture.
      const rows = Array.from({ length: 118 }, (_, id) => [
        1,
        -2,
        id,
        id,
        id,
        id,
        id,
      ]);
      for (const id of [40, 41]) {
        rows[id][2] = 50;
        rows[id][3] = 51;
      }
      const planner = createNativePedMovePlanner(
        { rows, sourceAddress: 0, sourceOffset: 0 },
        () => ({
          drunk: false,
          dancing: false,
          panicking: false,
          pedestrianSpeedFactor: 0,
        }),
      );
      const plans = [];
      const h = create(moveId, {
        planMove: (...args) => {
          const result = planner(...args);
          plans.push(result);
          return result;
        },
      });
      h.runtime.updateState(h.c.owner, { removedBoneMask: mask });
      h.advance(400);
      assert.equal(h.c.moveId, target);
      assert.equal(plans.length, 1);
      assert.deepEqual(plans[0].attempts, [target]);
      assert.equal(
        plans[0].speed,
        -1,
        "missing leg does not force intact-leg period100",
      );
      assert.equal(
        h.state.cache.runSpeed,
        0,
        "existing non-running move planner clears cached run speed",
      );
      assert.equal(
        h.state.cache.runFactor,
        f(0.25),
        "missing leg preserves old run factor",
      );
      assert.equal(h.state.runningTimeMs, 17);
      assert.equal(h.state.action, 1);
      assert.equal(h.c.diagnostics.size, 0);
    });
  }
}
