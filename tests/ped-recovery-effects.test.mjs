import assert from "node:assert/strict";
import test from "node:test";
import {
  Group,
  Mesh,
  BufferGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
} from "three";
import {
  createNativePedRecoveryEffects,
  preflightNativePedRecoveryEffects,
} from "../src/ped-recovery-effects.ts";
import {
  decideNativePedHalt,
  mutateNativePedHalt,
} from "../src/physics/ped-halt.ts";
import { OilRuntime } from "../src/physics/oil.ts";
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

test("native halt chance and shared corpse allocator consume exactly the original CRT sequence and once latch", () => {
  const f = fixture(),
    outlet = createNativePedRecoveryEffects(f.host),
    results = [];
  const halt = () =>
    mutateNativePedHalt(f.state, f.input, {
      shared: { retryScalar: 8 },
      nextCrtInteger: f.nextCrtInteger,
      onEffect: (effect) => {
        if (["corpse-slick", "status-physical-level"].includes(effect.kind))
          results.push(outlet(f.context, effect, f.state));
      },
    });
  assert.equal(halt().returnValue, 1);
  // Installed MSVC seed1: one chance, full-size and growth; no adapter chance.
  assert.deepEqual(f.samples, [41, 18467, 6334]);
  assert.equal(f.oil.spills.filter(Boolean).length, 1);
  assert.equal(f.state.flags & 0x10, 0x10);
  assert.equal(f.oil.spills.find(Boolean).spillTime, 423);
  assert.deepEqual(results, [undefined, []]);
  // Halt resets the exhausted retry counter. A later settled corpse must have
  // its principal axis aligned with the floor; otherwise the native retry
  // branch runs before the ordinary corpse tail and consumes a different draw.
  f.input.actorRootPose = [0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0];
  assert.equal(halt().returnValue, 1);
  assert.deepEqual(f.samples, [41, 18467, 6334, 26500]);
  assert.equal(f.oil.spills.filter(Boolean).length, 1);
  f.input.replay = true;
  assert.equal(halt().returnValue, 1);
  assert.equal(f.samples.length, 4);
  f.oil.dispose();
});

test("status recording retains a real recording outlet and never changes physics", () => {
  const f = fixture(),
    calls = [];
  const outlet = createNativePedRecoveryEffects({
    ...f.host,
    statusRecording: (ctx, effect, state) => {
      calls.push({ ctx, effect, state });
      return ["actual-status-serialization-owner"];
    },
  });
  const effect = { kind: "status-physical-level", level: 5, timeMs: 123 };
  const before = structuredClone(f.state);
  assert.deepEqual(outlet(f.context, effect, f.state), [
    "actual-status-serialization-owner",
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ctx, f.context);
  assert.equal(calls[0].effect, effect);
  assert.deepEqual(f.state, before);
  assert.equal(f.samples.length, 0);
  assert.deepEqual(
    createNativePedRecoveryEffects({ ...f.host, statusRecording: undefined })(
      f.context,
      effect,
      f.state,
    ),
    ["source-ped-status-recording-owner"],
  );
  f.oil.dispose();
});

test("remaining recovery owners remain explicit; selected face release uses the narrow owner", () => {
  const f = fixture(),
    released = [];
  const outlet = createNativePedRecoveryEffects({
    ...f.host,
    grounding: { releaseFaceCache: (owner) => released.push(owner) },
  });
  assert.equal(
    outlet(f.context, { kind: "release-selected-face-cache" }, f.state),
    undefined,
  );
  assert.deepEqual(released, [f.context.owner]);
  assert.deepEqual(outlet(f.context, { kind: "rescan-proximity" }, f.state), [
    "source-recovery-rescan-proximity-owner",
  ]);
  assert.deepEqual(
    outlet(
      f.context,
      {
        kind: "scan-objects",
        timeMs: 123,
        pointerIdentityReseedRequired: true,
      },
      f.state,
    ),
    ["source-recovery-scan-objects-owner"],
  );
  assert.deepEqual(
    createNativePedRecoveryEffects({
      ...f.host,
      readOil: () => null,
      readMaterials: () => null,
    })(f.context, { kind: "corpse-slick" }, f.state),
    [
      "source-shared-oil-runtime-owner",
      "source-registered-ped-slick-materials",
    ],
  );
  assert.equal(f.samples.length, 0);
  f.oil.dispose();
});

test("missing dead-halt resources are identified before any source random or once-latch mutation", () => {
  const f = fixture(),
    before = structuredClone(f.state);
  const check = (host) =>
    preflightNativePedRecoveryEffects(
      host,
      f.context,
      f.state,
      f.input,
      decideNativePedHalt(f.state, f.input),
    );
  assert.deepEqual(check(f.host), []);
  assert.deepEqual(check({ ...f.host, readMaterials: () => new Map() }), [
    "source-registered-ped-slick-material:GIBSLICK",
  ]);
  assert.deepEqual(check({ ...f.host, readAllocation: () => null }), [
    "source-current-ped-render-allocation",
  ]);
  assert.deepEqual(check({ ...f.host, readOil: () => null }), [
    "source-shared-oil-runtime-owner",
  ]);
  assert.deepEqual(f.samples, []);
  assert.deepEqual(f.state, before);
  assert.equal(f.oil.spills.filter(Boolean).length, 0);
  f.oil.dispose();
});

test("dead-halt preflight requires no unavailable slick owners when native chance/effect gates skip them", () => {
  const f = fixture(),
    unavailable = { ...f.host, readOil: () => null };
  const check = () =>
    preflightNativePedRecoveryEffects(
      unavailable,
      f.context,
      f.state,
      f.input,
      decideNativePedHalt(f.state, f.input),
    );
  f.input.replay = true;
  assert.deepEqual(check(), []);
  f.input.replay = false;
  f.state.flags |= 0x10;
  assert.deepEqual(check(), []);
  f.state.flags &= ~0x10;
  f.input.goreLevel = 0;
  assert.deepEqual(check(), []);
  f.input.goreLevel = 1;
  f.input.volumeGravity = 0.9;
  assert.deepEqual(check(), []);
  f.input.volumeGravity = 1;
  assert.deepEqual(check(), ["source-shared-oil-runtime-owner"]);
  f.state.cache.retryCount = 0;
  assert.deepEqual(check(), []); // Native retry branch precedes the corpse tail.
  assert.deepEqual(f.samples, []);
  f.oil.dispose();
});
