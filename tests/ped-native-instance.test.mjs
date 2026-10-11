import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";
import {
  createNativePedInstance,
  selectNativePedMove,
  advanceNativePedPose,
  selectNativePedBoneModel,
  currentNativePedModel,
  releaseNativePedActorSet,
} from "../src/ped-native-instance.ts";
import { transformPedPoint, stepPedRootPose } from "../src/ped-form.ts";
import { nativePedAnglesToMatrix } from "../src/ped-bone-pose.ts";

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const spawn = [...identity.slice(0, 9), 10, 20, 30];
function close(a, b, epsilon = 2e-6) {
  assert.equal(a.length, b.length);
  a.forEach((n, i) =>
    assert.ok(Math.abs(n - b[i]) <= epsilon, `component${i}: ${n} != ${b[i]}`),
  );
}
function model(name, geometry, material) {
  const actor = new THREE.Group();
  actor.name = name;
  actor.add(new THREE.Mesh(geometry, material));
  return {
    identifier: name,
    actor,
    modelBounds: new Map(),
    sourceModels: [name],
  };
}
function fixture() {
  const geometry = new THREE.BoxGeometry(1, 2, 3),
    material = new THREE.MeshBasicMaterial(),
    names = ["root", "head", "child"],
    bones = names.map((name, i) => ({
      name,
      index: i,
      parent: i - 1,
      mass: i ? 0.01 : 0.02,
      massKg: i ? 10 : 20,
      collisionType: "BOX",
      jointType: "NONE",
      attachments: i ? { child: [0.25, 0, 0], parent: [0, 1, 0] } : null,
      variants: [
        model(`${name}0`, geometry, material),
        model(`${name}1`, geometry, material),
        {
          identifier: null,
          actor: null,
          modelBounds: new Map(),
          sourceModels: [],
        },
      ],
    }));
  bones.forEach((b) => {
    b.actor = b.variants[0].actor;
  });
  const group = new THREE.Group();
  bones.forEach((b) =>
    b.variants.forEach((v) => {
      if (v.actor) group.add(v.actor);
    }),
  );
  const motion = {
    bones: names.map((name) => ({ name, children: [] })),
    frameCount: 3,
    matrices: new Float32Array(3 * names.length * 12),
  };
  for (let frame = 0; frame < 3; frame++)
    for (let bone = 0; bone < names.length; bone++) {
      motion.matrices.set(identity, (frame * names.length + bone) * 12);
      if (!bone)
        motion.matrices[(frame * names.length + bone) * 12 + 9] = [0, 1, 4][
          frame
        ];
    }
  const move = {
    id: 30,
    form: {
      id: 30,
      periodMs: 100,
      resetAxes: "",
      direction: [1, 0, 0],
      filename: "fixture.BON",
      flags: 1,
    },
    personality: { scale: 2, groundingMode: 0, groundingOffset: 0.25 },
    motion,
  };
  return {
    group,
    bones,
    form: { bones, mass: 0.04, moves: [move.form] },
    profile: {
      formName: "BIPED1",
      rootName: "root",
      mass: 0.04,
      bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
      centreOfMass: [0, 0, 0],
      inertia: [1, 1, 1],
    },
    moves: new Map([[30, move]]),
  };
}
function initialized(template = fixture(), options = {}) {
  const ped = createNativePedInstance(template, {
    rootPose: spawn,
    ...options,
  });
  assert.equal(
    selectNativePedMove(ped, 30, [1, 0, 0], [0, 1, 0], 100).status,
    "complete",
  );
  return ped;
}
function actorSet(template) {
  const group = new THREE.Group();
  group.name = "shared FORM render slot";
  const actors = template.form.bones.map((bone) => {
    const actor = new THREE.Group();
    actor.name = bone.name;
    group.add(actor);
    return actor;
  });
  return { group, actors };
}
const released = { isPhysicsReleased: () => true };
function anchors(ped, epsilon = 3e-6) {
  for (let i = 1; i < ped.bones.length; i++) {
    const bone = ped.poseBones[i];
    if (
      ped.removedBoneMask & (2 ** i) ||
      ped.removedBoneMask & (2 ** bone.parent)
    )
      continue;
    close(
      transformPedPoint(ped.bones[i].pose, bone.childAttachment),
      transformPedPoint(ped.bones[bone.parent].pose, bone.parentAttachment),
      epsilon,
    );
  }
}

test("instances clone flat actors and own mutable state while borrowing mesh resources", () => {
  const template = fixture(),
    a = initialized(template),
    b = initialized(template);
  assert.notEqual(a.group, b.group);
  assert.notEqual(a.rootPose, b.rootPose);
  assert.equal(a.rootPose, a.bones[0].pose);
  assert.equal(a.group.children.length, 3);
  for (let i = 0; i < a.bones.length; i++) {
    assert.equal(a.bones[i].actor.parent, a.group);
    assert.notEqual(a.bones[i].actor, b.bones[i].actor);
    assert.equal(
      a.bones[i].model.children[0].geometry,
      template.bones[i].actor.children[0].geometry,
    );
    assert.equal(
      a.bones[i].model.children[0].material,
      template.bones[i].actor.children[0].material,
    );
    assert.equal(a.bones[i].actor.children.length, 1);
    assert.equal(a.bones[i].model.parent, a.bones[i].actor);
    assert.equal(a.bones[i].modelSets[0][1].parent, null);
  }
  a.removedBoneMask = 2;
  advanceNativePedPose(a, 200);
  assert.deepEqual([...b.rootPose], spawn);
  assert.equal(b.clock.frame, 0);
  assert.equal(b.removedBoneMask, 0);
  assert.equal(template.bones[0].actor.parent, template.group);
});
test("FORM slot reuses the same group and ACTs while rebinding personality models and independent roots", () => {
  const first = fixture(),
    second = fixture(),
    slot = actorSet(first);
  second.bones.forEach((bone) =>
    bone.variants.forEach((v) => {
      if (v.actor) v.actor.name += ":second";
    }),
  );
  const a = initialized(first, { actorSet: slot });
  assert.equal(a.group, slot.group);
  a.bones.forEach((b, i) => assert.equal(b.actor, slot.actors[i]));
  const bodyActor = a.bones[0].actor,
    models = a.bones.map((b) => b.model),
    oldRoot = [...a.rootPose];
  assert.throws(
    () => createNativePedInstance(second, { rootPose: spawn, actorSet: slot }),
    /still owned/,
  );
  assert.throws(
    () => releaseNativePedActorSet(a, { isPhysicsReleased: () => false }),
    /PHIL/,
  );
  assert.equal(a.bones[0].model, models[0]);
  const returned = releaseNativePedActorSet(a, released);
  assert.equal(returned.group, slot.group);
  returned.actors.forEach((actor, i) => assert.equal(actor, slot.actors[i]));
  models.forEach((model) => {
    assert.equal(model.parent, null);
    assert.equal(model.visible, false);
  });
  assert.equal(slot.group.visible, false);
  const b = createNativePedInstance(second, {
    rootPose: [...identity.slice(0, 9), 50, 60, 70],
    actorSet: slot,
  });
  assert.equal(b.bones[0].actor, bodyActor);
  assert.equal(b.group, a.group);
  assert.equal(b.group.children.length, 3);
  assert.notEqual(b.rootPose, a.rootPose);
  assert.deepEqual([...a.rootPose], oldRoot);
  assert.equal(b.bones[0].actor.children.length, 1);
  assert.equal(b.bones[0].model.name, "root0:second");
  const pose = [...bodyActor.matrix.elements],
    selected = b.bones[0].model;
  for (const r of [
    selectNativePedMove(a, 30, [1, 0, 0], [0, 1, 0], 200),
    advanceNativePedPose(a, 200),
    selectNativePedBoneModel(a, 0, 1, 0),
  ])
    assert.deepEqual(r.requiredProviders, ["native-render-actor-set-owner"]);
  assert.deepEqual(bodyActor.matrix.elements, pose);
  assert.equal(b.bones[0].model, selected);
  assert.throws(() => currentNativePedModel(a, 0), /released/);
  assert.throws(() => releaseNativePedActorSet(a, released), /released/);
});
test("reusable FORM actor validation rejects transforms, wrong bones, duplicates and bound contents", () => {
  const template = fixture();
  const create = (slot) =>
    createNativePedInstance(template, { rootPose: spawn, actorSet: slot });
  const translated = actorSet(template);
  translated.group.position.x = 1;
  assert.throws(() => create(translated), /identity/);
  const parented = actorSet(template),
    parent = new THREE.Group();
  parent.position.y = 3;
  parent.add(parented.group);
  assert.throws(() => create(parented), /identity/);
  const nan = actorSet(template);
  nan.group.matrixAutoUpdate = false;
  nan.group.matrix.elements[0] = NaN;
  assert.throws(() => create(nan), /finite identity/);
  const count = actorSet(template);
  count.actors.pop();
  assert.throws(() => create(count), /bone count/);
  const duplicate = actorSet(template);
  duplicate.actors[1] = duplicate.actors[0];
  assert.throws(() => create(duplicate), /duplicate/);
  const order = actorSet(template);
  [order.actors[0], order.actors[1]] = [order.actors[1], order.actors[0]];
  assert.throws(() => create(order), /name\/order/);
  const model = actorSet(template);
  model.actors[0].add(new THREE.Group());
  assert.throws(() => create(model), /model contents/);
  const childNaN = actorSet(template);
  childNaN.actors[1].position.x = NaN;
  assert.throws(() => create(childNaN), /finite matrices/);
  const foreign = actorSet(template);
  const a = create(foreign);
  releaseNativePedActorSet(a, released);
  const other = fixture();
  other.profile.formName = "BIPEDF";
  assert.throws(
    () =>
      createNativePedInstance(other, { rootPose: spawn, actorSet: foreign }),
    /different FORM/,
  );
});
test("released reusable ACTs retain source NULL/dead-set behavior and reject still-detached ownership", () => {
  const template = fixture(),
    slot = actorSet(template),
    set1 = template.bones.map((b) => b.variants.map((v) => v.actor));
  const a = initialized(template, { actorSet: slot, modelSet1: set1 });
  selectNativePedBoneModel(a, 1, 1, 1);
  const headActor = a.bones[1].actor,
    dead = a.bones[1].model;
  a.bones[1].modelSets[0] = [a.bones[1].modelSets[0][0], null, null];
  selectNativePedBoneModel(a, 1, -1, 0);
  assert.equal(a.bones[1].model, null);
  assert.equal(headActor.children.length, 0);
  assert.equal(dead.parent, null);
  const physicsOwner = new THREE.Group();
  physicsOwner.add(a.bones[0].actor);
  assert.throws(() => releaseNativePedActorSet(a, released), /detached bones/);
  slot.group.add(a.bones[0].actor);
  releaseNativePedActorSet(a, released);
  const b = initialized(template, { actorSet: slot, modelSet1: set1 });
  assert.equal(b.bones[1].actor, headActor);
  assert.equal(selectNativePedBoneModel(b, 1, 1, 1).nativeModelReturn, 1);
  const previous = b.bones[1].model;
  assert.equal(selectNativePedBoneModel(b, 1, 2, 0).nativeModelReturn, 0);
  assert.equal(b.bones[1].model, previous);
  assert.equal(b.group.children.length, b.bones.length);
});
test("nonuniform authored frame deltas accumulate individually across ordinary wrap", () => {
  const ped = initialized();
  assert.equal(advanceNativePedPose(ped, 200).processedFrames, 1);
  close(ped.rootPose.slice(9), [12, 20, 30]);
  close(ped.nativeCharacterVelocity, [20, 0, 0]);
  assert.equal(advanceNativePedPose(ped, 300).processedFrames, 1);
  close(ped.rootPose.slice(9), [18, 20, 30]);
  close(ped.nativeCharacterVelocity, [60, 0, 0]);
  advanceNativePedPose(ped, 400);
  assert.equal(ped.clock.frame, 0);
  close(ped.rootPose.slice(9), [20, 20, 30]);
  anchors(ped);
  const batch = initialized();
  assert.equal(advanceNativePedPose(batch, 400).processedFrames, 3);
  close(batch.rootPose, ped.rootPose);
  close(batch.nativeCharacterVelocity, [Math.fround(10 / 0.3), 0, 0]);
});
test("clock fractions, ten-frame cap, stopped period and movement-disabled basis ownership", () => {
  const ped = initialized();
  assert.equal(advanceNativePedPose(ped, 150).processedFrames, 0);
  assert.equal(ped.clock.fraction, 0.5);
  assert.equal(advanceNativePedPose(ped, 200).processedFrames, 1);
  assert.equal(advanceNativePedPose(ped, 9999).processedFrames, 10);
  selectNativePedMove(ped, 30, [1, 0, 0], [0, 1, 0], 9999, { periodMs: 0 });
  advanceNativePedPose(ped, 10000);
  close(ped.nativeCharacterVelocity, [0, 0, 0]);
  const still = initialized();
  still.movementDisabled = true;
  advanceNativePedPose(still, 300);
  close(still.rootPose.slice(9), spawn.slice(9));
  close(still.nativeCharacterVelocity, [0, 0, 0]);
});
test("same move turns the native root without resetting phase and grounds explicit source origin", () => {
  const ped = initialized();
  advanceNativePedPose(ped, 250);
  const frame = ped.clock.frame,
    fraction = ped.clock.fraction,
    origin = [...ped.rootPose.slice(9)];
  selectNativePedMove(ped, 30, [0, 0, 1], [0, 1, 0], 250);
  assert.equal(ped.clock.frame, frame);
  assert.equal(ped.clock.fraction, fraction);
  close(ped.rootPose.slice(9), origin);
  close(ped.rootPose.slice(0, 3), [0, 0, 1]);
  anchors(ped);
  advanceNativePedPose(ped, 300, { groundHeight: 4 });
  assert.equal(ped.rootPose[10], 4.25);
  assert.equal(ped.nativeCharacterVelocity[1], 0);
});
test("physical mode3 preserves full solver root and reparents ordinary children through anchors", () => {
  const ped = initialized(),
    rootIdentity = ped.rootPose;
  const physical = nativePedAnglesToMatrix([37, 53, 19]);
  physical.set([5, -2, 7], 9);
  const r = advanceNativePedPose(ped, 300, {
    activeRootPose: physical,
    activeWorldVelocity: [2, 3, 4],
    groundHeight: 100,
  });
  assert.equal(r.status, "complete");
  assert.equal(r.processedFrames, 2);
  assert.equal(ped.rootPose, rootIdentity);
  assert.deepEqual([...ped.rootPose], [...physical]);
  close(ped.nativeCharacterVelocity, [2, 3, 4]);
  anchors(ped);
  const frozen = [...ped.rootPose];
  assert.deepEqual(advanceNativePedPose(ped, 400).requiredProviders, [
    "native-active-root-pose-provider",
  ]);
  assert.deepEqual([...ped.rootPose], frozen);
  assert.equal(ped.clock.frame, 2);
  const rootWorld = ped.bones[0].actor.matrixWorld;
  close(
    new THREE.Vector3(1, 0, 0).applyMatrix4(rootWorld).toArray(),
    transformPedPoint(physical, [1, 0, 0]),
  );
});
test("native modes retain the selected root basis and child matrices", () => {
  const ped = initialized(),
    tilted = nativePedAnglesToMatrix([17, 23, 31]);
  ped.rootPose.set(tilted.subarray(0, 9));
  const children = ped.bones.slice(1).map((bone) => [...bone.pose]);
  advanceNativePedPose(ped, 200, { mode: 2 });
  close(ped.rootPose.slice(0, 9), tilted.slice(0, 9));
  close(ped.rootPose.slice(9), [12, 20, 30]);
  ped.bones
    .slice(1)
    .forEach((bone, i) => assert.deepEqual([...bone.pose], children[i]));
  const root = [...ped.rootPose];
  advanceNativePedPose(ped, 300, { mode: 3 });
  assert.deepEqual([...ped.rootPose], root);
  anchors(ped);
});
test("removed and immediate-parent masks freeze only the source selected child matrices", () => {
  const ped = initialized(),
    old = ped.bones.map((b) => [...b.pose]);
  ped.removedBoneMask = 2;
  advanceNativePedPose(ped, 300);
  assert.deepEqual([...ped.bones[1].pose], old[1]);
  assert.deepEqual([...ped.bones[2].pose], old[2]);
  assert.notDeepEqual([...ped.bones[0].pose], old[0]);
  assert.equal(ped.bones[1].actor.visible, true);
  ped.vanishedBoneMask = 2;
  advanceNativePedPose(ped, 350);
  assert.equal(ped.bones[1].actor.visible, false);
});
test("model variants change pointers and visibility without creating siblings or resizing hull", () => {
  const template = fixture(),
    set1 = template.bones.map((b) => b.variants.map((v) => v.actor)),
    ped = initialized(template, { modelSet1: set1 }),
    count = ped.group.children.length;
  const hull = ped.hullProfile,
    stableActors = ped.bones.map((bone) => bone.actor);
  assert.equal(selectNativePedBoneModel(ped, 1, 1, 0).status, "complete");
  assert.equal(currentNativePedModel(ped, 1).identifier, "head1");
  assert.equal(selectNativePedBoneModel(ped, 1, -1, 1).status, "complete");
  assert.equal(ped.bones[1].model, ped.bones[1].modelSets[1][1]);
  assert.equal(selectNativePedBoneModel(ped, 1, -1, 0).status, "complete");
  assert.equal(ped.group.children.length, count);
  assert.equal(ped.hullProfile, hull);
  for (const bone of ped.bones)
    assert.equal(bone.modelSets.flat().filter((a) => a?.visible).length, 1);
  const before = ped.bones[1].model;
  const knownNull = selectNativePedBoneModel(ped, 1, 2, 1);
  assert.equal(knownNull.status, "complete");
  assert.equal(knownNull.nativeModelReturn, 0);
  assert.equal(ped.modelSet, 1);
  assert.equal(ped.bones[1].model, before);
  // Previous actor is absent from the current set1: source inferred pose falls back0.
  selectNativePedBoneModel(ped, 1, -1, 0);
  assert.equal(ped.bones[1].poseIndex, 0);
  selectNativePedBoneModel(ped, 1, 1, 0);
  // Unlike explicit-pose NULL, native inferred-pose NULL assigns the pointer.
  ped.bones[1].modelSets[1] = [ped.bones[1].modelSets[1][0], null, null];
  assert.equal(selectNativePedBoneModel(ped, 1, -1, 1).nativeModelReturn, 1);
  assert.equal(ped.bones[1].model, null);
  assert.equal(ped.bones[1].actor.children.length, 0);
  assert.equal(currentNativePedModel(ped, 1).actor, stableActors[1]);
  assert.equal(currentNativePedModel(ped, 1).identifier, null);
  assert.equal(currentNativePedModel(ped, 1).modelBounds, null);
  assert.equal(
    ped.bones[1].modelSets.flat().filter((a) => a?.visible).length,
    0,
  );
  ped.bones.forEach((bone, i) => {
    assert.equal(bone.actor, stableActors[i]);
    assert.equal(bone.actor.parent, ped.group);
  });
  assert.equal(ped.group.children.length, ped.bones.length);
});
test("changing a detached model retains the registered ACT pose and physical owner", () => {
  const template = fixture(),
    set1 = template.bones.map((bone) => bone.variants.map((v) => v.actor)),
    ped = initialized(template, { modelSet1: set1 }),
    bone = ped.bones[0],
    actor = bone.actor,
    bodyOwner = new THREE.Group();
  bodyOwner.add(actor);
  ped.detachedBoneMask = 1;
  actor.matrix.makeTranslation(43, 47, 53);
  actor.updateMatrixWorld(true);
  const physical = [...actor.matrix.elements];
  assert.equal(selectNativePedBoneModel(ped, 0, 1, 1).nativeModelReturn, 1);
  assert.equal(bone.actor, actor);
  assert.equal(actor.parent, bodyOwner);
  assert.deepEqual(actor.matrix.elements, physical);
  assert.equal(actor.children.length, 1);
  assert.equal(actor.children[0], bone.modelSets[1][1]);
  advanceNativePedPose(ped, 200);
  assert.deepEqual(actor.matrix.elements, physical);
  assert.equal(bone.actor, actor);
  // Explicit NULL changes the source set byte without replacing the current model.
  const previousModel = bone.model;
  assert.equal(selectNativePedBoneModel(ped, 0, 2, 0).nativeModelReturn, 0);
  assert.equal(bone.model, previousModel);
  assert.equal(actor.parent, bodyOwner);
  assert.deepEqual(actor.matrix.elements, physical);
});
test("missing authored moves, modelset1 and transitions remain explicit", () => {
  const ped = initialized(),
    before = [...ped.rootPose];
  assert.equal(
    selectNativePedMove(ped, 99, [1, 0, 0], [0, 1, 0], 100).status,
    "provider-required",
  );
  assert.equal(
    selectNativePedMove(ped, 30, [1, 0, 0], [0, 1, 0], 100, {
      retainRoot: true,
    }).status,
    "provider-required",
  );
  assert.equal(
    selectNativePedMove(ped, 30, [1, 0, 0], [0, 1, 0], 100, {
      morphDurationMs: 10,
    }).status,
    "provider-required",
  );
  assert.deepEqual(selectNativePedBoneModel(ped, 0, 0, 1).requiredProviders, [
    "native-model-set1-provider",
  ]);
  assert.deepEqual([...ped.rootPose], before);
  assert.throws(() => selectNativePedBoneModel(ped, 0, 0, 0.5), /selection/);
  assert.throws(
    () => advanceNativePedPose(ped, 200, { activeRootPose: [NaN] }),
    /native12/,
  );
  assert.equal(ped.clock.frame, 0);
});
test("ordinary completion callback is explicit, ordered once and can select the next move", () => {
  const ped = initialized();
  ped.completionRequested = true;
  const before = [...ped.rootPose];
  assert.deepEqual(advanceNativePedPose(ped, 400).requiredProviders, [
    "native-move-completion-provider",
  ]);
  assert.equal(ped.clock.frame, 0);
  assert.deepEqual([...ped.rootPose], before);
  let count = 0;
  ped.onMoveCompleted = (instance, now) => {
    count++;
    assert.equal(now, 400);
    assert.equal(instance.clock.frame, 2);
    assert.equal(instance.completionRequested, false);
  };
  assert.equal(advanceNativePedPose(ped, 400).completedMove, true);
  advanceNativePedPose(ped, 700);
  assert.equal(count, 1);
  const template = fixture();
  template.moves.set(41, {
    ...template.moves.get(30),
    id: 41,
    form: { ...template.moves.get(30).form, id: 41 },
  });
  const next = initialized(template);
  next.completionRequested = true;
  next.onMoveCompleted = (instance, now) =>
    selectNativePedMove(instance, 41, [1, 0, 0], [0, 1, 0], now);
  const completed = advanceNativePedPose(next, 400);
  assert.equal(completed.completedMove, true);
  assert.equal(next.moveId, 41);
  assert.equal(next.clock.frame, 0);
  anchors(next);
});

async function original(stem, dataRoot = "data") {
  const store = await createAssetStore(
      new URL("../carma2_orig/", import.meta.url).pathname,
    ),
    assets = new Assets();
  assets.manifest = store.manifest;
  assets.lookup = new Map(
    store.manifest.map((entry) => [entry.path.toLowerCase(), entry.path]),
  );
  assets.bytes = async (path) => {
    const bytes = await store.read(path);
    if (!bytes) throw new Error(`Asset missing: ${path}`);
    return new Uint8Array(bytes);
  };
  return loadNativePedAssets(assets, `PEDS/PEEPS/${stem}`, stem, dataRoot);
}
for (const dataRoot of ["data", "adv_data"]) {
  test(`original ${dataRoot} Blokebl/Bandsman reuse one BIPED1 ACT set with personality attachments/models`, async (t) => {
    let aTemplate, bTemplate;
    try {
      aTemplate = await original("Blokebl", dataRoot);
      bTemplate = await original("Bandsman", dataRoot);
    } catch (e) {
      if (e?.code === "ENOENT" || /Original installation/.test(String(e))) {
        t.skip("Original installation unavailable");
        return;
      }
      throw e;
    }
    assert.equal(aTemplate.profile.formName, bTemplate.profile.formName);
    const slot = actorSet(aTemplate),
      a = createNativePedInstance(aTemplate, {
        rootPose: spawn,
        actorSet: slot,
      });
    selectNativePedMove(a, 30, [0, 0, 1], [0, 1, 0], 100);
    advanceNativePedPose(a, 100 + a.clock.periodMs);
    anchors(a);
    const models = a.bones.map((bone) => bone.model),
      oldRoot = [...a.rootPose],
      rootBodyReference = a.bones[0].actor;
    releaseNativePedActorSet(a, released);
    const b = createNativePedInstance(bTemplate, {
      rootPose: [...identity.slice(0, 9), 31, 23, 17],
      actorSet: slot,
    });
    selectNativePedMove(b, 30, [1, 0, 0], [0, 1, 0], 100);
    advanceNativePedPose(b, 100 + b.clock.periodMs);
    anchors(b);
    assert.equal(b.bones[0].actor, rootBodyReference);
    assert.equal(b.group, slot.group);
    assert.equal(b.group.children.length, 10);
    b.bones.forEach((bone, i) => {
      assert.equal(bone.actor, slot.actors[i]);
      assert.notEqual(bone.model, models[i]);
      if (models[i]) {
        assert.equal(models[i].parent, null);
        assert.equal(models[i].visible, false);
      }
    });
    assert.deepEqual([...a.rootPose], oldRoot);
    assert.notEqual(a.hullProfile, b.hullProfile);
    assert.equal(b.hullProfile, bTemplate.profile);
    const physical = nativePedAnglesToMatrix([21, 7, 43]);
    physical.set([4, 6, 8], 9);
    advanceNativePedPose(b, 100 + 2 * b.clock.periodMs, {
      activeRootPose: physical,
    });
    assert.deepEqual([...b.rootPose], [...physical]);
    assert.equal(b.bones[0].actor, rootBodyReference);
    anchors(b);
  });
}
for (const stem of ["Blokebl", "Bandsman", "twolf"]) {
  test(`original ${stem} flat models follow authored root motion and remapped attachment anchors`, async (t) => {
    let template;
    try {
      template = await original(stem);
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
      selectNativePedMove(ped, 30, [0, 0, 1], [0, 1, 0], 100).status,
      "complete",
    );
    assert.equal(ped.bones.length, stem === "twolf" ? 16 : 10);
    assert.equal(
      ped.hullProfile.mass,
      Math.fround(stem === "twolf" ? 0.047 : 0.068),
    );
    // Full authored root basis is deliberately different from quantized child/root Euler reconstruction.
    if (stem !== "twolf")
      assert.ok(Math.abs(ped.move.roots[0][0] - 0.014276) < 2e-6);
    anchors(ped);
    let expected = ped.rootPose.slice();
    for (let frame = 1; frame <= 4; frame++)
      expected = stepPedRootPose(
        expected,
        ped.move.roots[frame],
        ped.characterOrientation,
        ped.movement,
        ped.move.asset.personality.scale,
      );
    const r = advanceNativePedPose(ped, 100 + 4 * ped.clock.periodMs);
    assert.equal(r.processedFrames, 4);
    assert.deepEqual([...ped.rootPose], [...expected]);
    anchors(ped);
    const p = nativePedAnglesToMatrix([64, 7, 29]);
    p.set([3, 2, 1], 9);
    advanceNativePedPose(ped, 100 + 5 * ped.clock.periodMs, {
      activeRootPose: p,
      activeWorldVelocity: [0, -0.2, 0],
    });
    assert.deepEqual([...ped.rootPose], [...p]);
    anchors(ped);
    assert.equal(
      ped.group.children.filter((a) => a.visible).length,
      ped.bones.length,
    );
    const projected = new THREE.Vector3(0.03, 0.04, 0.05)
      .applyMatrix4(ped.bones[2].actor.matrixWorld)
      .toArray();
    close(projected, transformPedPoint(ped.bones[2].pose, [0.03, 0.04, 0.05]));
  });
}
