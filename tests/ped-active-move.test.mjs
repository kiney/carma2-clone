import test from "node:test";
import assert from "node:assert/strict";
import { Group, Mesh, BoxGeometry, MeshBasicMaterial, Vector3 } from "three";
import {
  setNativeActivePedMove,
  nativeActivePedOrientation,
  createNativeActivePedMoveCallback,
} from "../src/physics/ped-active-move.ts";
import {
  createNativePedInstance,
  selectNativePedMove,
  advanceNativePedPose,
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
function active(template = fixture()) {
  const instance = createNativePedInstance(template, { rootPose: physical });
  assert.equal(
    selectNativePedMove(instance, 90, [0, 0, 1], [0, 1, 0], 100).status,
    "complete",
  );
  instance.physicsActive = true;
  instance.rootPose.set(physical);
  instance.clock = { frame: 2, fraction: 0.75, lastTimeMs: 1234, periodMs: 55 };
  return instance;
}
function request(instance, id, options = {}, extra = {}) {
  return setNativeActivePedMove({
    instance,
    rootPose: physical,
    id,
    timeMs: 4321,
    options,
    ...extra,
  });
}
function close(a, b, tolerance = 3e-6) {
  assert.equal(a.length, b.length);
  a.forEach((n, i) =>
    assert.ok(Math.abs(n - b[i]) <= tolerance, `${i}: ${n} != ${b[i]}`),
  );
}

test("installed capture: −1/same/new/forced/missing have different clock and callback semantics", () => {
  for (const retainRoot of [false, true]) {
    let instance = active(),
      callbacks = { flags: 1, queuedMoveIndex: 2 };
    assert.equal(
      request(
        instance,
        -1,
        { retainRoot },
        { speed: 66, callbackState: callbacks },
      ).nativeMoveReturn,
      1,
    );
    assert.deepEqual(instance.clock, {
      frame: 2,
      fraction: 0.75,
      lastTimeMs: 1234,
      periodMs: 66,
    });
    assert.deepEqual(callbacks, { flags: 1, queuedMoveIndex: 2 });
    instance = active();
    callbacks = { flags: 1, queuedMoveIndex: 2 };
    assert.equal(
      request(
        instance,
        90,
        { retainRoot, completionRequested: true },
        { speed: 66, callbackState: callbacks },
      ).nativeMoveReturn,
      1,
    );
    assert.deepEqual(instance.clock, {
      frame: 2,
      fraction: 0.75,
      lastTimeMs: 1234,
      periodMs: 66,
    });
    assert.deepEqual(callbacks, { flags: 3, queuedMoveIndex: -1 });
    instance = active();
    callbacks = { flags: 1, queuedMoveIndex: 2 };
    assert.equal(
      request(
        instance,
        0x4000005a,
        { retainRoot, completionRequested: true },
        { speed: 66, callbackState: callbacks },
      ).nativeMoveReturn,
      0,
    );
    assert.deepEqual(instance.clock, {
      frame: 0,
      fraction: 0,
      lastTimeMs: 0,
      periodMs: 66,
    });
    assert.deepEqual(callbacks, { flags: 2, queuedMoveIndex: -1 });
    instance = active();
    callbacks = { flags: 1, queuedMoveIndex: 2 };
    assert.equal(
      request(
        instance,
        94,
        { retainRoot, completionRequested: true },
        { speed: -2, callbackState: callbacks },
      ).nativeMoveReturn,
      0,
    );
    assert.deepEqual(instance.clock, {
      frame: 0,
      fraction: 0,
      lastTimeMs: 0,
      periodMs: 154,
    });
    assert.deepEqual(callbacks, { flags: 2, queuedMoveIndex: -1 });
    instance = active();
    callbacks = { flags: 1, queuedMoveIndex: 2 };
    assert.equal(
      request(
        instance,
        999,
        { retainRoot },
        { speed: 66, callbackState: callbacks },
      ).nativeMoveReturn,
      2,
    );
    assert.deepEqual(instance.clock, {
      frame: 2,
      fraction: 0.75,
      lastTimeMs: 1234,
      periodMs: 55,
    });
    assert.deepEqual(callbacks, { flags: 1, queuedMoveIndex: 2 });
  }
});
test("retained-root uses inverse new frame0, complete rotated physical basis, and no direction/velocity writes", () => {
  const instance = active(),
    oldDirection = instance.direction,
    oldUp = instance.groundNormal,
    oldMovement = instance.movement;
  instance.nativeCharacterVelocity.splice(0, 3, 2, 3, 4);
  const root = new Float32Array([0, 0, -1, 0, 1, 0, 1, 0, 0, 10, 20, 30]);
  const result = setNativeActivePedMove({
    instance,
    id: 94,
    timeMs: 0xffffffff,
    rootPose: root,
    options: { retainRoot: true },
  });
  assert.equal(result.status, "complete");
  assert.equal(result.poseMode, 3);
  assert.equal(result.directionIgnored, true);
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
  assert.equal(instance.direction, oldDirection);
  assert.equal(instance.groundNormal, oldUp);
  assert.equal(instance.movement, oldMovement);
  assert.deepEqual(instance.nativeCharacterVelocity, [2, 3, 4]);
  assert.equal(instance.physicsActive, true);
  assert.deepEqual(instance.bones[0].pose, root);
  assert.deepEqual(
    instance.bones[0].actor.matrix.elements.slice(12, 15),
    [10, 20, 30],
  );
});
test("new clock is stamped on next visit without advancing or reporting completion", () => {
  const instance = active();
  let completions = 0;
  request(instance, 94, {
    retainRoot: true,
    completionRequested: true,
    onMoveCompleted: () => completions++,
  });
  const first = advanceNativePedPose(instance, 9000, {
    activeRootPose: physical,
  });
  assert.equal(first.processedFrames, 0);
  assert.equal(instance.clock.lastTimeMs, 9000);
  assert.equal(completions, 0);
  const next = advanceNativePedPose(instance, 9077, {
    activeRootPose: physical,
  });
  assert.equal(next.processedFrames, 1);
  assert.equal(instance.clock.frame, 1);
  assert.equal(completions, 0);
});
test("ordinary active non-retain transition preserves orientation; newly grounded move needs explicit ACT writer", () => {
  const template = fixture();
  template.moves.get(94).personality.groundingMode = 0;
  let instance = active(template),
    oldMove = instance.move;
  assert.equal(request(instance, 94).status, "provider-required");
  assert.equal(instance.move, oldMove);
  const oldOrientation = instance.characterOrientation;
  let committed;
  const result = request(
    instance,
    94,
    { groundHeight: 8 },
    { writeGroundedRoot: (p) => (committed = p) },
  );
  assert.equal(result.status, "complete");
  assert.equal(result.poseMode, 0);
  assert.equal(instance.characterOrientation, oldOrientation);
  assert.equal(instance.rootPose[10], f(8 + 0.154));
  assert.deepEqual(committed, instance.rootPose);
  close(instance.bones[1].pose.slice(9), [10, f(9 + 0.154), 30]);
});
test("halted bit clears only after actual407b20 gate, no unconditional per-call reset", () => {
  const instance = active(),
    state = { flags: 7, queuedMoveIndex: 1 };
  instance.boned = true;
  instance.temporaryMatricesAvailable = false;
  const result = request(
    instance,
    94,
    { retainRoot: true, completionRequested: false },
    { callbackState: state },
  );
  assert.equal(result.status, "complete");
  assert.equal(result.haltedFlagCleared, false);
  assert.equal(state.flags, 5);
  assert.equal(state.queuedMoveIndex, -1);
  assert.equal(instance.clock.lastTimeMs, 0);
});
test("removed and physically detached ACTs keep their matrices during new move posing", () => {
  const instance = active(),
    bone = instance.bones[1];
  instance.removedBoneMask = 2;
  instance.detachedBoneMask = 2;
  bone.actor.matrix.makeTranslation(100, 200, 300);
  bone.actor.matrixAutoUpdate = false;
  const pose = bone.pose.slice(),
    matrix = bone.actor.matrix.clone();
  request(instance, 94, { retainRoot: true });
  assert.deepEqual(bone.pose, pose);
  assert.deepEqual(bone.actor.matrix, matrix);
});
test("host callback checks actual active PHIL state and preserves body pose/V/omega/quiet/policy", () => {
  const instance = active(),
    body = createNativePedBody({
      profile: instance.hullProfile,
      rootPose: physical,
      actor: instance.bones[0].actor,
      levelOut: 0,
    });
  body.headerState = 2;
  body.doNothing = false;
  body.state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), 0.65);
  body.state.velocity.set(2, 3, 4);
  body.state.angularVelocity.set(-1, 7, 8);
  const before = {
    position: body.state.position.clone(),
    orientation: body.state.orientation.clone(),
    velocity: body.state.velocity.clone(),
    omega: body.state.angularVelocity.clone(),
    flags: body.rigidFlags,
    quiet: body.quietState,
  };
  const callback = createNativeActivePedMoveCallback();
  const context = { instance, body, timeMs: 2000 };
  const result = callback(context, 94, [1, 0, 0], [1, 0, 0], {
    retainRoot: true,
  });
  assert.equal(result.status, "complete");
  assert.deepEqual(instance.rootPose, nativePedRootPose(body));
  assert.deepEqual(body.state.position, before.position);
  assert.deepEqual(body.state.orientation, before.orientation);
  assert.deepEqual(body.state.velocity, before.velocity);
  assert.deepEqual(body.state.angularVelocity, before.omega);
  assert.equal(body.rigidFlags, before.flags);
  assert.equal(body.quietState, before.quiet);
  assert.equal(body.headerState, 2);
  body.headerState = 1;
  assert.equal(
    callback(context, 96, [1, 0, 0], [0, 1, 0], {}).status,
    "provider-required",
  );
});
test("replay gate, signed16 periods, morph and numerical provider errors remain explicit", () => {
  const instance = active();
  assert.equal(
    request(instance, 94, {}, { replayMode: true }).replaySkipped,
    true,
  );
  assert.equal(instance.moveId, 90);
  assert.equal(
    request(
      instance,
      94,
      {},
      { replayMode: true, replayMutationsAllowed: true },
    ).status,
    "provider-required",
  );
  assert.equal(
    request(instance, 94, { morphDurationMs: 10 }).status,
    "provider-required",
  );
  assert.equal(request(instance, -1, {}, { speed: 65536 }).status, "complete");
  assert.equal(instance.clock.periodMs, 0);
  assert.equal(
    request(instance, -1, {}, { speed: 32768 }).status,
    "provider-required",
  );
  assert.equal(instance.clock.periodMs, 0);
  assert.throws(() => request(instance, -1, {}, { speed: NaN }), /speed/);
  assert.throws(
    () => request(instance, 94, {}, { rootPose: [1, 2] }),
    /native12/,
  );
  assert.throws(
    () => nativeActivePedOrientation(I, [...I.slice(0, 9), Infinity, 0, 0]),
    /finite/,
  );
});

test("original Stock/Advanced human and nonhumanoid BON90/94/96/97 transitions retain actual physical roots", async (t) => {
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
    store.manifest.map((entry) => [entry.path.toLowerCase(), entry.path]),
  );
  assets.bytes = async (path) => new Uint8Array(await store.read(path));
  let transitions = 0,
    dogs = 0;
  for (const tree of ["data", "adv_data"])
    for (const name of ["Blokebl", "Bandsman", "twolf"]) {
      const template = await loadNativePedAssets(
        assets,
        `PEDS/PEEPS/${name}`,
        name,
        tree,
      );
      // Ordinary30/40 exercise complete names; reactions below additionally
      // verify native zero allocations for the exact-name misses.
      const available = (name === "twolf" ? [30, 40] : [90, 94, 96, 97]).filter(
        (id) => template.moves.get(id)?.personality,
      );
      assert.ok(
        available.length >= 2,
        `${tree}/${name} provides native reaction/death transitions`,
      );
      const instance = createNativePedInstance(template, {
        rootPose: physical,
      });
      assert.equal(
        selectNativePedMove(instance, available[0], [0, 0, 1], [0, 1, 0], 100)
          .status,
        "complete",
      );
      instance.physicsActive = true;
      const root = new Float32Array([
        0, 0, -1, 0, 1, 0, 1, 0, 0, 1.25, 4.5, -3,
      ]);
      for (const id of available) {
        const result = setNativeActivePedMove({
          instance,
          rootPose: root,
          id,
          timeMs: 250,
          options: {
            retainRoot: true,
            restart: true,
            completionRequested: true,
          },
        });
        assert.equal(
          result.status,
          "complete",
          `${tree}/${name}/${id}: ${result.requiredProviders}`,
        );
        assert.deepEqual(instance.rootPose, root);
        assert.equal(instance.clock.lastTimeMs, 0);
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
        for (let i = 1; i < instance.bones.length; i++) {
          const anchor = instance.poseBones[i],
            transform = (p, v) =>
              v.map((_, j) =>
                f(v[0] * p[j] + v[1] * p[3 + j] + v[2] * p[6 + j] + p[9 + j]),
              );
          close(
            transform(instance.bones[i].pose, anchor.childAttachment),
            transform(
              instance.bones[anchor.parent].pose,
              anchor.parentAttachment,
            ),
            8e-6,
          );
        }
        transitions++;
        if (name === "twolf") dogs++;
      }
      if (name === "twolf")
        for (const id of [91, 93, 94]) {
          const reaction = setNativeActivePedMove({
            instance,
            rootPose: root,
            id,
            timeMs: 250,
            options: { retainRoot: true },
          });
          assert.equal(reaction.status, "complete");
          assert.equal(instance.moveId, id);
          assert.deepEqual(instance.rootPose, root);
          assert.equal(instance.clock.lastTimeMs, 0);
          if (id === 93)
            assert.ok(instance.characterOrientation.every((n) => n === 0));
        }
    }
  assert.equal(transitions, 20);
  assert.equal(dogs, 4);
});
