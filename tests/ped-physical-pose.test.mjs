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
import {
  createNativePedInstance,
  selectNativePedMove,
  synchronizeNativePedPhysicalPose,
} from "../src/ped-native-instance.ts";
import { NativePedRuntime } from "../src/ped-native-runtime.ts";
import { createNativePedPoolSettings } from "../src/ped-body-pool.ts";
import { nativePedBoxInertia } from "../src/ped-form.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { Assets } from "../src/content.ts";
import { createAssetStore } from "../server/assets.mjs";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";

const f = Math.fround,
  identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  physical = [0.25, 0.5, 1, -0.4, 0.2, 0.75, 1.5, -0.9, 0.4, 10, 20, 30];
function safeAssets() {
  const material = new MeshBasicMaterial(),
    geometry = new BoxGeometry(0.1, 0.1, 0.1),
    bounds = new Box3(
      new Vector3(-0.05, -0.05, -0.05),
      new Vector3(0.05, 0.05, 0.05),
    );
  geometry.userData.nativePedModelBounds = bounds;
  const formBones = [
    {
      name: "ROOT",
      parent: -1,
      mass: 0,
      massKg: 0,
      collisionType: null,
      jointType: null,
      jointRecords: [],
    },
    {
      name: "HEAD",
      parent: 0,
      mass: f(0.004),
      massKg: 4,
      collisionType: "SPHERE",
      jointType: "NONE",
      jointRecords: [],
    },
  ];
  const bones = formBones.map((bone, index) => {
    const actor = new Group();
    actor.add(new Mesh(geometry, material));
    return {
      ...bone,
      index,
      actor,
      variants: [
        {
          identifier: bone.name,
          actor,
          modelBounds: new Map([[bone.name, bounds]]),
          sourceModels: [bone.name],
        },
      ],
      attachments: index ? { child: [0, 0, 0], parent: [0, 0.1, 0] } : null,
    };
  });
  const formMove = {
      id: 30,
      periodMs: 33,
      resetAxes: "",
      direction: [1, 0, 0],
      filename: "safe.BON",
      flags: 0,
    },
    matrices = new Float32Array(3 * bones.length * 12);
  for (let frame = 0; frame < 3; frame++)
    for (let bone = 0; bone < bones.length; bone++)
      matrices.set(identity, (frame * bones.length + bone) * 12);
  const bodyBounds = { min: [-0.03, -0.1, -0.03], max: [0.03, 0.1, 0.03] };
  return {
    group: new Group(),
    bones,
    inheritedActorMaterial: material,
    form: {
      maxSimple: 1,
      maxRender: 1,
      maxBoned: 1,
      maxStoredDismembered: 1,
      remapFilename: null,
      bones: formBones,
      mass: f(0.004),
      moves: [formMove],
      nonHumanoid: false,
      headBone: 1,
      lyingAxes: [1, 3],
    },
    profile: {
      formName: "safe-physical-FORM",
      rootName: "ROOT",
      rootRemap: null,
      mass: f(0.004),
      bounds: bodyBounds,
      centreOfMass: [0, 0, 0],
      inertia: nativePedBoxInertia(f(0.004), bodyBounds),
      radius: 0.11,
      modelsByBone: new Map(),
      attachmentsByBone: new Map(),
      movement: new Map(),
      jumpHeight: 0,
    },
    moves: new Map([
      [
        30,
        {
          id: 30,
          form: formMove,
          personality: { scale: 1, groundingMode: 1, groundingOffset: 0 },
          motion: {
            bones: bones.map((b) => ({ name: b.name, children: [] })),
            frameCount: 3,
            matrices,
          },
        },
      ],
    ]),
    scene: { materials: new Map(), textures: new Map() },
  };
}
function instance(assets = safeAssets(), move = 30) {
  const p = createNativePedInstance(assets, { rootPose: identity });
  assert.equal(
    selectNativePedMove(p, move, [1, 0, 0], [0, 1, 0], 100).status,
    "complete",
  );
  p.physicsActive = true;
  p.clock.fraction = f(0.75);
  p.clock.lastTimeMs = 1234;
  p.nativeCharacterVelocity.splice(0, 3, 11, 12, 13);
  return p;
}

// Native40b770/409400 call LPInverse5324f0, then Mul531c60. These literal
// outputs were captured from installed HW; no general inverse/renormalization.
test("physical synchronization preserves clocks, V, raw affine root and current frame", () => {
  const p = instance(),
    clock = { ...p.clock },
    movement = [...p.movement],
    direction = [...p.direction];
  p.move.roots[0].set(identity);
  p.move.roots[1].set([0, 1, 0, -1, 0, 0, 0, 0, 1, 99, 98, 97]);
  p.clock.frame = 1;
  clock.frame = 1;
  const result = synchronizeNativePedPhysicalPose(p, physical);
  assert.equal(result.status, "complete");
  assert.equal(result.processedFrames, 0);
  assert.equal(result.completedMove, false);
  assert.deepEqual(p.clock, clock);
  assert.deepEqual([...p.rootPose], physical.map(f));
  assert.deepEqual(
    [...p.characterOrientation],
    [
      f(0.4),
      f(-0.2),
      f(-0.75),
      f(0.25),
      f(0.5),
      1,
      f(1.5),
      f(-0.9),
      f(0.4),
      0,
      0,
      0,
    ],
  );
  assert.deepEqual(p.nativeCharacterVelocity, [11, 12, 13]);
  assert.deepEqual([...p.movement], movement);
  assert.deepEqual([...p.direction], direction);
  assert.equal(p.physicsActive, true);
});

test("installed x87 sum order survives cancellation that a uniform dot product loses", () => {
  const p = instance(),
    q = f(Math.sqrt(0.5));
  p.move.roots[0].set([0.5, 0.5, -q, 0.5, 0.5, q, q, -q, 0, 0, 0, 0]);
  const root = [2 ** 55, 0, 0, -(2 ** 55), 1, 0, 1, 0, 1, 10, 20, 30];
  assert.equal(f(0.5 * root[0] + 0.5 * root[3] + q * root[6]), q);
  synchronizeNativePedPhysicalPose(p, root);
  assert.deepEqual(
    [...p.characterOrientation],
    [0, 0.5, q, -q, 0.5, -q, -50952412508192770, q, 0, 0, 0, 0],
  );
});

test("mode3 poses eligible flat children but preserves a removed child's matrix", () => {
  const p = instance(),
    retained = new Float32Array([...identity.slice(0, 9), 7, 8, 9]);
  p.bones[1].pose.set(retained);
  p.removedBoneMask = 2;
  synchronizeNativePedPhysicalPose(p, physical);
  assert.deepEqual([...p.bones[1].pose], [...retained]);
  p.removedBoneMask = 0;
  synchronizeNativePedPhysicalPose(p, physical);
  assert.notDeepEqual([...p.bones[1].pose], [...retained]);
  assert.deepEqual([...p.rootPose], physical.map(f));
});

function runtimeHost(hooks = {}) {
  const simulation = new VehicleSimulation(
      { raycast: () => null, querySurfaces: () => [] },
      new Group(),
    ),
    runtime = new NativePedRuntime(simulation, { levelOut: 0, hooks });
  runtime.registerPersonality("safe", safeAssets());
  const c = runtime.enroll({
    owner: {},
    personality: "safe",
    rootPose: identity,
    moveId: 30,
    direction: [1, 0, 0],
    groundNormal: [0, 1, 0],
    timeMs: 0,
    flags: 1,
  });
  runtime.prepareFrame({
    cameraOrigin: [0, 0, -10],
    timeMs: 100,
    settings: createNativePedPoolSettings(100, 0),
  });
  c.instance.nativeCharacterVelocity.splice(0, 3, 11, 12, 13);
  assert.equal(runtime.activate(c.owner), true);
  c.instance.clock.frame = 1;
  c.instance.clock.fraction = f(0.75);
  c.instance.clock.lastTimeMs = 1234;
  c.body.state.velocity.set(2, 3, 4);
  return { simulation, runtime, c };
}

test("moved wrapper copies source V before callback without consuming the outer BON clock", () => {
  let observed;
  const { c } = runtimeHost({
      onMoved: (ctx) => {
        observed = {
          V: [...ctx.instance.nativeCharacterVelocity],
          clock: { ...ctx.instance.clock },
          position: [...ctx.character.position],
          period: ctx.framePeriodMs,
        };
      },
    }),
    clock = { ...c.instance.clock };
  c.body.state.position.set(10, 20, 30);
  c.body.onMoved(c.body, 40);
  assert.deepEqual(observed, {
    V: [2, 3, 4],
    clock,
    position: [10, 20, 30],
    period: 40,
  });
  assert.deepEqual(c.instance.clock, clock);
  assert.deepEqual(c.body.state.velocity.toArray(), [2, 3, 4]);
});

test("rejected halt clears active bit for hook then restores it and retains prior character V", () => {
  let observed;
  const { c } = runtimeHost({
      onHalt: (ctx) => {
        observed = {
          flags: ctx.character.physicsFlags,
          active: ctx.instance.physicsActive,
          V: [...ctx.instance.nativeCharacterVelocity],
        };
        return { returnValue: 0 };
      },
    }),
    clock = { ...c.instance.clock };
  assert.equal(c.body.onHalt(c.body, 40), false);
  assert.deepEqual(observed, { flags: 1, active: false, V: [11, 12, 13] });
  assert.equal(c.physicsFlags, 5);
  assert.equal(c.instance.physicsActive, true);
  assert.deepEqual(c.instance.nativeCharacterVelocity, [11, 12, 13]);
  assert.deepEqual(c.instance.clock, clock);
  assert.deepEqual(c.body.state.velocity.toArray(), [2, 3, 4]);
});

test("accepted halt copies final live body V after the source hook", () => {
  const { c } = runtimeHost({
      onHalt: (ctx) => {
        assert.deepEqual(ctx.instance.nativeCharacterVelocity, [11, 12, 13]);
        ctx.body.state.velocity.set(7, 8, 9);
        return { returnValue: 1 };
      },
    }),
    clock = { ...c.instance.clock };
  assert.equal(c.body.onHalt(c.body, 40), true);
  assert.deepEqual(c.instance.nativeCharacterVelocity, [7, 8, 9]);
  assert.deepEqual(c.body.state.velocity.toArray(), [7, 8, 9]);
  assert.equal(c.physicsFlags, 1);
  assert.deepEqual(c.instance.clock, clock);
});

test("moved does nothing when the character does not own a simple resource", () => {
  let calls = 0;
  const { c } = runtimeHost({
      onMoved: () => {
        calls++;
      },
    }),
    before = [...c.instance.rootPose],
    clock = { ...c.instance.clock };
  c.physicsFlags &= ~1;
  c.body.state.position.set(30, 40, 50);
  c.body.onMoved(c.body, 40);
  assert.equal(calls, 0);
  assert.deepEqual([...c.instance.rootPose], before);
  assert.deepEqual(c.instance.nativeCharacterVelocity, [11, 12, 13]);
  assert.deepEqual(c.instance.clock, clock);
});

test("Stock and Advanced original BIPED/DOG frame roots match literal installed physical O captures", async (t) => {
  let store;
  try {
    store = await createAssetStore("carma2_orig");
  } catch (e) {
    if (/ENOENT|Original installation/.test(String(e))) {
      t.skip("Original installation absent");
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
  const captured = {
    "Blokebl:30": [
      -0.39637109637260437, 0.20710614323616028, 0.764204740524292,
      0.24244771897792816, 0.5050108432769775, 0.9856254458427429,
      -1.5022014379501343, 0.895584225654602, -0.40869754552841187, 0, 0, 0,
    ],
    "Blokebl:94": [
      -0.3909880518913269, 0.21730178594589233, 0.7844540476799011,
      0.1597345918416977, 0.5536093711853027, 0.9433158040046692,
      -1.5146329402923584, 0.8638845682144165, -0.46614062786102295, 0, 0, 0,
    ],
    "twolf:30": [
      0.2499999850988388, 0.5, 1, -0.40000003576278687, 0.20000004768371582,
      0.75, 1.5, -0.8999999761581421, 0.40000003576278687, 0, 0, 0,
    ],
    "twolf:94": [
      f(0.25),
      f(0.5),
      1,
      f(-0.4),
      f(0.2),
      f(0.75),
      f(1.5),
      f(-0.9),
      f(0.4),
      0,
      0,
      0,
    ],
  };
  for (const dir of ["data", "adv_data"])
    for (const stem of ["Blokebl", "twolf"]) {
      const native = await loadNativePedAssets(
        assets,
        `PEDS/PEEPS/${stem}`,
        stem,
        dir,
      );
      for (const move of [30, 94]) {
        const p = instance(native, move),
          clock = { ...p.clock };
        synchronizeNativePedPhysicalPose(p, physical);
        assert.deepEqual(
          [...p.characterOrientation],
          captured[`${stem}:${move}`],
          `${dir}/${stem}/${move}`,
        );
        assert.deepEqual([...p.rootPose], physical.map(f));
        assert.deepEqual(p.clock, clock);
        assert.deepEqual(p.nativeCharacterVelocity, [11, 12, 13]);
      }
    }
});
