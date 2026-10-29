import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { Assets } from "../src/content.ts";
import { parseMat, parsePix } from "../src/formats.ts";
import { nativeRenderMaterialSource } from "../src/native-material-render.ts";
import { loadNativePedSmearMaterial } from "../src/ped-smear-material.ts";

const concat = (...parts) =>
  Buffer.concat(parts.map((part) => Buffer.from(part)));
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
const floats = (...numbers) => {
  const b = Buffer.alloc(numbers.length * 4);
  numbers.forEach((n, i) => b.writeFloatBE(n, i * 4));
  return b;
};
const name = (s) => Buffer.from(s + "\0", "latin1");
const chunk = (tag, body = Buffer.alloc(0), length = body.length) =>
  concat(u32(tag), u32(length), body);
const header = (type) => concat(u32(0x12), u32(8), u32(type), u32(2));
function mat({
  identifier = "PEDSMEAR",
  texture = "pedsmear",
  flags = 0x1021,
  alpha = 128,
} = {}) {
  const body = concat(
    [255, 220, 180, alpha],
    floats(0.3, 0.4, 0.1, 12),
    u32(flags),
    floats(2, 0, 0, 3, 0.25, 0.5),
    Buffer.alloc(17),
    name(identifier),
  );
  return concat(
    header(5),
    chunk(0x3c, body, body.length + 2),
    ...(texture === null ? [] : [chunk(0x1c, name(texture))]),
    chunk(0),
  );
}
function pix(identifier = "") {
  return concat(
    header(2),
    chunk(
      0x3d,
      concat([18], u16(4), u16(2), u16(1), Buffer.alloc(6), name(identifier)),
    ),
    chunk(0x21, concat(u32(2), u32(2), u16(0x8f42), u16(0))),
    chunk(0),
  );
}
function fixture({
  material = mat(),
  pixelmap = pix(),
  missing = [],
  root = "data",
  options,
} = {}) {
  const files = new Map([
    [`${root}/PEDS/GIBLETS/PEDSMEAR.MAT`, material],
    [`${root}/PEDS/GIBLETS/PIX16/PEDSMEAR.PIX`, pixelmap],
    [`${root}/MATERIAL/GIBSMEAR.MAT`, mat({ identifier: "GIBSMEAR.MAT" })],
  ]);
  for (const path of missing) files.delete(path);
  const assets = new Assets(),
    reads = [];
  assets.manifest = [...files].map(([path, value]) => ({
    path,
    size: value.length,
  }));
  assets.bytes = async (path) => {
    reads.push(path);
    const value = files.get(path);
    if (!value) throw new Error(`Missing ${path}`);
    return value;
  };
  if (options) assets.configureNativeRendering(options);
  return { assets, files, reads };
}

test("PEDSMEAR maps authored MAT RGBA/flags/UV through native rendering and preserves PIX16 alpha", async () => {
  const h = fixture(),
    result = await loadNativePedSmearMaterial(h.assets, "data");
  assert.deepEqual(result.requiredProviders, []);
  const m = result.material,
    source = parseMat(h.files.get("data/PEDS/GIBLETS/PEDSMEAR.MAT"))[0];
  assert.equal(m.name, "PEDSMEAR");
  assert.deepEqual(nativeRenderMaterialSource(m), source);
  assert.equal(m.userData.c2Flags, 0x1021);
  assert.equal(m.opacity, 128 / 255);
  assert.equal(m.transparent, true);
  assert.equal(m.depthWrite, true);
  assert.equal(m.side, THREE.DoubleSide);
  assert.equal(m.alphaTest, 1 / 255);
  assert.equal(m.toneMapped, false);
  assert.equal(m.map.flipY, false);
  assert.equal(m.map.wrapS, THREE.RepeatWrapping);
  assert.equal(m.map.wrapT, THREE.RepeatWrapping);
  assert.equal(m.map.colorSpace, THREE.NoColorSpace);
  assert.equal(m.map.magFilter, THREE.NearestFilter);
  assert.equal(m.map.userData.c2PixelmapType, 18);
  assert.deepEqual(m.map.matrix.elements, [2, 0, 0, 0, 3, 0, 0.25, 0.5, 1]);
  assert.deepEqual([...m.map.image.data], [255, 68, 34, 136, 0, 0, 0, 0]);
  assert.deepEqual(h.reads, [
    "data/PEDS/GIBLETS/PEDSMEAR.MAT",
    "data/PEDS/GIBLETS/PIX16/PEDSMEAR.PIX",
  ]);
  assert.equal(h.assets.textures.size, 0);
  result.dispose();
});

test("actual Assets renderer options reach native shading, texture sampling and UV exceptions", async () => {
  const h = fixture({
    options: {
      shading: 4,
      interpolation: true,
      antialiasing: true,
      textureExceptions: new Map([["PEDSMEAR", 8]]),
    },
  });
  const result = await loadNativePedSmearMaterial(h.assets, "data"),
    m = result.material;
  assert.deepEqual(
    m.userData.c2NativeUniforms.c2Coefficients.value.toArray(),
    [1, 0, 0],
  );
  assert.equal(m.map.magFilter, THREE.LinearFilter);
  assert.equal(m.map.minFilter, THREE.LinearMipmapNearestFilter);
  assert.equal(m.map.generateMipmaps, true);
  assert.equal(m.map.matrix.elements[6], Math.fround(0.02));
  assert.equal(m.map.matrix.elements[7], Math.fround(0.02));
  assert.deepEqual(
    nativeRenderMaterialSource(m).uvTransform,
    [2, 0, 0, 3, 0.25, 0.5],
  );
  assert.equal(nativeRenderMaterialSource(m).flags, 0x1021);
  result.dispose();
});

test("missing MAT/PIX or registered identity remains explicit with no GIBSMEAR substitution", async () => {
  const cases = [
    [
      fixture({ missing: ["data/PEDS/GIBLETS/PEDSMEAR.MAT"] }),
      "source-ped-smear-MAT:data/PEDS/GIBLETS/PEDSMEAR.MAT",
    ],
    [
      fixture({ missing: ["data/PEDS/GIBLETS/PIX16/PEDSMEAR.PIX"] }),
      "source-ped-smear-PIX:data/PEDS/GIBLETS/PIX16/pedsmear.PIX",
    ],
    [
      fixture({ material: mat({ identifier: "GIBSMEAR.MAT" }) }),
      "source-registered-ped-smear-MAT:PEDSMEAR",
    ],
    [
      fixture({ material: mat({ texture: null }) }),
      "source-ped-smear-MAT-PIX-binding:PEDSMEAR",
    ],
    [
      fixture({ pixelmap: pix("OTHER") }),
      "source-registered-ped-smear-PIX:pedsmear",
    ],
  ];
  for (const [h, expected] of cases) {
    const result = await loadNativePedSmearMaterial(h.assets, "data");
    assert.equal(result.material, null);
    assert.deepEqual(result.requiredProviders, [expected]);
    assert.ok(h.reads.every((path) => !path.includes("GIBSMEAR")));
    result.dispose();
    result.dispose();
  }
  const unavailable = fixture();
  unavailable.assets.bytes = async () => {
    throw new Error("Unavailable asset server");
  };
  assert.equal(
    (await loadNativePedSmearMaterial(unavailable.assets, "data")).material,
    null,
  );
});

test("malformed original bytes fail with file context and the selected data tree is bounded", async () => {
  for (const [h, expected] of [
    [
      fixture({ material: new Uint8Array(4) }),
      /PEDSMEAR MAT data\/PEDS\/GIBLETS\/PEDSMEAR.MAT/,
    ],
    [
      fixture({ pixelmap: new Uint8Array(4) }),
      /PEDSMEAR PIX data\/PEDS\/GIBLETS\/PIX16\/PEDSMEAR.PIX/,
    ],
  ])
    await assert.rejects(
      () => loadNativePedSmearMaterial(h.assets, "data"),
      expected,
    );
  await assert.rejects(
    () => loadNativePedSmearMaterial(fixture().assets, "../data"),
    /explicit original data tree/,
  );
});

test("dispose releases only owned material/textures once and reloading creates independent reset resources", async () => {
  const h = fixture(),
    borrowed = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  let borrowedDisposals = 0;
  borrowed.addEventListener("dispose", () => borrowedDisposals++);
  h.assets.textures.set("unrelated", borrowed);
  const first = await loadNativePedSmearMaterial(h.assets, "data");
  let materialDisposals = 0,
    mapDisposals = 0;
  first.material.addEventListener("dispose", () => materialDisposals++);
  first.material.map.addEventListener("dispose", () => mapDisposals++);
  first.dispose();
  first.dispose();
  assert.equal(materialDisposals, 1);
  assert.equal(mapDisposals, 1);
  assert.equal(borrowedDisposals, 0);
  assert.equal(h.assets.textures.get("unrelated"), borrowed);
  const next = await loadNativePedSmearMaterial(h.assets, "data");
  assert.notEqual(next.material, first.material);
  assert.notEqual(next.material.map, first.material.map);
  assert.notEqual(next.material.map.image, first.material.map.image);
  assert.deepEqual(
    [...next.material.map.image.data],
    [...first.material.map.image.data],
  );
  next.dispose();
  assert.equal(materialDisposals, 1);
  assert.equal(mapDisposals, 1);
  assert.equal(borrowedDisposals, 0);
  borrowed.dispose();
});

test("Stock and Advanced PEDSMEAR retain actual MAT identity and all original RGBA4444 pixels", async (t) => {
  for (const root of ["data", "adv_data"]) {
    const matPath = `${root}/PEDS/GIBLETS/PEDSMEAR.MAT`,
      pixPath = `${root}/PEDS/GIBLETS/PIX16/PEDSMEAR.PIX`;
    let matBytes, pixBytes;
    try {
      [matBytes, pixBytes] = await Promise.all(
        [matPath, pixPath].map((path) =>
          readFile(new URL(`../carma2_orig/${path}`, import.meta.url)),
        ),
      );
    } catch (error) {
      if (error.code === "ENOENT") {
        t.skip("Original installation unavailable");
        return;
      }
      throw error;
    }
    const source = parseMat(matBytes)[0],
      pixels = parsePix(pixBytes)[0];
    const files = new Map([
      [matPath, matBytes],
      [pixPath, pixBytes],
    ]);
    const result = await loadNativePedSmearMaterial(
      {
        manifest: [...files].map(([path, bytes]) => ({
          path,
          size: bytes.length,
        })),
        bytes: async (path) => files.get(path),
      },
      root,
    );
    assert.deepEqual(result.requiredProviders, []);
    const m = result.material;
    assert.equal(m.name, "PEDSMEAR");
    assert.deepEqual(nativeRenderMaterialSource(m), source);
    assert.equal(m.userData.c2Flags, 0x20021);
    assert.equal(m.opacity, 1);
    assert.equal(
      m.transparent,
      true,
      "PIX18 partial alpha needs blending even with MAT opacity255",
    );
    assert.equal(m.alphaTest, 1 / 255);
    assert.equal(m.map.image.width, 64);
    assert.equal(m.map.image.height, 64);
    assert.equal(m.map.userData.c2PixelmapType, 18);
    assert.deepEqual(m.map.image.data, pixels.rgba);
    const alphas = new Set(
      [...pixels.rgba].filter((_, index) => index % 4 === 3),
    );
    assert.deepEqual(
      [...alphas].sort((a, b) => a - b),
      [0, 119, 204, 238, 255],
    );
    assert.equal(m.map.magFilter, THREE.LinearFilter);
    assert.equal(m.map.minFilter, THREE.LinearFilter);
    result.dispose();
  }
});
