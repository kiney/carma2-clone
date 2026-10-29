import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import * as THREE from "three";
import { createModelGeometry } from "../src/render-geometry.ts";
import {
  NativePedRenderEffects,
  nativePedPowerupScale,
  prepareNativePedVertexSampler,
} from "../src/ped-render-effects.ts";
import { NativeResourceArena } from "../src/native-resource-arena.ts";
import {
  createNativePedInstance,
  releaseNativePedActorSet,
  selectNativePedBoneModel,
} from "../src/ped-native-instance.ts";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";
import { prepareNativePedDeadModels } from "../src/ped-dead-models.ts";

const identity = () => Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
const model = (flags = 0x81) => ({
  name: "BODY.DAT",
  flags,
  positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 8, -9, 10]),
  uvs: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 0.5, 0.5]),
  materials: ["PERSON.MAT"],
  faces: [
    { indices: [0, 1, 2], material: 1, smoothing: 1, flags: 0 },
    { indices: [3, 1, 2], material: 1, smoothing: 1, flags: 0 },
  ],
});
function actor(raw = model(), options) {
  const object = new THREE.Group();
  object.name = raw.name;
  object.matrixAutoUpdate = false;
  const geometry = createModelGeometry(raw);
  if (options) geometry.userData.nativePedPreparedOptions = options;
  object.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  return object;
}
const geometry = (object) => object.children[0].geometry;
function fixture(headBone = 1) {
  const bones = [-1, 0, 1].map((parent, index) => {
    const object = actor();
    return {
      index,
      name: `bone${index}`,
      parent,
      mass: 1,
      massKg: 1000,
      collisionType: "BOX",
      jointType: "FALSE",
      powerupRemap: index === 2 ? [2, 0, 1] : null,
      attachments: index ? { child: [1, 2, 3], parent: [4, 5, 6] } : null,
      actor: object,
      variants: [
        {
          actor: object,
          identifier: "BODY.DAT",
          sourceModels: ["BODY.DAT"],
          modelBounds: new Map([
            [
              "BODY.DAT",
              new THREE.Box3(
                new THREE.Vector3(0, -9, 0),
                new THREE.Vector3(8, 1, 10),
              ),
            ],
          ]),
        },
      ],
    };
  });
  const movement = new Map([
    [0, { scale: 7, groundingMode: 0, groundingOffset: 2 }],
  ]);
  return {
    bones,
    group: new THREE.Group(),
    form: { bones, headBone, moves: [], nonHumanoid: false },
    profile: {
      formName: "test",
      rootName: "bone0",
      rootRemap: null,
      mass: 2,
      bounds: { min: [-1, -2, -3], max: [1, 2, 3] },
      centreOfMass: [1, 2, 3],
      radius: 3,
      inertia: [1, 2, 3],
      movement,
      attachmentsByBone: new Map(
        bones.filter((b) => b.attachments).map((b) => [b.name, b.attachments]),
      ),
      modelsByBone: new Map(),
      jumpHeight: 4,
    },
    moves: new Map(),
    scene: { materialArena: new NativeResourceArena() },
    dispose() {},
  };
}

test("powerup remaps assign input long/fat/deep into native model axes", () => {
  assert.deepEqual(nativePedPowerupScale([2, 3, 4], null), [2, 3, 4]);
  assert.deepEqual(nativePedPowerupScale([2, 3, 4], [2, 0, 1]), [3, 4, 2]);
  assert.deepEqual(nativePedPowerupScale([2, 3, 4], [3, 1, 2]), [-2, 3, 4]);
  assert.throws(() => nativePedPowerupScale([2, 3, 4], [0, 0, 1]), /remap/);
});

test("prepared pedestrian samples distinguish living DONT_WELD from welded dead MODEL", () => {
  const living = prepareNativePedVertexSampler(actor(model(0x81)));
  const dead = prepareNativePedVertexSampler(actor(model(0x80)));
  assert.equal(living.count, 4);
  assert.equal(dead.count, 3);
  assert.equal(living.welding, "dont-weld");
  assert.equal(dead.welding, "weld");
  assert.ok(
    !living.sourceVertexIndices.includes(4),
    "unused raw vertices are bounds, never prepared vertices",
  );
});

test("actual MAT pointer order and pivot precede inclusive contiguous group sampling", () => {
  const raw = model();
  raw.pivot = [0.25, 0.5, 0.75];
  raw.faces[1].material = 2;
  const object = actor(raw, {
    materialPointers: new Map([
      [1, 900],
      [2, 100],
    ]),
    materialPointerProvenance: "host-resource-addresses",
  });
  const sampler = prepareNativePedVertexSampler(object),
    out = new THREE.Vector3();
  assert.deepEqual(
    sampler.groups.map((g) => g.materialIndices),
    [[2], [1]],
  );
  assert.equal(sampler.firstGroupCount, 3);
  assert.equal(
    sampler.sampleVertex(sampler.firstGroupCount, out),
    true,
    "inclusive bound reaches the actual next group",
  );
  assert.deepEqual(out.toArray(), [-0.25, -0.5, -0.75]);
  assert.equal(
    sampler.sampleVertex(sampler.count, out),
    false,
    "never clamp an allocation overrun",
  );
  const corner = sampler.corners[0];
  geometry(object).getAttribute("position").setXYZ(corner, 10, 20, 30);
  assert.equal(sampler.sampleVertex(0, out), true);
  assert.deepEqual(out.toArray(), [9.75, 19.5, 29.25]);
  assert.throws(
    () => prepareNativePedVertexSampler(actor(raw)),
    /actual material pointer order/,
  );
});

test("one owned personality shares geometry across instances and scales only requested head geometry and anchors", () => {
  const original = fixture(),
    owner = new NativePedRenderEffects(original);
  const a = createNativePedInstance(owner.template, { rootPose: identity() }),
    b = createNativePedInstance(owner.template, { rootPose: identity() });
  const unbindA = owner.bind(a),
    unbindB = owner.bind(b);
  assert.equal(geometry(a.bones[1].model), geometry(b.bones[1].model));
  assert.notEqual(
    geometry(a.bones[1].model),
    geometry(original.bones[1].actor),
  );
  owner.setHeadScale(4);
  assert.equal(geometry(a.bones[0].model).userData.sourcePositions[3], 1);
  assert.equal(geometry(a.bones[1].model).userData.sourcePositions[3], 4);
  assert.equal(geometry(a.bones[2].model).userData.sourcePositions[3], 1);
  assert.deepEqual(a.poseBones[1].childAttachment, [4, 8, 12]);
  assert.deepEqual(a.poseBones[1].parentAttachment, [4, 5, 6]);
  assert.deepEqual(a.poseBones[2].parentAttachment, [16, 20, 24]);
  assert.equal(owner.template.profile.mass, 2);
  owner.setBodyScale([2, 3, 4]);
  assert.deepEqual(a.poseBones[2].childAttachment, [3, 8, 6]);
  assert.deepEqual(a.poseBones[2].parentAttachment, [32, 60, 96]);
  assert.equal(owner.template.profile.movement.get(0).groundingOffset, 4);
  assert.equal(
    owner.template.profile.movement.get(0).scale,
    7,
    "move translation scale does not change",
  );
  assert.equal(owner.template.profile.mass, 48);
  assert.deepEqual(owner.template.profile.bounds.max, [2, 6, 12]);
  assert.deepEqual(original.bones[1].attachments.child, [1, 2, 3]);
  assert.equal(
    geometry(original.bones[1].actor).userData.sourcePositions[3],
    1,
  );
  assert.equal(original.profile.mass, 2);
  owner.setHeadScale(1);
  owner.setBodyScale([1, 1, 1]);
  assert.deepEqual(a.poseBones[1].childAttachment, [1, 2, 3]);
  assert.equal(geometry(a.bones[1].model).userData.sourcePositions[3], 1);
  unbindA();
  unbindB();
  releaseNativePedActorSet(a, { isPhysicsReleased: () => true });
  releaseNativePedActorSet(b, { isPhysicsReleased: () => true });
  owner.dispose();
});

test("negative signed FORM head bone scales all bones without changing personality movement or mass", () => {
  const original = fixture(-1),
    owner = new NativePedRenderEffects(original);
  owner.setHeadScale(2);
  assert.equal(owner.template.profile.mass, 2);
  assert.equal(owner.template.profile.movement.get(0).groundingOffset, 2);
  for (const bone of owner.template.bones)
    assert.equal(geometry(bone.actor).userData.sourcePositions[3], 2);
  assert.deepEqual(owner.template.bones[1].attachments.parent, [8, 10, 12]);
  owner.dispose();
});

test("original Stock/Advanced living and blood MODEL sets retain exact prepared allocations and private scale ownership", async (t) => {
  const root =
    process.env.CARMA2_ROOT ??
    new URL("../carma2_orig/", import.meta.url).pathname;
  try {
    await access(root);
  } catch {
    t.skip("Original installation is unavailable");
    return;
  }
  const store = await createAssetStore(root),
    assets = new Assets();
  assets.manifest = store.manifest;
  assets.lookup = new Map(
    store.manifest.map((entry) => [entry.path.toLowerCase(), entry.path]),
  );
  assets.bytes = async (path) => {
    const bytes = await store.read(path);
    if (!bytes) throw new Error(`Missing ${path}`);
    return new Uint8Array(bytes);
  };
  for (const tree of ["data", "adv_data"])
    for (const stem of ["Blokebl", "Bandsman", "twolf"])
      await t.test(`${tree}/${stem}`, async () => {
        const original = await loadNativePedAssets(
          assets,
          `PEDS/PEEPS/${stem}`,
          stem,
          tree,
        );
        const dead = prepareNativePedDeadModels(stem, original, {
          nullFaceMaterial: () => original.inheritedActorMaterial,
        });
        const beforeArena = original.scene.materialArena.liveCount;
        const owner = new NativePedRenderEffects(original, dead);
        const secondOwner = new NativePedRenderEffects(original, dead);
        const instance = createNativePedInstance(owner.template, {
          rootPose: identity(),
          modelSet1: owner.modelSet1,
        });
        const unbind = owner.bind(instance);
        const sampled = [];
        for (const bone of owner.template.bones)
          for (const variant of bone.variants)
            if (variant.actor) {
              const sampler = prepareNativePedVertexSampler(variant.actor);
              assert.notEqual(
                sampler.materialOrder,
                "browser-first-approximation",
              );
              assert.equal(sampler.remainingMaterialOrder, "known-order");
              assert.ok(sampler.count > 0);
              sampled.push([variant.actor, sampler, sampler.corners.slice()]);
            }
        owner.setBodyScale([2, 3, 4]);
        for (const bone of owner.template.bones) {
          const ratio = nativePedPowerupScale(
            [2, 3, 4],
            bone.powerupRemap ?? null,
          );
          for (let p = 0; p < bone.variants.length; p++) {
            const copied = bone.variants[p].actor,
              source = original.bones[bone.index].variants[p].actor;
            if (!copied) continue;
            const live = geometry(copied).userData.sourcePositions,
              raw = geometry(source).userData.sourcePositions;
            for (let i = 0; i < live.length; i++)
              assert.equal(live[i], Math.fround(raw[i] * ratio[i % 3]));
          }
        }
        owner.setHeadScale(4);
        for (const [object, sampler, corners] of sampled) {
          assert.deepEqual(
            prepareNativePedVertexSampler(object).corners,
            corners,
            "POSITION update keeps initial prepared permutation",
          );
          const out = new THREE.Vector3();
          assert.equal(sampler.sampleVertex(0, out), true);
          assert.ok(out.toArray().every(Number.isFinite));
        }
        for (let index = 0; index < instance.bones.length; index++) {
          const selected = selectNativePedBoneModel(instance, index, 0, 1);
          assert.equal(selected.nativeModelReturn, 1);
          const deadSampler = prepareNativePedVertexSampler(
            instance.bones[index].model,
          );
          assert.equal(deadSampler.welding, "weld");
        }
        unbind();
        releaseNativePedActorSet(instance, { isPhysicsReleased: () => true });
        owner.dispose();
        assert.ok(
          original.scene.materialArena.liveCount > beforeArena,
          "another owner retains the same actual cloned MAT allocation",
        );
        assert.ok(
          prepareNativePedVertexSampler(secondOwner.modelSet1[0][0]).count > 0,
        );
        secondOwner.dispose();
        assert.equal(
          original.scene.materialArena.liveCount,
          beforeArena,
          "only owned MAT arena handles are freed",
        );
        dead.dispose();
        dead.materialRegistry.dispose();
        original.dispose();
      });
});
