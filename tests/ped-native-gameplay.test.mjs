import test from "node:test";
import assert from "node:assert/strict";
import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";
import { NativePedGameplay } from "../src/ped-native-gameplay.ts";
import { NativePedRuntime } from "../src/ped-native-runtime.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { activePedContact } from "../src/physics/ped-contact.ts";
import { advanceNativePedPose } from "../src/ped-native-instance.ts";
import { nativePedRootPose } from "../src/physics/ped-body.ts";
import { createNativePedPoolSettings } from "../src/ped-body-pool.ts";
import { nativePedBoxInertia } from "../src/ped-form.ts";
import { Assets } from "../src/content.ts";
import { readFile } from "node:fs/promises";
import {
  readNativePedMoveFSM,
  createNativePedMovePlanner,
} from "../src/ped-move-fsm.ts";
import { createAssetStore } from "../server/assets.mjs";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";
import {
  prepareNativePedDeadModels,
  NativePedDeadMaterialRegistry,
} from "../src/ped-dead-models.ts";
const f = Math.fround,
  identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const frame = (timeMs = 100) => ({
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
  const names = ["ROOT", "HEAD", "HAND"],
    masses = [60, 4, 4],
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
  for (const id of [30, 41, 80, 81, 90, 91, 92, 93, 94, 96, 97]) {
    const move = {
      id,
      periodMs: 100,
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
const globals = (overrides = {}) => ({
  immortal: false,
  exploding: false,
  brittle: false,
  goreLevel: 0,
  dismemberSpurtCount: 100,
  mutantSpeed: 0,
  blind: false,
  valiumTimeMs: 0,
  replay: false,
  ...overrides,
});
function create(assets = fixture(), overrides = {}, g = globals(), modelSet1) {
  const events = [],
    simulation = new VehicleSimulation(
      { raycast: () => null, querySurfaces: () => [] },
      new Group(),
    );
  let draws = 0;
  const values = overrides.values ?? [];
  delete overrides.values;
  const options = {
    // Each scenario represents a fresh process; do not leak the persistent
    // native retry scalar into other test modules sharing this Node process.
    sharedHalt: { retryScalar: 8 },
    settings: {
      severDamage: 40,
      severChance: 10,
      maxSurvivableInitialImpact: f(8),
      damagePerForce: f(250),
    },
    readGlobals: () => g,
    nextCrtInteger: () => {
      assert.ok(draws < values.length, "unexpected CRT draw");
      return values[draws++];
    },
    attributeContact: (ctx, d, s) => {
      events.push([
        "attribute",
        ctx.character.impactCount,
        s.cache.retryCount,
        s.cache.directionInterpolationMs,
      ]);
      if (d.other) {
        s.cache.killer = d.other;
        s.cache.killerDriver = 8;
      }
    },
    onNoise: (e) => events.push(["noise", e.phase, e.index]),
    onKillGiblets: (ctx, d, p) => {
      events.push([
        "giblets",
        p.force,
        ctx.instance.modelSet,
        ctx.instance.bones[assets.form.headBone].poseIndex,
      ]);
    },
    onOneLessPed: (ctx, s) =>
      events.push(["count", ctx.character.flags, s.cache.killer]),
    onScoreDeath: (ctx, s) =>
      events.push([
        "score",
        ctx.character.hitPoints,
        s.action,
        s.deathTimeMs,
        s.cache.killer,
      ]),
    onContactEffects: (ctx, d, r) =>
      events.push(["effects", d.phase, ctx.character.moveId]),
    ...overrides,
  };
  // JS callback return values must be void or explicit diagnostic arrays, not Array.push's number.
  for (const k of [
    "onNoise",
    "onOneLessPed",
    "onScoreDeath",
    "onContactEffects",
  ])
    if (options[k] && !overrides[k]) {
      const cb = options[k];
      options[k] = (...args) => {
        cb(...args);
      };
    }
  const gameplay = new NativePedGameplay(options),
    runtime = new NativePedRuntime(simulation, {
      levelOut: 0,
      hooks: gameplay.hooks,
    });
  gameplay.bindRuntime(runtime);
  runtime.registerPersonality("fixture", assets, {
    modelSet1:
      modelSet1 ??
      assets.bones.map((b) => b.variants.map((v) => v.actor?.clone() ?? null)),
  });
  const owner = {},
    c = runtime.enroll({
      owner,
      personality: "fixture",
      rootPose: [...identity.slice(0, 9), 0, 1, 0],
      moveId: 30,
      direction: [0, 0, 1],
      groundNormal: [0, 1, 0],
      timeMs: 0,
      flags: 0x40,
    });
  const state = gameplay.enroll(owner, {
    action: 0,
    cache: {
      retryCount: 2,
      flags: 0,
      stumpCounters: new Uint8Array(assets.form.bones.length),
      directionInterpolationMs: 50,
      killer: null,
      napalmDeadlineMs: 0,
    },
  });
  runtime.prepareFrame(frame());
  return {
    gameplay,
    runtime,
    simulation,
    c,
    state,
    events,
    g,
    draws: () => draws,
  };
}
function other(speed) {
  return {
    id: "other",
    properties: { mass: f(1), immovable: false },
    state: {
      position: new Vector3(),
      velocity: new Vector3(speed, 0, 0),
      orientation: new Quaternion(),
      angularVelocity: new Vector3(),
    },
  };
}
function activate(h, speed = 0.5) {
  const b = other(speed);
  h.simulation.preparePedContacts([
    {
      a: h.c.body,
      b,
      normal: new Vector3(1, 0, 0),
      point: new Vector3(),
      penetration: 0,
    },
  ]);
  return b;
}
function active(h, lambda = 0.01, b = undefined) {
  const body = h.c.body;
  if (body.headerState !== 2) h.runtime.activate(h.c.owner);
  const d = {
    phase: "active",
    other: b,
    totalLambda: lambda,
    firstLambda: lambda,
    force: new Vector3(lambda, 0, 0),
  };
  const ctx = body.contactProvider(body, d),
    r = activePedContact({
      ...ctx,
      other: b
        ? {
            type: 0,
            ownerPresent: false,
            mass: b.properties.mass,
            velocity: b.state.velocity,
          }
        : null,
      pedRigidType: 2,
      pedOwnerPresent: true,
      replay: false,
      totalLambda: lambda,
      firstRowLambda: lambda,
      pedVelocityY: body.state.velocity.y,
      worldForce: d.force,
      faceNormal: { x: 0, y: 1, z: 0 },
    });
  h.simulation.pedDamageResult(body, r, "active");
  return r;
}

test("actual PHIL passive activation commits WORD/cache/attribution before HP reaction and caller continuation", () => {
  const h = create();
  const actor = h.c.body.actor,
    V = h.c.body.state.velocity.clone(),
    omega = h.c.body.state.angularVelocity.clone();
  activate(h, 0.5);
  // q=.25, raw trunc(f32(.25/8*100))=3; f32(.068) normalization produces2.
  assert.equal(h.c.hitPoints, 98);
  assert.equal(h.c.impactCount, 1);
  assert.equal(h.c.moveId, 90);
  assert.equal(h.state.action, 5);
  assert.deepEqual(
    h.events.map((x) => x[0]),
    ["attribute", "noise", "noise", "effects"],
  );
  assert.deepEqual(h.events[0], ["attribute", 1, 0, 0]);
  assert.deepEqual(h.events[1], ["noise", "common", 4]);
  assert.deepEqual(h.events[2], ["noise", "passive-continuation", 0]);
  assert.equal(h.simulation.phil.getState(h.c.body), 2);
  assert.equal(h.c.body.filterA, 0x20000);
  assert.equal(h.c.body.actor, actor);
  assert.ok(h.c.body.state.velocity.equals(V));
  assert.ok(h.c.body.state.angularVelocity.equals(omega));
  assert.equal(h.draws(), 0);
});

test("passive Kill models/giblets/count/score precede caller94 override and preserve source attribution", () => {
  const h = create(fixture(), {}, globals({ goreLevel: 1 }));
  const b = activate(h, 4);
  assert.equal(h.c.hitPoints, 0);
  assert.equal(h.c.moveId, 94);
  assert.equal(h.state.action, 6);
  assert.equal(h.state.deathTimeMs, 100);
  assert.deepEqual(
    h.events.map((x) => x[0]),
    ["attribute", "noise", "giblets", "count", "score", "noise", "effects"],
  );
  assert.deepEqual(h.events[2], ["giblets", f(0.4), 1, 2]);
  assert.equal(h.events[3][1] & 0x100, 0x100);
  assert.equal(h.events[4][4], b);
  assert.equal(h.c.body.state.velocity.length(), 0);
  assert.equal(h.draws(), 0);
  const prior = h.events.filter(
    (x) => x[0] === "count" || x[0] === "score",
  ).length;
  active(h, 0.5, b);
  assert.equal(
    h.events.filter((x) => x[0] === "count" || x[0] === "score").length,
    prior,
  );
  assert.ok(h.events.some((x) => x[0] === "noise" && x[2] === 5));
});

test("real sever reservation/PHIL/type5 head precedes HP and changes the same detached actor to dead pose2", () => {
  const h = create(
    fixture(),
    { values: [0, 0, 0, 0, 0] },
    globals({ goreLevel: 2 }),
  );
  const actor = h.c.instance.bones[1].actor;
  active(h, 0.164, other(0)); // raw41 -> normalized40; one head attempt succeeds.
  assert.equal(h.c.removedBoneMask, 2);
  assert.equal(h.c.hitPoints, 0);
  assert.equal(h.draws(), 5);
  assert.equal(h.simulation.phil.count, 2);
  const part = h.simulation.pedBoneBodies[0];
  assert.equal(part.actor, actor);
  assert.equal(part.rigidType, 5);
  assert.equal(h.c.instance.bones[1].poseIndex, 2);
  assert.equal(h.c.instance.bones[1].actor, actor);
  assert.equal(h.state.cache.stumpCounters[1], 100);
  assert.deepEqual(
    h.events.map((x) => x[0]),
    ["attribute", "noise", "giblets", "count", "score", "effects"],
  );
  assert.ok(
    h.c.flags & 0x100,
    "active contact continuation must retain Kill's once-only flag",
  );
});

test("missing source effects preflight before HP, sever RNG, body admission or death feedback", () => {
  const h = create(
    fixture(),
    { onKillGiblets: undefined, values: [0, 0, 0, 0, 0] },
    globals({ goreLevel: 2 }),
  );
  const r = active(h, 0.164, other(0));
  assert.ok(r.unresolved.includes("source-Kill-DoGiblets-owner"));
  assert.equal(h.c.hitPoints, 100);
  assert.equal(h.c.removedBoneMask, 0);
  assert.equal(h.draws(), 0);
  assert.equal(h.simulation.phil.count, 1);
  assert.deepEqual(h.events, [["attribute", 0, 2, 50]]);
});

test("ineligible flag40 passive still activates PHIL but does not prelude/damage/noise", () => {
  const h = create();
  h.runtime.updateState(h.c.owner, { flags: 0 });
  activate(h, 4);
  assert.equal(h.simulation.phil.getState(h.c.body), 2);
  assert.equal(h.c.hitPoints, 100);
  assert.equal(h.c.impactCount, 0);
  assert.deepEqual(h.events, []);
});

test("active attribution precedes the zero-damage gate without passive cache/WORD resets; world nonzero has no sever RNG", () => {
  const h = create(fixture(), {}, globals({ goreLevel: 2 }));
  const zero = active(h, 0.0006);
  assert.equal(zero.applied, false);
  assert.deepEqual(h.events, [["attribute", 0, 2, 50]]);
  assert.equal(h.c.impactCount, 0);
  assert.equal(h.state.cache.retryCount, 2);
  assert.equal(h.state.cache.directionInterpolationMs, 50);
  assert.equal(h.draws(), 0);
  const nonzero = active(h, 0.01);
  assert.equal(nonzero.rawDamage, 3);
  assert.equal(h.c.hitPoints, 98);
  assert.equal(h.c.removedBoneMask, 0);
  assert.equal(h.draws(), 0);
});

test("moved period uses raw body V and shared CRT once; no duplicated settling or launch", () => {
  const h = create(fixture(), { values: [32767] });
  h.runtime.activate(h.c.owner);
  h.runtime.setMove(h.c.owner, 93, [0, 0, 1], [0, 1, 0], 100);
  h.c.body.state.velocity.set(1, 0, 0);
  const omega = h.c.body.state.angularVelocity.clone();
  h.c.body.onMoved(h.c.body, 40);
  const expected = Math.trunc(
    (f(0.6) + ((f(1.4) - f(0.6)) * 32767) / 32768) * 25,
  );
  assert.equal(h.c.instance.clock.periodMs, expected);
  assert.equal(h.draws(), 1);
  assert.ok(h.c.body.state.angularVelocity.equals(omega));
  assert.equal(h.c.body.state.velocity.x, 1);
});

test("halt absent source providers refuses acceptance rather than synthesizing recovery", () => {
  const h = create();
  h.runtime.activate(h.c.owner);
  h.c.body.doNothing = true;
  h.simulation.finishPedFrame(40);
  assert.equal(h.simulation.phil.getState(h.c.body), 2);
  assert.ok(h.c.diagnostics.has("source-halt-input-owner"));
  assert.equal(h.state.action, 0);
});

test("upright halt consumes actual recovery effects then returns PHIL passive and starts native running41", () => {
  const effects = [];
  const h = create(fixture(), {
    onRecoveryEffect: (ctx, e) => {
      effects.push(e.kind);
      if (e.kind === "direction") ctx.character.direction = e.vector;
    },
    readHaltInput: (ctx) => ({
      actorRootPose: identity,
      characterOrientation: identity,
      worldFaceNormals: [[0, 1, 0]],
      mass: ctx.body.properties.mass,
      inertia: ctx.body.properties.inertia.toArray(),
      bounds: ctx.body.profile.bounds,
      lyingAxes: [-1, 1],
      head: { boneIndex: 1, modelState: 0 },
      collisionFlag: false,
      nowMs: 100,
      immortal: false,
      volumeGravity: null,
      goreLevel: 0,
      mutantSpeed: 0,
    }),
  });
  h.runtime.activate(h.c.owner);
  h.c.body.doNothing = true;
  h.simulation.finishPedFrame(40);
  assert.equal(h.simulation.phil.getState(h.c.body), 1);
  assert.equal(h.c.moveId, 41);
  assert.equal(h.c.instance.clock.periodMs, 100);
  assert.equal(h.state.action, 1);
  assert.equal(h.state.runningTimeMs, 100);
  assert.deepEqual(effects, [
    "status-physical-level",
    "recache-ground",
    "direction",
    "rescan-proximity",
    "scan-objects",
  ]);
});

for (const tree of ["data", "adv_data"])
  test(`original ${tree} Blokebl/Bandsman common death uses source models and retained real PHIL`, async (t) => {
    let store;
    try {
      store = await createAssetStore(process.env.CARMA2_ROOT ?? "carma2_orig");
    } catch (e) {
      if (e?.code === "ENOENT" || /Original installation/.test(String(e))) {
        t.skip("Original installation unavailable");
        return;
      }
      throw e;
    }
    const assets = new Assets();
    assets.manifest = store.manifest;
    assets.lookup = new Map(
      store.manifest.map((x) => [x.path.toLowerCase(), x.path]),
    );
    assets.bytes = async (p) => new Uint8Array(await store.read(p));
    const registry = new NativePedDeadMaterialRegistry();
    const loaded = [];
    for (const name of ["Blokebl", "Bandsman"]) {
      const native = await loadNativePedAssets(
        assets,
        `PEDS/PEEPS/${name}`,
        name,
        tree,
      );
      const dead = prepareNativePedDeadModels(name, native, {
        materialRegistry: registry,
        nullFaceMaterial: () => native.inheritedActorMaterial,
      });
      loaded.push({ native, dead });
    }
    const h = create(
      loaded[0].native,
      { readGroundHeight: () => 1, writeGroundedRoot: () => {} },
      globals({ goreLevel: 1 }),
      loaded[0].dead.modelSet1,
    );
    h.runtime.registerPersonality("second", loaded[1].native, {
      deadModels: loaded[1].dead,
    });
    const owner = {},
      c = h.runtime.enroll({
        owner,
        personality: "second",
        rootPose: [...identity.slice(0, 9), 1, 1, 0],
        moveId: 30,
        direction: [0, 0, 1],
        groundNormal: [0, 1, 0],
        timeMs: 0,
        flags: 0x40,
      });
    const state = h.gameplay.enroll(owner, {
      action: 0,
      cache: {
        retryCount: 1,
        flags: 0,
        stumpCounters: new Uint8Array(loaded[1].native.form.bones.length),
        directionInterpolationMs: 1,
        killer: null,
        napalmDeadlineMs: 0,
      },
    });
    h.runtime.prepareFrame(frame(100));
    assert.equal(h.simulation.phil.count, 2);
    assert.equal(h.c.formKey, c.formKey);
    assert.notEqual(h.c.body, c.body);
    assert.notEqual(h.state.cache, state.cache);
    for (const [index, target] of [
      [0, h],
      [1, { ...h, c, state }],
    ]) {
      const actor = target.c.body.actor;
      active(target, 0.5);
      assert.equal(target.c.hitPoints, 0);
      assert.equal(target.c.body.actor, actor);
      assert.equal(h.simulation.phil.getState(target.c.body), 2);
      const head = loaded[index].native.form.headBone;
      assert.equal(
        target.c.instance.bones[head].model.name,
        loaded[index].dead.modelSet1[head][2].name,
      );
      assert.equal(target.c.instance.modelSet, 1);
      assert.equal(target.state.deathTimeMs, 100);
      assert.equal(target.c.diagnostics.size, 0);
    }
    assert.equal(h.events.filter((e) => e[0] === "count").length, 2);
  });

test("actual one-shot BON completion90→97→93 retains physical root/V and releases source selected cache once per callback", () => {
  const effects = [],
    h = create(fixture(), {
      onRecoveryEffect: (_ctx, e) => {
        effects.push(e.kind);
      },
    });
  activate(h, 0.5);
  const body = h.c.body,
    pose = nativePedRootPose(body),
    V = body.state.velocity.clone(),
    omega = body.state.angularVelocity.clone();
  const advance = (time) =>
    advanceNativePedPose(h.c.instance, time, {
      activeRootPose: pose,
      activeWorldVelocity: body.state.velocity.toArray(),
      mode: 3,
    });
  advance(100);
  advance(400);
  assert.equal(h.c.moveId, 97);
  assert.equal(h.c.instance.completionRequested, true);
  assert.equal(h.state.action, 5);
  advance(500);
  advance(800);
  assert.equal(h.c.moveId, 93);
  assert.equal(h.c.instance.completionRequested, false);
  assert.equal(h.state.cache.headSequence.address, 0x65d050);
  assert.equal(
    effects.filter((e) => e === "release-selected-face-cache").length,
    2,
  );
  assert.equal(effects.filter((e) => e === "head-sequence").length, 1);
  assert.deepEqual(Array.from(nativePedRootPose(body)), Array.from(pose));
  assert.ok(body.state.velocity.equals(V));
  assert.ok(body.state.angularVelocity.equals(omega));
  advance(900);
  advance(1200);
  assert.equal(
    effects.filter((e) => e === "release-selected-face-cache").length,
    2,
  );
});

test("completion applies installed FSM fallback, action/cache writes and speed factor through the real active move owner", async (t) => {
  let table;
  try {
    table = readNativePedMoveFSM(
      await readFile(
        `${process.env.CARMA2_ROOT || "carma2_orig"}/carma2_HW.exe`,
      ),
    );
  } catch (error) {
    if (error.code === "ENOENT") return t.skip("Original HW executable absent");
    throw error;
  }
  const assets = fixture();
  // Synthetic authored availability exercises the original97→72 fallback.
  // No original BON/table fixture is copied into the repository.
  const fallback = assets.moves.get(93);
  assets.moves.delete(97);
  const form = { ...fallback.form, id: 72 };
  assets.form.moves.push(form);
  assets.moves.set(72, { ...fallback, id: 72, form });
  let speedFactor = 0;
  const planner = createNativePedMovePlanner(table, () => ({
    drunk: false,
    dancing: false,
    panicking: false,
    pedestrianSpeedFactor: speedFactor,
  }));
  const plans = [];
  const h = create(assets, {
    planMove: (...args) => {
      const result = planner(...args);
      plans.push(result);
      return result;
    },
    onRecoveryEffect: () => {},
  });
  activate(h, 0.5);
  assert.equal(h.c.moveId, 90);
  speedFactor = 2;
  h.state.cache.runSpeed = 123;
  const pose = nativePedRootPose(h.c.body);
  const velocity = h.c.body.state.velocity.clone();
  const omega = h.c.body.state.angularVelocity.clone();
  for (const timeMs of [100, 400])
    advanceNativePedPose(h.c.instance, timeMs, {
      activeRootPose: pose,
      activeWorldVelocity: velocity.toArray(),
      mode: 3,
    });
  const result = plans.at(-1);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.attempts, [97, 72]);
  assert.equal(result.speed, -0.5);
  assert.equal(h.c.moveId, 72);
  assert.equal(h.state.action, 5);
  assert.equal(h.state.cache.runSpeed, 0);
  assert.equal(h.c.instance.clock.periodMs, 50);
  assert.equal(h.c.instance.completionRequested, true);
  assert.equal(h.c.diagnostics.size, 0);
  assert.equal(h.simulation.phil.getState(h.c.body), 2);
  assert.deepEqual(Array.from(nativePedRootPose(h.c.body)), Array.from(pose));
  assert.ok(h.c.body.state.velocity.equals(velocity));
  assert.ok(h.c.body.state.angularVelocity.equals(omega));
});

test("Kill low-gravity branch skips dead MODEL/giblets but still commits native count/death/score", () => {
  const h = create(
    fixture(),
    { readVolumeGravity: () => f(0.5) },
    globals({ goreLevel: 2 }),
  );
  active(h, 0.5);
  assert.equal(h.c.hitPoints, 0);
  assert.equal(h.c.instance.modelSet, 0);
  assert.equal(h.events.filter((e) => e[0] === "giblets").length, 0);
  assert.deepEqual(
    h.events.map((e) => e[0]),
    ["attribute", "noise", "count", "score", "effects"],
  );
  assert.equal(h.draws(), 0);
});

test("low-gravity moved period applies1.5 after integer clamp and delegates extra source tail without added draws", () => {
  let called = 0;
  const h = create(fixture(), {
    values: [0],
    readVolumeGravity: () => f(0.5),
    onMovedVolume: () => {
      called++;
    },
  });
  h.runtime.activate(h.c.owner);
  h.runtime.setMove(h.c.owner, 94, [0, 0, 1], [0, 1, 0], 100);
  h.c.body.state.velocity.set(1, 0, 0);
  h.c.body.onMoved(h.c.body, 40);
  assert.equal(h.c.instance.clock.periodMs, 30);
  assert.equal(h.draws(), 1);
  assert.equal(called, 1);
});

test("inactive retained-root halt retry uses the installed recovery provider without toggling physical ownership", () => {
  const h = create(fixture(), {
    values: [0],
    onRecoveryEffect: () => {},
    readHaltInput: (ctx) => ({
      actorRootPose: identity,
      characterOrientation: identity,
      worldFaceNormals: [[0, 1, 0]],
      mass: ctx.body.properties.mass,
      inertia: [1, 2, 3],
      bounds: ctx.body.profile.bounds,
      lyingAxes: [-1, 1],
      head: { boneIndex: 1, modelState: 0 },
      collisionFlag: false,
      nowMs: 100,
      immortal: false,
      volumeGravity: null,
      goreLevel: 0,
      mutantSpeed: 0,
    }),
  });
  activate(h, 0.5);
  h.c.body.doNothing = true;
  // Mark O lying without altering the source ACT to force the principal-Z alignment retry.
  h.c.instance.characterOrientation[4] = 0;
  h.gameplay.options.readHaltInput = (ctx) => ({
    actorRootPose: identity,
    characterOrientation: [1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0],
    worldFaceNormals: [[0, 1, 0]],
    mass: ctx.body.properties.mass,
    inertia: [1, 2, 3],
    bounds: ctx.body.profile.bounds,
    lyingAxes: [-1, 1],
    head: { boneIndex: 1, modelState: 0 },
    collisionFlag: false,
    nowMs: 100,
    immortal: false,
    volumeGravity: null,
    goreLevel: 0,
    mutantSpeed: 0,
  });
  h.simulation.finishPedFrame(40);
  assert.equal(h.draws(), 1, "source retry performs its one percentage draw");
  assert.equal(h.simulation.phil.getState(h.c.body), 2);
  assert.equal(h.c.moveId, 93);
  assert.equal(
    h.c.instance.physicsActive,
    true,
    "halt return0 retains active header",
  );
  assert.equal(h.state.action, 3);
  assert.equal(h.state.cache.retryCount, 1);
  assert.equal(h.c.instance.clock.frame, 0);
  assert.equal(h.c.instance.clock.fraction, 0);
  assert.equal(h.c.instance.clock.lastTimeMs, 0);
  assert.ok(!h.c.diagnostics.has("native-inactive-retained-root-move-owner"));
});

test("passive continuation retains strict66/200 momentum thresholds across HP/Kill callbacks", () => {
  for (const [velocity, immortal, index] of [
    [[1, 1, 8], true, 0],
    [[1, 1, 8.001], true, 1],
    [[10, 10, 0], false, 1],
    [[10, 10, 0.01], false, 2],
  ]) {
    const h = create(fixture(), {}, globals({ immortal })),
      b = other(0);
    b.state.velocity.fromArray(velocity);
    h.simulation.preparePedContacts([
      {
        a: h.c.body,
        b,
        normal: new Vector3(1, 0, 0),
        point: new Vector3(),
        penetration: 0,
      },
    ]);
    assert.equal(
      h.events.find(
        (e) => e[0] === "noise" && e[1] === "passive-continuation",
      )[2],
      index,
    );
  }
});

test("accepted dead halt freezes current animation without selecting a new move and preserves once-only slick flag", () => {
  const effects = [],
    h = create(
      fixture(),
      {
        values: [0],
        onRecoveryEffect: (_ctx, e) => {
          effects.push(e.kind);
        },
        readHaltInput: (ctx) => ({
          actorRootPose: identity,
          characterOrientation: identity,
          worldFaceNormals: [[0, 1, 0]],
          mass: ctx.body.properties.mass,
          inertia: [1, 2, 3],
          bounds: ctx.body.profile.bounds,
          lyingAxes: [-1, 1],
          head: { boneIndex: 1, modelState: 2 },
          collisionFlag: false,
          nowMs: 100,
          immortal: false,
          volumeGravity: null,
          goreLevel: 1,
          mutantSpeed: 0,
        }),
      },
      globals({ goreLevel: 1 }),
    );
  active(h, 0.5);
  h.c.body.doNothing = true;
  h.simulation.finishPedFrame(40);
  assert.equal(h.simulation.phil.getState(h.c.body), 1);
  assert.equal(h.c.moveId, 94);
  assert.equal(h.c.instance.clock.periodMs, 0);
  assert.equal(h.state.action, 6);
  assert.equal(h.c.flags & 0x110, 0x110);
  assert.equal(h.draws(), 1);
  assert.equal(effects.filter((e) => e === "corpse-slick").length, 1);
});

test("source object scan action selected after StartPedRunning survives halt snapshot commit", () => {
  const h = create(fixture(), {
    onRecoveryEffect: (ctx, e, state) => {
      if (e.kind === "scan-objects") {
        state.action = 2;
        const result = h.runtime.setMove(
          ctx.owner,
          90,
          ctx.character.direction,
          ctx.character.groundNormal,
          ctx.timeMs,
        );
        assert.equal(result.status, "complete");
      }
    },
    readHaltInput: (ctx) => ({
      actorRootPose: identity,
      characterOrientation: identity,
      worldFaceNormals: [[0, 1, 0]],
      mass: ctx.body.properties.mass,
      inertia: [1, 2, 3],
      bounds: ctx.body.profile.bounds,
      lyingAxes: [-1, 1],
      head: { boneIndex: 1, modelState: 0 },
      collisionFlag: false,
      nowMs: 100,
      immortal: false,
      volumeGravity: null,
      goreLevel: 0,
      mutantSpeed: 0,
    }),
  });
  h.runtime.activate(h.c.owner);
  h.c.body.doNothing = true;
  h.simulation.finishPedFrame(40);
  assert.equal(h.simulation.phil.getState(h.c.body), 1);
  assert.equal(h.state.action, 2);
  assert.equal(h.c.moveId, 90);
});
