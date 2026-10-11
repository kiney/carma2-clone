import test from "node:test";
import assert from "node:assert/strict";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";
import { parsePedBloodSettings } from "../src/ped-blood.ts";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";
import { prepareNativePedDeadModels } from "../src/ped-dead-models.ts";
import {
  createNativePedInstance,
  selectNativePedBoneModel,
} from "../src/ped-native-instance.ts";
import { queueNativePedCorpseSlick } from "../src/ped-slick.ts";
import { OilRuntime } from "../src/physics/oil.ts";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
} from "three";

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
const sourcePositions = new Float32Array([-1, -2, -3, 2, 3, 4]);
function modelActor(
  name = "root-model",
  positions = sourcePositions,
  flags = 0,
) {
  const actor = new Group(),
    model = new Group(),
    buffer = new BufferGeometry();
  buffer.setAttribute("position", new Float32BufferAttribute(positions, 3));
  buffer.userData.sourcePositions = positions;
  buffer.userData.modelFlags = flags;
  const mesh = new Mesh(buffer, new MeshBasicMaterial());
  mesh.name = name;
  model.name = name;
  model.add(mesh);
  actor.add(model);
  actor.matrixAutoUpdate = false;
  model.matrixAutoUpdate = false;
  model.matrix.identity();
  return { actor, model, mesh };
}
function hostFixture(options = {}) {
  let draws = 0;
  const oil = new OilRuntime({ random: () => (draws++, 0.5) }),
    scene = new Group(),
    root = modelActor(),
    instance = {
      group: scene,
      bones: [{ actor: root.actor, model: root.model }],
    };
  scene.add(root.actor);
  const allocation = {
    phase: "owned",
    renderSlot: 0,
    render: { instance, actorSet: { actors: [root.actor] } },
  };
  return {
    oil,
    allocation,
    slick: { ...slick },
    materials: new Map([
      ["gibslick", new MeshBasicMaterial()],
      ["gibsmear", new MeshBasicMaterial()],
    ]),
    timeMs: 100,
    root,
    instance,
    get draws() {
      return draws;
    },
    ...options,
  };
}

test("native corpse slick retains selected MODEL bounds, follows root ACT, and uses exactly shared queue draws", () => {
  const host = hostFixture(),
    result = queueNativePedCorpseSlick(host);
  assert.equal(result.status, "queued");
  if (result.status !== "queued") return;
  const spill = result.spill;
  assert.equal(host.draws, 2);
  assert.equal(spill.source?.identity, host.root.actor);
  assert.deepEqual(spill.source?.readModelBounds().min.toArray(), [-1, -2, -3]);
  host.root.actor.matrix.makeTranslation(10, 20, 30);
  host.root.actor.matrixWorldNeedsUpdate = true;
  host.root.model.removeFromParent();
  const replacement = modelActor("replacement", new Float32Array([90, 90, 90]));
  host.instance.bones[0].model = replacement.model;
  assert.deepEqual(spill.source?.readModelBounds().min.toArray(), [-1, -2, -3]);
  assert.deepEqual(spill.source?.readPosition().toArray(), [10, 20, 30]);
  // The retained original MODEL remains live even after ACT.model replacement.
  host.root.mesh.geometry.userData.sourcePositions = new Float32Array([
    -4, -5, -6, 2, 3, 4,
  ]);
  assert.deepEqual(spill.source?.readModelBounds().min.toArray(), [-4, -5, -6]);
  assert.deepEqual(host.instance.bones[0].model, replacement.model);
  assert.equal(host.oil.spills.filter(Boolean).length, 1);
  host.oil.dispose();
});

test("native slick uses the shared 32-slot oil pool and accepts zero-friction config without smear fields", () => {
  const host = hostFixture({
    slick: {
      ...slick,
      friction: [0, 0],
      smearDistance: null,
      smearMaterial: null,
    },
    materials: new Map([["gibslick", new MeshBasicMaterial()]]),
  });
  const queued = queueNativePedCorpseSlick(host);
  assert.equal(queued.status, "queued");
  assert.equal(host.oil.spills.filter(Boolean).length, 1);
  if (queued.status === "queued") {
    assert.deepEqual(queued.spill.friction, [0, 0]);
    assert.deepEqual(queued.spill.smearDistance, [0, 0]);
    assert.equal(queued.spill.smearMaterial, null);
  }
  assert.equal(host.draws, 2);
  host.oil.dispose();
});

test("a pending native spill follows reused ACT identity while retaining the separately queued MODEL", () => {
  const host = hostFixture(),
    queued = queueNativePedCorpseSlick(host);
  assert.equal(queued.status, "queued");
  if (queued.status !== "queued") return;
  // CharacterNoLongerRenderable frees occupancy, not the preallocated FORM ACT.
  host.root.actor.removeFromParent();
  host.root.model.removeFromParent();
  const newInstance = new Group();
  newInstance.add(host.root.actor);
  const replacement = modelActor("next-occupant", new Float32Array([7, 8, 9]));
  host.root.actor.add(replacement.model);
  host.root.actor.matrix.makeTranslation(30, 0, 40);
  host.root.actor.matrixWorldNeedsUpdate = true;
  assert.equal(queued.spill.source.identity, host.root.actor);
  assert.deepEqual(queued.spill.source.readPosition().toArray(), [30, 0, 40]);
  assert.deepEqual(
    queued.spill.source.readModelBounds().min.toArray(),
    [-1, -2, -3],
  );
  assert.equal(host.draws, 2);
  host.oil.dispose();
});

test("native corpse slick reports absent render/MODEL/material/custom-bounds providers", () => {
  const host = hostFixture();
  assert.deepEqual(
    queueNativePedCorpseSlick({ ...host, allocation: null }).requiredProviders,
    ["source-current-ped-render-allocation"],
  );
  assert.deepEqual(
    queueNativePedCorpseSlick({
      ...host,
      allocation: { ...host.allocation, renderSlot: -1 },
    }).requiredProviders,
    ["source-current-ped-render-slot"],
  );
  assert.deepEqual(
    queueNativePedCorpseSlick({
      ...host,
      allocation: {
        ...host.allocation,
        render: { ...host.allocation.render, instance: null },
      },
    }).requiredProviders,
    ["source-current-ped-root-ACT"],
  );
  assert.deepEqual(
    queueNativePedCorpseSlick({
      ...host,
      materials: new Map(),
    }).requiredProviders,
    ["source-registered-ped-slick-material:GIBSLICK"],
  );
  const ambiguous = modelActor();
  ambiguous.model.add(
    new Mesh(ambiguous.mesh.geometry, ambiguous.mesh.material),
  );
  host.root.model.removeFromParent();
  ambiguous.model.removeFromParent();
  host.root.actor.add(ambiguous.model);
  host.allocation.render.instance.bones[0].model = ambiguous.model;
  assert.deepEqual(queueNativePedCorpseSlick(host).requiredProviders, [
    "source-unambiguous-current-ped-root-MODEL",
  ]);
  const custom = modelActor("custom", sourcePositions, 0x400);
  ambiguous.model.removeFromParent();
  custom.model.removeFromParent();
  host.root.actor.add(custom.model);
  host.allocation.render.instance.bones[0].model = custom.model;
  assert.deepEqual(queueNativePedCorpseSlick(host).requiredProviders, [
    "native retained custom MODEL bounds/radius",
  ]);
  assert.equal(host.draws, 0);
  host.oil.dispose();
});

test("native slick rejects translated selected MODEL and missing active smear material", () => {
  const host = hostFixture();
  host.root.model.matrix.makeTranslation(1, 0, 0);
  assert.deepEqual(queueNativePedCorpseSlick(host).requiredProviders, [
    "source-unambiguous-current-ped-root-MODEL",
  ]);
  host.root.model.matrix.identity();
  host.materials.delete("gibsmear");
  assert.deepEqual(queueNativePedCorpseSlick(host).requiredProviders, [
    "source-registered-ped-slick-smear-material:GIBSMEAR.MAT",
  ]);
  host.oil.dispose();
});

test("native corpse slick uses the shared 32-slot pool and reports disposed queue", () => {
  const host = hostFixture();
  for (let i = 0; i < 33; i++) {
    const result = queueNativePedCorpseSlick({ ...host, timeMs: 100 + i });
    assert.equal(result.status, "queued");
  }
  assert.equal(host.oil.spills.filter(Boolean).length, 32);
  assert.equal(host.draws, 66);
  host.oil.dispose();
  const result = queueNativePedCorpseSlick(host);
  assert.equal(result.status, "allocation-failed");
  assert.deepEqual(result.requiredProviders, ["shared-oil-spill-allocation"]);
});

const originalRoot = new URL("../carma2_orig/", import.meta.url).pathname;
for (const dataRoot of ["data", "adv_data"])
  for (const stem of ["Blokebl", "FATBLOKE2"])
    test(`original ${dataRoot}/${stem} root set0 and set1 queue exact selected MODEL`, async (t) => {
      let store;
      try {
        store = await createAssetStore(originalRoot);
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
      const assets = new Assets();
      assets.manifest = store.manifest;
      assets.lookup = new Map(
        store.manifest.map((entry) => [entry.path.toLowerCase(), entry.path]),
      );
      assets.bytes = async (path) => {
        const bytes = await store.read(path);
        if (!bytes) throw new Error(`Asset missing: ${path}`);
        return new Uint8Array(bytes);
      };
      const template = await loadNativePedAssets(
          assets,
          `PEDS/PEEPS/${stem}`,
          stem,
          dataRoot,
        ),
        dead = prepareNativePedDeadModels(stem, template),
        instance = createNativePedInstance(template, {
          rootPose: [1, 0, 0, 0, 1, 0, 0, 0, 1, 2, 3, 4],
          modelSet1: dead.modelSet1,
        }),
        parsed = parsePedBloodSettings(
          await assets.text(`${dataRoot}/PEDS/settings.txt`),
        ),
        slickMaterial = new MeshBasicMaterial(),
        smearMaterial = new MeshBasicMaterial(),
        oil = new OilRuntime({ random: () => 0.5 });
      for (const set of [0, 1]) {
        if (selectNativePedBoneModel(instance, 0, 0, set).status !== "complete")
          throw new Error(`Could not select root model set${set}`);
        const allocation = {
          phase: "owned",
          renderSlot: 0,
          render: {
            instance,
            actorSet: { actors: instance.bones.map((bone) => bone.actor) },
          },
        };
        const result = queueNativePedCorpseSlick({
          oil,
          allocation,
          slick: parsed.slick,
          materials: new Map([
            ["gibslick", slickMaterial],
            ["gibsmear", smearMaterial],
          ]),
          timeMs: 100 + set,
        });
        assert.equal(result.status, "queued");
        if (result.status === "queued") {
          assert.equal(result.spill.source?.identity, instance.bones[0].actor);
          assert.equal(result.spill.source?.readModelBounds().isEmpty(), false);
          const expected =
            set === 0
              ? template.bones[0].variants[0].modelBounds.values().next().value
              : dead.models.find(
                  (record) => record.boneIndex === 0 && record.poseIndex === 0,
                ).bounds;
          assert.deepEqual(
            result.spill.source?.readModelBounds().min.toArray(),
            expected.min.toArray(),
          );
        }
      }
      assert.equal(oil.spills.filter(Boolean).length, 2);
      oil.dispose();
      dead.dispose();
      dead.materialRegistry.dispose();
    });
