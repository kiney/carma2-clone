import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { buildPedRootMotion, pedRootMotionDirection } from "../src/ped-form.ts";
import { buildNativePedBoneMotion } from "../src/ped-bone-pose.ts";
import {
  createNativePedInstance,
  selectNativePedMove,
  advanceNativePedPose,
} from "../src/ped-native-instance.ts";
import { createNativeActivePedMoveCallback } from "../src/physics/ped-active-move.ts";
import {
  createNativePedBody,
  nativePedRootPose,
} from "../src/physics/ped-body.ts";
import { Assets } from "../src/content.ts";
import { createAssetStore } from "../server/assets.mjs";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
test("strict defaults remain bounds-checked; native exact-name misses preserve zero storage", () => {
  const motion = {
    bones: [{ name: "Bone01" }, { name: "Bone_NO2" }],
    frameCount: 2,
    matrices: new Float32Array([...I, ...I, ...I, ...I]),
  };
  assert.throws(
    () => buildPedRootMotion(motion, "Bone_01", "XYZ"),
    /invalid root motion/,
  );
  assert.throws(
    () => buildNativePedBoneMotion(motion, ["Bone_01", "Bone_N02"]),
    /missing animation bone/,
  );
  const root = buildPedRootMotion(motion, "Bone_01", "XYZ", {
    missingRoot: "native-zero",
  });
  assert.equal(root.length, 2);
  assert.ok(root.every((matrix) => matrix.every((n) => n === 0)));
  // Installed reset XYZ stores fchs(+0) into frame0 translation.
  assert.ok([9, 10, 11].every((i) => Object.is(root[0][i], -0)));
  const angles = buildNativePedBoneMotion(motion, ["Bone_01", "Bone_N02"], {
    missingBones: "native-zero",
  });
  assert.deepEqual(angles.boneNames, ["Bone_01", "Bone_N02"]);
  assert.deepEqual(
    angles.frames.map((frame) => Array.from(frame)),
    [Array(6).fill(0), Array(6).fill(0)],
  );
  assert.deepEqual(pedRootMotionDirection(root, [0, 0, 1], "XYZ"), {
    sourceDirection: [0, 0, 1],
    movementDirection: [0, 0, 0],
    stationary: true,
  });
  assert.throws(
    () =>
      buildPedRootMotion(
        { ...motion, matrices: new Float32Array(1) },
        "Bone_01",
        "XYZ",
        { missingRoot: "native-zero" },
      ),
    /invalid root motion/,
  );
  assert.throws(
    () =>
      buildNativePedBoneMotion({ ...motion, frameCount: 0 }, ["Bone_01"], {
        missingBones: "native-zero",
      }),
    /invalid animation/,
  );
  assert.throws(
    () =>
      buildNativePedBoneMotion(motion, ["Bone_01"], { missingBones: "alias" }),
    /invalid animation/,
  );
  assert.deepEqual(
    motion.bones.map((b) => b.name),
    ["Bone01", "Bone_NO2"],
  );
});

async function original(t) {
  let store;
  try {
    store = await createAssetStore(process.env.CARMA2_ROOT ?? "carma2_orig");
  } catch (error) {
    if (
      error.code === "ENOENT" ||
      /Original installation/.test(error.message)
    ) {
      t.skip("Original installation absent");
      return null;
    }
    throw error;
  }
  const assets = new Assets();
  assets.manifest = store.manifest;
  assets.lookup = new Map(
    store.manifest.map((e) => [e.path.toLowerCase(), e.path]),
  );
  assets.bytes = async (path) => new Uint8Array(await store.read(path));
  return assets;
}
test("original DOG1 reaction names stay literal and missing records become native zero allocations", async (t) => {
  const assets = await original(t);
  if (!assets) return;
  for (const tree of ["data", "adv_data"]) {
    const template = await loadNativePedAssets(
      assets,
      "PEDS/PEEPS/twolf",
      "twolf",
      tree,
    );
    const formNames = template.form.bones.map((b) => b.name),
      rootName = template.profile.rootName;
    assert.equal(rootName, "Bone_01");
    assert.equal(formNames[2], "Bone_N02");
    for (const id of [30, 91, 93, 94]) {
      const asset = template.moves.get(id),
        beforeNames = asset.motion.bones.map((b) => b.name),
        beforeMatrices = asset.motion.matrices.slice();
      const angles = buildNativePedBoneMotion(asset.motion, formNames, {
        missingBones: "native-zero",
      });
      const root = buildPedRootMotion(
        asset.motion,
        rootName,
        asset.form.resetAxes,
        { missingRoot: "native-zero" },
      );
      assert.equal(root.length, asset.motion.frameCount);
      assert.equal(angles.frames.length, asset.motion.frameCount);
      if (id !== 30) {
        assert.ok(beforeNames.includes("Bone_NO2"));
        assert.ok(!beforeNames.includes("Bone_N02"));
        for (const frame of angles.frames)
          assert.deepEqual(Array.from(frame.slice(6, 9)), [0, 0, 0]);
        const authoredTypo = buildNativePedBoneMotion(asset.motion, [
          "Bone_NO2",
        ]);
        assert.ok(
          authoredTypo.frames.some((frame) => frame.some((n) => n !== 0)),
          "Do not alias the nonzero authored NO2 angle records",
        );
      }
      if (id === 93) {
        assert.ok(beforeNames.includes("Bone01"));
        assert.ok(!beforeNames.includes("Bone_01"));
        assert.ok(root.every((matrix) => matrix.every((n) => n === 0)));
        assert.ok([9, 10, 11].every((i) => Object.is(root[0][i], -0)));
        for (const frame of angles.frames)
          assert.deepEqual(Array.from(frame.slice(0, 3)), [0, 0, 0]);
      } else
        assert.ok(
          root.some((matrix) => matrix.slice(0, 9).some((n) => n !== 0)),
        );
      assert.deepEqual(
        asset.motion.bones.map((b) => b.name),
        beforeNames,
      );
      assert.deepEqual(asset.motion.matrices, beforeMatrices);
    }
  }
});
test("actual Stock/Advanced dog and human active reactions preserve physical root/V/omega across native zero-record preparation", async (t) => {
  const assets = await original(t);
  if (!assets) return;
  const root = [...I.slice(0, 9), 1.25, 4.5, -3],
    hook = createNativeActivePedMoveCallback();
  let transitions = 0;
  for (const tree of ["data", "adv_data"])
    for (const name of ["twolf", "Blokebl", "Bandsman"]) {
      const template = await loadNativePedAssets(
          assets,
          `PEDS/PEEPS/${name}`,
          name,
          tree,
        ),
        instance = createNativePedInstance(template, { rootPose: root });
      assert.equal(
        selectNativePedMove(instance, 30, [0, 0, 1], [0, 1, 0], 100).status,
        "complete",
      );
      const body = createNativePedBody({
        profile: template.profile,
        rootPose: instance.rootPose,
        actor: instance.bones[0].actor,
        levelOut: 0,
      });
      body.headerState = 2;
      instance.physicsActive = true;
      body.state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), 0.3);
      body.state.velocity.set(0.1, 0.2, -0.3);
      body.state.angularVelocity.set(1, -2, 3);
      const physical = nativePedRootPose(body),
        position = body.state.position.clone(),
        orientation = body.state.orientation.clone(),
        velocity = body.state.velocity.clone(),
        omega = body.state.angularVelocity.clone();
      for (const id of name === "twolf" ? [91, 93, 94] : [90, 94, 96, 97]) {
        const result = hook(
          { instance, body, timeMs: 2000 },
          id,
          [1, 0, 0],
          [1, 0, 0],
          { retainRoot: true, restart: true },
        );
        assert.equal(
          result.status,
          "complete",
          `${tree}/${name}/${id}: ${result.requiredProviders}`,
        );
        assert.deepEqual(instance.rootPose, physical);
        assert.equal(instance.moveId, id);
        assert.equal(instance.clock.periodMs, 33);
        assert.deepEqual(body.state.position, position);
        assert.deepEqual(body.state.orientation, orientation);
        assert.deepEqual(body.state.velocity, velocity);
        assert.deepEqual(body.state.angularVelocity, omega);
        assert.ok(instance.bones.every((b) => b.pose.every(Number.isFinite)));
        if (name === "twolf" && id === 93) {
          assert.ok(instance.characterOrientation.every((n) => n === 0));
          assert.ok(
            instance.bones
              .slice(1)
              .every((b) => b.pose.slice(0, 9).every((n) => n === 0)),
            "Source unmatched root degenerates child animation basis, not the physical root",
          );
        }
        const advance = advanceNativePedPose(instance, 2033, {
          activeRootPose: physical,
        });
        assert.equal(advance.status, "complete");
        assert.deepEqual(instance.rootPose, physical);
        transitions++;
      }
    }
  assert.equal(transitions, 22);
});
