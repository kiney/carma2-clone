import assert from "node:assert/strict";
import test from "node:test";
import { BufferGeometry, Float32BufferAttribute, Mesh, Vector3 } from "three";
import { Assets } from "../src/content.ts";
import { prepareNativeModelVertexOrder } from "../src/car-smoke.ts";
import {
  nativeNonCarSmokeMesh,
  prepareNativeNonCarSmokeSampler,
} from "../src/noncar-debris.ts";

// Independent tiny asset records exercise the real loader/registry/teardown
// boundary without depending on a local installation or proprietary fixtures.
const join = (...parts) => Buffer.concat(parts);
const u16 = (value) => {
  const result = Buffer.alloc(2);
  result.writeUInt16BE(value);
  return result;
};
const u32 = (value) => {
  const result = Buffer.alloc(4);
  result.writeUInt32BE(value);
  return result;
};
const scalar = (value) => {
  const result = Buffer.alloc(4);
  result.writeFloatBE(value);
  return result;
};
const floats = (...values) => join(...values.map(scalar));
const name = (value) => Buffer.from(`${value}\0`, "latin1");
const chunk = (tag, payload = Buffer.alloc(0)) =>
  join(u32(tag), u32(payload.length), payload);
const header = (type) => chunk(0x12, join(u32(type), u32(2)));
function materialRecord(identifier) {
  return join(
    chunk(
      0x3c,
      join(
        Buffer.from([255, 128, 64, 255]),
        floats(0.1, 0.7, 0, 20),
        u32(1),
        floats(1, 0, 0, 1, 0, 0),
        Buffer.from([0, 0]),
        floats(0, 0),
        Buffer.from([0, 0, 0]),
        u32(0),
        name(identifier),
      ),
    ),
    chunk(0),
  );
}
function fixtureFiles(prefix, { materials, table, slots }) {
  const identifier = `${prefix}-model`;
  const actor = (actorName) =>
    join(
      header(1),
      chunk(0x23, join(Buffer.from([1, 4]), name(actorName))),
      chunk(0x24, name(identifier)),
      chunk(0),
    );
  return new Map([
    [`${prefix}/scene.mat`, join(header(5), ...materials.map(materialRecord))],
    [
      `${prefix}/scene.dat`,
      join(
        header(0xface),
        chunk(0x36, join(u16(0), name(identifier))),
        chunk(0x17, join(u32(3), floats(0, 0, 0, 1, 0, 0, 0, 1, 0))),
        chunk(0x18, join(u32(3), floats(0, 0, 1, 0, 0, 1))),
        chunk(
          0x35,
          join(
            u32(slots.length),
            ...slots.map(() =>
              join(u16(0), u16(1), u16(2), u16(1), Buffer.from([0])),
            ),
          ),
        ),
        chunk(0x16, join(u32(table.length), ...table.map(name))),
        chunk(0x1a, join(u32(slots.length), u32(2), ...slots.map(u16))),
        chunk(0),
      ),
    ],
    [`${prefix}/scene.act`, actor("scene-actor")],
    [`${prefix}/extra.act`, actor("extra-actor")],
  ]);
}
function makeAssets(...sets) {
  const files = new Map(sets.flatMap((set) => [...set]));
  const assets = new Assets();
  assets.manifest = [...files].map(([path, bytes]) => ({
    path,
    size: bytes.length,
  }));
  assets.lookup = new Map([...files.keys()].map((path) => [path, path]));
  assets.bytes = async (path) => {
    assert.ok(files.has(path), path);
    return files.get(path);
  };
  return assets;
}
const configuration = {
  materials: ["alpha", "beta", "alpha"],
  table: ["beta", "alpha", "ALPHA", "absent"],
  slots: [1, 2, 3, 4, 0],
};

test("prepared options preserve actual loaded MAT identity, aliases and named NULL bindings", async () => {
  const assets = makeAssets(fixtureFiles("first", configuration));
  const scene = await assets.scene("first", "scene");
  const model = scene.sourceModelStorage[0];
  const geometry = scene.sourceModelGeometries.get(model);
  const { materialPointers: pointers } =
    assets.getNativeModelPreparedOptions(geometry);
  const [alpha, beta, duplicate] = scene.sourceMaterialEpisodes;
  assert.equal(duplicate.accepted, false);
  assert.equal(
    assets.materialArena.materialAddress(duplicate.material).resolved,
    false,
  );
  assert.equal(
    pointers.get(1),
    assets.materialArena.materialAddress(beta.material).address,
  );
  assert.equal(
    pointers.get(2),
    assets.materialArena.materialAddress(alpha.material).address,
  );
  assert.equal(
    pointers.get(3),
    pointers.get(2),
    "case alias retains actual MAT pointer",
  );
  assert.equal(pointers.get(4), 0, "failed named resolution is raw NULL");
  assert.equal(pointers.get(0), 0);
  assert.ok(
    pointers.get(2) < pointers.get(1),
    "actual addresses reverse the authored slot order",
  );
  const prepared = prepareNativeModelVertexOrder(model, {
    materialPointers: pointers,
  });
  assert.deepEqual(
    prepared.groups.map((group) => group.materialIndices),
    [[4, 0], [2, 3], [1]],
  );
  assert.equal(prepared.firstGroupCount, 3);
  scene.dispose();
});

test("later same-name registrations cannot rebind an earlier preparation episode", async () => {
  const replacement = {
    materials: ["alpha", "absent"],
    table: ["alpha", "absent"],
    slots: [1, 2],
  };
  const assets = makeAssets(
    fixtureFiles("first", configuration),
    fixtureFiles("second", replacement),
  );
  const first = await assets.scene("first", "scene");
  const firstGeometry = first.sourceModelGeometries.get(
    first.sourceModelStorage[0],
  );
  const initial =
    assets.getNativeModelPreparedOptions(firstGeometry).materialPointers;
  const second = await assets.scene("second", "scene");
  assert.notStrictEqual(
    first.sourceMaterialStorage[0],
    assets.nativeMaterialRegistry.find("alpha"),
  );
  assert.deepEqual(
    assets.getNativeModelPreparedOptions(firstGeometry).materialPointers,
    initial,
  );
  const secondGeometry = second.sourceModelGeometries.get(
    second.sourceModelStorage[0],
  );
  const later =
    assets.getNativeModelPreparedOptions(secondGeometry).materialPointers;
  assert.notEqual(later.get(1), initial.get(2));
  assert.notEqual(
    later.get(2),
    0,
    "previous unresolved name stays NULL only in the first MODEL",
  );
  second.dispose();
  assert.deepEqual(
    assets.getNativeModelPreparedOptions(firstGeometry).materialPointers,
    initial,
  );
  first.dispose();
  assert.throws(
    () => assets.getNativeModelPreparedOptions(firstGeometry),
    /unavailable or released/,
  );
});

test("extra ACT and debris clones and damage geometry copies share the captured MODEL binding", async () => {
  const assets = makeAssets(fixtureFiles("first", configuration));
  const scene = await assets.scene("first", "scene");
  const extra = await scene.loadActorFile("first/extra.act");
  const template = extra.children[0].clone(true);
  const launch = template.clone(true);
  const mesh = nativeNonCarSmokeMesh(launch);
  assert.strictEqual(nativeNonCarSmokeMesh(mesh), mesh);
  const pointers = assets.getNativeModelPreparedOptions(
    mesh.geometry,
  ).materialPointers;
  const copiedGeometry = mesh.geometry.clone();
  assert.notStrictEqual(copiedGeometry, mesh.geometry);
  assert.strictEqual(copiedGeometry.userData, mesh.geometry.userData);
  assert.deepEqual(
    assets.getNativeModelPreparedOptions(copiedGeometry).materialPointers,
    pointers,
  );
  mesh.geometry = copiedGeometry;
  const diagnostics = [];
  const sampler = prepareNativeNonCarSmokeSampler(
    launch,
    assets.getNativeModelPreparedOptions(
      nativeNonCarSmokeMesh(template).geometry,
    ),
    (message) => diagnostics.push(message),
  );
  assert.deepEqual(diagnostics, []);
  assert.equal(sampler.remainingMaterialOrder, "known-order");
  assert.equal(sampler.firstGroupCount, 3);
  assert.equal(
    sampler.count,
    9,
    "same-pointer aliases coalesce within their actual group",
  );
  assert.equal(
    sampler.sampleVertex(sampler.firstGroupCount, new Vector3()),
    true,
  );
  scene.dispose();
  assert.throws(
    () => assets.getNativeModelPreparedOptions(copiedGeometry),
    /released/,
  );
  assert.throws(
    () => assets.getNativeModelPreparedOptions(new BufferGeometry()),
    /unavailable/,
  );
  assert.throws(() => nativeNonCarSmokeMesh(extra), /source actor's model/);
});

test("freed MAT storage cannot silently become an index ordering provider", async () => {
  const assets = makeAssets(fixtureFiles("first", configuration));
  const scene = await assets.scene("first", "scene");
  const geometry = scene.sourceModelGeometries.get(scene.sourceModelStorage[0]);
  const source = scene.sourceMaterialStorage[0];
  const allocation = assets.materialArena.materialAddress(source);
  assets.materialArena.free(allocation.handle);
  const replacement = assets.materialArena.allocateMaterial({
    name: "new episode",
  });
  assert.equal(replacement.address, allocation.address);
  assert.throws(
    () => assets.getNativeModelPreparedOptions(geometry),
    /material unavailable:.*freed resource episode/,
  );
  scene.dispose();
  assets.materialArena.free(replacement);
});

function runtimeGeometry(materials) {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      materials.flatMap((_, index) => [
        2 * index,
        0,
        0,
        2 * index + 1,
        0,
        0,
        2 * index,
        1,
        0,
      ]),
      3,
    ),
  );
  geometry.setAttribute(
    "uv",
    new Float32BufferAttribute(new Float32Array(materials.length * 6), 2),
  );
  geometry.userData = {
    c2PreparedSourceKind: "runtime-mutation",
    modelFlags: 0,
    sourcePositions: geometry.getAttribute("position").array,
    sourceUVs: geometry.getAttribute("uv").array,
    sourceFaces: materials.map((_, index) => ({
      indices: [3 * index, 3 * index + 1, 3 * index + 2],
      material: index + 1,
      smoothing: 1,
      flags: 0,
    })),
    sourceVertexIndices: Uint32Array.from(
      { length: materials.length * 3 },
      (_, index) => index,
    ),
    c2RawFaceMaterials: materials,
  };
  return geometry;
}

test("runtime MODEL mutation prepares actual cross-source MAT aliases and NULL without rebinding loaded borrows", async () => {
  const assets = makeAssets(
    fixtureFiles("first", configuration),
    fixtureFiles("second", {
      materials: ["alpha"],
      table: ["alpha"],
      slots: [1],
    }),
  );
  const first = await assets.scene("first", "scene");
  const loaded = first.sourceModelGeometries.get(first.sourceModelStorage[0]);
  const captured = assets.getNativeModelPreparedOptions(loaded);
  const second = await assets.scene("second", "scene");
  const firstAlpha = first.sourceMaterialStorage[0];
  const secondAlpha = second.sourceMaterialStorage[0];
  assert.equal(firstAlpha.name, secondAlpha.name);
  assert.notStrictEqual(firstAlpha, secondAlpha);
  const geometry = runtimeGeometry([
    secondAlpha,
    null,
    firstAlpha,
    secondAlpha,
  ]);
  const options = assets.getNativeModelPreparedOptions(geometry);
  assert.equal(options.materialPointerProvenance, "host-resource-addresses");
  assert.equal(
    options.materialPointers.get(1),
    assets.materialArena.materialAddress(secondAlpha).address,
  );
  assert.equal(options.materialPointers.get(2), 0);
  assert.equal(
    options.materialPointers.get(3),
    assets.materialArena.materialAddress(firstAlpha).address,
  );
  assert.equal(
    options.materialPointers.get(4),
    options.materialPointers.get(1),
  );
  const sampler = prepareNativeNonCarSmokeSampler(new Mesh(geometry), options);
  assert.deepEqual(
    sampler.groups.map((group) => group.materialIndices),
    [[2], [3], [1, 4]],
  );
  assert.equal(sampler.firstGroupCount, 3);
  assert.equal(sampler.sampleVertex(3, new Vector3()), true);
  assert.deepEqual(assets.getNativeModelPreparedOptions(loaded), captured);
  assert.deepEqual(
    assets.getNativeModelPreparedOptions(geometry.clone()),
    options,
  );
  second.dispose();
  const reused = assets.materialArena.allocateMaterial({
    name: "new runtime episode",
  });
  assert.equal(reused.address, options.materialPointers.get(1));
  assert.throws(
    () => assets.getNativeModelPreparedOptions(geometry),
    /runtime-mutation:1:.*freed resource episode/,
  );
  assert.deepEqual(assets.getNativeModelPreparedOptions(loaded), captured);
  assets.materialArena.free(reused);
  first.dispose();
});

test("runtime prepared sources require an explicit tag, valid MODEL inputs and a complete actual MAT table", () => {
  const assets = new Assets();
  const make = () => runtimeGeometry([null]);
  const untagged = make();
  delete untagged.userData.c2PreparedSourceKind;
  assert.throws(
    () => assets.getNativeModelPreparedOptions(untagged),
    /MODEL resource/,
  );
  for (const field of [
    "modelFlags",
    "sourcePositions",
    "sourceUVs",
    "sourceFaces",
    "c2RawFaceMaterials",
  ]) {
    const geometry = make();
    delete geometry.userData[field];
    assert.throws(
      () => assets.getNativeModelPreparedOptions(geometry),
      /runtime-mutation source is incomplete/,
      field,
    );
  }
  const invalidFace = make();
  invalidFace.userData.sourceFaces[0].indices[2] = 3;
  assert.throws(
    () => assets.getNativeModelPreparedOptions(invalidFace),
    /runtime-mutation face is invalid/,
  );
  const outsideTable = make();
  outsideTable.userData.sourceFaces[0].material = 2;
  assert.throws(
    () => assets.getNativeModelPreparedOptions(outsideTable),
    /slot out of bounds: runtime-mutation:2/,
  );
  const missingBinding = make();
  missingBinding.userData.c2RawFaceMaterials[0] = undefined;
  assert.throws(
    () => assets.getNativeModelPreparedOptions(missingBinding),
    /binding missing: runtime-mutation:1/,
  );
  const unowned = runtimeGeometry([{ name: "same name is insufficient" }]);
  assert.throws(
    () => assets.getNativeModelPreparedOptions(unowned),
    /not allocated in this host arena/,
  );
});
