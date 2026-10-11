import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { TextureAnimation } from "../src/animation.ts";
import {
  createNativeRenderMaterial,
  glorifyNativeMaterial,
  nativeMaterialSpecular,
  nativeMaterialLampDirection,
  nativeRenderMaterialSource,
  copyNativeTextureSampling,
} from "../src/native-material-render.ts";
import { NativeGlobalResources } from "../src/native-global-resources.ts";
import { Assets } from "../src/content.ts";
import { createAssetStore } from "../server/assets.mjs";
import { parseMat, parseDat } from "../src/formats.ts";

const mat = (extra = {}) => ({
  name: "fixture",
  rgba: [255, 128, 64, 255],
  ambient: 0.1,
  diffuse: 0.7,
  specular: 0,
  power: 20,
  flags: 0x1003,
  uvTransform: [1, 0, 0, 1, 0, 0],
  ...extra,
});
test("installed Glorify shading branches retain authored identity and exact f32 coefficients", () => {
  const source = mat();
  for (const [shading, ka, kd, ks, flags] of [
    [1, 0.2, 0.8, 0, 0x1005],
    [2, 0.6, 0.2, 0.8, 0x1005],
    [3, 0.4, 0.8, 0, 0x1005],
    [4, 1, 0, 0, 0x1005],
    [0, 1, 0, 0, 0x1003],
    [-1, 1, 0, 0, 0x1003],
    [5, 1, 0, 0, 0x1003],
  ]) {
    const out = glorifyNativeMaterial(source, { shading });
    assert.deepEqual(
      [out.ambient, out.diffuse, out.specular, out.flags],
      [Math.fround(ka), Math.fround(kd), Math.fround(ks), flags],
    );
  }
  assert.equal(source.flags, 0x1003);
  assert.equal(source.ambient, 0.1);
});
test("native texture exception bits suppress interpolation and offset UVs; other settings remain independent", () => {
  const source = mat({
    texture: "Odd.PIX",
    flags: 1,
    uvTransform: [2, 3, 4, 5, 6, 7],
  });
  const out = glorifyNativeMaterial(source, {
    interpolation: true,
    antialiasing: true,
    perspective: true,
    textureExceptions: new Map([["ODD.PIX", 9]]),
  });
  assert.equal(out.flags, 0x10021);
  assert.deepEqual(out.uvTransform, [
    2,
    3,
    4,
    5,
    Math.fround(0.02),
    Math.fround(0.02),
  ]);
  assert.deepEqual(source.uvTransform, [2, 3, 4, 5, 6, 7]);
});
test("native rational highlight differs from exponentiation and observes installed cutoff", () => {
  assert.equal(nativeMaterialSpecular(0.5, 0.8, 20), 0);
  assert.equal(nativeMaterialSpecular(Math.fround(0.6172), 0.8, 20), 0);
  assert.equal(nativeMaterialSpecular(1, 0.8, 20), 0.8);
  assert.ok(Math.abs(nativeMaterialSpecular(0.8, 0.8, 20) - 2 / 15) < 1e-15);
  const lamp = nativeMaterialLampDirection();
  assert.ok(Math.abs(lamp.length() - 1) < 1e-12);
  assert.ok(lamp.y > 0.86 && lamp.y < 0.87);
});
test("opaque/transparent native depth writes, keys, culling and sampling use independent flags", () => {
  const texture = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
  const render = createNativeRenderMaterial(
    mat({ flags: 0x1801, rgba: [255, 255, 255, 128] }),
    texture,
  );
  assert.equal(render.transparent, true);
  assert.equal(render.depthWrite, true);
  assert.equal(render.side, THREE.DoubleSide);
  assert.equal(render.userData.c2NativeUniforms.c2TwoSided.value, 1);
  assert.equal(render.alphaTest, 1 / 255);
  assert.equal(render.map.magFilter, THREE.NearestFilter);
  assert.equal(render.map.minFilter, THREE.NearestFilter);
  assert.equal(render.map.colorSpace, THREE.NoColorSpace);
  const always = createNativeRenderMaterial(mat({ flags: 0x801 }), undefined);
  assert.equal(always.side, THREE.DoubleSide);
  assert.equal(always.userData.c2NativeUniforms.c2TwoSided.value, 0);
  const noWrite = createNativeRenderMaterial(
    mat({ flags: 0x1000001 }),
    undefined,
  );
  assert.equal(noWrite.depthWrite, false);
});
test("FUNK atlas frames keep native sampling without altering atlas transforms or source texture libraries", () => {
  const library = new THREE.DataTexture(new Uint8Array(16).fill(255), 2, 2);
  library.colorSpace = THREE.SRGBColorSpace;
  const source = mat({
    name: "rear",
    flags: 0x70025,
    texture: "atlas",
    uvTransform: [2, 0, 0, 3, 0.2, 0.4],
  });
  const render = createNativeRenderMaterial(source, library);
  const base = render.map.matrix.clone();
  const text =
    "START OF FUNK\nrear\nconstant\npiss off\nnone\nframes\naccurate\ntexturebits\nVB\n4\natlas,2,0,2,0\natlas,2,1,2,0\natlas,2,0,2,1\natlas,2,1,2,1\nEND OF FUNK";
  const animation = new TextureAnimation(
    new Map([["rear", render]]),
    new Map([["atlas", library]]),
    text,
  );
  assert.deepEqual(animation.warnings, []);
  animation.update(0.1, { speed: 0, steer: 0, brake: true, throttle: 0 });
  const selected = render.map;
  const atlas = new THREE.Matrix3()
    .set(0.5, 0, 0, 0, 0.5, 0.5, 0, 0, 1)
    .multiply(base);
  assert.deepEqual(selected.matrix.elements, atlas.elements);
  assert.equal(selected.colorSpace, THREE.NoColorSpace);
  assert.equal(selected.magFilter, THREE.LinearFilter);
  assert.equal(selected.minFilter, THREE.LinearMipmapLinearFilter);
  assert.equal(selected.generateMipmaps, true);
  const matrix = selected.matrix.clone();
  const version = selected.version;
  copyNativeTextureSampling(selected, render);
  assert.deepEqual(selected.matrix.elements, matrix.elements);
  assert.equal(
    selected.version,
    version,
    "unchanged sampling does not reupload each animation tick",
  );
  render.userData.c2NativeState.flags = 0x25;
  animation.update(0.1, { speed: 0, steer: 0, brake: true, throttle: 0 });
  assert.equal(render.map.magFilter, THREE.NearestFilter);
  assert.equal(render.map.minFilter, THREE.NearestFilter);
  assert.equal(render.map.generateMipmaps, false);
  assert.deepEqual(render.map.matrix.elements, atlas.elements);
  assert.equal(library.colorSpace, THREE.SRGBColorSpace);
  animation.dispose();
});
test("native display clones retain shader hooks and source identity; allocated clones own a new race MAT", () => {
  const assets = new Assets();
  const source = assets.registerGeneratedMaterial(mat(), "persistent-fixture");
  const render = assets.updateNativeMaterial(source);
  const display = render.clone().clone();
  assert.equal(nativeRenderMaterialSource(display), source);
  assert.equal(display.onBeforeCompile, render.onBeforeCompile);
  assert.equal(
    display.userData.c2NativeUniforms,
    render.userData.c2NativeUniforms,
  );
  display.color.setHex(0x223344);
  assert.notEqual(display.color.getHex(), render.color.getHex());
  const allocated = assets.cloneNativeMaterial(render);
  const newSource = assets.resolveNativeMaterial(allocated);
  assert.notEqual(newSource, source);
  assert.equal(assets.materialArena.materialAddress(newSource).resolved, true);
  assert.equal(assets.nativeMaterialRegistry.find(source.name), newSource);
  assets.releaseRaceResources();
  assert.equal(assets.materialArena.materialAddress(newSource).resolved, false);
  assert.equal(assets.nativeMaterialRegistry.find(source.name), source);
});
test("global registration admission scope and identity teardown restore older storage lookups", () => {
  const reg = new NativeGlobalResources(true),
    a = {},
    b = {};
  const first = mat({ name: "Grass" }),
    second = mat({ name: "grass" }),
    same = mat({ name: "Grass" });
  assert.equal(reg.add(a, first), true);
  assert.equal(reg.add(a, same), false);
  assert.equal(reg.add(a, second), true);
  assert.equal(reg.add(b, same), true);
  assert.equal(reg.find("GRASS"), same);
  assert.deepEqual(reg.removeStorage(b), [same]);
  assert.equal(reg.find("GRASS"), second);
  assert.equal(reg.find("grass.MAT"), undefined);
  assert.equal(
    reg.add(a, same, false),
    true,
    "direct BrMaterialAdd bypasses storage duplicate rejection",
  );
  assert.equal(reg.find("GRASS"), same);
});
test("generated track/default black identities retain native defaults across race teardown", () => {
  const assets = new Assets();
  assets.palette = new Uint8Array(256 * 4);
  assets.palette.set([4, 8, 12, 255], 227 * 4);
  assets.palette.set([33, 33, 33, 255], 5 * 4);
  assets.palette.set([33, 33, 33, 255], 6 * 4);
  const initial = assets.generatedTrackMaterials();
  assert.equal(initial.defaultTrackMaterial.name, "gDefault_track_material");
  assert.equal(initial.defaultTrackMaterial.power, 20);
  assert.deepEqual(initial.defaultTrackMaterial.rgba, [4, 8, 12, 255]);
  assert.equal(initial.blackMaterial.flags, 5);
  assert.equal(initial.blackMaterial.name, "Simple");
  assert.equal(
    initial.blackMaterial.indexBase,
    5,
    "equal palette errors retain the first index",
  );
  assert.equal(initial.blackMaterial.indexRange, 0);
  assert.equal(
    assets.nativeMaterialRegistry.find("Simple"),
    initial.blackMaterial,
  );
  assert.equal(
    assets.nativeMaterialRegistry.find("gDefault_track_material"),
    initial.defaultTrackMaterial,
  );
  assert.equal(assets.nativeMaterialRegistry.find("M14.MAT"), undefined);
  assets.releaseRaceResources();
  assert.equal(
    assets.generatedTrackMaterials().defaultTrackMaterial,
    initial.defaultTrackMaterial,
  );
  assert.equal(
    assets.materialArena.materialAddress(initial.blackMaterial).resolved,
    true,
  );
});
test("original scene storages share global material arena and release only race-owned registrations", async (t) => {
  let store;
  try {
    store = await createAssetStore();
  } catch (error) {
    if (error?.code === "ENOENT") {
      t.skip("Original installation absent");
      return;
    }
    throw error;
  }
  if (
    !store.manifest.some(
      (e) => e.path.toLowerCase() === "data/races/newcity1/newcity1.act",
    )
  ) {
    t.skip("Original installation absent");
    return;
  }
  const assets = new Assets();
  assets.manifest = store.manifest;
  assets.lookup = new Map(
    store.manifest.map((e) => [e.path.toLowerCase(), e.path]),
  );
  assets.bytes = async (p) => store.read(p);
  const first = await assets.scene("data/RACES/newcity1", "newcity1", {
    storage: "shared-test",
  });
  const second = await assets.scene("data/RACES/newcity1", "newcity1", {
    storage: "shared-test",
  });
  assert.equal(second.sourceMaterialStorage.length, 0);
  assert.equal(
    second.findSourceMaterial("advert2"),
    first.findSourceMaterial("advert2"),
  );
  assert.equal(second.materialArena, first.materialArena);
  const source = first.findSourceMaterial("advert2");
  first.dispose();
  assert.equal(second.materialArena.materialAddress(source).resolved, true);
  assets.releaseRaceResources();
  assert.equal(assets.nativeMaterialRegistry.find("advert2"), undefined);
  assert.equal(assets.materialArena.materialAddress(source).resolved, false);
  assert.equal(assets.nativeModelRegistry.registrations.length, 0);
});

test("Advanced Desert slash-named MAT lookup yields native NULL and inherits track material for nonzero DAT/ACT slots", async (t) => {
  let store;
  try {
    store = await createAssetStore();
  } catch (error) {
    if (error?.code === "ENOENT") {
      t.skip("Original installation absent");
      return;
    }
    throw error;
  }
  const dir = "adv_data/RACES/desert_mission";
  if (
    !store.manifest.some(
      (e) => e.path.toLowerCase() === `${dir.toLowerCase()}/desert_mission.act`,
    )
  ) {
    t.skip("Advanced Desert absent");
    return;
  }
  const assets = new Assets();
  assets.manifest = store.manifest;
  assets.lookup = new Map(
    store.manifest.map((e) => [e.path.toLowerCase(), e.path]),
  );
  assets.bytes = (p) => store.read(p);
  assets.palette = new Uint8Array(256 * 4);
  const { defaultTrackMaterial } = assets.generatedTrackMaterials();
  const scene = await assets.scene(dir, "DESERT_mission", {
    defaultMaterial: defaultTrackMaterial,
  });
  const admitted = scene.sourceMaterialStorage.find(
    (m) => m.name === "!/75WATER",
  );
  assert.ok(
    admitted,
    "The named MAT is present, rather than a fabricated missing-file resource",
  );
  assert.equal(
    scene.findSourceMaterial("!/75WATER"),
    undefined,
    "Native slash terminates the lookup pattern",
  );
  const absent = new Set(
    scene.sourceModelStorage.flatMap((m) =>
      m.materials.filter((name) => !scene.findSourceMaterial(name)),
    ),
  );
  assert.deepEqual([...absent], ["!/75WATER"]);
  const model = scene.sourceModelStorage.find((m) => m.name === "15 8");
  const slots = [...new Set(model.faces.map((f) => f.material))];
  const waterSlot = slots.findIndex(
    (i) => model.materials[i - 1] === "!/75WATER",
  );
  assert.ok(
    waterSlot >= 0 && slots[waterSlot] !== 0,
    "Authored nonzero DAT index is retained",
  );
  let found = 0;
  scene.group.traverse((object) => {
    if (object.geometry === scene.sourceModelGeometries.get(model)) {
      found++;
      assert.equal(
        assets.resolveNativeMaterial(object.material[waterSlot]),
        defaultTrackMaterial,
      );
    }
  });
  assert.equal(found, 1);
  const word = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  const name = (n) => Buffer.from(`${n}\0`, "latin1");
  const chunk = (tag, data = Buffer.alloc(0)) =>
    Buffer.concat([word(tag), word(data.length), data]);
  const actor = Buffer.concat([
    chunk(0x12, Buffer.concat([word(1), word(2)])),
    chunk(
      0x23,
      Buffer.concat([Buffer.from([1, 4]), name("null-lookup-fixture")]),
    ),
    chunk(0x24, name("15 8")),
    chunk(0x26, name("!/75WATER")),
    chunk(0),
  ]);
  assets.bytes = (p) =>
    p === "/synthetic-act" ? Promise.resolve(actor) : store.read(p);
  const additional = await scene.loadActorResource("/synthetic-act");
  const mesh = additional.group.children[0].children[0];
  assert.equal(
    assets.resolveNativeMaterial(mesh.material[waterSlot]),
    defaultTrackMaterial,
    "NULL ACT material retains parent/default inheritance",
  );
  assert.equal(model.materials[slots[waterSlot] - 1], "!/75WATER");
  assets.releaseRaceResources();
});

test("process-global MODEL material leases retain exact arena/render identities while race lookup and unrelated resources clear", async (t) => {
  let store;
  try {
    store = await createAssetStore();
  } catch (error) {
    if (error?.code === "ENOENT") {
      t.skip("Original installation absent");
      return;
    }
    throw error;
  }
  if (
    !store.manifest.some(
      (e) => e.path.toLowerCase() === "data/races/newcity1/newcity1.act",
    )
  ) {
    t.skip("Newcity absent");
    return;
  }
  const assets = new Assets();
  assets.manifest = store.manifest;
  assets.lookup = new Map(
    store.manifest.map((e) => [e.path.toLowerCase(), e.path]),
  );
  assets.bytes = (p) => store.read(p);
  await assets.common(() => {});
  const scene = await assets.scene("data/RACES/newcity1", "newcity1", {
    storage: "track",
  });
  const source = scene.sourceMaterialStorage.find(
    (m) => assets.getNativeRenderMaterial(m)?.map,
  );
  assert.ok(
    source,
    "An actual admitted original MAT with a texture is required",
  );
  const unrelated = scene.sourceMaterialStorage.find((m) => m !== source);
  const wrapper = assets.getNativeRenderMaterial(source),
    map = wrapper.map;
  const before = assets.materialArena.materialAddress(source);
  let materialDisposals = 0,
    textureDisposals = 0;
  wrapper.addEventListener("dispose", () => materialDisposals++);
  map.addEventListener("dispose", () => textureDisposals++);
  assets.retainNativeMaterial(source);
  assets.retainNativeMaterial(source);
  assert.equal(assets.isRetainedNativeMaterial(wrapper), true);
  assert.equal(assets.isRetainedNativeTexture(map), true);
  const borrowedSource = map.clone();
  assert.equal(assets.isRetainedNativeTexture(borrowedSource), true);
  scene.dispose();
  assets.releaseRaceResources();
  assert.equal(
    assets.nativeMaterialRegistry.find(source.name),
    undefined,
    "Retention does not re-register an old race MAT",
  );
  const after = assets.materialArena.materialAddress(source);
  assert.equal(after.resolved, true);
  assert.equal(after.handle, before.handle);
  assert.equal(after.address, before.address);
  assert.equal(assets.getNativeRenderMaterial(source), wrapper);
  assert.equal(wrapper.map, map);
  assert.equal(materialDisposals, 0);
  assert.equal(textureDisposals, 0);
  assert.equal(assets.materialArena.materialAddress(unrelated).resolved, false);
  assert.equal(assets.getNativeRenderMaterial(unrelated), undefined);
  assert.throws(
    () => assets.retainNativeMaterial(unrelated),
    /existing live source allocation/,
  );
  assert.throws(
    () => assets.retainNativeMaterial(mat()),
    /existing live source allocation/,
  );
});

test("original REG material/model registration preserves load-time bindings and render ownership across race teardown", async (t) => {
  let store;
  try {
    store = await createAssetStore();
  } catch (error) {
    if (error?.code === "ENOENT") {
      t.skip("Original installation absent");
      return;
    }
    throw error;
  }
  if (
    !store.manifest.some(
      (e) => e.path.toLowerCase() === "data/reg/models/&69powerup1.dat",
    ) ||
    !store.manifest.some(
      (e) => e.path.toLowerCase() === "data/races/newcity1/newcity1.act",
    )
  ) {
    t.skip("Common powerup/Newcity original resources absent");
    return;
  }
  const assets = new Assets();
  assets.manifest = store.manifest;
  assets.lookup = new Map(
    store.manifest.map((e) => [e.path.toLowerCase(), e.path]),
  );
  assets.bytes = (path) => store.read(path);
  const expectedMats = [];
  for (const path of assets.files("data/Reg/MATERIAL", /^[^/]+\.mat$/i))
    expectedMats.push(...parseMat(await store.read(path)));
  const expectedModels = [];
  for (const path of assets.files("data/Reg/MODELS", /^[^/]+\.dat$/i))
    expectedModels.push(...parseDat(await store.read(path)));
  await assets.common(() => {});
  const startupMats = assets.nativeMaterialRegistry.registrations.map(
    (r) => r.resource,
  );
  const startupModels = assets.nativeModelRegistry.registrations.map(
    (r) => r.resource,
  );
  assert.deepEqual(
    startupMats.map((m) => [m.name, m.flags]),
    expectedMats.map((m) => [m.name, m.flags & ~1]),
  );
  assert.deepEqual(
    startupModels.map((m) => [m.name, m.flags]),
    expectedModels.map((m) => [m.name, 0x80]),
  );
  assert.deepEqual(startupModels.map((m) => m.name).sort(), [
    "&68POWERUP1.ACT",
    "&69POWERUP1.ACT",
    "&70POWERUP1.ACT",
  ]);
  await assets.common(() => {});
  assert.equal(
    assets.nativeModelRegistry.registrations.length,
    startupModels.length,
    "startup registration is idempotent",
  );
  const power = assets.nativeModelRegistry.find("&69POWERUP1.ACT");
  const bindings = power.materials.map((name) =>
    assets.nativeMaterialRegistry.find(name),
  );
  assert.ok(bindings.every(Boolean));
  const commonSimple = assets.nativeMaterialRegistry.find("M14.MAT");
  const { defaultTrackMaterial, blackMaterial } =
    assets.generatedTrackMaterials();
  assert.equal(
    assets.nativeMaterialRegistry.find("M14.MAT"),
    commonSimple,
    "GetSimpleMaterial's generated identifier Simple does not shadow the original M14.MAT",
  );
  assert.equal(assets.nativeMaterialRegistry.find("Simple"), blackMaterial);
  const scene = await assets.scene("data/RACES/newcity1", "newcity1", {
    defaultMaterial: defaultTrackMaterial,
  });
  assert.deepEqual(scene.sourceModelMaterialBindings.get(power), bindings);
  assert.notEqual(
    scene.findSourceMaterial(power.materials[0]),
    bindings[0],
    "newest global lookup changes while the startup DAT table retains its old pointers",
  );
  assets.releaseRaceResources();
  assert.equal(assets.nativeModelRegistry.find(power.name), power);
  const word = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  const chunk = (tag, data = Buffer.alloc(0)) =>
    Buffer.concat([word(tag), word(data.length), data]);
  const actor = Buffer.concat([
    chunk(0x12, Buffer.concat([word(1), word(2)])),
    chunk(
      0x23,
      Buffer.concat([
        Buffer.from([1, 4]),
        Buffer.from("common-fallback\0", "latin1"),
      ]),
    ),
    chunk(0x24, Buffer.from("&69POWERUP1.ACT\0", "latin1")),
    chunk(0),
  ]);
  // A structural ACT fixture references the genuine startup MODEL. It has no
  // race DAT registration that could conceal the persistent common geometry.
  assets.lookup.set("fixture/common.act", "fixture/common.act");
  assets.bytes = (path) =>
    path === "fixture/common.act" ? Promise.resolve(actor) : store.read(path);
  const resource = await assets.scene("fixture", "common", {
    defaultMaterial: defaultTrackMaterial,
  });
  assert.equal(resource.findSourceModel(power.name), power);
  const mesh = resource.group.children[0].children[0];
  assert.ok(mesh?.isMesh);
  const slots = [...new Set(power.faces.map((f) => f.material))];
  slots.forEach((slot, index) =>
    assert.equal(
      assets.resolveNativeMaterial(mesh.material[index]),
      slot ? bindings[slot - 1] : defaultTrackMaterial,
    ),
  );
  const source = bindings[0],
    wrapper = assets.getNativeRenderMaterial(source);
  assert.ok(
    wrapper.map,
    "actual common powerup texture is loaded from startup libraries",
  );
  let geometryDisposals = 0,
    materialDisposals = 0,
    textureDisposals = 0;
  mesh.geometry.addEventListener("dispose", () => geometryDisposals++);
  wrapper.addEventListener("dispose", () => materialDisposals++);
  wrapper.map.addEventListener("dispose", () => textureDisposals++);
  assert.equal(assets.ownsNativeGeometry(mesh.geometry), true);
  assert.equal(assets.ownsNativeTexture(wrapper.map.clone()), true);
  assert.equal(assets.ownsNativeGeometry(new THREE.BufferGeometry()), false);
  assert.equal(assets.ownsNativeTexture(new THREE.Texture()), false);
  const address = assets.materialArena.materialAddress(source);
  assets.releaseRaceResources();
  assert.equal(assets.nativeModelRegistry.find(power.name), power);
  assert.equal(assets.nativeMaterialRegistry.find(source.name), source);
  assert.equal(
    assets.materialArena.materialAddress(source).handle,
    address.handle,
  );
  assert.equal(assets.materialArena.materialAddress(source).resolved, true);
  assert.equal(assets.getNativeRenderMaterial(source), wrapper);
  assert.equal(assets.ownsNativeGeometry(mesh.geometry), true);
  assert.equal(assets.ownsNativeTexture(wrapper.map), true);
  assert.deepEqual(
    [geometryDisposals, materialDisposals, textureDisposals],
    [0, 0, 0],
  );
  assert.equal(
    assets.nativeModelRegistry.registrations.length,
    startupModels.length,
  );
  assert.equal(
    assets.nativeModelRegistry.find("&70POWERUP1.ACT"),
    startupModels.find((m) => m.name === "&70POWERUP1.ACT"),
  );
});
