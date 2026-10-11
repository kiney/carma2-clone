import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Assets } from "../src/content.ts";
import { parseMat, parsePix } from "../src/formats.ts";
import { createAssetStore } from "../server/assets.mjs";
import {
  NativePedSlickMaterialRegistry,
  NATIVE_TEMPORARY_MATERIAL_CAPACITY,
  glorifyNativePedSlickMaterial,
  mapNativePedSlickMaterial,
} from "../src/ped-slick-materials.ts";

const f = Math.fround;
const quality = (overrides = {}) => ({
  interpolation: false,
  antialiasing: false,
  perspective: false,
  exceptionFlags: () => null,
  ...overrides,
});
const descriptor = (overrides = {}) => ({
  name: "GIBSMEAR.MAT",
  texture: "GIBSMEAR",
  rgba: [255, 255, 255, 255],
  ambient: f(0.2),
  diffuse: 0.5,
  specular: f(0.05),
  power: 20,
  flags: 0,
  uvTransform: [1, 0, 0, 1, 0, 0],
  ...overrides,
});
const bytes = (...parts) => Buffer.concat(parts.map((p) => Buffer.from(p)));
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const floats = (...ns) => {
  const b = Buffer.alloc(ns.length * 4);
  ns.forEach((n, i) => b.writeFloatBE(n, i * 4));
  return b;
};
const name = (n) => Buffer.from(n + "\0", "latin1");
const chunk = (tag, payload = Buffer.alloc(0), length = payload.length) =>
  bytes(u32(tag), u32(length), payload);
const header = (type) => bytes(u32(0x12), u32(8), u32(type), u32(2));
function mat(m = descriptor()) {
  const payload = bytes(
    m.rgba,
    floats(m.ambient, m.diffuse, m.specular, m.power),
    u32(m.flags),
    floats(...m.uvTransform),
    Buffer.alloc(17),
    name(m.name),
  );
  return bytes(
    header(5),
    chunk(0x3c, payload, payload.length + 2),
    chunk(0x1c, name(m.texture)),
    chunk(0),
  );
}
function pix(type = 18) {
  const pixelSize = type === 3 ? 1 : 2;
  const data = type === 3 ? bytes([1, 0]) : bytes(u16(0x8f42), u16(0));
  return bytes(
    header(2),
    chunk(
      0x3d,
      bytes(
        [type],
        u16(2 * pixelSize),
        u16(2),
        u16(1),
        Buffer.alloc(6),
        name(""),
      ),
    ),
    chunk(0x21, bytes(u32(2), u32(pixelSize), data)),
    chunk(0),
  );
}
function fixture({
  root = "data",
  mode = "PIX16",
  material = mat(),
  missing = [],
  options = {},
  palette,
} = {}) {
  const files = new Map([
    [`${root}/MATERIAL/GIBSMEAR.MAT`, material],
    [
      `${root}/PEDS/GIBLETS/${mode}/GIBSLICK.PIX`,
      pix(mode === "PIX8" ? 3 : 18),
    ],
    [`${root}/PIXELMAP/${mode}/GIBSMEAR.PIX`, pix(mode === "PIX8" ? 3 : 18)],
  ]);
  missing.forEach((path) => files.delete(path));
  const assets = new Assets(),
    reads = [];
  assets.manifest = [...files].map(([path, b]) => ({ path, size: b.length }));
  assets.lookup = new Map(
    [...files.keys()].map((path) => [path.toLowerCase(), path]),
  );
  assets.palette = palette;
  assets.bytes = async (path) => {
    reads.push(path);
    const b = files.get(assets.resolve(path));
    if (!b) throw new Error(`missing ${path}`);
    return b;
  };
  const registry = new NativePedSlickMaterialRegistry(assets, {
    dataRoot: root,
    pixelmapDirectory: mode,
    textureQuality: quality(),
    ...options,
  });
  return { assets, files, reads, registry };
}
function sourceTexture(type = 18) {
  const texture = new THREE.DataTexture(
    new Uint8Array([255, 68, 34, 136]),
    1,
    1,
    THREE.RGBAFormat,
  );
  texture.userData.c2PixelmapType = type;
  return texture;
}

test("original initial Glorify modes retain distinct procedural and authored source descriptors", async () => {
  const { registry, assets } = fixture(),
    result = await registry.prepare();
  assert.equal(result.status, "complete");
  assert.deepEqual(result.requiredProviders, []);
  assert.deepEqual([...result.materials.keys()], ["gibslick", "gibsmear"]);
  const [slick, smear] = result.resources;
  assert.equal(slick.kind, "procedural-gibslick");
  assert.equal(slick.materialPath, null);
  assert.equal(slick.source.ambient, f(0.99));
  assert.equal(slick.source.flags, 0x25);
  assert.equal(slick.effective.ambient, 1);
  assert.equal(smear.kind, "authored-gibsmear");
  assert.equal(smear.materialPath, "data/MATERIAL/GIBSMEAR.MAT");
  assert.deepEqual(
    smear.source,
    parseMat(fixture().files.get(smear.materialPath))[0],
  );
  assert.equal(smear.effective.flags, 5);
  assert.deepEqual(
    [
      smear.effective.ambient,
      smear.effective.diffuse,
      smear.effective.specular,
      smear.effective.power,
    ],
    [1, 0, 0, 20],
  );
  assert.equal(smear.material.name, "GIBSMEAR.MAT");
  assert.equal(smear.material.transparent, true); // PIX16 partial alpha, MAT opacity255.
  assert.equal(smear.material.opacity, 1);
  assert.equal(smear.material.side, THREE.FrontSide);
  assert.equal(smear.material.depthWrite, true);
  assert.equal(smear.material.alphaTest, 1 / 255);
  assert.equal(smear.material.map.image, smear.pixelmap.image);
  assert.notEqual(smear.material.map, smear.pixelmap);
  assert.deepEqual(
    [...smear.pixelmap.image.data],
    [255, 68, 34, 136, 0, 0, 0, 0],
  );
  assert.equal(assets.textures.size, 0); // Per-installation private source PIX registry.
  registry.dispose(() => true);
});

test("concurrent/repeated preparation retains exact MAT and PIX identity without repeated loads", async () => {
  const { registry, reads } = fixture();
  const first = registry.prepare(),
    second = registry.prepare();
  assert.equal(first, second);
  const a = await first,
    b = await registry.prepare();
  assert.equal(a, b);
  assert.equal(a.materials.get("gibslick"), b.materials.get("gibslick"));
  assert.equal(a.resources[0].pixelmap, b.resources[0].pixelmap);
  assert.equal(reads.length, 3);
  registry.dispose(() => true);
});

test("LoadTemporaryMaterial finds literal registered identity; duplicate entries and full200 return remain valid", async () => {
  const { registry } = fixture();
  await registry.prepare();
  const first = registry.loadTemporaryMaterial("GIBSLICK");
  assert.equal(first.status, "complete");
  assert.equal(first.appended, true);
  assert.equal(
    registry.loadTemporaryMaterial("gibslick").resource,
    first.resource,
  );
  assert.equal(
    registry.loadTemporaryMaterial("GIBSMEAR").status,
    "provider-required",
  );
  const smear = registry.loadTemporaryMaterial("GIBSMEAR.MAT");
  assert.equal(smear.resource.identifier, "GIBSMEAR.MAT");
  assert.throws(() => registry.loadTemporaryMaterial("*.MAT"), /literal/);
  while (
    registry.temporaryMaterials.length < NATIVE_TEMPORARY_MATERIAL_CAPACITY
  )
    registry.loadTemporaryMaterial("GIBSLICK");
  const full = registry.loadTemporaryMaterial("GIBSLICK");
  assert.equal(full.status, "complete");
  assert.equal(full.resource, first.resource);
  assert.equal(full.appended, false);
  assert.equal(registry.temporaryMaterials.length, 200);
  registry.removeFromAdaptation(first.resource);
  assert.equal(registry.temporaryMaterials.length, 200);
  assert.equal(registry.temporaryMaterials[2], smear.resource);
  assert.equal(
    registry.temporaryMaterials.filter((v) => v === null).length,
    199,
  );
  assert.equal(registry.loadTemporaryMaterial("GIBSLICK").appended, false);
  registry.dispose(() => true);
});

test("Glorify numeric modes preserve source power; PRELIT cleared by modes1/2/3/4", () => {
  const original = descriptor({
    flags: 2,
    ambient: 0.75,
    diffuse: 0.5,
    specular: 0.125,
    power: 37,
  });
  const expected = [
    [1, 0, 0, 2],
    [f(0.2), f(0.8), 0, 5],
    [f(0.6), f(0.2), f(0.8), 5],
    [f(0.4), f(0.8), 0, 5],
    [1, 0, 0, 5],
  ];
  for (let mode = 0; mode <= 4; mode++) {
    const out = glorifyNativePedSlickMaterial(original, mode, quality());
    assert.deepEqual(
      [out.ambient, out.diffuse, out.specular, out.flags],
      expected[mode],
    );
    assert.equal(out.power, 37);
  }
  assert.equal(original.flags, 2);
  assert.equal(original.ambient, 0.75);
});

test("Glorify reads texture identifier exceptions before shading; F32 .02 and OR-only quality retention", () => {
  const calls = [],
    q = quality({
      interpolation: true,
      antialiasing: true,
      perspective: true,
      exceptionFlags: (id) => (calls.push(id), 9),
    });
  const out = glorifyNativePedSlickMaterial(descriptor(), 4, q);
  assert.deepEqual(calls, ["GIBSMEAR"]);
  assert.equal(out.flags, 0x10025); // exception1 prevents interpolation.
  assert.deepEqual(out.uvTransform, [1, 0, 0, 1, f(0.02), f(0.02)]);
  const next = glorifyNativePedSlickMaterial(out, 0, quality());
  assert.equal(next.flags, out.flags);
  assert.deepEqual(next.uvTransform, out.uvTransform);
  assert.equal(
    glorifyNativePedSlickMaterial(
      descriptor(),
      0,
      quality({ interpolation: true }),
    ).flags,
    0x20000,
  );
  assert.throws(
    () =>
      glorifyNativePedSlickMaterial(
        descriptor(),
        1,
        quality({ exceptionFlags: () => undefined }),
      ),
    /exception/,
  );
  assert.throws(
    () =>
      glorifyNativePedSlickMaterial(
        descriptor({ ambient: 1e50 }),
        1,
        quality(),
      ),
    /descriptor/,
  );
  assert.throws(
    () => glorifyNativePedSlickMaterial(descriptor(), 5, quality()),
    /shading/,
  );
});

test("bounded mapping keeps UV, opacity, alpha, two-sided and texture sampler fields; unsupported lighting is explicit", () => {
  const source = descriptor({
    flags: 0x31825,
    ambient: 1,
    diffuse: 0,
    specular: 0,
    rgba: [255, 128, 64, 128],
    uvTransform: [2, 3, 4, 5, 0.25, 0.5],
  });
  const pixelmap = sourceTexture(),
    out = mapNativePedSlickMaterial(source, pixelmap);
  assert.equal(out.status, "complete");
  assert.equal(out.material.side, THREE.DoubleSide);
  assert.equal(out.material.opacity, 128 / 255);
  assert.equal(out.material.map.magFilter, THREE.LinearFilter);
  assert.equal(out.material.map.minFilter, THREE.LinearMipmapNearestFilter);
  assert.deepEqual(
    out.material.map.matrix.elements,
    [2, 3, 0, 4, 5, 0, 0.25, 0.5, 1],
  );
  for (const invalid of [
    descriptor({ flags: 1 }),
    descriptor({ flags: 2 }),
    descriptor({ flags: 0x40 }),
  ])
    assert.deepEqual(
      mapNativePedSlickMaterial(invalid, pixelmap).requiredProviders,
      ["native-slick-MAT-lighting-or-effect-mapping"],
    );
  assert.deepEqual(
    mapNativePedSlickMaterial(descriptor(), sourceTexture(5)).requiredProviders,
    ["native-slick-PIX-alpha-mapping"],
  );
  out.material.dispose();
  out.material.map.dispose();
  pixelmap.dispose();
});

test("PIX8 requires actual renderer palette and avoids parsePix grayscale fallback", async () => {
  const absent = fixture({ mode: "PIX8" });
  assert.deepEqual((await absent.registry.prepare()).requiredProviders, [
    "source-slick-PIX8-render-palette",
  ]);
  assert.equal(absent.reads.length, 0);
  absent.registry.dispose(() => true);
  const palette = new Uint8Array(1024);
  palette.set([10, 20, 30, 255], 4);
  const present = fixture({ mode: "PIX8", palette }),
    result = await present.registry.prepare();
  assert.equal(result.status, "complete");
  assert.deepEqual(
    [...result.resources[0].pixelmap.image.data],
    [10, 20, 30, 255, 0, 0, 0, 0],
  );
  assert.equal(result.resources[0].material.transparent, false);
  present.registry.dispose(() => true);
});

test("missing original resources, texture globals or actual internal MAT/PIX binding never fabricate resources", async () => {
  const cases = [
    [
      fixture({ missing: ["data/MATERIAL/GIBSMEAR.MAT"] }),
      "source-slick-MAT:data/MATERIAL/GIBSMEAR.MAT",
    ],
    [
      fixture({ missing: ["data/PEDS/GIBLETS/PIX16/GIBSLICK.PIX"] }),
      "source-slick-PIX:data/PEDS/GIBLETS/PIX16/GIBSLICK.PIX",
    ],
    [
      fixture({ options: { textureQuality: undefined } }),
      "native-slick-texture-glorification-state",
    ],
    [
      fixture({ material: mat(descriptor({ name: "OTHER.MAT" })) }),
      "source-registered-slick-MAT:GIBSMEAR.MAT",
    ],
    [
      fixture({ material: mat(descriptor({ texture: "OTHER" })) }),
      "source-slick-MAT-PIX-binding:GIBSMEAR.MAT",
    ],
  ];
  for (const [host, expected] of cases) {
    const result = await host.registry.prepare();
    assert.equal(result.status, "provider-required");
    assert.ok(result.requiredProviders.includes(expected));
    host.registry.dispose(() => true);
  }
});

test("a genuinely missing mapping provider is retryable while successful resources retain identity", async () => {
  let missing = true;
  const host = fixture({
    options: {
      mapMaterial: (source, pix, kind) =>
        kind === "authored-gibsmear" && missing
          ? {
              status: "provider-required",
              material: null,
              requiredProviders: ["actual-slick-shader"],
            }
          : mapNativePedSlickMaterial(source, pix),
    },
  });
  const a = await host.registry.prepare();
  assert.deepEqual(a.requiredProviders, ["actual-slick-shader"]);
  const identity = a.materials.get("gibslick");
  missing = false;
  const b = await host.registry.prepare();
  assert.equal(b.status, "complete");
  assert.equal(b.materials.get("gibslick"), identity);
  assert.equal(host.reads.filter((p) => p.endsWith("GIBSLICK.PIX")).length, 1);
  assert.equal(host.reads.filter((p) => p.endsWith("GIBSMEAR.PIX")).length, 1);
  host.registry.dispose(() => true);
});

test("cached adaptation needs real in-place Glorify/fog owner, visits duplicate pointers in order and clears count", async () => {
  const { registry } = fixture();
  await registry.prepare();
  const a = registry.loadTemporaryMaterial("GIBSLICK").resource,
    b = registry.loadTemporaryMaterial("GIBSMEAR.MAT").resource;
  registry.loadTemporaryMaterial("GIBSLICK");
  assert.equal(registry.adaptCachedMaterials(1).status, "provider-required");
  assert.equal(registry.temporaryMaterials.length, 3);
  const calls = [];
  assert.equal(
    registry.adaptCachedMaterials(1, (resource, next) => {
      calls.push(resource);
      assert.equal(
        resource.material,
        registry.materials.get(
          resource.identifier.replace(/\.mat$/i, "").toLowerCase(),
        ),
      );
      assert.deepEqual(
        [next.ambient, next.diffuse, next.specular],
        [f(0.2), f(0.8), 0],
      );
    }).status,
    "complete",
  );
  assert.deepEqual(calls, [a, b, a]);
  assert.equal(registry.temporaryMaterials.length, 0);
  assert.equal(a.effective.diffuse, f(0.8));
  registry.loadTemporaryMaterial("GIBSLICK");
  registry.loadTemporaryMaterial("GIBSMEAR.MAT");
  registry.removeFromAdaptation(a);
  assert.equal(
    registry.adaptCachedMaterials(4, (resource) => {
      assert.equal(resource, b);
    }).status,
    "complete",
  );
  registry.dispose(() => true);
});

test("adaptation failure retains pending list rather than inventing fog completion", async () => {
  const { registry } = fixture();
  await registry.prepare();
  registry.loadTemporaryMaterial("GIBSLICK");
  const out = registry.adaptCachedMaterials(1, () => ["source-fog-state"]);
  assert.deepEqual(out.requiredProviders, ["source-fog-state"]);
  assert.equal(registry.temporaryMaterials.length, 1);
  assert.equal(registry.temporaryMaterials[0].effective.ambient, 1);
  assert.throws(
    () => registry.adaptCachedMaterials(1, () => [""]),
    /adaptation result/,
  );
  registry.dispose(() => true);
});

test("borrowed registered identity bypasses initialization and survives registry disposal", async () => {
  const { registry } = fixture(),
    material = new THREE.MeshBasicMaterial(),
    pixelmap = sourceTexture();
  const source = descriptor(),
    effective = descriptor({
      flags: 5,
      ambient: f(0.2),
      diffuse: f(0.8),
      specular: 0,
    });
  const resource = {
    identifier: source.name,
    kind: "authored-gibsmear",
    source,
    effective,
    material,
    pixelmap,
    materialPath: "data/MATERIAL/GIBSMEAR.MAT",
    pixelmapPath: "data/PIXELMAP/PIX16/GIBSMEAR.PIX",
    owned: false,
  };
  let materialDisposed = 0,
    pixelmapDisposed = 0;
  material.addEventListener("dispose", () => materialDisposed++);
  pixelmap.addEventListener("dispose", () => pixelmapDisposed++);
  registry.addBorrowed(resource);
  const prepared = await registry.prepare();
  assert.equal(prepared.materials.get("gibsmear"), material);
  assert.equal(
    registry.loadTemporaryMaterial("gibsmear.mat").resource,
    resource,
  );
  assert.equal(resource.effective, effective); // InitSkids found-existing branch does not reinitialize.
  assert.throws(() => registry.dispose(() => false), /borrowers/);
  registry.dispose(() => true);
  registry.dispose(() => true);
  assert.equal(materialDisposed, 0);
  assert.equal(pixelmapDisposed, 0);
  assert.throws(() => registry.loadTemporaryMaterial("GIBSLICK"), /disposed/);
  material.dispose();
  pixelmap.dispose();
});

test("owned MAT, per-MAT UV wrapper and source PIX are disposed exactly once after explicit release proof", async () => {
  const { registry } = fixture(),
    result = await registry.prepare(),
    counters = [];
  for (const resource of result.resources)
    for (const object of [
      resource.material,
      resource.material.map,
      resource.pixelmap,
    ]) {
      const index = counters.length;
      counters.push(0);
      object.addEventListener("dispose", () => counters[index]++);
    }
  registry.dispose(() => true);
  registry.dispose(() => true);
  assert.deepEqual(counters, [1, 1, 1, 1, 1, 1]);
});

test("lifetime and explicit tree/mode input validation reject invalid source ownership", async () => {
  const host = fixture();
  assert.throws(
    () =>
      new NativePedSlickMaterialRegistry(host.assets, {
        dataRoot: "guess",
        pixelmapDirectory: "PIX16",
      }),
    /explicit/,
  );
  assert.throws(
    () =>
      new NativePedSlickMaterialRegistry(host.assets, {
        dataRoot: "data",
        pixelmapDirectory: "TIFF",
      }),
    /explicit/,
  );
  const preparing = host.registry.prepare();
  assert.throws(() => host.registry.dispose(() => true), /preparation/);
  await preparing;
  host.registry.dispose(() => true);
});

const originalRoot =
  process.env.CARMA2_ROOT ||
  new URL("../carma2_orig/", import.meta.url).pathname;
for (const dataRoot of ["data", "adv_data"])
  test(`original ${dataRoot} GIBSLICK/GIBSMEAR PIX16 resources use actual MAT, partial alpha and shared identity`, async (t) => {
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
      store.manifest.map((e) => [e.path.toLowerCase(), e.path]),
    );
    assets.bytes = async (path) => {
      const b = await store.read(path);
      if (!b) throw new Error(`Missing original ${path}`);
      return new Uint8Array(b);
    };
    const registry = new NativePedSlickMaterialRegistry(assets, {
      dataRoot,
      pixelmapDirectory: "PIX16",
      textureQuality: quality(),
    });
    const result = await registry.prepare();
    assert.equal(result.status, "complete");
    const [slick, smear] = result.resources;
    assert.deepEqual(
      smear.source,
      parseMat(await assets.bytes(`${dataRoot}/MATERIAL/GIBSMEAR.MAT`))[0],
    );
    assert.equal(smear.source.flags, 0);
    assert.equal(smear.source.power, 20);
    assert.equal(smear.source.diffuse, 0.5);
    assert.equal(slick.source.flags, 0x25);
    assert.equal(slick.source.ambient, f(0.99));
    for (const r of result.resources) {
      const parsed = parsePix(await assets.bytes(r.pixelmapPath))[0];
      assert.equal(parsed.format, 18);
      assert.equal(parsed.width, 64);
      assert.equal(parsed.height, 64);
      assert.deepEqual(r.pixelmap.image.data, parsed.rgba);
      assert.equal(r.material.transparent, true);
      assert.equal(r.material.opacity, 1);
      assert.equal(registry.loadTemporaryMaterial(r.identifier).resource, r);
      assert.equal(
        registry.loadTemporaryMaterial(r.identifier.toLowerCase()).resource,
        r,
      );
    }
    const alpha = new Set(
      Array.from(smear.pixelmap.image.data).filter((_, i) => i % 4 === 3),
    );
    assert.ok(alpha.has(0) && alpha.has(255) && alpha.has(136));
    assert.equal(alpha.size, 16);
    const count = registry.temporaryMaterials.length;
    assert.equal(registry.adaptCachedMaterials(1).status, "provider-required");
    assert.equal(registry.temporaryMaterials.length, count);
    registry.dispose(() => true);
  });

for (const dataRoot of ["data", "adv_data"])
  test(`original ${dataRoot} archived renderer palette resolves actual PIX8 slick colours`, async (t) => {
    let store;
    try {
      store = await createAssetStore(originalRoot);
    } catch (error) {
      if (error?.code === "ENOENT") {
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
      if (!bytes) throw new Error(`Missing original ${path}`);
      return new Uint8Array(bytes);
    };
    const path = assets.resolve(`${dataRoot}/Reg/PALETTES/DRRENDER.PAL`);
    assert.ok(path, "palette supplied through archive virtual manifest");
    const original = parsePix(await assets.bytes(path))[0];
    assert.equal(original.format, 7);
    assert.equal(original.width, 1);
    assert.equal(original.height, 256);
    assets.palette = original.palette;
    assert.equal(assets.palette.length, 1024);
    assert.deepEqual(
      [...assets.palette.slice(227 * 4, 227 * 4 + 4)],
      [60, 59, 60, 255],
    );
    const registry = new NativePedSlickMaterialRegistry(assets, {
      dataRoot,
      pixelmapDirectory: "PIX8",
      textureQuality: quality(),
    });
    try {
      const result = await registry.prepare();
      assert.equal(result.status, "complete");
      assert.deepEqual(result.requiredProviders, []);
      for (const resource of result.resources) {
        const parsed = parsePix(
          await assets.bytes(resource.pixelmapPath),
          assets.palette,
        )[0];
        assert.equal(parsed.format, 3);
        assert.deepEqual(resource.pixelmap.image.data, parsed.rgba);
        const rgba = resource.pixelmap.image.data;
        let transparent = 0,
          coloured = 0;
        for (let i = 0; i < rgba.length; i += 4) {
          if (rgba[i + 3] === 0) transparent++;
          else if (rgba[i] !== rgba[i + 1] || rgba[i + 1] !== rgba[i + 2])
            coloured++;
        }
        assert.ok(transparent > 0, "source transparent index0 preserved");
        assert.ok(coloured > 0, "authored palette replaces grayscale fallback");
      }
    } finally {
      registry.dispose(() => true);
    }
  });
