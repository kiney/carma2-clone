import assert from "node:assert/strict";
import test from "node:test";
import { createAssetStore } from "../server/assets.mjs";
import * as THREE from "three";
import { Assets } from "../src/content.ts";
import { NativeResourceArena } from "../src/native-resource-arena.ts";

const u16 = (value) => {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value);
  return bytes;
};
const u32 = (value) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
};
const f32 = (value) => {
  const bytes = Buffer.alloc(4);
  bytes.writeFloatBE(value);
  return bytes;
};
const bytes = (...parts) => Buffer.concat(parts);
const name = (value) => Buffer.from(`${value}\0`, "latin1");
const chunk = (tag, payload = Buffer.alloc(0)) =>
  bytes(u32(tag), u32(payload.length), payload);
const header = (type) => bytes(chunk(0x12, bytes(u32(type), u32(2))));
const floats = (...values) => bytes(...values.map(f32));

function materialRecord(nameValue, textureName) {
  const payload = bytes(
    Buffer.from([255, 128, 64, 255]),
    floats(0.1, 0.7, 0, 20),
    u32(0x1003),
    floats(1, 0, 0, 1, 0, 0),
    Buffer.from([0, 0]),
    f32(0),
    f32(0),
    Buffer.from([0, 0, 0]),
    u32(0),
    name(nameValue),
  );
  return bytes(
    chunk(0x3c, payload),
    ...(textureName ? [chunk(0x1c, name(textureName))] : []),
    chunk(0),
  );
}

function material(nameValue, textureName) {
  return bytes(header(5), materialRecord(nameValue, textureName));
}

function materialFile(records) {
  return bytes(
    header(5),
    ...records.map(([nameValue, texture]) =>
      materialRecord(nameValue, texture),
    ),
  );
}

function pixelmap(mapName, pixel = 0xf800) {
  return bytes(
    header(2),
    chunk(
      0x3d,
      bytes(
        Buffer.from([5]),
        u16(2),
        u16(1),
        u16(1),
        Buffer.alloc(6),
        name(mapName),
      ),
    ),
    chunk(0x21, bytes(u32(1), u32(2), u16(pixel))),
    chunk(0),
  );
}

function model(modelName, materialName) {
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  return bytes(
    header(0xface),
    chunk(0x36, bytes(u16(0), name(modelName))),
    chunk(0x17, bytes(u32(3), floats(...positions))),
    chunk(0x18, bytes(u32(3), floats(0, 0, 1, 0, 0, 1))),
    chunk(
      0x35,
      bytes(u32(1), u16(0), u16(1), u16(2), u16(3), Buffer.from([0])),
    ),
    chunk(0x16, bytes(u32(1), name(materialName))),
    chunk(0x1a, bytes(u32(1), u32(2), u16(1))),
    chunk(0),
  );
}

function actor(modelName) {
  return bytes(
    header(1),
    chunk(0x23, bytes(Buffer.from([1, 4]), name("fixture-actor"))),
    chunk(0x24, name(modelName)),
    chunk(0),
  );
}

function fixtureFiles(prefix, { materialName, modelName, actorBytes } = {}) {
  materialName ??= `${prefix}-material`;
  modelName ??= `${prefix}-model`;
  return new Map([
    [`${prefix}/scene.mat`, material(materialName)],
    [`${prefix}/scene.dat`, model(modelName, materialName)],
    [`${prefix}/scene.act`, actorBytes ?? actor(modelName)],
  ]);
}

function createAssets(files) {
  const assets = new Assets();
  assets.manifest = [...files].map(([path, data]) => ({
    path,
    size: data.length,
  }));
  assets.lookup = new Map(
    assets.manifest.map(({ path }) => [path.toLowerCase(), path]),
  );
  assets.bytes = async (path) => {
    const data = files.get(path);
    if (!data) throw new Error(`Fixture asset absent: ${path}`);
    return data;
  };
  return assets;
}

function assertSameRegistrations(registry, expected) {
  assert.equal(registry.registrations.length, expected.length);
  expected.forEach((entry, index) =>
    assert.strictEqual(registry.registrations[index], entry),
  );
}

function registerBaseline(assets) {
  const permanentMaterial = assets.registerGeneratedMaterial({
    name: "permanent-material",
    rgba: [1, 2, 3, 255],
    ambient: 0,
    diffuse: 1,
    specular: 0,
    power: 20,
    flags: 1,
    uvTransform: [1, 0, 0, 1, 0, 0],
  });
  const permanentModel = { name: "permanent-model", faces: [] };
  assets.nativeModelRegistry.add({}, permanentModel);
  return {
    permanentMaterial,
    materialRegistrations: [...assets.nativeMaterialRegistry.registrations],
    modelRegistrations: [...assets.nativeModelRegistry.registrations],
    liveMaterials: assets.materialArena.liveCount,
  };
}

function assertAtBaseline(assets, baseline) {
  assertSameRegistrations(
    assets.nativeMaterialRegistry,
    baseline.materialRegistrations,
  );
  assertSameRegistrations(
    assets.nativeModelRegistry,
    baseline.modelRegistrations,
  );
  assert.equal(assets.materialArena.liveCount, baseline.liveMaterials);
  assert.strictEqual(
    assets.nativeMaterialRegistry.find("permanent-material"),
    baseline.permanentMaterial,
  );
}

function installManifest(assets, paths) {
  assets.manifest = paths.map((path) => ({ path, size: 1 }));
  assets.lookup = new Map(paths.map((path) => [path.toLowerCase(), path]));
}

test("asset byte failures are evicted, shared while pending, and successful bytes stay cached", async () => {
  const assets = new Assets();
  const path = "fixture/item.dat";
  installManifest(assets, [path]);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let finishFirst;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1)
      return await new Promise((resolve) => {
        finishFirst = resolve;
      });
    if (calls === 2) throw new Error("network interrupted");
    if (calls === 3)
      return {
        ok: true,
        arrayBuffer: async () => {
          throw new Error("interrupted response body");
        },
      };
    return {
      ok: true,
      arrayBuffer: async () => Uint8Array.from([4, 5, 6]).buffer,
    };
  };
  try {
    const first = assets.bytes(path);
    const concurrent = assets.bytes(path);
    assert.equal(calls, 1, "concurrent reads share one in-flight fetch");
    finishFirst({ ok: false, status: 503 });
    await assert.rejects(first, /HTTP 503/);
    await assert.rejects(concurrent, /HTTP 503/);
    await assert.rejects(assets.bytes(path), /network interrupted/);
    await assert.rejects(assets.bytes(path), /interrupted response body/);

    const recovered = await assets.bytes(path);
    assert.deepEqual([...recovered], [4, 5, 6]);
    assert.strictEqual(await assets.bytes(path), recovered);
    assert.equal(
      calls,
      4,
      "HTTP, network, and body-read failures are retried, then successful bytes are cached",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a failed older byte request cannot evict a newer cached request", async () => {
  const assets = new Assets();
  const path = "fixture/racing.dat";
  installManifest(assets, [path]);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let rejectOld;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1)
      return await new Promise((_, reject) => {
        rejectOld = reject;
      });
    return {
      ok: true,
      arrayBuffer: async () => Uint8Array.from([9]).buffer,
    };
  };
  try {
    const old = assets.bytes(path);
    // Model explicit cache invalidation while the first fetch is still pending.
    assets.cache.delete(path);
    const newer = assets.bytes(path);
    assert.deepEqual([...(await newer)], [9]);
    rejectOld(new Error("obsolete request failure"));
    await assert.rejects(old, /obsolete request failure/);
    assert.deepEqual([...(await assets.bytes(path))], [9]);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unknown asset paths do not issue a fetch", async () => {
  const assets = new Assets();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("unexpected fetch");
  };
  try {
    await assert.rejects(assets.bytes("not/in/manifest.dat"), /Asset missing/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("partial allocation of a MAT batch rolls back without freeing an earlier owner", async () => {
  const files = fixtureFiles("allocation-failure");
  files.set(
    "allocation-failure/scene.mat",
    materialFile([["first-batch-material"], ["second-batch-material"]]),
  );
  const assets = createAssets(files);
  // One permanent and one provisional 180-byte allocation fit; the next does
  // not. Native admission occurs only after the complete MAT file allocates.
  assets.materialArena = new NativeResourceArena({
    initialCapacity: 512,
    maxCapacity: 512,
  });
  const baseline = registerBaseline(assets);
  await assert.rejects(
    assets.scene("allocation-failure", "scene", { storage: "track" }),
    /capacity/,
  );
  assertAtBaseline(assets, baseline);
  assets.releaseRaceResources();
  assertAtBaseline(assets, baseline);
});

for (const stage of ["mat", "dat", "geometry", "act"]) {
  test(`failed ${stage.toUpperCase()} scene construction rolls back its resource episode and permits retry`, async () => {
    const broken = fixtureFiles("broken", {
      actorBytes: stage === "act" ? Buffer.from([1, 2, 3]) : undefined,
    });
    if (stage === "mat") {
      // The first MAT file is admitted before the later malformed file fails.
      broken.delete("broken/scene.mat");
      broken.set("broken/a.mat", material("broken-first-material"));
      broken.set("broken/z.mat", Buffer.from([1, 2, 3]));
    } else if (stage === "dat") {
      broken.set("broken/scene.dat", Buffer.from([1, 2, 3]));
    }
    const assets = createAssets(broken);
    const baseline = registerBaseline(assets);
    let generatedGeometry,
      generatedGeometryDisposals = 0;
    if (stage === "geometry") {
      const original = assets.bindModelGeometry;
      assets.bindModelGeometry = function (source, defaultMaterial) {
        const data = original.call(this, source, defaultMaterial);
        if (source.name === "broken-model") {
          generatedGeometry = data.geometry;
          generatedGeometry.addEventListener(
            "dispose",
            () => generatedGeometryDisposals++,
          );
          throw new Error("TEST FIXTURE: injected geometry failure");
        }
        return data;
      };
    }

    await assert.rejects(
      assets.scene("broken", "scene", { storage: "track" }),
      stage === "geometry"
        ? /injected geometry failure/
        : stage === "act"
          ? /ACT/
          : stage === "mat"
            ? /MAT/
            : /DAT/,
    );
    assertAtBaseline(assets, baseline);
    if (generatedGeometry) {
      assert.equal(assets.ownsNativeGeometry(generatedGeometry), false);
      assert.equal(
        generatedGeometryDisposals,
        1,
        "rollback disposes geometry admitted before failure",
      );
    }
    if (stage === "geometry") delete assets.bindModelGeometry;

    const retryFiles = fixtureFiles("retry", {
      materialName: "retry-material",
      modelName: "retry-model",
    });
    for (const [path, data] of retryFiles) {
      assets.manifest.push({ path, size: data.length });
      assets.lookup.set(path.toLowerCase(), path);
    }
    const originalBytes = assets.bytes.bind(assets);
    assets.bytes = async (path) => retryFiles.get(path) ?? originalBytes(path);
    const retried = await assets.scene("retry", "scene", { storage: "track" });
    assert.equal(
      retried.findSourceMaterial("retry-material")?.name,
      "retry-material",
    );
    assert.equal(retried.findSourceModel("retry-model")?.name, "retry-model");
    assert.ok(retried.group.children.length > 0);
    retried.dispose();
    retried.dispose();
    assertAtBaseline(assets, baseline);
  });
}

test("geometry binding validation disposes the BufferGeometry created before it throws", async () => {
  const assets = createAssets(fixtureFiles("geometry-validation"));
  const baseline = registerBaseline(assets);
  const originalBindModelMaterials = assets.bindModelMaterials;
  const originalGeometryDispose = THREE.BufferGeometry.prototype.dispose;
  const disposed = [];
  assets.bindModelMaterials = function (source) {
    originalBindModelMaterials.call(this, source);
    this.nativeModelMaterialBindings.delete(source);
  };
  THREE.BufferGeometry.prototype.dispose = function () {
    disposed.push(this);
    return originalGeometryDispose.call(this);
  };
  try {
    await assert.rejects(
      assets.scene("geometry-validation", "scene", { storage: "track" }),
      /Native DAT material bindings missing/,
    );
    assert.equal(disposed.length, 1);
    assert.equal(assets.ownsNativeGeometry(disposed[0]), false);
    assertAtBaseline(assets, baseline);
  } finally {
    THREE.BufferGeometry.prototype.dispose = originalGeometryDispose;
  }
});

test("failed second scene sharing storage preserves existing resource identities and order", async () => {
  const files = fixtureFiles("first", {
    materialName: "first-material",
    modelName: "first-model",
  });
  const broken = fixtureFiles("second", {
    materialName: "second-material",
    modelName: "second-model",
    actorBytes: Buffer.from([1, 2, 3]),
  });
  files.set(
    "first/scene.mat",
    materialFile([["first-material"], ["first-material"]]),
  );
  // A rejected duplicate in the failed episode borrows the earlier accepted
  // material; rollback must retire the rejected allocation, not that owner.
  broken.set(
    "second/scene.mat",
    materialFile([["first-material"], ["second-material"]]),
  );
  const assets = createAssets(new Map([...files, ...broken]));
  const baseline = registerBaseline(assets);
  const first = await assets.scene("first", "scene", { storage: "track" });
  assert.equal(first.stats.rejectedMaterials, 1);
  const materialsAfterFirst = [...assets.nativeMaterialRegistry.registrations];
  const modelsAfterFirst = [...assets.nativeModelRegistry.registrations];
  const liveAfterFirst = assets.materialArena.liveCount;
  const firstMaterial = first.findSourceMaterial("first-material");
  const firstModel = first.findSourceModel("first-model");

  await assert.rejects(
    assets.scene("second", "scene", { storage: "track" }),
    /ACT/,
  );

  assertSameRegistrations(assets.nativeMaterialRegistry, materialsAfterFirst);
  assertSameRegistrations(assets.nativeModelRegistry, modelsAfterFirst);
  assert.equal(assets.materialArena.liveCount, liveAfterFirst);
  assert.strictEqual(
    assets.nativeMaterialRegistry.find("first-material"),
    firstMaterial,
  );
  assert.strictEqual(
    assets.nativeModelRegistry.find("first-model"),
    firstModel,
  );
  assert.equal(
    assets.ownsNativeGeometry(first.sourceModelGeometries.get(firstModel)),
    true,
  );

  first.dispose();
  first.dispose();
  assertAtBaseline(assets, baseline);
});

test("ACT rollback disposes new local textures and material maps but preserves shared textures", async () => {
  const files = fixtureFiles("textured-failure", {
    materialName: "unused-material",
    modelName: "textured-model",
    actorBytes: Buffer.from([1, 2, 3]),
  });
  files.set(
    "textured-failure/scene.mat",
    materialFile([
      ["local-material", "local-map"],
      ["shared-material", "shared-map"],
    ]),
  );
  files.set(
    "textured-failure/scene.dat",
    model("textured-model", "local-material"),
  );
  files.set("textured-failure/LOCAL.PIX", pixelmap("local-map"));
  const assets = createAssets(files);
  const sharedTexture = new THREE.DataTexture(
    new Uint8Array([10, 20, 30, 255]),
    1,
    1,
  );
  assets.textures.set("shared-map", sharedTexture);
  const baseline = registerBaseline(assets);
  const disposedTextures = new Set();
  const originalTextureDispose = THREE.Texture.prototype.dispose;
  const originalPixelmaps = assets.pixelmaps.bind(assets);
  const originalBytes = assets.bytes.bind(assets);
  let localTexture;
  const materialMaps = [];
  THREE.Texture.prototype.dispose = function () {
    disposedTextures.add(this);
    return originalTextureDispose.call(this);
  };
  assets.pixelmaps = async (path, target, owned) => {
    const result = await originalPixelmaps(path, target, owned);
    if (path.endsWith("LOCAL.PIX")) localTexture = target.get("local-map");
    return result;
  };
  assets.bytes = async (path) => {
    const data = await originalBytes(path);
    if (path.endsWith("scene.act"))
      for (const render of assets.renderedNativeMaterials.values())
        if (render.map) materialMaps.push(render.map);
    return data;
  };
  try {
    await assert.rejects(
      assets.scene("textured-failure", "scene", { storage: "track" }),
      /ACT/,
    );
    assertAtBaseline(assets, baseline);
    assert.ok(localTexture, "the synthetic local PIX was loaded");
    assert.equal(materialMaps.length, 2);
    assert.ok(disposedTextures.has(localTexture));
    for (const map of materialMaps) assert.ok(disposedTextures.has(map));
    assert.equal(
      disposedTextures.has(sharedTexture),
      false,
      "the preexisting shared source texture remains owned by the texture library",
    );
    assert.strictEqual(assets.textures.get("shared-map"), sharedTexture);
  } finally {
    THREE.Texture.prototype.dispose = originalTextureDispose;
  }
});

test("an ACT read failure retries the actual Stock Eagle scene without retaining partial resources", async (t) => {
  let store;
  try {
    store = await createAssetStore();
  } catch (error) {
    if (error?.code === "ENOENT") {
      t.skip("local original installation absent");
      return;
    }
    throw error;
  }
  const dir = "data/CARS/EAGLE3";
  const actorPath = store.manifest.find(
    ({ path }) => path.toLowerCase() === `${dir.toLowerCase()}/eagle3.act`,
  )?.path;
  if (!actorPath) {
    t.skip("Stock Eagle ACT is absent from the local installation");
    return;
  }

  const assets = new Assets();
  assets.manifest = store.manifest;
  assets.lookup = new Map(
    store.manifest.map(({ path }) => [path.toLowerCase(), path]),
  );
  let rejectActorOnce = true;
  assets.bytes = async (path) => {
    if (path === actorPath && rejectActorOnce) {
      rejectActorOnce = false;
      throw new Error("TEST FIXTURE: transient Eagle ACT read failure");
    }
    return store.read(path);
  };

  await assert.rejects(
    assets.scene(dir, "EAGLE3", { storage: "stock-eagle" }),
    /transient Eagle ACT read failure/,
  );
  assert.equal(assets.materialArena.liveCount, 0);
  assert.equal(assets.nativeMaterialRegistry.registrations.length, 0);
  assert.equal(assets.nativeModelRegistry.registrations.length, 0);
  assets.releaseRaceResources();
  assert.equal(assets.materialArena.liveCount, 0);
  assert.equal(assets.nativeMaterialRegistry.registrations.length, 0);
  assert.equal(assets.nativeModelRegistry.registrations.length, 0);

  assets.bytes = async (path) => store.read(path);
  const scene = await assets.scene(dir, "EAGLE3", { storage: "stock-eagle" });
  assert.ok(scene.group.children.length > 0);
  assert.ok(scene.materials.size > 0);
  assert.ok(scene.models.size > 0);
  scene.dispose();
  scene.dispose();
  assert.equal(assets.materialArena.liveCount, 0);
  assert.equal(assets.nativeMaterialRegistry.registrations.length, 0);
  assert.equal(assets.nativeModelRegistry.registrations.length, 0);
  assets.releaseRaceResources();
  assert.equal(assets.materialArena.liveCount, 0);
});
