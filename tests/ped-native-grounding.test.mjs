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
import { NativePedGrounding } from "../src/ped-native-grounding.ts";
import { NativePedRuntime } from "../src/ped-native-runtime.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { createNativeActivePedMoveCallback } from "../src/physics/ped-active-move.ts";
import { nativePedBoxInertia } from "../src/ped-form.ts";
import { createNativePedPoolSettings } from "../src/ped-body-pool.ts";
import { Assets } from "../src/content.ts";
import { createAssetStore } from "../server/assets.mjs";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";
import { NativePedProcessCachePool } from "../src/ped-process-cache.ts";
const f = Math.fround,
  identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
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
const settings = createNativePedPoolSettings(100, 0);
const floor = (id = "floor") => ({
  id,
  a: [-2, 0, -2],
  b: [2, 0, -2],
  c: [0, 0, 2],
  normal: [0, 1, 0],
  rawFlags: 0,
  sourceIdentity: { id },
});
const frame = (timeMs = 0) => ({ cameraOrigin: [0, 0, -10], timeMs, settings });
function host({
  faces = [floor()],
  overrides = {},
  assets = assetsFixture(),
  useHook = false,
} = {}) {
  const log = [],
    inputs = new WeakMap();
  let bridge,
    enabled = false;
  const simulation = new VehicleSimulation(
    { raycast: () => null, querySurfaces: () => [] },
    new Group(),
  );
  const runtime = new NativePedRuntime(simulation, {
    levelOut: 0,
    hooks: {
      beforePose: (ctx) =>
        enabled && useHook ? bridge.beforePose(ctx) : undefined,
      activeSetMove: createNativeActivePedMoveCallback(),
    },
  });
  runtime.registerPersonality("safe", assets);
  const options = {
    readInput: (ctx) => ({
      action: 0,
      processFloorNormal: [0, 1, 0],
      cosMaxSlope: 0.8,
      direction: ctx.instance.direction,
      smoothTurnTarget: null,
      replay: false,
      replayOverride: false,
      excludePlingMaterials: false,
      pedPosition: ctx.character.position,
      ...inputs.get(ctx.owner),
    }),
    collectFaces: (ctx, request) => {
      log.push(["collect", ctx.owner, request]);
      return faces;
    },
    queryFace: (ctx, face, query) => {
      log.push(["query", face, query]);
      return { parameter: 0.2, point: [query.origin[0], 0, query.origin[2]] };
    },
    stopSmoothTurn: (ctx) => {
      log.push(["stop", ctx.owner]);
      inputs.set(ctx.owner, {
        ...inputs.get(ctx.owner),
        smoothTurnTarget: null,
      });
    },
    setPedXZDirection: (ctx, direction) => {
      log.push(["direction", direction]);
      return runtime.setMove(
        ctx.owner,
        ctx.character.moveId,
        direction,
        ctx.instance.groundNormal,
        ctx.timeMs,
        { periodMs: ctx.instance.clock.periodMs },
      );
    },
    selectMove: (ctx, effect) => {
      log.push(["move", effect, ctx.body.state.velocity.clone()]);
      const result = runtime.setMove(
        ctx.owner,
        effect.move,
        ctx.instance.direction,
        ctx.instance.groundNormal,
        effect.timeMs,
        {
          periodMs: ctx.instance.template.moves.get(effect.move).form.periodMs,
          restart: !!effect.restart,
          completionRequested: !!effect.completion,
        },
      );
      if (result.status === "complete")
        inputs.set(ctx.owner, {
          ...inputs.get(ctx.owner),
          action: effect.action,
        });
      return result;
    },
    setAction: (ctx, action) => {
      log.push(["action", action]);
      inputs.set(ctx.owner, { ...inputs.get(ctx.owner), action });
    },
    vanish: (ctx, effect) => {
      log.push(["vanish", effect]);
      runtime.updateState(ctx.owner, { flags: effect.flags });
      runtime.updateState(ctx.owner, { flags: effect.flags & ~1 });
      runtime.prepareFrame(frame(ctx.timeMs));
    },
    proximityRescan: () => {
      log.push(["proximity"]);
      return { processFloorNormal: [0, 1, 0] };
    },
    ...overrides,
  };
  bridge = new NativePedGrounding(runtime, options);
  const enroll = (owner = {}, root = [0, 0.4, 0]) =>
    runtime.enroll({
      owner,
      personality: "safe",
      rootPose: [...identity.slice(0, 9), ...root],
      moveId: 30,
      direction: [1, 0, 0],
      groundNormal: [0, 1, 0],
      timeMs: 0,
      flags: 0x41,
    });
  const context = (owner, timeMs = 0) => {
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
    runtime,
    simulation,
    bridge,
    log,
    inputs,
    enroll,
    context,
    enable: () => (enabled = true),
  };
}

/** Actual bounded source process records, separate from the real runtime/PHIL
 * fixture's FORM resources. Extra selection-test owners need no fake bodies. */
function canonicalHost({ overrides = {}, ...options } = {}) {
  const links = new WeakMap(),
    releases = [];
  const h = host({
    ...options,
    overrides: {
      ...overrides,
      readProcessCache: (owner) => links.get(owner) ?? null,
    },
  });
  const processPool = new NativePedProcessCachePool({
    readCache: (owner) => links.get(owner) ?? null,
    writeCache: (owner, cache) => links.set(owner, cache),
    releaseFaceCache: (slot, cache, oldOwner) => {
      releases.push({ slot, cache, oldOwner, oldLink: links.get(oldOwner) });
      h.bridge.releaseBorrowedFaceSlot(slot);
    },
  });
  const acquire = (owner, timeMs = 0, replay = false) =>
    processPool.visit(owner, {
      timeMs,
      replay,
      minTurnIntervalMs: 0,
      maxTurnIntervalMs: 0,
      spurtingPeriodMs: 100,
    });
  return { ...h, processPool, links, releases, acquire };
}

test("raw support hit adds current clearance once, uses actual FORM slot0, and does not advance BON", () => {
  const h = host(),
    owner = {},
    c = h.enroll(owner);
  h.runtime.prepareFrame(frame());
  const ctx = h.context(owner),
    clock = { ...ctx.instance.clock };
  h.inputs.set(owner, { callbackState: { flags: 3, queuedMoveIndex: -1 } });
  const visit = h.bridge.advance(ctx);
  assert.equal(visit.completion.status, "complete");
  assert.equal(visit.ground.status, "supported");
  assert.equal(ctx.instance.rootPose[10], f(0.25));
  assert.equal(visit.ground.effects[0].position[1], f(0.25));
  assert.deepEqual(ctx.instance.clock, clock);
  assert.equal(visit.completion.processedFrames, 0);
  assert.equal(h.inputs.get(owner).callbackState.flags, 2);
  assert.equal(visit.ground.hit.face, h.bridge.pool.get(owner).faces[0]);
  assert.equal(
    h.bridge.state(owner).cache.selectedFace,
    h.bridge.pool.get(owner).faces[0],
  );
  assert.equal(c.flags & 6, 0);
  assert.deepEqual(
    h.log
      .filter((x) => ["direction", "proximity"].includes(x[0]))
      .map((x) => x[0]),
    ["direction", "proximity"],
  );
});

test("slot0 is FORM first move30, not absent moveID0, and unmatched initialization offset is zero", () => {
  const a = assetsFixture();
  a.profile.movement.set(30, {
    scale: 1,
    groundingMode: -1,
    groundingOffset: 0.6,
  });
  const h = host({ assets: a }),
    owner = {};
  h.enroll(owner, [0, 0.9, 0]);
  h.runtime.prepareFrame(frame());
  const v = h.bridge.advance(h.context(owner));
  assert.equal(v.ground.status, "supported"); // .9-.6 <=3/6.9; .9-0 would fall.
  const q = host({ assets: assetsFixture() }),
    o = {};
  q.enroll(o, [0, 0.6, 0]);
  q.runtime.prepareFrame(frame());
  q.runtime.character(o).instance.template.profile.movement.delete(30);
  assert.equal(q.bridge.advance(q.context(o)).ground.status, "fall");
});

test("collector receives current root translation and actual movement basis without heading reconstruction", () => {
  const h = host(),
    owner = {};
  h.enroll(owner);
  h.runtime.prepareFrame(frame());
  const ctx = h.context(owner),
    basis = [0, 0, 2, 0, 1, 0, -3, 0, 0];
  ctx.instance.movement.set(basis);
  ctx.instance.rootPose.set([10, 20, 30], 9);
  h.inputs.set(owner, { action: 0 });
  h.bridge.advance(ctx);
  const request = h.log.find((x) => x[0] === "collect")[2];
  assert.deepEqual([...request.characterPose], [...basis, 10, 20, 30]);
  assert.equal(request.limit, 76);
  assert.equal(request.localBounds.min[1], f(-2.5 / 6.9));
});

test("runtime beforePose grounds current root and the outer host advances one BON frame only", () => {
  const h = host({ useHook: true }),
    owner = {};
  h.enroll(owner);
  h.runtime.prepareFrame(frame(1));
  h.enable();
  const visit = h.runtime.prepareFrame(frame(101))[0],
    ctx = h.context(owner, 101);
  assert.equal(visit.pose.status, "complete");
  assert.equal(visit.pose.processedFrames, 1);
  assert.equal(ctx.instance.clock.frame, 1);
  assert.equal(ctx.instance.clock.lastTimeMs, 101);
  assert.equal(h.bridge.state(owner).lastResult.status, "supported");
  assert.equal(ctx.instance.rootPose[10], f(0.25));
});

test("unsupported native falling activates real shared PHIL before active move72, preserving raw velocity/omega", () => {
  const h = host({ faces: [] }),
    owner = {};
  h.enroll(owner);
  h.runtime.prepareFrame(frame());
  const ctx = h.context(owner);
  ctx.instance.nativeCharacterVelocity.splice(0, 3, 0.25, -0.1, 0.75);
  ctx.body.state.angularVelocity.set(0.1, 0.2, 0.3);
  const omega = ctx.body.state.angularVelocity.clone(),
    v = h.bridge.advance(ctx);
  assert.equal(v.completion.status, "complete");
  assert.equal(v.ground.status, "fall");
  assert.equal(h.simulation.phil.getState(ctx.body), 2);
  assert.equal(ctx.character.physicsFlags & 4, 4);
  assert.deepEqual(ctx.body.state.velocity.toArray(), [
    f(0.25),
    f(-0.1),
    f(0.75),
  ]);
  assert.deepEqual(ctx.body.state.angularVelocity, omega);
  assert.equal(ctx.instance.moveId, 72);
  assert.deepEqual(
    h.log
      .filter((x) => ["stop", "move", "action"].includes(x[0]))
      .map((x) => x[0]),
    ["stop", "move", "action"],
  );
  assert.deepEqual(
    h.log.find((x) => x[0] === "move")[2],
    ctx.body.state.velocity,
  );
  assert.equal(h.inputs.get(owner).action, 3);
  assert.equal(h.bridge.state(owner).cache.selectedFace, null);
});

test("missing named move/action callbacks preflight before a half-applied fall or flags clear", () => {
  const h = host({
      faces: [],
      overrides: { selectMove: undefined, setAction: undefined },
    }),
    owner = {};
  h.enroll(owner);
  h.runtime.prepareFrame(frame());
  const ctx = h.context(owner);
  h.runtime.updateState(owner, { flags: 0x47 });
  const old = ctx.body.state.velocity.clone();
  const result = h.bridge.advance(ctx);
  assert.equal(result.completion.status, "provider-required");
  assert.deepEqual(result.completion.requiredProviders, [
    "source-ground-selectMove",
    "source-ground-setAction",
  ]);
  assert.equal(h.simulation.phil.getState(ctx.body), 1);
  assert.equal(ctx.character.flags, 0x47);
  assert.deepEqual(ctx.body.state.velocity, old);
  assert.ok(!h.log.some((x) => x[0] === "stop"));
});

test("finite collector/query and direction/proximity effects stay explicit when absent", () => {
  for (const [name, expected] of [
    ["collectFaces", "source-ground-collectFaces"],
    ["queryFace", "source-ground-queryFace"],
    ["setPedXZDirection", "source-ground-setPedXZDirection"],
    ["proximityRescan", "source-ground-proximityRescan"],
  ]) {
    const h = host({ overrides: { [name]: undefined } }),
      owner = {};
    h.enroll(owner);
    h.runtime.prepareFrame(frame());
    const ctx = h.context(owner),
      y = ctx.instance.rootPose[10],
      v = h.bridge.advance(ctx);
    assert.equal(v.completion.status, "provider-required", name);
    assert.ok(v.completion.requiredProviders.includes(expected), name);
    assert.equal(ctx.instance.rootPose[10], y, name);
    const retry = h.bridge.advance(h.context(owner, 40));
    assert.equal(retry.completion.status, "provider-required", name);
    assert.ok(retry.completion.requiredProviders.includes(expected), name);
    assert.equal(ctx.instance.rootPose[10], y, name);
  }
});

test("active/action/replay bypasses issue no face queries or gameplay effects", () => {
  for (const condition of [
    { active: true },
    { action: 5 },
    { replay: true, replayOverride: false },
  ]) {
    const h = host(),
      owner = {};
    h.enroll(owner);
    h.runtime.prepareFrame(frame());
    h.inputs.set(owner, condition);
    if (condition.active) h.runtime.activate(owner);
    const v = h.bridge.advance(h.context(owner));
    assert.equal(v.ground.status, "bypassed");
    assert.equal(v.completion.status, "complete");
    assert.deepEqual(h.log, []);
  }
});

test("one85slot pool evicts the first five-face owner before reuse; copied support identity survives scratch reuse", () => {
  const scratch = floor(),
    h = host({ faces: [scratch] }),
    owners = Array.from({ length: 41 }, () => ({}));
  owners.forEach((o, i) => h.enroll(o, [i * 0.001, 0.4, 0]));
  h.runtime.prepareFrame(frame());
  assert.equal(h.bridge.pool.size, 85);
  const first = h.bridge.advance(h.context(owners[0])),
    saved = first.ground.hit.face;
  assert.notEqual(saved, scratch);
  assert.notEqual(saved.a, scratch.a);
  assert.equal(saved.sourceIdentity, scratch.sourceIdentity);
  scratch.a[0] = 999;
  assert.equal(saved.a[0], -2);
  scratch.a[0] = -2;
  for (const o of owners.slice(1)) h.bridge.advance(h.context(o));
  assert.equal(h.bridge.state(owners[0]).cache, null);
  assert.equal(h.bridge.pool.get(owners[0]), null);
  assert.equal(h.bridge.pool.get(owners[40]).index, 0);
  assert.equal(saved.a[0], -2);
  const state = h.bridge.state(owners[40]);
  assert.equal(state.cache.selectedFace, state.cache.faces[0]);
});

test("retained support leaves bucket order untouched; floor normal persists until actual proximity writer", () => {
  let writes = 0;
  const h = host({
      overrides: {
        proximityRescan: () => {
          writes++;
          return { processFloorNormal: [0, f(0.7), f(0.7)] };
        },
      },
    }),
    owner = {};
  h.enroll(owner, [0, 0.25, 0]);
  h.runtime.prepareFrame(frame());
  h.bridge.advance(h.context(owner));
  const order = h.bridge.pool.order(5),
    normal = h.bridge.state(owner).processFloorNormal;
  h.inputs.set(owner, { processFloorNormal: [1, 0, 0] });
  h.log.length = 0;
  const v = h.bridge.advance(h.context(owner, 40));
  assert.equal(v.ground.status, "retained");
  assert.deepEqual(h.log, []);
  assert.deepEqual(h.bridge.pool.order(5), order);
  assert.deepEqual(h.bridge.state(owner).processFloorNormal, normal);
  assert.equal(writes, 1);
  h.bridge.invalidate(owner);
  assert.equal(h.bridge.advance(h.context(owner, 80)).ground.rebuilt, true);
  assert.equal(writes, 2);
  h.bridge.release(owner);
  assert.equal(h.bridge.state(owner), null);
  assert.equal(h.bridge.pool.get(owner), null);
  h.bridge.reset();
  assert.equal(h.bridge.pool.order(5)[0].index, 0);
});

test("original Stock/Advanced human and DOG resources ground through real runtime/PHIL with authored current clearance", async (t) => {
  let store;
  try {
    store = await createAssetStore("carma2_orig");
  } catch (error) {
    if (/ENOENT|Original installation/.test(String(error))) {
      t.skip("Original installation absent");
      return;
    }
    throw error;
  }
  const assets = new Assets();
  assets.manifest = store.manifest;
  assets.lookup = new Map(
    store.manifest.map((x) => [x.path.toLowerCase(), x.path]),
  );
  assets.bytes = async (p) => new Uint8Array(await store.read(p));
  for (const d of ["data", "adv_data"])
    for (const stem of ["Blokebl", "Bandsman", "twolf"]) {
      const native = await loadNativePedAssets(
          assets,
          `PEDS/PEEPS/${stem}`,
          stem,
          d,
        ),
        h = host({ assets: native }),
        owner = {};
      h.enroll(owner, [0, 0.2, 0]);
      h.runtime.prepareFrame(frame());
      const ctx = h.context(owner),
        v = h.bridge.advance(ctx);
      assert.equal(
        v.completion.status,
        "complete",
        `${d}/${stem}: ${v.completion.requiredProviders}`,
      );
      assert.equal(v.ground.status, "supported", `${d}/${stem}`);
      assert.equal(
        ctx.instance.rootPose[10],
        f(ctx.instance.move.asset.personality.groundingOffset),
      );
      assert.equal(h.simulation.phil.getState(ctx.body), 1);
      assert.equal(v.ground.cache.selectedFace, v.ground.cache.faces[0]);
    }
});

test("authored slot0 retries finite cast with offset while raw ground setter still uses hitpoint", () => {
  const origins = [],
    h = host({
      overrides: {
        queryFace: (_ctx, _face, q) => {
          origins.push(q.origin);
          return origins.length === 1
            ? null
            : { parameter: 0.45, point: [q.origin[0], 0, q.origin[2]] };
        },
      },
    }),
    owner = {};
  h.enroll(owner);
  h.runtime.prepareFrame(frame());
  const ctx = h.context(owner),
    rootY = ctx.instance.rootPose[10],
    v = h.bridge.advance(ctx);
  assert.equal(v.ground.hit.pass, 1);
  assert.equal(origins[1][1], f(rootY + f(0.25)));
  assert.equal(ctx.instance.rootPose[10], f(0.25));
  assert.equal(v.ground.hit.point[1], 0);
});

test("collector76 overflow retains only75 copied records and rawuint32 wrap does not expire or fabricate a TTL", () => {
  const faces = Array.from({ length: 76 }, (_, i) => floor(i)),
    h = host({ faces }),
    owner = {};
  h.enroll(owner, [0, 0.25, 0]);
  h.runtime.prepareFrame(frame());
  let v = h.bridge.advance(h.context(owner, 0xffffffff));
  assert.equal(v.ground.overflow, true);
  assert.equal(v.ground.cache.capacity, 75);
  assert.equal(v.ground.cache.faces.length, 75);
  assert.equal(h.bridge.pool.get(owner).timeMs, 0xffffffff);
  h.log.length = 0;
  v = h.bridge.advance(h.context(owner, 0));
  assert.equal(v.ground.status, "retained");
  assert.deepEqual(h.log, []);
  assert.equal(h.bridge.pool.get(owner).timeMs, 0xffffffff);
  h.bridge.invalidate(owner);
  v = h.bridge.advance(h.context(owner, 0));
  assert.equal(v.ground.rebuilt, true);
  assert.equal(h.bridge.pool.get(owner).timeMs, 0);
});

test("dead cache acquisition repeats move94 twice with actual completion/action and no allocation", () => {
  const h = host(),
    owner = {};
  h.enroll(owner);
  h.runtime.prepareFrame(frame());
  h.runtime.updateState(owner, { hitPoints: 0 });
  const v = h.bridge.advance(h.context(owner, 456));
  assert.equal(v.ground.status, "dead-cache-move");
  assert.equal(v.ground.attempts, 2);
  assert.equal(v.completion.status, "complete");
  assert.equal(h.bridge.pool.get(owner), null);
  assert.ok(!h.log.some((x) => x[0] === "collect"));
  const moves = h.log.filter((x) => x[0] === "move");
  assert.equal(moves.length, 2);
  for (const [, e] of moves)
    assert.deepEqual(e, {
      kind: "select-move",
      move: 94,
      period: -1,
      restart: 0,
      completion: 1,
      action: 6,
      timeMs: 456,
    });
  assert.equal(h.runtime.character(owner).instance.completionRequested, true);
  assert.equal(h.inputs.get(owner).action, 6);
});

test("unsupported floor without flag40 requires actual vanish owner and does not activate", () => {
  const h = host({ faces: [], overrides: { vanish: undefined } }),
    owner = {};
  h.enroll(owner);
  h.runtime.prepareFrame(frame());
  h.runtime.updateState(owner, { flags: 1 });
  const ctx = h.context(owner),
    v = h.bridge.advance(ctx);
  assert.equal(v.ground.status, "vanish");
  assert.deepEqual(v.completion.requiredProviders, ["source-ground-vanish"]);
  assert.equal(ctx.character.flags, 1);
  assert.equal(h.simulation.phil.getState(ctx.body), 1);
  assert.ok(!h.log.some((x) => ["stop", "move"].includes(x[0])));
});

test("vanish event owner observes pre-80 flags then commits actual mask before resource release", () => {
  const observations = [],
    h = host({
      faces: [],
      overrides: {
        vanish: (ctx, effect) => {
          observations.push(ctx.character.flags);
          h.runtime.updateState(ctx.owner, { flags: effect.flags });
          // The actual admitted resource host releases when this real owner is disabled.
          h.runtime.updateState(ctx.owner, { flags: effect.flags & ~1 });
          h.runtime.prepareFrame(frame(ctx.timeMs));
        },
      },
    }),
    owner = {};
  h.enroll(owner);
  h.runtime.prepareFrame(frame());
  h.runtime.updateState(owner, { flags: 7 });
  const ctx = h.context(owner),
    body = ctx.body,
    v = h.bridge.advance(ctx);
  assert.equal(v.completion.status, "complete");
  assert.deepEqual(observations, [1]);
  assert.equal(h.runtime.character(owner).flags, 0x80);
  assert.equal(h.simulation.phil.getState(body), 0);
  assert.equal(h.runtime.allocation(owner), null);
  assert.equal(ctx.character.body, null);
});

test("public grounding rejects stale resource contexts and fractional/raw overflow clocks", () => {
  const h = host(),
    owner = {};
  h.enroll(owner);
  h.runtime.prepareFrame(frame());
  const ctx = h.context(owner);
  for (const timeMs of [-1, 0.5, 0x100000000])
    assert.throws(() => h.bridge.advance({ ...ctx, timeMs }), /uint32/);
  const wrong = { ...ctx, body: { ...ctx.body } };
  assert.throws(() => h.bridge.advance(wrong), /current owner/);
  assert.deepEqual(h.log, []);
});

test("move completion releases only borrowed face-list ownership, retaining process normal and native ring order", () => {
  const h = host(),
    owner = {};
  h.enroll(owner);
  h.runtime.prepareFrame(frame());
  const ctx = h.context(owner);
  assert.equal(h.bridge.advance(ctx).completion.status, "complete");
  const state = h.bridge.state(owner);
  const slot = h.bridge.pool.get(owner);
  const ring = h.bridge.pool.order(slot.capacity);
  const oldFaces = slot.faces;
  const normal = [f(0.2), f(0.9), f(-0.1)];
  h.bridge.setProcessFloorNormal(owner, normal);
  h.bridge.releaseFaceCache(owner);
  assert.equal(h.bridge.state(owner), state);
  assert.deepEqual(state.processFloorNormal, normal);
  assert.equal(state.cache, null);
  assert.equal(slot.owner, null);
  assert.equal(h.bridge.pool.get(owner), null);
  assert.equal(slot.faces, oldFaces);
  assert.deepEqual(h.bridge.pool.order(slot.capacity), ring);
  // Clearing the process+b0 means no retained-triangle fast path on the next
  // visit. Acquisition takes the next native slot instead of rotating this one.
  h.log.length = 0;
  const next = h.bridge.advance(h.context(owner, 100));
  assert.equal(next.ground.rebuilt, true);
  assert.ok(h.log.some((row) => row[0] === "collect"));
  assert.notEqual(h.bridge.pool.get(owner), slot);
  h.bridge.releaseFaceCache(owner);
  h.bridge.releaseFaceCache(owner);
  assert.equal(h.bridge.state(owner), state);
  h.bridge.release(owner);
  assert.equal(h.bridge.state(owner), null);
});

test("canonical grounding reads live process stores and publishes the actual slot before finite queries", () => {
  let h;
  const owner = {},
    beforeRescan = [];
  h = canonicalHost({
    overrides: {
      queryFace: (ctx, face, query) => {
        const process = h.links.get(ctx.owner),
          slot = h.bridge.pool.get(ctx.owner);
        assert.equal(process.faceCache, slot);
        assert.equal(slot.owner, ctx.owner);
        assert.equal(slot.selectedFace, null);
        assert.equal(h.bridge.state(ctx.owner).cache.identity, slot);
        return { parameter: 0.2, point: [query.origin[0], 0, query.origin[2]] };
      },
      proximityRescan: (ctx, result) => {
        beforeRescan.push(h.bridge.state(ctx.owner).processFloorNormal);
        assert.equal(
          h.links.get(ctx.owner).faceCache.selectedFace,
          result.hit.face,
        );
        return {
          processFloorNormal: [0.1, 0.8, -0.2],
          processRetainedDirection: [0.2, 0, -0.9],
        };
      },
    },
  });
  h.enroll(owner, [0, 0.25, 0]);
  const process = h.acquire(owner).cache;
  h.inputs.set(owner, { processFloorNormal: undefined });
  h.bridge.setProcessFloorNormal(owner, [0, 0, 0]); // No WeakMap state is needed.
  h.runtime.prepareFrame(frame());
  assert.equal(
    h.bridge.advance(h.context(owner)).completion.status,
    "complete",
  );
  assert.deepEqual(beforeRescan, [[0, 0, 0]]);
  assert.deepEqual(process.floorNormal, [f(0.1), f(0.8), f(-0.2)]);
  assert.deepEqual(process.retainedDirection, [f(0.2), 0, f(-0.9)]);
  assert.equal(process.faceCache.selectedFace, process.faceCache.faces[0]);
  const state = h.bridge.state(owner);
  process.floorNormal = [0, 0.6, 0.8];
  h.inputs.set(owner, { processFloorNormal: [1, 0, 0] });
  assert.deepEqual(state.processFloorNormal, [0, f(0.6), f(0.8)]);
  assert.equal(
    h.bridge.advance(h.context(owner, 40)).ground.status,
    "retained",
  );
  assert.deepEqual(state.processFloorNormal, [0, f(0.6), f(0.8)]);
  h.bridge.setProcessRetainedDirection(owner, [-1, 0, 0]);
  assert.deepEqual(process.retainedDirection, [-1, 0, 0]);
});

test("canonical NULL process is explicit and never restores a standalone floor or borrowed list", () => {
  const h = canonicalHost(),
    owner = {};
  h.enroll(owner);
  h.runtime.prepareFrame(frame());
  const ctx = h.context(owner),
    flags = ctx.character.flags,
    clock = { ...ctx.instance.clock };
  const missing = h.bridge.advance(ctx);
  assert.equal(missing.completion.status, "provider-required");
  assert.deepEqual(missing.completion.requiredProviders, [
    "source-ground-current-process-cache-owner",
  ]);
  assert.equal(missing.ground.cache, null);
  assert.deepEqual(h.log, []);
  assert.equal(ctx.character.flags, flags);
  assert.deepEqual(ctx.instance.clock, clock);
  assert.equal(h.bridge.state(owner).cache, null);
  assert.throws(
    () => h.bridge.state(owner).processFloorNormal,
    /current process/,
  );
  assert.throws(() => h.bridge.releaseFaceCache(owner), /current process/);
  const process = h.acquire(owner).cache;
  process.floorNormal = [0.5, 0.5, 0];
  h.bridge.advance(ctx);
  assert.equal(h.bridge.state(owner).cache.identity, process.faceCache);
});

test("actual100-record eviction releases the borrowed Ped slot after its old cache link clears and rebinds recycled vectors", () => {
  const h = canonicalHost({ overrides: { proximityRescan: () => undefined } }),
    a = {},
    b = {};
  h.enroll(a);
  h.enroll(b);
  h.runtime.prepareFrame(frame());
  const original = h.acquire(a, 100).cache;
  original.floorNormal = [0.1, 0.8, -0.2];
  original.retainedDirection = [0, 0, -1];
  h.bridge.advance(h.context(a, 100));
  const aState = h.bridge.state(a),
    oldSlot = original.faceCache,
    oldSelected = oldSlot.selectedFace,
    oldFaces = oldSlot.faces,
    oldRing = h.bridge.pool.order(5);
  const others = Array.from({ length: 99 }, () => ({}));
  others.forEach((o, i) => h.acquire(o, 101 + i));
  h.processPool.slots[1].floorNormal = [0, -1, 0];
  h.processPool.slots[1].retainedDirection = [1, 0, 0];
  const reused = h.acquire(b, 1000);
  assert.equal(reused.cache, original);
  assert.equal(h.links.get(a), null);
  assert.equal(h.links.get(b), original);
  assert.equal(h.releases[0].oldOwner, a);
  assert.equal(h.releases[0].oldLink, null);
  assert.equal(h.releases[0].slot, oldSlot);
  assert.equal(oldSlot.owner, null);
  assert.equal(oldSlot.selectedFace, oldSelected);
  assert.equal(oldSlot.faces, oldFaces);
  assert.deepEqual(h.bridge.pool.order(5), oldRing);
  assert.equal(original.faceCache, null);
  assert.deepEqual(original.floorNormal, [f(0.1), f(0.8), f(-0.2)]);
  assert.deepEqual(original.retainedDirection, [0, 0, -1]);
  assert.equal(aState.cache, null);
  h.log.length = 0;
  assert.equal(
    h.bridge.advance(h.context(a, 1000)).completion.status,
    "provider-required",
  );
  assert.deepEqual(h.log, []);
  h.bridge.advance(h.context(b, 1000));
  assert.deepEqual(h.bridge.state(b).processFloorNormal, original.floorNormal);
  assert.notEqual(original.faceCache, oldSlot);
  const reacquired = h.acquire(a, 2000).cache;
  assert.equal(reacquired, h.processPool.slots[1]);
  assert.equal(h.bridge.state(a), aState);
  assert.deepEqual(aState.processFloorNormal, [0, -1, 0]);
  assert.equal(aState.cache, null);
  h.bridge.advance(h.context(a, 2000));
  assert.notEqual(reacquired.faceCache, oldSlot);
  assert.notEqual(reacquired.faceCache, original.faceCache);
  assert.deepEqual(aState.processFloorNormal, [0, -1, 0]);
});

test("finite ground-slot eviction clears the displaced Ped's current process pointer without clearing retained stores", () => {
  const h = canonicalHost({ overrides: { proximityRescan: () => undefined } }),
    owners = Array.from({ length: 41 }, () => ({}));
  owners.forEach((owner, i) => {
    h.enroll(owner, [i * 0.001, 0.4, 0]);
    h.acquire(owner, 100 + i);
  });
  h.runtime.prepareFrame(frame());
  const process = h.links.get(owners[0]);
  process.floorNormal = [0.2, 0.9, -0.1];
  process.retainedDirection = [0, 0, 1];
  process.retryCount = 7;
  process.headSequence = { address: 0x65d050, startTimeMs: 99, index: 2 };
  h.bridge.advance(h.context(owners[0], 200));
  const slot = process.faceCache,
    state = h.bridge.state(owners[0]);
  for (const owner of owners.slice(1)) h.bridge.advance(h.context(owner, 200));
  assert.equal(process.faceCache, null);
  assert.equal(state.cache, null);
  assert.equal(slot.owner, owners[40]);
  assert.equal(h.links.get(owners[40]).faceCache, slot);
  assert.equal(slot.selectedFace, slot.faces[0]);
  assert.deepEqual(process.floorNormal, [f(0.2), f(0.9), f(-0.1)]);
  assert.deepEqual(process.retainedDirection, [0, 0, 1]);
  assert.equal(process.retryCount, 7);
  assert.equal(process.headSequence.address, 0x65d050);
  assert.equal(process.headSequence.startTimeMs, 99);
  assert.equal(process.headSequence.index, 2);
});

test("replay singleton reinitialization releases the exact old Ped slot and preserves shared scalar aliases", () => {
  const h = canonicalHost({ overrides: { proximityRescan: () => undefined } }),
    a = {},
    b = {};
  for (const owner of [a, b]) {
    h.enroll(owner);
    h.inputs.set(owner, { replay: true, replayOverride: true });
  }
  h.runtime.prepareFrame(frame());
  const singleton = h.acquire(a, 100, true).cache;
  singleton.floorNormal = [0.3, 0.8, 0];
  singleton.retainedDirection = [1, 0, 0];
  h.bridge.advance(h.context(a, 100));
  const firstSlot = singleton.faceCache,
    aState = h.bridge.state(a);
  assert.equal(firstSlot.owner, a);
  h.acquire(b, 200, true);
  assert.equal(h.links.get(a), singleton);
  assert.equal(h.links.get(b), singleton);
  assert.equal(firstSlot.owner, null);
  assert.equal(aState.cache, null);
  assert.equal(h.releases[0].oldLink, singleton);
  assert.deepEqual(aState.processFloorNormal, [f(0.3), f(0.8), 0]);
  h.bridge.advance(h.context(b, 200));
  const bSlot = singleton.faceCache;
  assert.equal(bSlot.owner, b);
  assert.equal(aState.cache.identity, bSlot); // Actual shared pointer, never A's former slot.
  h.inputs.set(a, { replay: true, replayOverride: false });
  h.log.length = 0;
  assert.equal(h.bridge.advance(h.context(a, 200)).ground.status, "bypassed");
  assert.equal(singleton.faceCache, bSlot);
  assert.equal(bSlot.owner, b);
  assert.deepEqual(h.log, []);
  h.acquire(a, 300, true);
  assert.equal(bSlot.owner, null);
  assert.equal(h.bridge.state(b).cache, null);
  const normal = h.acquire(a, 400, false).cache;
  assert.notEqual(normal, singleton);
  assert.equal(h.links.get(b), singleton);
  assert.equal(aState.cache, null);
  assert.deepEqual(aState.processFloorNormal, [0, 0, 0]);
});

test("canonical move completion releases only face ownership and preserves process, head, directions and slot storage", () => {
  const h = canonicalHost({ overrides: { proximityRescan: () => undefined } }),
    owner = {};
  h.enroll(owner);
  h.runtime.prepareFrame(frame());
  const process = h.acquire(owner, 100).cache;
  h.bridge.advance(h.context(owner, 100));
  process.floorNormal = [0.2, 0.9, -0.1];
  process.retainedDirection = [0, 0, -1];
  process.headSequence = { address: 0x65d050, startTimeMs: 51, index: 1 };
  process.retryCount = 2;
  const slot = process.faceCache,
    selected = slot.selectedFace,
    faces = slot.faces,
    ring = h.bridge.pool.order(5),
    state = h.bridge.state(owner);
  h.bridge.releaseFaceCache(owner);
  h.bridge.releaseFaceCache(owner);
  assert.equal(h.links.get(owner), process);
  assert.equal(process.faceCache, null);
  assert.equal(slot.owner, null);
  assert.equal(slot.selectedFace, selected);
  assert.equal(slot.faces, faces);
  assert.deepEqual(h.bridge.pool.order(5), ring);
  assert.deepEqual(state.processFloorNormal, [f(0.2), f(0.9), f(-0.1)]);
  assert.deepEqual(process.retainedDirection, [0, 0, -1]);
  assert.equal(process.headSequence.address, 0x65d050);
  assert.equal(process.headSequence.index, 1);
  assert.equal(process.headSequence.startTimeMs, 51);
  assert.equal(process.retryCount, 2);
  h.log.length = 0;
  assert.equal(h.bridge.advance(h.context(owner, 200)).ground.rebuilt, true);
  assert.ok(h.log.some((row) => row[0] === "collect"));
  assert.notEqual(process.faceCache, slot);
  h.bridge.reset();
  assert.equal(process.faceCache, null);
  assert.equal(h.bridge.state(owner), null);
  assert.deepEqual(process.floorNormal, [f(0.2), f(0.9), f(-0.1)]);
});

test("canonical recache keeps source slot+30 through memcpy and finite query, then commits the returned record", () => {
  let h,
    phase = 0,
    previousSelected;
  const owner = {},
    first = floor("first"),
    second = floor("second");
  h = canonicalHost({
    overrides: {
      collectFaces: () => (phase ? [first] : [first, second]),
      queryFace: (ctx, face, query) => {
        const process = h.links.get(ctx.owner),
          slot = process.faceCache;
        if (phase) {
          assert.equal(slot, h.bridge.pool.get(ctx.owner));
          assert.equal(slot.selectedFace, previousSelected);
          assert.equal(slot.faces.includes(previousSelected), false);
          assert.equal(
            h.bridge.state(ctx.owner).cache.selectedFace,
            previousSelected,
          );
          assert.equal(
            h.bridge.pool.ownsFaceRecord(slot, previousSelected),
            true,
          );
        }
        return {
          parameter: face.id === "second" ? 0.1 : 0.2,
          point: [query.origin[0], 0, query.origin[2]],
        };
      },
      proximityRescan: () => undefined,
    },
  });
  h.enroll(owner, [0, 0.25, 0]);
  h.runtime.prepareFrame(frame());
  const process = h.acquire(owner, 100).cache;
  h.bridge.advance(h.context(owner, 100));
  const slot = process.faceCache;
  previousSelected = slot.selectedFace;
  assert.equal(previousSelected.id, "second");
  phase = 1;
  h.bridge.invalidate(owner);
  const result = h.bridge.advance(h.context(owner, 200));
  assert.equal(result.completion.status, "complete");
  assert.equal(process.faceCache, slot);
  assert.equal(slot.selectedFace, slot.faces[0]);
  assert.equal(slot.selectedFace.id, "first");
  assert.notEqual(slot.selectedFace, previousSelected);
});
