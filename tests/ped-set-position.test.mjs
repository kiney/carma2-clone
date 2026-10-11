import test from "node:test";
import assert from "node:assert/strict";
import { Group, Mesh, BoxGeometry, MeshBasicMaterial } from "three";
import { setNativePedPosition } from "../src/ped-set-position.ts";
import {
  createNativePedInstance,
  selectNativePedMove,
  releaseNativePedActorSet,
} from "../src/ped-native-instance.ts";
import { composePedRootPose, pedRootMotionDirection } from "../src/ped-form.ts";
import { Assets } from "../src/content.ts";
import { createAssetStore } from "../server/assets.mjs";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";
const f = Math.fround;
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const physical = [...I.slice(0, 9), 10, 20, 30];
function fixture() {
  const formBones = [
    {
      name: "ROOT",
      parent: -1,
      mass: 0.02,
      massKg: 20,
      collisionType: "BOX",
      jointType: "NONE",
      jointRecords: [],
    },
    {
      name: "HEAD",
      parent: 0,
      mass: 0.01,
      massKg: 10,
      collisionType: "SPHERE",
      jointType: "NONE",
      jointRecords: [],
    },
  ];
  const geometry = new BoxGeometry(),
    material = new MeshBasicMaterial();
  const bones = formBones.map((bone, index) => {
    const model = new Group();
    model.name = bone.name;
    model.add(new Mesh(geometry, material));
    return {
      ...bone,
      index,
      actor: model,
      attachments: index ? { child: [0, 0, 0], parent: [0, 1, 0] } : null,
      variants: [
        {
          identifier: bone.name,
          actor: model,
          modelBounds: new Map(),
          sourceModels: [bone.name],
        },
      ],
    };
  });
  const moves = new Map(
    [90, 94, 96, 97].map((id) => {
      const matrices = new Float32Array(3 * 2 * 12);
      for (let frame = 0; frame < 3; frame++)
        for (let bone = 0; bone < 2; bone++)
          matrices.set(I, (frame * 2 + bone) * 12);
      if (id === 94)
        for (let frame = 0; frame < 3; frame++) {
          // Exporter rotation aboutZ becomes native rotation aboutY.
          matrices.set([0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0], frame * 24);
        }
      const form = {
        id,
        periodMs: id === 94 ? 77 : 33,
        resetAxes: "",
        direction: [0, 0, 1],
        filename: `synthetic-${id}.BON`,
        flags: 0,
      };
      return [
        id,
        {
          id,
          form,
          personality: {
            scale: 0.35,
            groundingMode: -1,
            groundingOffset: 0.154,
          },
          motion: {
            bones: formBones.map(({ name }) => ({ name })),
            frameCount: 3,
            matrices,
          },
        },
      ];
    }),
  );
  return {
    group: new Group(),
    bones,
    form: {
      bones: formBones,
      moves: [...moves.values()].map((m) => m.form),
      mass: 0.03,
    },
    profile: {
      formName: "fixture",
      rootName: "ROOT",
      mass: 0.03,
      bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
      centreOfMass: [0, 0, 0],
      inertia: [1, 1, 1],
    },
    moves,
  };
}

function instanceFor(resetAxes = "YZ", frame = 2) {
  const template = fixture(),
    asset = template.moves.get(90);
  asset.form.resetAxes = resetAxes;
  asset.personality.groundingOffset = 0.2;
  //Exporter absolute coordinates -> native delta1(.25,.5,.75),delta2(1,2,3).
  asset.motion.matrices.set([0.25, -0.75, 0.5], 24 + 9);
  asset.motion.matrices.set([1.25, -3.75, 2.5], 48 + 9);
  const instance = createNativePedInstance(template, { rootPose: physical });
  selectNativePedMove(instance, 90, [0, 0, 1], [0, 1, 0], 100);
  instance.clock = { frame, fraction: 0.75, lastTimeMs: 1234, periodMs: 55 };
  instance.rootPose.set(physical);
  return instance;
}
function place(instance, extra = {}) {
  return setNativePedPosition({
    instance,
    groundPoint: [4, 5, 6],
    physicsFlags: 0,
    ...extra,
  });
}
test("installed mode1 reset-axis captures: all masks and three integral frames", () => {
  for (let frame = 0; frame < 3; frame++)
    for (let mask = 0; mask < 8; mask++) {
      const axes = ["X", "Y", "Z"].filter((_, i) => mask & (1 << i)).join("");
      const instance = instanceFor(axes, frame),
        out = place(instance);
      assert.equal(out.status, "complete");
      const sums =
        frame === 2
          ? [1.25, 2.5, 3.75]
          : frame === 1
            ? [0.25, 0.5, 0.75]
            : [0, 0, 0];
      //ReadMove marks X-reset moves stationary; no correction in that branch.
      const target = [4, f(5 + f(0.2)), 6];
      for (let i = 0; i < 3; i++)
        if (!(mask & 1) && mask & (1 << i))
          target[i] = f(target[i] + sums[i] * f(0.35));
      assert.deepEqual(
        Array.from(instance.rootPose.slice(9)),
        target,
        `${axes}/${frame}`,
      );
      assert.deepEqual(instance.clock, {
        frame,
        fraction: 0.75,
        lastTimeMs: 1234,
        periodMs: 55,
      });
    }
});
test("phase correction is world-axis, then current frame basis poses without delta movement", () => {
  const instance = instanceFor();
  instance.characterOrientation = new Float32Array([
    0, 0, -1, 0, 1, 0, 1, 0, 0, 0, 0, 0,
  ]);
  instance.movement = new Float32Array([0, 0, 1, 0, 1, 0, -1, 0, 0, 0, 0, 0]);
  instance.nativeCharacterVelocity.splice(0, 3, 2, 3, 4);
  const movement = instance.movement,
    orientation = instance.characterOrientation,
    direction = instance.direction,
    up = instance.groundNormal;
  place(instance);
  assert.deepEqual(Array.from(instance.rootPose.slice(9)), [
    4,
    f(f(5 + f(0.2)) + 2.5 * f(0.35)),
    f(6 + 3.75 * f(0.35)),
  ]);
  assert.deepEqual(
    instance.rootPose,
    composePedRootPose(
      instance.move.roots[2],
      orientation,
      instance.rootPose.slice(9),
    ),
  );
  assert.equal(instance.characterOrientation, orientation);
  assert.equal(instance.movement, movement);
  assert.equal(instance.direction, direction);
  assert.equal(instance.groundNormal, up);
  assert.deepEqual(instance.nativeCharacterVelocity, [2, 3, 4]);
});
test("passive full-matrix notification occurs before current-frame re-pose", () => {
  const instance = instanceFor(),
    state = { flags: 7, queuedMoveIndex: 2 },
    before = instance.rootPose.slice(0, 9);
  instance.characterOrientation = new Float32Array([
    0, 0, -1, 0, 1, 0, 1, 0, 0, 0, 0, 0,
  ]);
  let copy;
  const out = place(instance, {
    physicsFlags: 1,
    callbackState: state,
    writePassiveMatrix: (p) => {
      copy = p;
      assert.deepEqual(instance.rootPose, p);
      assert.deepEqual(p.slice(0, 9), before);
      assert.equal(state.flags, 7);
    },
  });
  assert.equal(out.physicsMatrixWritten, true);
  assert.equal(out.haltedFlagCleared, true);
  assert.equal(state.flags, 6);
  assert.equal(state.queuedMoveIndex, 2);
  assert.notDeepEqual(instance.rootPose.slice(0, 9), copy.slice(0, 9));
  assert.deepEqual(instance.rootPose.slice(9), copy.slice(9));
});
test("inactive boned/no-temp still poses; detached and removed child ACTs are retained", () => {
  const instance = instanceFor(),
    state = { flags: 1, queuedMoveIndex: 0 },
    child = instance.bones[1];
  instance.boned = true;
  instance.temporaryMatricesAvailable = false;
  instance.removedBoneMask = 2;
  instance.detachedBoneMask = 2;
  child.actor.matrix.makeTranslation(100, 200, 300);
  child.actor.matrixAutoUpdate = false;
  const pose = child.pose.slice(),
    matrix = child.actor.matrix.clone();
  assert.equal(
    place(instance, { physicsFlags: 2, callbackState: state }).status,
    "complete",
  );
  assert.equal(state.flags, 0);
  assert.deepEqual(child.pose, pose);
  assert.deepEqual(child.actor.matrix, matrix);
  assert.equal(instance.physicsActive, false);
});
test("source active no-op and unavailable ownership/provider leave pose and clock untouched", () => {
  const instance = instanceFor(),
    root = instance.rootPose.slice(),
    clock = { ...instance.clock };
  instance.physicsActive = true;
  assert.equal(place(instance, { physicsFlags: 5 }).positionIgnored, true);
  assert.deepEqual(instance.rootPose, root);
  assert.deepEqual(instance.clock, clock);
  assert.equal(
    place(instance, { physicsFlags: 5, replayMode: true }).status,
    "provider-required",
  );
  instance.physicsActive = false;
  assert.equal(
    place(instance, { physicsFlags: 1 }).requiredProviders[0],
    "native-passive-position-matrix-owner",
  );
  instance.morphActive = true;
  assert.equal(place(instance).status, "provider-required");
  instance.morphActive = false;
  assert.throws(() => place(instance, { groundPoint: [NaN, 0, 0] }), /finite/);
  releaseNativePedActorSet(instance, { isPhysicsReleased: () => true });
  assert.equal(
    place(instance).requiredProviders[0],
    "native-render-actor-set-owner",
  );
});
test("original humans and DOG1 nonzero BON frames preserve the clock and source model identity", async (t) => {
  let store;
  try {
    store = await createAssetStore(process.env.CARMA2_ROOT ?? "carma2_orig");
  } catch (error) {
    if (
      error.code === "ENOENT" ||
      /Original installation/.test(error.message)
    ) {
      t.skip("Original installation absent");
      return;
    }
    throw error;
  }
  const assets = new Assets();
  assets.manifest = store.manifest;
  assets.lookup = new Map(
    store.manifest.map((e) => [e.path.toLowerCase(), e.path]),
  );
  assets.bytes = async (p) => new Uint8Array(await store.read(p));
  let cases = 0;
  for (const tree of ["data", "adv_data"])
    for (const name of ["Blokebl", "Bandsman", "twolf"]) {
      const template = await loadNativePedAssets(
        assets,
        `PEDS/PEEPS/${name}`,
        name,
        tree,
      );
      for (const id of [30, 40, 93, 94].filter(
        (id) => template.moves.get(id)?.personality,
      )) {
        const instance = createNativePedInstance(template, {
          rootPose: physical,
        });
        selectNativePedMove(instance, id, [0, 0, 1], [0, 1, 0], 100);
        const actors = instance.bones.map((b) => b.actor),
          models = instance.bones.map((b) => b.model);
        for (const frame of [
          1,
          Math.floor(instance.move.roots.length / 2),
          instance.move.roots.length - 1,
        ].filter((i) => i < instance.move.roots.length)) {
          instance.clock = {
            frame,
            fraction: 0.37,
            lastTimeMs: 1371,
            periodMs: instance.move.asset.form.periodMs,
          };
          const clock = { ...instance.clock },
            O = instance.characterOrientation,
            movement = instance.movement;
          let copied;
          const out = place(instance, {
            physicsFlags: 1,
            writePassiveMatrix: (p) => (copied = p),
          });
          assert.equal(
            out.status,
            "complete",
            `${tree}/${name}/${id}/${frame}`,
          );
          assert.deepEqual(instance.clock, clock);
          assert.equal(instance.characterOrientation, O);
          assert.equal(instance.movement, movement);
          assert.deepEqual(instance.rootPose.slice(9), copied.slice(9));
          instance.bones.forEach((b, i) => {
            assert.equal(b.actor, actors[i]);
            assert.equal(b.model, models[i]);
          });
          assert.equal(instance.physicsActive, false);
          cases++;
        }
      }
    }
  assert.equal(cases, 72);
});
