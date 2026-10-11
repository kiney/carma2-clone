import test from "node:test";
import assert from "node:assert/strict";
import { Group, Mesh, BoxGeometry, MeshBasicMaterial, Vector3 } from "three";
import {
  setNativePedRecoveryMove,
  createNativePedRecoveryMoveCallback,
} from "../src/ped-recovery-move.ts";
import {
  createNativePedInstance,
  selectNativePedMove,
  advanceNativePedPose,
  releaseNativePedActorSet,
} from "../src/ped-native-instance.ts";
import {
  createNativePedBody,
  nativePedRootPose,
} from "../src/physics/ped-body.ts";
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

function inactive(template = fixture()) {
  const instance = createNativePedInstance(template, { rootPose: physical });
  selectNativePedMove(instance, 90, [0, 0, 1], [0, 1, 0], 100);
  instance.rootPose.set(physical);
  instance.clock = { frame: 2, fraction: 0.75, lastTimeMs: 1234, periodMs: 55 };
  return instance;
}
function request(instance, id, extra = {}) {
  return setNativePedRecoveryMove({
    instance,
    id,
    rootPose: physical,
    timeMs: 4321,
    speed: 66,
    completion: true,
    retainRoot: true,
    ...extra,
  });
}
test("installed inactive captures: period-only, same, forced, changed and absent IDs", () => {
  for (const boned of [false, true]) {
    for (const [id, code, period, flags] of [
      [-1, 1, 66, 1],
      [90, 1, 66, 3],
      [0x4000005a, 0, 66, 2],
      [94, 0, 154, 2],
      [999, 2, 55, 1],
    ]) {
      const instance = inactive(),
        callbackState = { flags: 1, queuedMoveIndex: 2 };
      instance.boned = boned;
      instance.temporaryMatricesAvailable = false;
      const out = request(instance, id, {
        speed: id === 94 ? -2 : 66,
        callbackState,
      });
      assert.equal(out.nativeMoveReturn, code);
      assert.deepEqual(instance.clock, {
        frame: code === 0 ? 0 : 2,
        fraction: code === 0 ? 0 : 0.75,
        lastTimeMs: code === 0 ? 0 : 1234,
        periodMs: period,
      });
      assert.equal(callbackState.flags, flags);
      assert.equal(
        callbackState.queuedMoveIndex,
        id === -1 || id === 999 ? 2 : -1,
      );
      assert.deepEqual(instance.rootPose, new Float32Array(physical));
      assert.equal(instance.physicsActive, false);
      if (id === 94)
        assert.deepEqual(
          instance.characterOrientation,
          new Float32Array([0, 0, 1, 0, 1, 0, -1, 0, 0, 0, 0, 0]),
        );
      assert.equal(out.haltedFlagCleared, code === 0);
    }
  }
});
test("retained root uses full actual basis without direction, movement, model, V or ACT replacement", () => {
  const instance = inactive(),
    root = new Float32Array([0, 0, -1, 0, 1, 0, 1, 0, 0, 10, 20, 30]);
  const direction = instance.direction,
    up = instance.groundNormal,
    movement = instance.movement;
  const actors = instance.bones.map((b) => b.actor),
    models = instance.bones.map((b) => b.model);
  instance.nativeCharacterVelocity.splice(0, 3, 2, 3, 4);
  const out = request(instance, 94, { rootPose: root });
  assert.equal(out.poseMode, 3);
  assert.equal(out.directionIgnored, true);
  const frame = instance.move.roots[0],
    expected = new Float32Array(12);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      expected[i * 3 + j] = f(
        frame[i] * root[j] +
          frame[3 + i] * root[3 + j] +
          frame[6 + i] * root[6 + j],
      );
  assert.deepEqual(instance.characterOrientation, expected);
  assert.deepEqual(instance.rootPose, root);
  assert.equal(instance.direction, direction);
  assert.equal(instance.groundNormal, up);
  assert.equal(instance.movement, movement);
  assert.deepEqual(instance.nativeCharacterVelocity, [2, 3, 4]);
  instance.bones.forEach((b, i) => {
    assert.equal(b.actor, actors[i]);
    assert.equal(b.model, models[i]);
  });
  assert.deepEqual(
    instance.bones[0].actor.matrix.elements.slice(12, 15),
    [10, 20, 30],
  );
});
test("grounded retained move never queries ground or substitutes clearance", () => {
  const template = fixture();
  template.moves.get(94).personality.groundingMode = 0;
  const instance = inactive(template);
  assert.equal(request(instance, 94).status, "complete");
  assert.equal(instance.rootPose[10], 20);
});
test("new timestamp is zero and first ordinary animation visit only stamps it", () => {
  const instance = inactive();
  let completions = 0;
  const onMoveCompleted = () => completions++;
  request(instance, 94, { speed: -1, onMoveCompleted });
  assert.equal(instance.onMoveCompleted, onMoveCompleted);
  assert.equal(
    advanceNativePedPose(instance, 9000, { mode: 3 }).processedFrames,
    0,
  );
  assert.equal(instance.clock.lastTimeMs, 9000);
  assert.equal(completions, 0);
  assert.equal(
    advanceNativePedPose(instance, 9077, { mode: 3 }).processedFrames,
    1,
  );
  assert.equal(instance.clock.frame, 1);
  assert.equal(instance.physicsActive, false);
});
test("same concrete move updates completion and queue, without installing a new completion function", () => {
  const instance = inactive(),
    state = { flags: 7, queuedMoveIndex: 1 },
    original = () => {};
  instance.onMoveCompleted = original;
  request(instance, 90, {
    completion: false,
    callbackState: state,
    onMoveCompleted: () => {},
  });
  assert.equal(instance.completionRequested, false);
  assert.equal(instance.onMoveCompleted, original);
  assert.deepEqual(state, { flags: 5, queuedMoveIndex: -1 });
  assert.equal(instance.clock.lastTimeMs, 1234);
});
test("removed/vanished and physically detached actors retain their ownership and matrices", () => {
  const instance = inactive(),
    child = instance.bones[1];
  instance.removedBoneMask = 2;
  instance.detachedBoneMask = 2;
  child.actor.matrix.makeTranslation(100, 200, 300);
  child.actor.matrixAutoUpdate = false;
  const pose = child.pose.slice(),
    matrix = child.actor.matrix.clone();
  request(instance, 94);
  assert.deepEqual(child.pose, pose);
  assert.deepEqual(child.actor.matrix, matrix);
  assert.equal(instance.group.children.length, 2);
});
test("direct gameplay callback accepts inactive halt under header2 and leaves PHIL state untouched", () => {
  const instance = inactive(),
    body = createNativePedBody({
      profile: instance.hullProfile,
      rootPose: physical,
      actor: instance.bones[0].actor,
      levelOut: 0,
    });
  body.headerState = 2;
  body.state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), 0.65);
  body.state.velocity.set(2, 3, 4);
  body.state.angularVelocity.set(-1, 7, 8);
  const before = {
    position: body.state.position.clone(),
    orientation: body.state.orientation.clone(),
    V: body.state.velocity.clone(),
    omega: body.state.angularVelocity.clone(),
    flags: body.rigidFlags,
    quiet: body.quietState,
  };
  const state = { flags: 1, queuedMoveIndex: 2 },
    callback = createNativePedRecoveryMoveCallback({
      readCallbackState: () => state,
    });
  assert.equal(
    callback(
      { instance, body, timeMs: 2000 },
      { id: 94, speed: -1, completion: true, retainRoot: true },
    ).status,
    "complete",
  );
  assert.deepEqual(instance.rootPose, nativePedRootPose(body));
  assert.deepEqual(body.state.position, before.position);
  assert.deepEqual(body.state.orientation, before.orientation);
  assert.deepEqual(body.state.velocity, before.V);
  assert.deepEqual(body.state.angularVelocity, before.omega);
  assert.equal(body.rigidFlags, before.flags);
  assert.equal(body.quietState, before.quiet);
  assert.equal(body.headerState, 2);
  assert.equal(instance.physicsActive, false);
  assert.equal(state.flags, 2);
  body.actor = new Group();
  assert.equal(
    callback(
      { instance, body, timeMs: 2000 },
      { id: 96, speed: -1, completion: true, retainRoot: true },
    ).status,
    "provider-required",
  );
});
test("unsupported providers and invalid inputs do not partially select a move", () => {
  const instance = inactive(),
    original = instance.move;
  assert.equal(
    request(instance, 94, { retainRoot: false }).status,
    "provider-required",
  );
  assert.equal(instance.move, original);
  instance.morphActive = true;
  assert.equal(request(instance, 94).status, "provider-required");
  instance.morphActive = false;
  instance.physicsActive = true;
  assert.equal(request(instance, 94).status, "provider-required");
  instance.physicsActive = false;
  assert.equal(request(instance, 94, { replayMode: true }).replaySkipped, true);
  assert.equal(
    request(instance, 94, { replayMode: true, replayMutationsAllowed: true })
      .status,
    "provider-required",
  );
  assert.equal(
    request(instance, -1, { speed: 65536, retainRoot: false }).status,
    "complete",
  );
  assert.equal(instance.clock.periodMs, 0);
  assert.equal(
    request(instance, -1, { speed: 32768 }).status,
    "provider-required",
  );
  assert.equal(instance.clock.periodMs, 0);
  assert.throws(() => request(instance, 94, { speed: NaN }), /speed/);
  assert.throws(() => request(instance, 94, { rootPose: [1, 2] }), /native12/);
  assert.throws(
    () =>
      request(instance, 94, {
        callbackState: { flags: 256, queuedMoveIndex: 1 },
      }),
    /byte/,
  );
  releaseNativePedActorSet(instance, { isPhysicsReleased: () => true });
  assert.equal(
    request(instance, 94).requiredProviders[0],
    "native-render-actor-set-owner",
  );
});

test("original Stock/Advanced human93/94 and DOG1 zero-name root retain the actual ACT", async (t) => {
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
  assets.bytes = async (path) => new Uint8Array(await store.read(path));
  const root = new Float32Array([0, 0, -1, 0, 1, 0, 1, 0, 0, 1.25, 4.5, -3]);
  let count = 0;
  for (const tree of ["data", "adv_data"])
    for (const name of ["Blokebl", "Bandsman", "twolf"]) {
      const template = await loadNativePedAssets(
        assets,
        `PEDS/PEEPS/${name}`,
        name,
        tree,
      );
      const instance = createNativePedInstance(template, { rootPose: root });
      selectNativePedMove(instance, 30, [0, 0, 1], [0, 1, 0], 100);
      const actors = instance.bones.map((b) => b.actor);
      for (const id of [93, 94]) {
        const motion = template.moves.get(id).motion.matrices.slice();
        const out = request(instance, id, { rootPose: root, speed: -1 });
        assert.equal(
          out.status,
          "complete",
          `${tree}/${name}/${id}: ${out.requiredProviders}`,
        );
        assert.equal(instance.physicsActive, false);
        assert.equal(instance.clock.lastTimeMs, 0);
        assert.deepEqual(instance.rootPose, root);
        assert.deepEqual(template.moves.get(id).motion.matrices, motion);
        instance.bones.forEach((b, i) => assert.equal(b.actor, actors[i]));
        const frame = instance.move.roots[0],
          expected = new Float32Array(12);
        for (let i = 0; i < 3; i++)
          for (let j = 0; j < 3; j++)
            expected[i * 3 + j] = f(
              frame[i] * root[j] +
                frame[3 + i] * root[3 + j] +
                frame[6 + i] * root[6 + j],
            );
        assert.deepEqual(instance.characterOrientation, expected);
        if (name === "twolf" && id === 93)
          assert.ok(frame.every((n) => n === 0));
        count++;
      }
    }
  assert.equal(count, 12);
});
