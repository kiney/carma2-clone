import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createModelGeometry } from "../src/render-geometry.ts";
import {
  NativePedDeadMaterialRegistry,
  prepareNativePedDeadModels,
} from "../src/ped-dead-models.ts";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";
import {
  createNativePedInstance,
  selectNativePedBoneModel,
} from "../src/ped-native-instance.ts";

function sourceModel(name = "BODY.ACT", flags = 0x403) {
  return {
    name,
    flags,
    // Last vertex is unused, but contributes to native MODEL bounds.
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 8, -9, 10]),
    uvs: Float32Array.from([0, 0, 1, 0, 0, 1, 0.25, 0.5]),
    materials: ["PERSON.MAT", "BUTTON.MAT"],
    faces: [
      { indices: [0, 1, 2], material: 1, smoothing: 17, flags: 3 },
      { indices: [2, 1, 0], material: 2, smoothing: 32, flags: 4 },
      { indices: [0, 2, 1], material: 1, smoothing: 0, flags: 0 },
    ],
  };
}
function variant(model, materials) {
  const actor = new THREE.Group();
  actor.name = model.name;
  actor.matrixAutoUpdate = false;
  actor.add(new THREE.Mesh(createModelGeometry(model), materials));
  return {
    identifier: model.name,
    actor,
    sourceModels: [model.name],
    modelBounds: new Map(),
  };
}
function fixture() {
  const liveTexture = new THREE.Texture(),
    blood = new THREE.Texture();
  const first = new THREE.MeshLambertMaterial({ map: liveTexture });
  first.name = "PERSON.MAT";
  first.userData.c2Flags = 0x1800;
  const button = new THREE.MeshLambertMaterial({ color: 0x123456 });
  button.name = "BUTTON.MAT";
  const raw = sourceModel();
  const alive = variant(raw, [first, button]);
  const assets = {
    bones: [{ variants: [alive] }],
    scene: {
      materials: new Map([
        ["person", first],
        ["button", button],
      ]),
      textures: new Map([["personb", blood]]),
    },
  };
  return { assets, raw, alive, first, button, blood, liveTexture };
}

test("native set1 copies remapped raw vertices/faces, drops source MODEL header flags, and substitutes first MAT only", () => {
  const x = fixture();
  const source = x.alive.actor.children[0].geometry;
  const before = source.userData.sourceFaces.map((f) => ({
    ...f,
    indices: [...f.indices],
  }));
  const dead = prepareNativePedDeadModels("PERSON", x.assets);
  const record = dead.models[0];
  assert.equal(record.identifier, "BODY1.DAT");
  assert.equal(record.model.flags, 0x80);
  assert.equal(source.userData.modelFlags, 0x403);
  assert.notEqual(record.model.positions, source.userData.sourcePositions);
  assert.notEqual(record.model.uvs, source.userData.sourceUVs);
  assert.deepEqual(record.model.positions, x.raw.positions);
  assert.deepEqual(record.model.uvs, x.raw.uvs);
  assert.deepEqual(record.bounds.min.toArray(), [0, -9, 0]);
  assert.deepEqual(record.bounds.max.toArray(), [8, 1, 10]);
  assert.deepEqual(source.userData.sourceFaces, before);
  for (let i = 0; i < before.length; i++) {
    assert.notEqual(record.model.faces[i], source.userData.sourceFaces[i]);
    assert.deepEqual(record.model.faces[i].indices, before[i].indices);
    assert.equal(record.model.faces[i].smoothing, before[i].smoothing);
    assert.equal(record.model.faces[i].flags, before[i].flags);
  }
  const copied = record.faceMaterials[0];
  assert.notEqual(copied, x.first);
  assert.equal(copied.name, "PERSON1.MAT");
  assert.equal(copied.map, x.blood);
  assert.equal(copied.userData.c2Flags, 0x1800);
  assert.equal(record.faceMaterials[1], x.button);
  assert.equal(record.faceMaterials[2], copied);
  assert.equal(x.first.map, x.liveTexture);
  assert.equal(record.actor.parent, null);
  assert.ok(record.actor.matrix.equals(new THREE.Matrix4()));
  assert.equal(record.actor.matrixAutoUpdate, false);
  assert.equal(record.geometry.userData.nativePedRawModel, record.model);
  assert.equal(record.geometry.userData.nativePedModelBounds, record.bounds);
  assert.equal(record.actor.clone(true).children[0].geometry, record.geometry);
  record.model.positions[0] = 100;
  assert.equal(source.userData.sourcePositions[0], 0);
});

test("pose cloning stops at first NULL and multiple MODELs share one personality MAT clone", () => {
  const x = fixture();
  const second = variant(sourceModel("HEAD.dead.DAT", 0), [x.first, x.button]);
  x.assets.bones.push({ variants: [second, { actor: null }, x.alive] });
  const dead = prepareNativePedDeadModels("PERSON", x.assets);
  assert.equal(dead.models.length, 2);
  assert.equal(dead.models[1].identifier, "HEAD1.DAT");
  assert.deepEqual(dead.modelSet1[1].slice(1), [null, null, null]);
  assert.equal(
    dead.models[0].faceMaterials[0],
    dead.models[1].faceMaterials[0],
  );
  assert.equal(dead.materialRegistry.clonedMaterials.length, 1);
});

test("distinct source slots with the same first MAT pointer are both substituted", () => {
  const x = fixture();
  x.alive.actor.children[0].material = [x.first, x.first];
  const dead = prepareNativePedDeadModels("PERSON", x.assets);
  assert.equal(new Set(dead.models[0].faceMaterials).size, 1);
  assert.deepEqual(
    dead.models[0].model.faces.map((face) => face.material),
    [1, 1, 1],
  );
  assert.deepEqual(
    x.alive.actor.children[0].geometry.userData.sourceFaces.map(
      (face) => face.material,
    ),
    [1, 2, 1],
  );
});

test("raw first face NULL cannot be replaced by its resolved inherited render MAT", () => {
  const x = fixture(),
    raw = sourceModel();
  raw.faces[0].material = 0;
  x.assets.bones[0].variants[0] = variant(raw, [x.first, x.button, x.first]);
  const registry = new NativePedDeadMaterialRegistry();
  assert.throws(
    () =>
      prepareNativePedDeadModels("PERSON", x.assets, {
        materialRegistry: registry,
        nullFaceMaterial: () => x.first,
      }),
    /first-face MAT is NULL; installed cloning has no defined path/,
  );
  assert.equal(registry.clonedMaterials.length, 0);
  assert.equal(x.first.map, x.liveTexture);
});

test("a later raw NULL face preserves its pointer despite inherited render MAT aliasing first MAT", () => {
  const x = fixture(),
    raw = sourceModel();
  raw.faces[1].material = 0;
  x.assets.bones[0].variants[0] = variant(raw, [x.first, x.first]);
  const dead = prepareNativePedDeadModels("PERSON", x.assets, {
    nullFaceMaterial: () => x.first,
  });
  assert.equal(dead.models[0].faceMaterials[1], null);
  assert.equal(dead.models[0].model.faces[1].material, 0);
  assert.equal(dead.models[0].actor.children[0].material[1], x.first);
  assert.equal(
    dead.models[0].faceMaterials[0],
    dead.models[0].faceMaterials[2],
  );
  assert.notEqual(dead.models[0].faceMaterials[0], x.first);
  assert.equal(x.first.map, x.liveTexture);
});

test("an existing derived MAT is reused while only the personality-named MAT receives B texture", () => {
  const x = fixture(),
    borrowed = new THREE.MeshLambertMaterial();
  borrowed.name = "PERSON1.MAT";
  const registry = new NativePedDeadMaterialRegistry(
    new Map([["PERSON1.MAT", borrowed]]),
  );
  const dead = prepareNativePedDeadModels("PERSON", x.assets, {
    materialRegistry: registry,
  });
  assert.equal(dead.models[0].faceMaterials[0], borrowed);
  assert.equal(borrowed.map, x.blood);
  assert.equal(registry.clonedMaterials.length, 0);
  const other = fixture();
  other.first.name = "CLOTH.MAT";
  const cloth = prepareNativePedDeadModels("PERSON", other.assets);
  assert.equal(cloth.models[0].faceMaterials[0].name, "CLOTH1.MAT");
  assert.equal(cloth.models[0].faceMaterials[0].map, other.liveTexture);
});

test("native50 MAT limit retains NULL pointers and requires explicit ACT material provider", () => {
  const x = fixture(),
    registry = new NativePedDeadMaterialRegistry();
  for (let i = 0; i < 50; i++) {
    const material = new THREE.MeshLambertMaterial();
    material.name = `other${i}.MAT`;
    assert.ok(registry.cloneFirst(material));
  }
  assert.throws(
    () =>
      prepareNativePedDeadModels("PERSON", x.assets, {
        materialRegistry: registry,
      }),
    /NULL dead MAT requires ACT material provider/,
  );
  const fallback = new THREE.MeshLambertMaterial();
  const dead = prepareNativePedDeadModels("PERSON", x.assets, {
    materialRegistry: registry,
    nullFaceMaterial: (bone, pose) => {
      assert.equal(bone, 0);
      assert.equal(pose, 0);
      return fallback;
    },
  });
  assert.deepEqual(dead.models[0].faceMaterials, [null, x.button, null]);
  assert.equal(dead.models[0].model.faces[0].material, 0);
  assert.equal(dead.models[0].actor.children[0].material[0], fallback);
  assert.deepEqual(dead.diagnostics, [
    "native-dead-material-capacity:PERSON1.MAT",
  ]);
  assert.equal(registry.clonedMaterials.length, 50);
  assert.equal(x.first.map, x.liveTexture);
});

test("MODEL teardown and global cloned MAT teardown have separate ownership and borrow texture maps", () => {
  const x = fixture(),
    dead = prepareNativePedDeadModels("PERSON", x.assets);
  let geometryDisposals = 0,
    cloneDisposals = 0,
    livingDisposals = 0,
    mapDisposals = 0;
  dead.models[0].geometry.addEventListener(
    "dispose",
    () => geometryDisposals++,
  );
  dead.models[0].faceMaterials[0].addEventListener(
    "dispose",
    () => cloneDisposals++,
  );
  x.first.addEventListener("dispose", () => livingDisposals++);
  x.button.addEventListener("dispose", () => livingDisposals++);
  x.blood.addEventListener("dispose", () => mapDisposals++);
  dead.dispose();
  assert.equal(geometryDisposals, 1);
  assert.equal(cloneDisposals, 0);
  dead.materialRegistry.dispose();
  assert.equal(cloneDisposals, 1);
  assert.equal(livingDisposals, 0);
  assert.equal(mapDisposals, 0);
});

test("missing raw source/blood/ACT providers fail instead of manufacturing a generic corpse", () => {
  let x = fixture();
  x.assets.scene.textures.clear();
  assert.throws(
    () => prepareNativePedDeadModels("PERSON", x.assets),
    /blood texture missing/,
  );
  x = fixture();
  delete x.alive.actor.children[0].geometry.userData.sourceUVs;
  assert.throws(
    () => prepareNativePedDeadModels("PERSON", x.assets),
    /raw MODEL metadata missing/,
  );
  x = fixture();
  x.alive.actor.matrix.makeTranslation(1, 0, 0);
  assert.throws(
    () => prepareNativePedDeadModels("PERSON", x.assets),
    /ACT transform/,
  );
  x = fixture();
  x.assets.scene.materials.set("person1", x.first);
  assert.throws(
    () => prepareNativePedDeadModels("PERSON", x.assets),
    /aliases a living material/,
  );
});

const rootPose = Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 4, 5, 6]);
for (const tree of ["data", "adv_data"])
  for (const name of ["Blokebl", "Bandsman", "twolf"])
    test(`original ${tree}/${name} set1 uses actual remapped models, blood map and source dead head selection`, async (t) => {
      let store;
      try {
        store = await createAssetStore(
          new URL("../carma2_orig/", import.meta.url).pathname,
        );
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
        store.manifest.map((x) => [x.path.toLowerCase(), x.path]),
      );
      assets.bytes = async (path) => {
        const bytes = await store.read(path);
        if (!bytes) throw new Error(`Asset missing: ${path}`);
        return new Uint8Array(bytes);
      };
      const live = await loadNativePedAssets(
        assets,
        `PEDS/PEEPS/${name}`,
        name,
        tree,
      );
      const dead = prepareNativePedDeadModels(name, live, {
        nullFaceMaterial: (bone, pose) => {
          const mesh = live.bones[bone].variants[pose].actor.children[0];
          const slots = [
            ...new Set(
              mesh.geometry.userData.sourceFaces.map((face) => face.material),
            ),
          ];
          const index = slots.indexOf(0);
          assert.ok(
            index >= 0,
            "Original NULL MAT uses the actual loaded ACT inheritance provider",
          );
          return mesh.material[index];
        },
      });
      assert.equal(dead.models.length, name === "twolf" ? 16 : 12);
      assert.equal(dead.materialRegistry.clonedMaterials.length, 1);
      assert.deepEqual(dead.diagnostics, []);
      for (const record of dead.models) {
        const variant = live.bones[record.boneIndex].variants[record.poseIndex];
        const source = variant.actor.children[0];
        assert.deepEqual(
          record.model.positions,
          source.geometry.userData.sourcePositions,
        );
        assert.deepEqual(record.model.uvs, source.geometry.userData.sourceUVs);
        assert.equal(record.model.flags, 0x80);
        assert.notEqual(record.geometry, source.geometry);
        assert.notEqual(record.faceMaterials[0], source.material[0]);
        assert.equal(
          record.faceMaterials[0].map,
          live.scene.textures.get(`${name}B`.toLowerCase()),
        );
        assert.notEqual(source.material[0].map, record.faceMaterials[0].map);
        source.geometry.userData.sourceFaces.forEach((face, i) => {
          if (face.material === 0) {
            assert.equal(record.faceMaterials[i], null);
            assert.equal(record.model.faces[i].material, 0);
          }
        });
        const sourceBounds = [...variant.modelBounds.values()][0];
        assert.ok(record.bounds.equals(sourceBounds));
      }
      const instance = createNativePedInstance(live, {
        rootPose,
        modelSet1: dead.modelSet1,
      });
      const stableActors = instance.bones.map((b) => b.actor);
      for (let bone = 0; bone < instance.bones.length; bone++)
        assert.equal(
          selectNativePedBoneModel(instance, bone, 0, 1).nativeModelReturn,
          1,
        );
      const head = name === "twolf" ? 2 : 1;
      const headResult = selectNativePedBoneModel(instance, head, 2, 1);
      assert.equal(headResult.nativeModelReturn, name === "twolf" ? 0 : 1);
      assert.equal(instance.modelSet, 1);
      assert.equal(instance.bones[head].poseIndex, name === "twolf" ? 0 : 2);
      const selected = instance.bones[head].model;
      assert.equal(
        selected.name,
        name === "Blokebl"
          ? "CHEBLB1.DAT"
          : name === "Bandsman"
            ? "HEDCB1.DAT"
            : "TGHEAD11.DAT",
      );
      assert.equal(
        selected.children[0].geometry,
        dead.modelSet1[head][name === "twolf" ? 0 : 2].children[0].geometry,
      );
      assert.deepEqual(
        instance.bones.map((b) => b.actor),
        stableActors,
      );
      dead.dispose();
      dead.materialRegistry.dispose();
    });
