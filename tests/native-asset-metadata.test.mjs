import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";
import { Assets } from "../src/content.ts";
import { parseAct, parseDat, parseMat } from "../src/formats.ts";
import { createModelGeometry } from "../src/render-geometry.ts";
import { createAssetStore } from "../server/assets.mjs";

const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const f32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeFloatBE(n);
  return b;
};
const bytes = (...parts) => Buffer.concat(parts);
const name = (s) => Buffer.from(`${s}\0`, "latin1");
const chunk = (tag, payload = Buffer.alloc(0), length = payload.length) =>
  bytes(u32(tag), u32(length), payload);
const header = (type) => bytes(u32(0x12), u32(8), u32(type), u32(2));
const model = () => chunk(0x36, bytes(u16(0), name("metadata-model")));
const withPivot = (pivot) =>
  bytes(
    header(0xface),
    model(),
    chunk(0x15, bytes(...pivot.map(f32))),
    chunk(0),
  );

test("DAT retains a native pivot and geometry gets an independent zero default", () => {
  const [parsed] = parseDat(withPivot([2.5, -4, 0.125]));
  assert.deepEqual(parsed.pivot, [2.5, -4, 0.125]);
  const geometry = createModelGeometry({
    ...parsed,
    positions: new Float32Array(),
    uvs: new Float32Array(),
    faces: [],
    materials: [],
  });
  parsed.pivot[0] = 99;
  assert.deepEqual(geometry.userData.c2Pivot, [2.5, -4, 0.125]);

  const [withoutPivot] = parseDat(bytes(header(0xface), model(), chunk(0)));
  const defaultGeometry = createModelGeometry(withoutPivot);
  assert.deepEqual(defaultGeometry.userData.c2Pivot, [0, 0, 0]);
});

test("DAT rejects malformed, duplicate, non-finite, and orphan pivots", () => {
  const valid = bytes(...[1, 2, 3].map(f32));
  assert.throws(
    () =>
      parseDat(
        bytes(header(0xface), model(), chunk(0x15, valid.subarray(0, 8))),
      ),
    /exactly 3 scalars/,
  );
  assert.throws(
    () =>
      parseDat(
        bytes(header(0xface), model(), chunk(0x15, valid), chunk(0x15, valid)),
      ),
    /duplicate model pivot/,
  );
  assert.throws(
    () => parseDat(bytes(header(0xface), chunk(0x15, valid))),
    /precedes model declaration/,
  );
  assert.throws(
    () =>
      parseDat(
        bytes(
          header(0xface),
          model(),
          chunk(0x15, bytes(f32(1), f32(Number.NaN), f32(3))),
        ),
      ),
    /non-finite coordinate/,
  );
});

test("ACT scene objects retain raw actor metadata without changing effective styles", async () => {
  const u8 = (n) => Buffer.from([n]);
  const act = bytes(
    header(1),
    chunk(0x23, bytes(u8(0), u8(0), name("default-root"))),
    chunk(0x26, name("parent-material")),
    chunk(0x23, bytes(u8(1), u8(4), name("face-child"))),
    chunk(0x2a),
    chunk(0),
    chunk(0x23, bytes(u8(5), u8(0), name("bounds-root"))),
    chunk(0x32, bytes(...[-2, -3, -4, 5, 6, 7].map(f32))),
    chunk(0x29),
    chunk(0),
  );
  const files = new Map([["scene/scene.act", act]]);
  const assets = new Assets();
  assets.manifest = [...files.keys()].map((path) => ({
    path,
    size: files.get(path).length,
  }));
  assets.lookup = new Map([...files.keys()].map((path) => [path, path]));
  assets.bytes = async (path) => files.get(path);
  const scene = await assets.scene("scene", "scene");
  const [nativeDefault, nativeBounds] = scene.group.children;
  const faceChild = nativeDefault.children[0];
  assert.deepEqual(
    [
      nativeDefault.userData.c2ActorType,
      nativeDefault.userData.c2ActorRenderStyle,
      nativeDefault.userData.c2ActorName,
      nativeDefault.userData.c2ActorChildIndex,
    ],
    [0, 0, "default-root", 0],
  );
  assert.deepEqual(
    [
      faceChild.userData.c2ActorType,
      faceChild.userData.c2ActorRenderStyle,
      faceChild.userData.c2ActorName,
      faceChild.userData.c2ActorChildIndex,
    ],
    [1, 4, "face-child", 0],
  );
  assert.equal(nativeBounds.userData.c2ActorType, 5);
  assert.equal(nativeBounds.userData.c2ActorRenderStyle, 0);
  assert.equal(
    nativeDefault.userData.c2ActorLocalMaterialName,
    "parent-material",
  );
  assert.equal(faceChild.userData.c2ActorLocalMaterialName, null);
  assert.equal(
    faceChild.userData.c2ActorMaterialName,
    null,
    "a completed NULL material lookup inherits the default, not an unresolved name",
  );
  assert.equal(faceChild.userData.c2ActorLocalModelName, null);
  assert.deepEqual(nativeBounds.userData.c2ActorBounds, {
    min: [-2, -3, -4],
    max: [5, 6, 7],
  });
  assert.deepEqual(scene.sourceActors, parseAct(act));
  nativeBounds.userData.c2ActorBounds.min[0] = 99;
  assert.equal(scene.sourceActors[1].bounds.min[0], -2);
  const [sourceDefault, sourceBounds] = scene.sourceActors;
  assert.equal(scene.sourceActorObjects.get(sourceDefault), nativeDefault);
  assert.equal(
    scene.sourceActorObjects.get(sourceDefault.children[0]),
    faceChild,
  );
  assert.equal(scene.sourceActorObjects.get(sourceBounds), nativeBounds);
  const originalBindings = [...scene.sourceActorObjects];
  const extra = await scene.loadActorFile("scene/scene.act");
  assert.equal(extra.children[0].name, nativeDefault.name);
  assert.notEqual(extra.children[0], nativeDefault);
  assert.deepEqual([...scene.sourceActorObjects], originalBindings);
  const additional = await scene.loadActorResource("scene/scene.act");
  assert.deepEqual(additional.sourceActors, scene.sourceActors);
  assert.notEqual(additional.sourceActors[0], sourceDefault);
  assert.equal(
    additional.sourceActorObjects.get(additional.sourceActors[0]),
    additional.group.children[0],
  );
  assert.equal(
    additional.sourceActorObjects.get(additional.sourceActors[0].children[0]),
    additional.group.children[0].children[0],
  );
  assert.equal(additional.sourceActorObjects.has(sourceDefault), false);
  assert.equal(scene.sourceActorObjects.has(additional.sourceActors[0]), false);
  assert.deepEqual([...scene.sourceActorObjects], originalBindings);
});

test("original Stock and Advanced scenes retain ACT source metadata", async (t) => {
  try {
    await access("carma2_orig");
  } catch {
    t.skip("local original assets are absent");
    return;
  }
  const store = await createAssetStore();
  const assets = new Assets();
  assets.manifest = store.manifest;
  assets.lookup = new Map(
    store.manifest.map(({ path }) => [path.toLowerCase(), path]),
  );
  assets.bytes = async (path) => store.read(path);

  const samples = [
    ["data/CARS/EAGLE3", "EAGLE3"],
    ["adv_data/CARS/69mach1", "69MACH1"],
    ["data/RACES/newcity1", "newcity1"],
    ["adv_data/RACES/newcity1", "newcity1"],
  ];
  for (const [dir, stem] of samples) {
    if (!assets.resolve(`${dir}/${stem}.act`)) {
      t.skip(`required Stock/Advanced ACT is unavailable: ${dir}/${stem}.act`);
      return;
    }
    const previousLiveMaterials = assets.materialArena.liveCount;
    const [scene, roots] = await Promise.all([
      assets.scene(dir, stem),
      assets.bytes(assets.resolve(`${dir}/${stem}.act`)).then(parseAct),
    ]);
    const visit = (node, object, index) => {
      assert.equal(object.userData.c2ActorType, node.type);
      assert.equal(object.userData.c2ActorRenderStyle, node.renderStyle);
      assert.equal(object.userData.c2ActorName, node.name);
      assert.equal(object.userData.c2ActorChildIndex, index);
      assert.equal(object.userData.c2ActorLocalModelName, node.model ?? null);
      assert.equal(
        object.userData.c2ActorLocalMaterialName,
        node.material ?? null,
      );
      assert.deepEqual(object.userData.c2ActorBounds, node.bounds);
      const childActors = object.children.filter(
        (child) => child.userData.c2ActorName !== undefined,
      );
      node.children.forEach((child, childIndex) =>
        visit(child, childActors[childIndex], childIndex),
      );
    };
    const expectedMaterials = new Map(),
      admittedNames = new Set(),
      expectedStorage = [];
    for (const path of assets.files(dir, /^[^/]+\.mat$/i))
      for (const mat of parseMat(await assets.bytes(path))) {
        if (admittedNames.has(mat.name)) continue;
        admittedNames.add(mat.name);
        expectedStorage.push(mat);
        expectedMaterials.set(
          mat.name.replace(/\.(pix|mat|dat|act|tif|tiff)$/i, "").toLowerCase(),
          mat,
        );
      }
    assert.deepEqual(scene.sourceMaterialStorage, expectedStorage);
    assert.equal(
      scene.materialArena.liveCount,
      previousLiveMaterials + expectedStorage.length,
    );
    for (const episode of scene.sourceMaterialEpisodes)
      assert.equal(
        scene.materialArena.materialAddress(episode.material).resolved,
        episode.accepted,
      );
    assert.deepEqual(scene.sourceMaterials, expectedMaterials);
    assert.equal(scene.sourceMaterials.size, scene.materials.size);
    for (const [key, mat] of scene.sourceMaterials) {
      assert.notEqual(mat, scene.materials.get(key));
      assert.equal(scene.materials.get(key).userData.c2Flags, mat.flags);
    }
    assert.deepEqual(scene.sourceActors, roots);
    roots.forEach((root, index) =>
      visit(root, scene.group.children[index], index),
    );
    let count = 0;
    const checkBinding = (node, object) => {
      count++;
      assert.equal(scene.sourceActorObjects.get(node), object);
      const children = object.children.filter(
        (child) => child.userData.c2ActorName !== undefined,
      );
      node.children.forEach((child, i) => checkBinding(child, children[i]));
    };
    scene.sourceActors.forEach((root, i) =>
      checkBinding(root, scene.group.children[i]),
    );
    assert.equal(scene.sourceActorObjects.size, count);
  }
});
