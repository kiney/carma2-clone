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
import { createNativePedRecoveryMoveCallback } from "../src/ped-recovery-move.ts";
import { createNativePedPoolSettings } from "../src/ped-body-pool.ts";
import { nativePedBoxInertia } from "../src/ped-form.ts";
import { nativePedRootPose } from "../src/physics/ped-body.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";
import { setNativePedRecoveryMove } from "../src/ped-recovery-move.ts";
import { advanceNativePedPose } from "../src/ped-native-instance.ts";
import { advancePedAnimationClock } from "../src/ped-form.ts";

const f = Math.fround,
  identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const frame = (timeMs) => ({
  cameraOrigin: [0, 0, -10],
  timeMs,
  settings: createNativePedPoolSettings(100, 0),
});
function safeAssets() {
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
      mass: f(index ? 0.004 : 0.064),
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
  const bounds = { min: [-0.03, -0.1, -0.03], max: [0.03, 0.1, 0.03] };
  const profile = {
    formName: "safe-stillify",
    defaultMovesName: "safe-stillify",
    rootName: "ROOT",
    rootRemap: null,
    mass: f(0.068),
    bounds,
    centreOfMass: [0, 0, 0],
    radius: 0.11,
    inertia: nativePedBoxInertia(f(0.068), bounds),
    modelsByBone: new Map(),
    attachmentsByBone: new Map(),
    movement: new Map(),
    jumpHeight: 0,
  };
  const moves = new Map();
  for (const id of [30, 94, 113]) {
    const move = {
        id,
        periodMs: 100,
        resetAxes: "",
        direction: [1, 0, 0],
        filename: "SAFE.BON",
        flags: 0,
      },
      matrices = new Float32Array(3 * 2 * 12);
    for (let fr = 0; fr < 3; fr++)
      for (let bone = 0; bone < 2; bone++) {
        matrices.set(identity, (fr * 2 + bone) * 12);
        matrices[(fr * 2 + bone) * 12 + 9] = fr * 0.2;
      }
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
  return {
    group: new Group(),
    bones,
    inheritedActorMaterial: material,
    profile,
    scene: { materials: new Map(), textures: new Map() },
    form: {
      maxSimple: 2,
      maxRender: 2,
      maxBoned: 1,
      maxStoredDismembered: 1,
      remapFilename: null,
      bones,
      mass: f(0.068),
      nonHumanoid: false,
      headBone: 1,
      lyingAxes: [-1, 1],
      moves: [...moves.values()].map((m) => m.form),
    },
    moves,
  };
}
function host(resource = safeAssets(), initialMove = 94) {
  const simulation = new VehicleSimulation(
      { raycast: () => null, querySurfaces: () => [] },
      new Group(),
    ),
    calls = [];
  const globals = {
    immortal: false,
    exploding: false,
    brittle: false,
    goreLevel: 0,
    dismemberSpurtCount: 100,
    mutantSpeed: 0,
    blind: false,
    valiumTimeMs: 0,
    replay: false,
  };
  let gameplay;
  const recovery = createNativePedRecoveryMoveCallback({
    readCallbackState: (ctx) => gameplay.state(ctx.owner).callback,
  });
  gameplay = new NativePedGameplay({
    settings: {
      severDamage: 40,
      severChance: 10,
      maxSurvivableInitialImpact: f(8),
      damagePerForce: f(250),
    },
    readGlobals: () => globals,
    nextCrtInteger: () => {
      throw new Error("Stillify must not draw RNG");
    },
    headModelRecording: "disabled",
    planMove: () => {
      throw new Error("direct Stillify must bypass SetPedMove planner");
    },
    setRecoveryMove: (ctx, request) => {
      calls.push({
        request,
        velocity: ctx.body.state.velocity.toArray(),
        timeMs: ctx.timeMs,
      });
      return recovery(ctx, request);
    },
  });
  const runtime = new NativePedRuntime(simulation, {
    levelOut: 0,
    hooks: gameplay.hooks,
  });
  gameplay.bindRuntime(runtime);
  runtime.registerPersonality("fixture", resource, {
    modelSet1: resource.bones.map((b) =>
      b.variants.map((v) => v.actor?.clone() ?? null),
    ),
  });
  const owner = {},
    character = runtime.enroll({
      owner,
      personality: "fixture",
      rootPose: identity,
      moveId: initialMove,
      direction: [1, 0, 0],
      groundNormal: [0, 1, 0],
      timeMs: 0,
    });
  const state = gameplay.enroll(owner, { action: 0, cache: null });
  runtime.prepareFrame(frame(100));
  assert.ok(character.body && character.instance);
  const context = (timeMs) => ({
    owner,
    character,
    instance: character.instance,
    body: character.body,
    timeMs,
    framePeriodMs: 0,
  });
  return {
    simulation,
    gameplay,
    runtime,
    globals,
    calls,
    character,
    state,
    context,
  };
}

test("passive outer BON velocity reaches actual Object+68 before afterPose/Stillify", () => {
  const h = host(safeAssets(), 30),
    b = h.character.body,
    v = b.state.velocity;
  b.state.velocity.set(100, 200, 300);
  const visit = h.runtime.prepareFrame(frame(200))[0];
  assert.equal(visit.pose.status, "complete");
  assert.equal(b.state.velocity, v);
  assert.deepEqual(v.toArray(), h.character.instance.nativeCharacterVelocity);
  assert.ok(
    v.length() > 0,
    "safe authored root translation provides real animation V",
  );
  assert.deepEqual(b.characterVelocity.toArray(), v.toArray());
  assert.equal(h.calls.length, 0);
});

test("outer active BON visit preserves physical velocity instead of copying animation velocity", () => {
  const h = host(safeAssets(), 30),
    c = h.character;
  h.runtime.activate(c.owner);
  c.body.state.velocity.set(f(0.2), f(-0.3), f(0.4));
  const before = c.body.state.velocity.toArray();
  const visit = h.runtime.prepareFrame(frame(200))[0];
  assert.equal(visit.pose.status, "complete");
  assert.deepEqual(c.body.state.velocity.toArray(), before);
  assert.equal(h.calls.length, 0);
});

test("direct Stillify rate setter completes before the existing head animation outlet", () => {
  const h = host(),
    order = [],
    originalHead = h.gameplay.advanceHeadSequence.bind(h.gameplay);
  const originalRecovery = h.gameplay.options.setRecoveryMove;
  // The constructor retains the actual recovery callback; its recorded call is
  // observed by the actual head operation without replacing the setter.
  assert.equal(typeof originalRecovery, "function");
  h.gameplay.advanceHeadSequence = (owner, timeMs) => {
    order.push([h.calls.length, h.character.instance.clock.periodMs, timeMs]);
    return originalHead(owner, timeMs);
  };
  h.character.hitPoints = 0;
  h.state.action = 6;
  const result = h.gameplay.hooks.beforeSaveRoot(h.context(0xffffffff));
  assert.equal(result.status, "complete");
  assert.deepEqual(order, []);
  h.gameplay.hooks.afterPose(h.context(0xffffffff));
  assert.deepEqual(order, [[1, 0, 0xffffffff]]);
});

test("Stillify tests animation-period WORD rather than independent impact count, then preserves source current move/clock/root", () => {
  for (const [mutant, period, expected] of [
    [0, 100, 0],
    [0, -1, 0],
    [0, -32768, 0],
    [1.5, 0, 150],
    [-1.5, 0, 1],
    [0, 0, null],
    [1.5, 100, null],
    [1e-50, 100, 0],
  ]) {
    const h = host(),
      c = h.character,
      instance = c.instance;
    h.globals.mutantSpeed = mutant;
    c.hitPoints = -1;
    c.impactCount = 0xffff;
    h.state.action = 6;
    instance.clock.periodMs = period;
    instance.clock.frame = 1;
    instance.clock.fraction = 0.375;
    instance.clock.lastTimeMs = 0xffffffff;
    instance.completionRequested = true;
    h.state.callback.flags = 3;
    h.state.callback.queuedMoveIndex = 0;
    const move = instance.move,
      root = instance.rootPose.slice(),
      physical = nativePedRootPose(c.body),
      O = instance.characterOrientation.slice(),
      velocity = c.body.state.velocity.toArray(),
      omega = c.body.state.angularVelocity.toArray();
    const result = h.gameplay.hooks.beforeSaveRoot(h.context(0));
    assert.equal(result.status, "complete");
    assert.equal(
      h.calls.length,
      expected === null ? 0 : 1,
      `mutant=${mutant},period=${period}`,
    );
    assert.equal(instance.clock.periodMs, expected ?? period);
    assert.equal(instance.move, move);
    assert.equal(instance.moveId, 94);
    assert.deepEqual(
      [
        instance.clock.frame,
        instance.clock.fraction,
        instance.clock.lastTimeMs,
      ],
      [1, 0.375, 0xffffffff],
    );
    assert.deepEqual(instance.rootPose, root);
    assert.deepEqual(nativePedRootPose(c.body), physical);
    assert.deepEqual(instance.characterOrientation, O);
    assert.deepEqual(c.body.state.velocity.toArray(), velocity);
    assert.deepEqual(c.body.state.angularVelocity.toArray(), omega);
    assert.equal(instance.completionRequested, true);
    assert.deepEqual(h.state.callback, { flags: 3, queuedMoveIndex: 0 });
    if (expected !== null)
      assert.deepEqual(h.calls[0].request, {
        id: -1,
        speed: f(mutant) === 0 ? 0 : f(-f(mutant)),
        completion: false,
        retainRoot: false,
      });
  }
});

test("HP/action/move113/physical-active gates retain period, including independent zero impact count", () => {
  for (const patch of [
    { hp: 1 },
    { hp: 0, action: 5 },
    { hp: -128, move: 113 },
    { hp: 0, active: true },
  ]) {
    const h = host(safeAssets(), patch.move ?? 94),
      c = h.character;
    c.hitPoints = patch.hp;
    c.impactCount = 0;
    h.state.action = patch.action ?? 6;
    if (patch.active) h.runtime.activate(c.owner);
    c.instance.clock.periodMs = 100;
    const result = h.gameplay.hooks.beforeSaveRoot(h.context(500));
    assert.equal(result.status, "complete");
    assert.equal(h.calls.length, 0);
    assert.equal(c.instance.clock.periodMs, 100);
  }
});

test("processed passive corpse visit synchronizes V before direct freeze and does not repeat freeze next zero-period visit", () => {
  const h = host(),
    c = h.character;
  c.hitPoints = -128;
  c.impactCount = 0;
  h.state.action = 6;
  const first = h.runtime.prepareFrame(frame(200))[0];
  assert.equal(first.afterPose.status, "complete");
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].velocity, c.instance.nativeCharacterVelocity);
  assert.ok(new Vector3(...h.calls[0].velocity).length() > 0);
  assert.equal(c.instance.clock.periodMs, 0);
  assert.equal(h.simulation.phil.getState(c.body), 1);
  assert.equal(c.instance.clock.lastTimeMs, 200);
  const second = h.runtime.prepareFrame(frame(201))[0];
  assert.equal(second.afterPose.status, "complete");
  assert.equal(h.calls.length, 1);
  assert.deepEqual(c.body.state.velocity.toArray(), [0, 0, 0]);
});

test("outer hooks observe V-copy then old ped.pos, current ACT, saved ped.pos, and head in source order", () => {
  const h = host(),
    c = h.character,
    events = [];
  const before = h.gameplay.hooks.beforeSaveRoot,
    after = h.gameplay.hooks.afterPose;
  const oldPosition = [...c.position];
  c.hitPoints = 0;
  h.state.action = 6;
  h.gameplay.hooks.beforeSaveRoot = (ctx) => {
    events.push([
      "before",
      [...ctx.character.position],
      [...ctx.instance.rootPose.subarray(9)],
      ctx.body.state.velocity.toArray(),
      ctx.instance.clock.periodMs,
    ]);
    return before(ctx);
  };
  h.gameplay.hooks.afterPose = (ctx) => {
    events.push([
      "after",
      [...ctx.character.position],
      [...ctx.instance.rootPose.subarray(9)],
      ctx.body.state.velocity.toArray(),
      ctx.instance.clock.periodMs,
    ]);
    return after(ctx);
  };
  const visit = h.runtime.prepareFrame(frame(200))[0];
  assert.equal(visit.beforeSaveRoot.status, "complete");
  assert.equal(visit.afterPose.status, "complete");
  assert.deepEqual(
    events.map((e) => e[0]),
    ["before", "after"],
  );
  assert.deepEqual(events[0][1], oldPosition);
  assert.notDeepEqual(events[0][2], oldPosition);
  assert.deepEqual(events[1][1], events[0][2]);
  assert.deepEqual(events[1][2], events[0][2]);
  assert.deepEqual(events[0][3], events[1][3]);
  assert.deepEqual(
    events.map((e) => e[4]),
    [100, 0],
  );
});

test("unresolved before-save owner retains completed BON/passive V and exposes its own phase result without saving ped.pos/head", () => {
  const h = host(safeAssets(), 30),
    c = h.character,
    oldPosition = [...c.position];
  const oldRootRecord = c.rootPose.slice();
  let heads = 0;
  h.gameplay.hooks.beforeSaveRoot = () => ({
    status: "provider-required",
    requiredProviders: ["actual-before-save-owner"],
    processedFrames: 0,
    completedMove: false,
  });
  h.gameplay.hooks.afterPose = () => {
    heads++;
  };
  const visit = h.runtime.prepareFrame(frame(200))[0];
  assert.equal(visit.pose.status, "complete");
  assert.equal(visit.pose.processedFrames, 1);
  assert.equal(visit.beforeSaveRoot.status, "provider-required");
  assert.equal(visit.afterPose, undefined);
  assert.ok(c.diagnostics.has("actual-before-save-owner"));
  assert.deepEqual(c.position, oldPosition);
  assert.deepEqual(c.rootPose, oldRootRecord);
  assert.notDeepEqual(c.instance.rootPose, oldRootRecord);
  assert.deepEqual(
    c.body.state.velocity.toArray(),
    c.instance.nativeCharacterVelocity,
  );
  assert.ok(c.body.state.velocity.length() > 0);
  assert.equal(c.instance.clock.lastTimeMs, 200);
  assert.equal(heads, 0);
  const advancedRoot = c.instance.rootPose.slice(),
    advancedV = c.body.state.velocity.toArray();
  h.gameplay.hooks.beforeSaveRoot = () => ({
    status: "complete",
    requiredProviders: [],
    processedFrames: 0,
    completedMove: false,
  });
  const retry = h.runtime.prepareFrame(frame(200))[0];
  assert.equal(
    retry.pose.processedFrames,
    0,
    "same-clock recovery does not replay committed BON",
  );
  assert.deepEqual(c.instance.rootPose, advancedRoot);
  assert.deepEqual(c.body.state.velocity.toArray(), advancedV);
  assert.deepEqual(c.position, [...advancedRoot.subarray(9)]);
  assert.equal(heads, 1);
});

test("actual pool release inside before-save callback skips stale owner/root/head dereferences", () => {
  const h = host(safeAssets(), 30),
    c = h.character,
    body = c.body,
    instance = c.instance;
  let heads = 0;
  h.gameplay.hooks.beforeSaveRoot = () => {
    const released = h.runtime.bodyPool.visitFrame(h.runtime.characters, {
      ...frame(200),
      cameraOrigin: [1e6, 0, 0],
    });
    assert.equal(released[0].status, "out-of-scope");
    return {
      status: "complete",
      requiredProviders: [],
      processedFrames: 0,
      completedMove: false,
    };
  };
  h.gameplay.hooks.afterPose = () => {
    heads++;
  };
  const visit = h.runtime.prepareFrame(frame(200))[0];
  assert.equal(visit.pose.status, "complete");
  assert.equal(visit.pose.processedFrames, 1);
  assert.equal(visit.beforeSaveRoot.status, "complete");
  assert.equal(visit.afterPose, undefined);
  assert.equal(c.body, null);
  assert.equal(c.instance, null);
  assert.equal(h.simulation.phil.getState(body), 0);
  assert.equal(heads, 0);
  assert.equal(instance.clock.lastTimeMs, 200);
  assert.ok(body.state.velocity.length() > 0);
});

test("native original core rate captures accept signed AX and preserve all current-move fields", () => {
  // Private HW40a050 captures under native CRT PC53. Inputs are synthetic;
  // these literal outcomes are independent of the JavaScript conversion.
  for (const [authored, speed, expected] of [
    [125, -400, -15536],
    [125, -262.136, 32766],
    [125, -262.144, -32768],
    [0xffffffff, -1, -1],
    [125, 32767.9, 32767],
    [125, 32768, -32768],
    [0xffffffff, -3.402823466e38, 0],
    [125, -0, 0],
    [0xffffffff, -16777218, 0],
  ]) {
    // Admission uses a representable ordinary initial rate. The unsigned
    // current authored DWORD is supplied at the actual setter boundary.
    const h = host(),
      instance = h.character.instance;
    instance.move.asset.form.periodMs = authored;
    instance.clock.frame = 2;
    instance.clock.fraction = 0.75;
    instance.clock.lastTimeMs = 1234;
    const root = instance.rootPose.slice(),
      O = instance.characterOrientation.slice(),
      move = instance.move;
    const callbackState = { flags: 1, queuedMoveIndex: 2 };
    const result = setNativePedRecoveryMove({
      instance,
      id: -1,
      rootPose: instance.rootPose,
      timeMs: 0xffffffff,
      speed,
      completion: false,
      retainRoot: false,
      callbackState,
    });
    assert.equal(result.status, "complete");
    assert.equal(result.nativeMoveReturn, 1);
    assert.deepEqual(instance.clock, {
      frame: 2,
      fraction: 0.75,
      lastTimeMs: 1234,
      periodMs: expected,
    });
    assert.deepEqual(callbackState, { flags: 1, queuedMoveIndex: 2 });
    assert.equal(instance.move, move);
    assert.deepEqual(instance.rootPose, root);
    assert.deepEqual(instance.characterOrientation, O);
  }
});

test("ordinary signed-negative period advances current frame backwards while adding source root delta", () => {
  const h = host(),
    c = h.character,
    instance = c.instance;
  instance.move.asset.form.periodMs = 125;
  const selected = setNativePedRecoveryMove({
    instance,
    id: -1,
    rootPose: instance.rootPose,
    timeMs: 100,
    speed: -400,
    completion: false,
    retainRoot: false,
  });
  assert.equal(selected.nativeMoveReturn, 1);
  assert.equal(instance.clock.periodMs, -15536);
  instance.clock.frame = 1;
  instance.clock.fraction = 0;
  instance.clock.lastTimeMs = 100;
  const clock = advancePedAnimationClock(instance.clock, 140);
  assert.equal(clock.advance, -1);
  assert.equal(clock.fraction, f(1 - 40 / 15536));
  const beforeX = instance.rootPose[9],
    bodyV = c.body.state.velocity.toArray();
  const posed = advanceNativePedPose(instance, 140);
  assert.equal(posed.status, "complete");
  assert.equal(posed.processedFrames, 1);
  assert.equal(instance.clock.frame, 0);
  assert.equal(instance.rootPose[9], f(beforeX + f(0.2)));
  assert.equal(instance.nativeCharacterVelocity[0], f(f(0.2) / 15.536));
  assert.deepEqual(
    c.body.state.velocity.toArray(),
    bodyV,
    "BON core does not perform the later passive Object V copy",
  );
});

test("triggered replay Stillify retains its explicit mutation/recording owner instead of changing period", () => {
  const h = host();
  h.character.hitPoints = 0;
  h.state.action = 6;
  h.globals.replay = true;
  const result = h.gameplay.hooks.beforeSaveRoot(h.context(400));
  assert.equal(result.status, "provider-required");
  assert.deepEqual(result.requiredProviders, [
    "source-replay-Stillify-move-owner",
  ]);
  assert.equal(h.calls.length, 0);
  assert.equal(h.character.instance.clock.periodMs, 100);
});

for (const dataset of ["data", "adv_data"])
  test(`original ${dataset} Blokebl/DOG passive current-move freeze uses actual personality period without touching ACT identity`, async (t) => {
    let store;
    try {
      store = await createAssetStore(process.env.CARMA2_ROOT ?? "carma2_orig");
    } catch (error) {
      if (
        error?.code === "ENOENT" ||
        /Original installation/.test(String(error))
      )
        return t.skip("Original installation unavailable");
      throw error;
    }
    try {
      const client = new Assets();
      client.manifest = store.manifest;
      client.lookup = new Map(
        store.manifest.map((x) => [x.path.toLowerCase(), x.path]),
      );
      client.bytes = async (p) => new Uint8Array(await store.read(p));
      for (const name of ["Blokebl", "twolf"]) {
        const resource = await loadNativePedAssets(
          client,
          `PEDS/PEEPS/${name}`,
          name,
          dataset,
        );
        const h = host(resource),
          c = h.character,
          instance = c.instance;
        const actors = instance.bones.map((b) => b.actor),
          body = c.body;
        c.hitPoints = 0;
        h.state.action = 6;
        c.impactCount = 0;
        const originalPeriod = instance.move.asset.form.periodMs;
        instance.clock.periodMs = 0;
        h.globals.mutantSpeed = 1.25;
        const result = h.gameplay.hooks.beforeSaveRoot(h.context(0xffffffff));
        assert.equal(result.status, "complete");
        assert.equal(
          instance.clock.periodMs,
          Math.trunc(originalPeriod * f(1.25)),
        );
        actors.forEach((actor, i) =>
          assert.equal(instance.bones[i].actor, actor),
        );
        assert.equal(c.body, body);
        assert.equal(h.simulation.phil.getState(body), 1);
      }
    } catch (error) {
      if (/ENOENT|not found|not configured/i.test(String(error)))
        return t.skip(String(error));
      throw error;
    }
  });
