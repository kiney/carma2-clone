import assert from "node:assert/strict";
import test from "node:test";
import {
  Group,
  Mesh,
  BufferGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
} from "three";
import { createNativePedRecoveryEffects } from "../src/ped-recovery-effects.ts";
import {
  decideNativePedHalt,
  mutateNativePedHalt,
  completeNativePedMove,
} from "../src/physics/ped-halt.ts";
import { OilRuntime } from "../src/physics/oil.ts";
import { createOrdinaryPedRecoveryHost } from "../src/ped-ordinary-recovery.ts";
import { NativePedProcessCachePool } from "../src/ped-process-cache.ts";
import { NativePedGroundCachePool } from "../src/ped-ground-cache.ts";
import { NativeRandom } from "../src/native-random.ts";

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function fixture() {
  const owner = {},
    actor = new Group(),
    model = new Group(),
    group = new Group();
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([-1, -1, -1, 1, 1, 1], 3),
  );
  geometry.userData.sourcePositions = new Float32Array([-1, -1, -1, 1, 1, 1]);
  geometry.userData.modelFlags = 0;
  model.add(new Mesh(geometry, new MeshBasicMaterial()));
  actor.add(model);
  group.add(actor);
  const instance = { group, bones: [{ actor, model }] };
  const allocation = {
    phase: "owned",
    renderSlot: 0,
    render: { instance, actorSet: { actors: [actor] } },
  };
  const context = { owner, instance, timeMs: 123 };
  const state = {
    hitPoints: 0,
    flags: 0,
    moveId: 93,
    action: 5,
    impactSerial: 0,
    cache: { retryCount: 2 },
    doNothing: true,
    rigidFlags: 0,
    rigidPose: new Float32Array(I),
    localOmega: [0, 0, 0],
    filterA: 0x20000,
    filterB: 0x40000,
  };
  const input = {
    actorRootPose: I,
    characterOrientation: [1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0],
    worldFaceNormals: [[0, 1, 0]],
    mass: 2,
    inertia: [2.6, 2, 1],
    bounds: { min: [0, 0, 0], max: [2, 4, 6] },
    lyingAxes: [-1, 1],
    head: { boneIndex: 0, modelState: 0, renderSlot: 0 },
    collisionFlag: false,
    nowMs: 123,
    immortal: false,
    volumeGravity: null,
    goreLevel: 1,
    replay: false,
    mutantSpeed: 0,
  };
  const random = new NativeRandom(1),
    samples = [];
  const nextCrtInteger = () => {
    const value = random.nextInteger();
    samples.push(value);
    return value;
  };
  const oil = new OilRuntime({ random: () => nextCrtInteger() / 32768 });
  const slick = {
    pixelmap: "GIBSLICK",
    delayMs: 300,
    growth: [0.00001, 0.00007],
    initialSize: 0.001,
    fullSize: [0.05, 0.15],
    friction: [0.2, 1],
    smearDistance: [1, 1],
    smearMaterial: "GIBSMEAR.MAT",
  };
  const materials = new Map([
    ["gibslick", new MeshBasicMaterial()],
    ["gibsmear", new MeshBasicMaterial()],
  ]);
  const host = {
    readAllocation: (candidate) => (candidate === owner ? allocation : null),
    readOil: () => oil,
    readSlick: () => slick,
    readMaterials: () => materials,
    statusRecording: "disabled",
  };
  return { context, state, input, nextCrtInteger, samples, oil, host };
}

const complete = () => ({ status: "complete", requiredProviders: [] });
function bounded(f) {
  const records = new Map(),
    faces = new NativePedGroundCachePool();
  const processes = new NativePedProcessCachePool({
    readCache: (owner) => records.get(owner) ?? null,
    writeCache: (owner, cache) => records.set(owner, cache),
    releaseFaceCache: (slot) => faces.releaseSlot(slot),
  });
  const process = processes.visit(f.context.owner, {
    timeMs: 100,
    replay: false,
    minTurnIntervalMs: 0,
    maxTurnIntervalMs: 0,
    spurtingPeriodMs: 0,
  }).cache;
  const face = {
    a: [0, 0, 0],
    b: [2, 0, 0],
    c: [0, 0, 2],
    normal: [0, 1, 0],
    rawFlags: 0,
  };
  const slot = faces.acquire({
    owner: f.context.owner,
    capacity: 5,
    faces: [face],
    bounds: { min: [-1, -1, -1], max: [3, 1, 3] },
    timeMs: 100,
  });
  process.faceCache = slot;
  process.floorNormal = [0, 0.8, 0.6];
  process.retainedDirection = [1, 0, 0];
  const events = [];
  const options = {
    ...f.host,
    readProcess: (owner) => records.get(owner) ?? null,
    releaseBorrowedFaceSlot: (slot) => {
      events.push("release");
      faces.releaseSlot(slot);
    },
    recacheGround: (ctx, request, state) => {
      events.push(["ground", request, state.action]);
      return complete();
    },
    setDirection: (ctx, direction, time, state) => {
      events.push(["direction", direction, time, state.action]);
      return complete();
    },
    rescanProximity: () => {
      events.push("proximity");
      return complete();
    },
    scanObjects: () => {
      events.push("objects");
      return complete();
    },
  };
  return { process, slot, faces, processes, records, events, options };
}

test("source completion releases only the actual borrowed face slot, retaining canonical process/floor/head and allocation", () => {
  const f = fixture(),
    b = bounded(f),
    host = createOrdinaryPedRecoveryHost(b.options),
    outlet = createNativePedRecoveryEffects(host);
  const state = {
    ...f.state,
    hitPoints: 100,
    moveId: 96,
    cache: b.process,
    frame: 3,
    completionEnabled: true,
  };
  const gameplay = { action: state.action, cache: b.process };
  const allocation = f.host.readAllocation(f.context.owner),
    copiedFace = b.slot.faces[0];
  const result = completeNativePedMove(
    state,
    {
      frameCount: 3,
      positiveAdvance: 1,
      replay: false,
      nowMs: 123,
      blind: false,
      valiumTimeMs: 0,
      head: { boneIndex: 0, renderSlot: 0, modelState: 0 },
    },
    (effect) => {
      if (effect.kind === "release-selected-face-cache")
        assert.equal(outlet(f.context, effect, gameplay), undefined);
    },
  );
  assert.equal(result.dispatched, true);
  assert.deepEqual(b.events, ["release"]);
  assert.equal(b.slot.owner, null);
  assert.equal(b.faces.get(f.context.owner), null);
  assert.equal(b.slot.faces[0], copiedFace);
  assert.equal(b.process.faceCache, null);
  assert.equal(b.records.get(f.context.owner), b.process);
  assert.deepEqual(b.process.floorNormal, [
    0,
    Math.fround(0.8),
    Math.fround(0.6),
  ]);
  assert.deepEqual(b.process.retainedDirection, [1, 0, 0]);
  assert.equal(b.process.headSequence.address, 0x65d050);
  assert.equal(f.host.readAllocation(f.context.owner), allocation);
  assert.deepEqual(f.samples, []);
  // Repeated release is a resolved NULL branch, with no second pool operation.
  outlet(f.context, { kind: "release-selected-face-cache" }, gameplay);
  b.records.set(f.context.owner, null);
  outlet(f.context, { kind: "release-selected-face-cache" }, gameplay);
  assert.deepEqual(b.events, ["release"]);
  f.oil.dispose();
});

test("living upright halt forwards source ground/direction/proximity/object order and does not add noise/RNG", () => {
  const f = fixture(),
    b = bounded(f),
    host = createOrdinaryPedRecoveryHost(b.options),
    outlet = createNativePedRecoveryEffects(host);
  const state = { ...f.state, hitPoints: 100, moveId: 93, cache: b.process };
  const input = { ...f.input, characterOrientation: I, goreLevel: 0 };
  const gameplay = { action: state.action, cache: b.process };
  const decision = decideNativePedHalt(state, input);
  assert.equal(decision.kind, "upright");
  assert.deepEqual(
    host.preflightRecoveryEffects(f.context, state, input, decision),
    [],
  );
  const result = mutateNativePedHalt(state, input, {
    shared: { retryScalar: 8 },
    nextCrtInteger: f.nextCrtInteger,
    onEffect: (effect) => {
      if (
        [
          "recache-ground",
          "direction",
          "rescan-proximity",
          "scan-objects",
          "status-physical-level",
        ].includes(effect.kind)
      )
        assert.deepEqual(outlet(f.context, effect, gameplay) ?? [], []);
    },
  });
  assert.equal(result.returnValue, 1);
  assert.deepEqual(
    b.events.map((e) => (Array.isArray(e) ? e[0] : e)),
    ["ground", "direction", "proximity", "objects"],
  );
  assert.deepEqual(b.events[0][1], { force: true, timeMs: 123 });
  assert.equal(b.slot.owner, f.context.owner);
  assert.equal(b.process.faceCache, b.slot);
  assert.deepEqual(f.samples, []);
  f.oil.dispose();
});

test("missing PED07 operations fail living preflight before source writes/RNG but do not block dead or retry branches", () => {
  const f = fixture(),
    b = bounded(f);
  const host = createOrdinaryPedRecoveryHost({
    ...b.options,
    recacheGround: undefined,
    setDirection: undefined,
    rescanProximity: undefined,
    scanObjects: undefined,
  });
  const state = { ...f.state, hitPoints: 100, cache: b.process },
    input = { ...f.input, characterOrientation: I, goreLevel: 0 };
  const before = [...b.process.storage];
  assert.deepEqual(
    host.preflightRecoveryEffects(
      f.context,
      state,
      input,
      decideNativePedHalt(state, input),
    ),
    [
      "source-PED07-recache-ground-owner",
      "source-recovery-direction-owner",
      "source-recovery-rescan-proximity-owner",
      "source-recovery-scan-objects-pointer-CRT-owner",
    ],
  );
  assert.deepEqual([...b.process.storage], before);
  assert.deepEqual(f.samples, []);
  const dead = { ...f.state, cache: b.process };
  b.process.retryCount = 2;
  assert.deepEqual(
    host.preflightRecoveryEffects(
      f.context,
      dead,
      { ...f.input, goreLevel: 0 },
      decideNativePedHalt(dead, { ...f.input, goreLevel: 0 }),
    ),
    [],
  );
  assert.deepEqual(
    host.preflightRecoveryEffects(f.context, dead, f.input, { kind: "retry" }),
    [],
  );
  f.oil.dispose();
});

test("real corpse halt reuses shared oil/MODEL/material owners with exactly the native chance and allocation CRT draws", () => {
  const f = fixture(),
    b = bounded(f),
    host = createOrdinaryPedRecoveryHost(b.options),
    outlet = createNativePedRecoveryEffects(host),
    slickResults = [];
  host.onSlickResult = (owner, result) => slickResults.push(result);
  assert.deepEqual(
    host.preflightRecoveryEffects(
      f.context,
      f.state,
      f.input,
      decideNativePedHalt(f.state, f.input),
    ),
    [],
  );
  const result = mutateNativePedHalt(f.state, f.input, {
    shared: { retryScalar: 8 },
    nextCrtInteger: f.nextCrtInteger,
    onEffect: (effect) => {
      if (["corpse-slick", "status-physical-level"].includes(effect.kind))
        assert.deepEqual(outlet(f.context, effect, f.state) ?? [], []);
    },
  });
  assert.equal(result.returnValue, 1);
  assert.deepEqual(f.samples, [41, 18467, 6334]);
  assert.equal(f.oil.spills.filter(Boolean).length, 1);
  assert.equal(slickResults[0].status, "queued");
  assert.equal(f.oil.spills.find(Boolean), slickResults[0].spill);
  assert.equal(f.state.flags & 0x10, 0x10);
  f.oil.dispose();
});

test("missing resources/readiness and non-successful operation results stay explicit", () => {
  const f = fixture(),
    b = bounded(f);
  const host = createOrdinaryPedRecoveryHost({
    ...b.options,
    readMaterials: () => null,
    preflight: () => ["source-PED07-selected-support-owner"],
    setDirection: () => ({
      status: "provider-required",
      requiredProviders: ["source-actual-direction-owner"],
    }),
  });
  const check = host.preflightRecoveryEffects(
    f.context,
    f.state,
    f.input,
    decideNativePedHalt(f.state, f.input),
  );
  assert.deepEqual(check, [
    "source-registered-ped-slick-materials",
    "source-PED07-selected-support-owner",
  ]);
  const outlet = createNativePedRecoveryEffects(host);
  assert.deepEqual(
    outlet(
      f.context,
      { kind: "direction", vector: [1, 0, 0], turn: 0, timeMs: 123 },
      f.state,
    ),
    ["source-actual-direction-owner"],
  );
  const invalid = createNativePedRecoveryEffects(
    createOrdinaryPedRecoveryHost({
      ...b.options,
      scanObjects: () => undefined,
    }),
  );
  assert.throws(
    () => invalid(f.context, { kind: "scan-objects", timeMs: 123 }, f.state),
    /explicit source operation result/,
  );
  assert.deepEqual(f.samples, []);
  f.oil.dispose();
});
