import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";
import {
  NativePedAssetError,
  loadNativePedAssets,
} from "../src/ped-native-assets.ts";

async function originalAssets(root) {
  const store = await createAssetStore(root);
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
  return assets;
}
async function fixture(root, dataRoot, stem) {
  return loadNativePedAssets(
    await originalAssets(root),
    `PEDS/PEEPS/${stem}`,
    stem,
    dataRoot,
  );
}

test("native pedestrian assets assemble flat original Blokebl and Bandsman actors", async (t) => {
  let root;
  try {
    root = new URL("../carma2_orig/", import.meta.url).pathname;
    const loaded = [];
    for (const [dataRoot, stem] of [
      ["data", "Blokebl"],
      ["data", "Bandsman"],
      ["data", "twolf"],
      ["adv_data", "Blokebl"],
      ["adv_data", "Bandsman"],
      ["adv_data", "twolf"],
    ]) {
      try {
        loaded.push({
          dataRoot,
          stem,
          ped: await fixture(root, dataRoot, stem),
        });
      } catch (error) {
        if (/ENOENT|Original installation/.test(String(error))) {
          t.skip("Original installation unavailable");
          return;
        }
        throw error;
      }
    }
    for (const { stem, ped } of loaded) {
      assert.equal(
        ped.form.bones.length,
        stem.toLowerCase() === "twolf" ? 16 : 10,
      );
      assert.equal(ped.bones.length, ped.form.bones.length);
      assert.equal(
        ped.profile.mass,
        Math.fround(stem.toLowerCase() === "twolf" ? 0.047 : 0.068),
      );
      assert.equal(ped.moves.size, ped.form.moves.length);
      assert.ok(ped.moves.has(30));
      assert.ok(ped.moves.get(30).motion.frameCount > 0);
      assert.equal(ped.group.matrixAutoUpdate, false);
      assert.equal(ped.group.matrix.elements[12], 0);
      assert.equal(
        ped.group.children.length,
        ped.bones.reduce(
          (n, b) => n + b.variants.filter((v) => v.actor).length,
          0,
        ),
      );
      for (let i = 0; i < ped.bones.length; i++) {
        const bone = ped.bones[i];
        let contiguous = true;
        assert.equal(bone.index, i);
        assert.ok(bone.mass >= 0);
        assert.equal(bone.parent, ped.form.bones[i].parent);
        if (i) assert.ok(bone.attachments);
        for (const variant of bone.variants) {
          if (!variant.actor) {
            contiguous = false;
            continue;
          }
          assert.equal(variant.actor.parent, ped.group);
          assert.ok(variant.sourceModels.length > 0);
          for (const modelBounds of variant.modelBounds.values()) {
            assert.ok(!modelBounds.isEmpty());
            assert.ok(
              [
                ...modelBounds.min.toArray(),
                ...modelBounds.max.toArray(),
              ].every(Number.isFinite),
            );
          }
          variant.actor.traverse((object) => {
            if (!object.isMesh) return;
            if (contiguous)
              assert.ok(
                object.geometry.userData.modelFlags & 0x80,
                "ReadPersonality prepares nonnull set0 MODEL as updateable",
              );
            assert.ok(object.geometry.getAttribute("position").count > 0);
            assert.ok(object.material.length > 0);
            assert.ok(
              object.material.every((material) => material.name.length > 0),
            );
          });
        }
      }
      assert.ok(
        [...ped.moves.values()].every(
          (move) =>
            move.motion.matrices.length ===
            move.motion.bones.length * move.motion.frameCount * 12,
        ),
      );
    }
    for (const { dataRoot, stem, ped } of loaded) {
      const counterpart = loaded.find(
        (entry) => entry.dataRoot !== dataRoot && entry.stem === stem,
      )?.ped;
      assert.ok(counterpart, `${stem} counterpart`);
      assert.deepEqual(
        ped.form.bones.map((b) => b.name),
        counterpart.form.bones.map((b) => b.name),
      );
      const rootVariant = ped.bones[0].variants[0];
      if (stem.toLowerCase() === "twolf")
        assert.match(rootVariant.identifier, /\.DAT$/i);
      else assert.match(rootVariant.identifier, /\.ACT$/i);
      assert.ok(rootVariant.sourceModels[0]);
      const slotZeroMaterials = [];
      rootVariant.actor.traverse((object) => {
        if (object.isMesh)
          slotZeroMaterials.push(
            ...object.material.filter(
              (material) =>
                material.name.toLowerCase() !==
                "c2 pedestrian inherited material",
            ),
          );
      });
      assert.ok(slotZeroMaterials.some((material) => material.name.length > 0));
    }
  } catch (error) {
    if (error?.code === "ENOENT") t.skip("Original installation unavailable");
    else throw error;
  }
});

test("native pedestrian loader resolves the Advanced personality namespace", async (t) => {
  try {
    const ped = await fixture(
      new URL("../carma2_orig/", import.meta.url).pathname,
      "adv_data",
      "twolf",
    );
    assert.equal(ped.form.nonHumanoid, true);
    assert.equal(ped.bones.length, 16);
    assert.ok(ped.profile.mass > 0);
    assert.equal(
      ped.group.children.length,
      ped.bones.reduce(
        (n, b) => n + b.variants.filter((v) => v.actor).length,
        0,
      ),
    );
    assert.ok(ped.moves.size > 0);
    assert.ok(ped.bones.every((bone) => bone.variants.length > 0));
    assert.ok(
      ped.bones[0].variants[0].sourceModels.some(
        (name) => name.toLowerCase().replace(/\.dat$/, "") === "twolf",
      ),
    );
  } catch (error) {
    if (error?.code === "ENOENT") t.skip("Original installation unavailable");
    else throw error;
  }
});

test("native asset paths reject traversal before accessing the asset bundle", async () => {
  const assets = new Assets();
  await assert.rejects(
    loadNativePedAssets(assets, "../outside", "person", "data"),
    /Invalid native pedestrian asset path/,
  );
});

test("flat FORM actors inherit BRender default; authored ACT material is unrelated", async () => {
  const assets = new Assets();
  assets.text = async (path) => {
    if (path.endsWith("/PERSON.TXT"))
      return `FORM\nDEFAULT\nSTART OF BONES\nroot\nROOT.ACT\nEND OF BONES\nSTART OF MOVES\nEND OF MOVES\n-1,-1,-1\n1,1,1\n0,0,0\nSOUNDS.TXT`;
    if (path.endsWith("/FORM.TXT"))
      return `1\n0\n1\n0\nNONE\nSTART OF BONES\nroot\n100\nBOX\nNONE\nEND OF BONES\nSTART OF MOVES\nEND OF MOVES\nHUMANOID\n0\n-1\n1`;
    if (path.endsWith("/DEFAULT.TXT")) return "START OF MOVES\nEND OF MOVES";
    throw new Error(`Unexpected text path: ${path}`);
  };
  assets.files = () => ["data/PEDS/PEEPS/PERSON/ROOT.act"];
  const actorMaterial = new THREE.MeshLambertMaterial({ color: 0x112233 });
  actorMaterial.name = "ACT_MAT";
  const namedMaterial = new THREE.MeshLambertMaterial({ color: 0x445566 });
  namedMaterial.name = "DAT_MAT";
  const defaultMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
  defaultMaterial.name = "C2 default material";
  const root = new THREE.Group();
  root.userData.c2ActorMaterialName = "ACT_MAT";
  const sourceMesh = new THREE.Mesh(new THREE.BufferGeometry(), actorMaterial);
  sourceMesh.name = "ROOT.DAT";
  root.add(sourceMesh);
  const dat = {
    name: "ROOT.ACT",
    flags: 0,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    uvs: new Float32Array(8),
    faces: [
      { indices: [0, 1, 2], smoothing: 0, flags: 0, material: 0 },
      { indices: [0, 2, 3], smoothing: 0, flags: 0, material: 1 },
    ],
    materials: ["DAT_MAT"],
  };
  assets.scene = async (_directory, _stem, options) => {
    assert.equal(options.resourceOnly, true);
    return {
      group: new THREE.Group().add(root),
      models: new Map([["root", dat]]),
      materials: new Map([
        ["act_mat", actorMaterial],
        ["dat_mat", namedMaterial],
      ]),
      defaultMaterial,
    };
  };
  const ped = await loadNativePedAssets(
    assets,
    "PEDS/PEEPS/PERSON",
    "PERSON",
    "data",
  );
  const mesh = ped.bones[0].actor.children[0];
  assert.equal(mesh.material[0], defaultMaterial);
  assert.equal(mesh.material[1], namedMaterial);

  root.userData.c2ActorMaterialName = null;
  const defaultPed = await loadNativePedAssets(
    assets,
    "PEDS/PEEPS/PERSON",
    "PERSON",
    "data",
  );
  assert.equal(
    defaultPed.bones[0].actor.children[0].material[0],
    defaultMaterial,
  );
  root.userData.c2ActorMaterialName = "MISSING_MAT";
  const unchangedPed = await loadNativePedAssets(
    assets,
    "PEDS/PEEPS/PERSON",
    "PERSON",
    "data",
  );
  assert.equal(
    unchangedPed.bones[0].actor.children[0].material[0],
    defaultMaterial,
  );
  dat.name = "ROOT.DAT";
  await assert.rejects(
    loadNativePedAssets(assets, "PEDS/PEEPS/PERSON", "PERSON", "data"),
    (error) =>
      error instanceof NativePedAssetError &&
      error.diagnostics[0].identifier === "ROOT.ACT" &&
      error.diagnostics[0].code === "missing-model",
  );
});

test("resource-only directories do not require an arbitrary ACT bootstrap", async () => {
  const assets = new Assets();
  assets.bytes = async () => {
    throw new Error("No authored files should be read");
  };
  const scene = await assets.scene("data/PEDS/PEEPS/EMPTY", "EMPTY", {
    resourceOnly: true,
  });
  assert.equal(scene.sourceActors.length, 0);
  assert.equal(scene.group.children.length, 0);
  assert.equal(scene.defaultMaterial.name, "C2 default material");
  scene.dispose();
  scene.dispose();
});

test("Stock and Advanced declared MODELs preserve CitySwat poses, animal attachments and head variants", async (t) => {
  let assets;
  try {
    assets = await originalAssets(
      new URL("../carma2_orig/", import.meta.url).pathname,
    );
  } catch (error) {
    if (error?.code === "ENOENT")
      return t.skip("Original installation unavailable");
    throw error;
  }
  const identity = new THREE.Matrix4();
  for (const dataRoot of ["data", "adv_data"]) {
    for (const stem of ["CitySwat", "Bandsman", "deer", "penguin"]) {
      const ped = await loadNativePedAssets(
        assets,
        `PEDS/PEEPS/${stem}`,
        stem,
        dataRoot,
      );
      assert.equal(ped.scene.sourceActors.length, 0);
      for (const bone of ped.bones) {
        assert.equal(
          bone.attachments,
          ped.profile.attachmentsByBone.get(bone.name) ?? null,
        );
        for (const variant of bone.variants) {
          if (!variant.actor) continue;
          assert.ok(
            variant.actor.matrix.equals(identity),
            `${stem}/${bone.name} has no ACT tilt`,
          );
          assert.equal(
            variant.sourceModels[0].toLowerCase(),
            variant.identifier.toLowerCase(),
          );
          assert.equal(variant.actor.parent, ped.group);
        }
      }
      if (stem === "CitySwat" || stem === "Bandsman") {
        assert.equal(ped.bones[1].variants.length, 3);
        assert.equal(
          new Set(ped.bones[1].variants.map((v) => v.sourceModels[0])).size,
          3,
        );
      }
      let releases = 0;
      const geometry = ped.bones[0].actor.children[0].geometry;
      geometry.addEventListener("dispose", () => releases++);
      ped.dispose();
      ped.dispose();
      assert.equal(releases, 1);
      assert.equal(ped.group.children.length, 0);
    }
    // These original backup TXT files have spaces; their declared resources
    // are valid and must be checked rather than rejected by path validation.
    for (const stem of ["deer", "penguin"]) {
      const copy = await loadNativePedAssets(
        assets,
        `PEDS/PEEPS/${stem}`,
        `Copy of ${stem}`,
        dataRoot,
      );
      assert.ok(copy.bones.length > 0);
      copy.dispose();
    }
    await assert.rejects(
      loadNativePedAssets(assets, "PEDS/PEEPS/chef1", "CHEF1", dataRoot),
      (error) =>
        error instanceof NativePedAssetError &&
        error.diagnostics.some((d) => d.identifier === "HECHB.DAT") &&
        error.diagnostics.some((d) => d.identifier === "HECHC.DAT") &&
        !error.diagnostics.some((d) => d.identifier === "FATBCH.ACT"),
    );
  }
});

test("source BON/SKL parsing is shared per Assets/root/path and template geometry is owned", async (t) => {
  let assets;
  try {
    assets = await originalAssets(
      new URL("../carma2_orig/", import.meta.url).pathname,
    );
  } catch (error) {
    if (error?.code === "ENOENT")
      return t.skip("Original installation unavailable");
    throw error;
  }
  const bytes = assets.bytes.bind(assets),
    reads = new Map();
  assets.bytes = async (path) => {
    if (/\.(bon|skl)$/i.test(path)) reads.set(path, (reads.get(path) ?? 0) + 1);
    return bytes(path);
  };
  const first = await loadNativePedAssets(
    assets,
    "PEDS/PEEPS/CitySwat",
    "CitySwat",
    "data",
  );
  const second = await loadNativePedAssets(
    assets,
    "PEDS/PEEPS/Blokebl",
    "Blokebl",
    "data",
  );
  assert.ok(reads.size > 0);
  assert.ok([...reads.values()].every((count) => count === 1));
  for (const [id, move] of first.moves)
    assert.equal(move.motion, second.moves.get(id).motion);
  assert.notEqual(
    first.bones[0].actor.children[0].geometry,
    second.bones[0].actor.children[0].geometry,
  );
  let materialReleases = 0;
  first.inheritedActorMaterial.addEventListener(
    "dispose",
    () => materialReleases++,
  );
  first.dispose();
  assert.equal(
    materialReleases,
    0,
    "shared native storage retains borrowed render resources",
  );
  assert.ok(
    second.bones[0].actor.children[0].geometry.getAttribute("position").count >
      0,
  );
  second.dispose();
  assert.equal(materialReleases, 1);
});
