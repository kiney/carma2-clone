import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";
import {
  advanceNativePedPose,
  createNativePedInstance,
  selectNativePedMove,
} from "../src/ped-native-instance.ts";
import { stepPedRootPose } from "../src/ped-form.ts";
import { poseNativePedBones } from "../src/ped-bone-pose.ts";

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const spawn = [...identity.slice(0, 9), 10, 20, 30];
const f = Math.fround;

function close(actual, expected, epsilon = 1e-6) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) =>
    assert.ok(
      Math.abs(value - expected[index]) <= epsilon,
      `component ${index}: ${value} != ${expected[index]}`,
    ),
  );
}

function fixture(flags = 0) {
  const names = ["root", "child"],
    actors = names.map((name) => {
      const actor = new THREE.Group();
      actor.name = name;
      return actor;
    }),
    bones = names.map((name, index) => ({
      index,
      name,
      parent: index ? 0 : -1,
      massKg: index ? 10 : 20,
      mass: index ? 0.01 : 0.02,
      collisionType: "BOX",
      jointType: "NONE",
      actor: actors[index],
      attachments: index ? { child: [0, 0, 0], parent: [0, 0, 0] } : null,
      variants: [
        {
          identifier: `${name}0`,
          actor: null,
          modelBounds: new Map(),
          sourceModels: [],
        },
      ],
    })),
    frames = [
      [0, 0.2, 0.4],
      [0, 0.4, 0.8],
      [0, 0.6, 1.2],
      [0, 0.8, 1.6],
    ],
    matrices = new Float32Array(frames.length * names.length * 12);
  for (let frame = 0; frame < frames.length; frame++) {
    matrices.set(identity, frame * names.length * 12);
    matrices[frame * names.length * 12 + 9] = [0, 1, 4, 9][frame];
    const angle = frames[frame][1],
      c = Math.cos(angle),
      s = Math.sin(angle);
    // Authored root-local Y rotation; distinct child poses identify the source
    // frame consumed before the signed frame index moves backward.
    matrices.set(
      [c, 0, s, 0, 1, 0, -s, 0, c, 0, 0, 0],
      (frame * names.length + 1) * 12,
    );
  }
  const group = new THREE.Group();
  group.name = "synthetic animation";
  const motion = {
    bones: names.map((name) => ({ name, children: [] })),
    frameCount: frames.length,
    matrices,
  };
  const formMove = {
    id: 30,
    form: undefined,
    periodMs: 100,
    resetAxes: "",
    direction: [1, 0, 0],
    filename: "synthetic.BON",
    flags,
  };
  const move = {
    id: 30,
    form: formMove,
    personality: { scale: 2, groundingMode: -1, groundingOffset: 0 },
    motion,
  };
  const template = {
    group,
    form: {
      bones: names.map((name) => ({ name, children: [] })),
      moves: [formMove],
    },
    profile: {
      formName: "synthetic",
      rootName: "root",
      mass: 0.03,
      bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
      centreOfMass: [0, 0, 0],
      inertia: [1, 1, 1],
    },
    bones,
    moves: new Map([[30, move]]),
    inheritedActorMaterial: new THREE.MeshBasicMaterial(),
    scene: {},
  };
  bones.forEach((bone) => group.add(bone.actor));
  const ped = createNativePedInstance(template, { rootPose: spawn });
  assert.equal(
    selectNativePedMove(ped, 30, [1, 0, 0], [0, 1, 0], 1000).status,
    "complete",
  );
  return ped;
}

function expectedReverse(ped, requestedAdvance, flagClamp) {
  let frame = ped.clock.frame,
    pose = Float32Array.from(ped.rootPose),
    lastSourceFrame = frame,
    processedFrames = 0;
  const oldOrigin = [...pose.slice(9)],
    oldPeriod = ped.clock.periodMs;
  for (let step = 0; step < requestedAdvance; step++) {
    lastSourceFrame = frame;
    const next = stepPedRootPose(
      pose,
      ped.move.roots[frame],
      ped.characterOrientation,
      ped.movement,
      ped.move.asset.personality.scale,
    );
    // Native uses mode2 while more signed frames remain, then mode0 for the
    // last source frame so the full current-frame root basis is installed.
    if (step + 1 < requestedAdvance) next.set(pose.subarray(0, 9));
    pose = next;
    processedFrames++;
    frame--;
    if (frame < 0) {
      frame = flagClamp ? 0 : ped.move.roots.length - 1;
      if (flagClamp) break;
    }
  }
  const delta = [
    f(pose[9] - oldOrigin[0]),
    f(pose[10] - oldOrigin[1]),
    f(pose[11] - oldOrigin[2]),
  ];
  const velocity = delta.map((value) =>
    f(value / (-requestedAdvance * oldPeriod * 0.001)),
  );
  return { frame, pose, velocity, lastSourceFrame, processedFrames };
}

function assertFinalBonePose(ped, sourceFrame) {
  const expected = poseNativePedBones({
    bones: ped.poseBones,
    angles: ped.move.bones.frames[sourceFrame],
    rootPose: ped.rootPose,
    characterOrientation: ped.characterOrientation,
    currentPoses: ped.bones.map((bone) => bone.pose),
    removedBoneMask: ped.removedBoneMask,
    mode: 0,
    selectedMoveValid: true,
    renderAvailable: true,
    physicsActive: false,
    boned: false,
    temporaryMatricesAvailable: false,
    morphActive: false,
    mutantSpeed: 0,
  });
  assert.deepEqual(expected.requiredProviders, []);
  close(ped.bones[1].pose, expected.poses[1]);
}

test("single negative advance applies the current frame, then decrements and signs velocity", () => {
  const ped = fixture();
  ped.clock.frame = 3;
  ped.clock.fraction = 0.25;
  ped.completionRequested = true;
  let callbacks = 0;
  ped.onMoveCompleted = () => callbacks++;
  const expected = expectedReverse(ped, 1, false),
    result = advanceNativePedPose(ped, 900);
  assert.deepEqual(result.requiredProviders, []);
  assert.equal(result.processedFrames, expected.processedFrames);
  assert.equal(ped.clock.frame, expected.frame);
  assert.equal(ped.clock.fraction, 0.25);
  assert.equal(ped.clock.lastTimeMs, 900);
  close(ped.rootPose, expected.pose);
  close(ped.nativeCharacterVelocity, expected.velocity);
  assertFinalBonePose(ped, expected.lastSourceFrame);
  assert.equal(ped.completionRequested, true);
  assert.equal(callbacks, 0);
});

test("multi-frame negative advance preserves signed clock fraction and mode2-to-mode0 pose order", () => {
  const ped = fixture();
  ped.clock.frame = 3;
  ped.clock.fraction = 0.5;
  const expected = expectedReverse(ped, 2, false),
    result = advanceNativePedPose(ped, 800);
  assert.deepEqual(result.requiredProviders, []);
  assert.equal(result.processedFrames, expected.processedFrames);
  assert.equal(ped.clock.frame, expected.frame);
  assert.equal(ped.clock.fraction, 0.5);
  assert.equal(ped.clock.lastTimeMs, 800);
  close(ped.rootPose, expected.pose);
  close(ped.nativeCharacterVelocity, expected.velocity);
  assert.equal(ped.clock.frame, 1);
  assert.equal(expected.lastSourceFrame, 2);
  assertFinalBonePose(ped, 2);
});

for (const flags of [0, 1]) {
  test(`negative frame underflow follows authored flag bit0 (${flags})`, () => {
    const ped = fixture(flags);
    ped.clock.frame = 1;
    const expected = expectedReverse(ped, 2, !!(flags & 1)),
      result = advanceNativePedPose(ped, 800);
    assert.deepEqual(result.requiredProviders, []);
    assert.equal(result.processedFrames, expected.processedFrames);
    assert.equal(ped.clock.frame, expected.frame);
    assert.equal(expected.frame, flags & 1 ? 0 : 3);
    close(ped.rootPose, expected.pose);
    close(ped.nativeCharacterVelocity, expected.velocity);
    assertFinalBonePose(ped, expected.lastSourceFrame);
  });
}

test("bit0 underflow exit divides velocity by requested frames, not visited frames", () => {
  const ped = fixture(1);
  ped.clock.frame = 1;
  const expected = expectedReverse(ped, 3, true),
    result = advanceNativePedPose(ped, 700);
  assert.deepEqual(result.requiredProviders, []);
  assert.equal(result.processedFrames, 2);
  assert.equal(ped.clock.frame, 0);
  assert.equal(ped.clock.fraction, 0);
  assert.equal(ped.clock.lastTimeMs, 700);
  close(ped.rootPose, expected.pose);
  close(ped.nativeCharacterVelocity, expected.velocity);
});

test("positive completion callback stops a same-move batch and supplies the current period", () => {
  const ped = fixture();
  ped.clock.frame = 2;
  ped.completionRequested = true;
  let callbacks = 0;
  ped.onMoveCompleted = (instance, now) => {
    callbacks++;
    assert.equal(now, 1300);
    assert.equal(instance.completionRequested, false);
    instance.clock.periodMs = 50;
    return 1;
  };
  const result = advanceNativePedPose(ped, 1300);
  assert.deepEqual(result.requiredProviders, []);
  assert.equal(result.completedMove, true);
  assert.equal(result.processedFrames, 1);
  assert.equal(callbacks, 1);
  assert.equal(ped.clock.frame, 0);
  close(ped.rootPose.slice(9), [20, 20, 30]);
  close(ped.nativeCharacterVelocity, [66.66666412353516, 0, 0], 2e-6);
});

test("zero callback period reports non-finite velocity without committing it", () => {
  const ped = fixture();
  ped.clock.frame = 2;
  ped.completionRequested = true;
  ped.nativeCharacterVelocity.splice(0, 3, 7, 8, 9);
  ped.onMoveCompleted = (instance) => {
    instance.clock.periodMs = 0;
  };
  const result = advanceNativePedPose(ped, 1300);
  assert.deepEqual(result.requiredProviders, [
    "native-nonfinite-animation-velocity",
  ]);
  assert.equal(ped.clock.frame, 0);
  close(ped.rootPose.slice(9), [20, 20, 30]);
  assert.deepEqual(ped.nativeCharacterVelocity, [7, 8, 9]);
});

test("positive replay clamps on authored flag bit0 while ordinary playback ignores it", () => {
  const ordinary = fixture(1),
    replay = fixture(1);
  ordinary.clock.frame = 2;
  replay.clock.frame = 2;
  const normalResult = advanceNativePedPose(ordinary, 1300),
    replayResult = advanceNativePedPose(replay, 1300, {
      actionReplay: true,
      replayRate: 1,
    });
  assert.deepEqual(normalResult.requiredProviders, []);
  assert.deepEqual(replayResult.requiredProviders, []);
  assert.equal(normalResult.processedFrames, 3);
  assert.equal(ordinary.clock.frame, 1);
  close(ordinary.rootPose.slice(9), [24, 20, 30]);
  assert.equal(replayResult.processedFrames, 2);
  assert.equal(replay.clock.frame, 3);
  close(replay.rootPose.slice(9), [30, 20, 30]);
});

test("zero-advance passive visit updates the clock but retains current pose and velocity", () => {
  const ped = fixture();
  ped.rootPose.set([0, 1, 0, -1, 0, 0, 0, 0, 1, 42, 43, 44]);
  ped.bones[1].pose.set([0, 0, 1, 0, 1, 0, -1, 0, 0, 3, 4, 5]);
  ped.nativeCharacterVelocity.splice(0, 3, 1, 2, 3);
  const root = [...ped.rootPose],
    child = [...ped.bones[1].pose],
    result = advanceNativePedPose(ped, 1050);
  assert.deepEqual(result.requiredProviders, []);
  assert.equal(result.processedFrames, 0);
  assert.equal(ped.clock.frame, 0);
  assert.equal(ped.clock.fraction, 0.5);
  assert.deepEqual([...ped.rootPose], root);
  assert.deepEqual([...ped.bones[1].pose], child);
  assert.deepEqual(ped.nativeCharacterVelocity, [1, 2, 3]);
});

test("negative advance preserves active PHIL root and orientation while zeroing animated velocity", () => {
  const ped = fixture();
  ped.clock.frame = 3;
  ped.nativeCharacterVelocity.splice(0, 3, 7, -2, 5);
  const retainedOrientation = [...ped.characterOrientation];
  const physical = Float32Array.from([0, 0, 1, 0, 1, 0, -1, 0, 0, 40, 50, 60]);
  const result = advanceNativePedPose(ped, 900, {
    activeRootPose: physical,
  });
  assert.deepEqual(result.requiredProviders, []);
  assert.equal(result.processedFrames, 1);
  assert.deepEqual([...ped.rootPose], [...physical]);
  assert.deepEqual(ped.nativeCharacterVelocity, [-0, -0, -0]);
  assert.deepEqual([...ped.characterOrientation], retainedOrientation);
  assert.equal(ped.clock.frame, 2);
});

async function original(stem, dataRoot) {
  const store = await createAssetStore(
      new URL("../carma2_orig/", import.meta.url).pathname,
    ),
    assets = new Assets();
  assets.manifest = store.manifest;
  assets.lookup = new Map(
    store.manifest.map((entry) => [entry.path.toLowerCase(), entry.path]),
  );
  assets.bytes = async (path) => {
    const value = await store.read(path);
    if (!value) throw new Error(`Asset missing: ${path}`);
    return new Uint8Array(value);
  };
  return loadNativePedAssets(assets, `PEDS/PEEPS/${stem}`, stem, dataRoot);
}

test("installed Blokebl frame0 rewind matches the verified source capture", async (t) => {
  let template;
  try {
    template = await original("Blokebl", "data");
  } catch (error) {
    if (
      error?.code === "ENOENT" ||
      /Original installation/.test(String(error))
    ) {
      t.skip("Original installation unavailable");
      return;
    }
    throw error;
  }
  const ped = createNativePedInstance(template, { rootPose: spawn });
  assert.equal(
    selectNativePedMove(ped, 30, [1, 0, 0], [0, 1, 0], 331, {
      periodMs: 33,
    }).status,
    "complete",
  );
  ped.characterOrientation.set(identity);
  ped.movement.set(identity);
  const result = advanceNativePedPose(ped, 315);
  assert.deepEqual(result.requiredProviders, []);
  assert.equal(result.processedFrames, 1);
  assert.equal(ped.clock.frame, 29);
  assert.equal(ped.clock.fraction, 0.5151515007019043);
  assert.equal(ped.clock.lastTimeMs, 315);
  close(
    ped.rootPose.slice(9),
    [10.000452995300293, 19.998130798339844, 30.010194778442383],
    2e-7,
  );
  close(
    ped.nativeCharacterVelocity,
    [-0.013727130368351936, 0.05664247274398804, -0.30893269181251526],
    2e-7,
  );
});

for (const [dataRoot, stem] of [
  ["data", "Blokebl"],
  ["data", "Bandsman"],
  ["data", "twolf"],
  ["adv_data", "Blokebl"],
  ["adv_data", "Bandsman"],
]) {
  test(`original ${dataRoot}/${stem} source roots advance on negative clock steps`, async (t) => {
    let template;
    try {
      template = await original(stem, dataRoot);
    } catch (error) {
      if (
        error?.code === "ENOENT" ||
        /Original installation/.test(String(error))
      ) {
        t.skip("Original installation unavailable");
        return;
      }
      throw error;
    }
    const ped = createNativePedInstance(template, { rootPose: spawn });
    assert.equal(
      selectNativePedMove(ped, 30, [1, 0, 0], [0, 1, 0], 1000).status,
      "complete",
    );
    assert.ok(ped.move.roots.length > 2);
    ped.clock.frame = Math.min(2, ped.move.roots.length - 1);
    ped.clock.fraction = 0.25;
    const expected = expectedReverse(ped, 1, !!(ped.move.asset.form.flags & 1)),
      result = advanceNativePedPose(ped, 1000 - ped.clock.periodMs);
    assert.deepEqual(result.requiredProviders, []);
    assert.equal(result.processedFrames, 1);
    assert.equal(ped.clock.frame, expected.frame);
    close(ped.rootPose, expected.pose, 3e-5);
    close(ped.nativeCharacterVelocity, expected.velocity, 3e-5);
    assertFinalBonePose(ped, expected.lastSourceFrame);
  });
}
