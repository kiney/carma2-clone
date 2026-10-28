import test from "node:test";
import assert from "node:assert/strict";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
  Texture,
  Vector3,
} from "three";
import { WorldDestruction } from "../src/world-destruction.ts";
import { NativeSmashQueue } from "../src/smash-queue.ts";
import {
  createNativeSmashEdgeState,
  prepareNativeSmashEdge,
  restoreNativeSmashEdgeMasks,
  NATIVE_SMASH_EDGE_SELECTORS,
} from "../src/world-smash-edge-flags.ts";
const payload = {
  sounds: [],
  shrapnel: [],
  explosions: [],
  slick: null,
  activations: [],
  sideEffects: [],
  extensionFlags: 0,
  roomCode: 0,
  award: { frequency: "none" },
  variableChanges: [],
};
function fixture(mode = "edges", capacity = 20) {
  const geo = new BufferGeometry(),
    positions = [],
    uvs = [];
  for (const [lo, hi] of [
    [0, 0.5],
    [0.5, 1],
  ]) {
    positions.push(lo, 0, 0, hi, 0, 0, hi, 1, 0, lo, 0, 0, hi, 1, 0, lo, 1, 0);
    uvs.push(lo, 0, hi, 0, hi, 1, lo, 0, hi, 1, lo, 1);
  }
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  geo.userData.sourceFaceFlags = Uint8Array.from([0x84, 0x81, 0x84, 0x81]);
  const mat = new MeshLambertMaterial();
  mat.name = "GLASS";
  const root = new Group(),
    mesh = new Mesh(geo, mat);
  root.add(mesh);
  const events = [],
    queue = new NativeSmashQueue();
  for (let i = capacity; i < 20; i++)
    queue.enqueue({
      key: {},
      targetTier: 1,
      context: {},
      getReachedTier: () => 0,
      getLevelCount: () => 2,
      hasModel: () => true,
    });
  const spec = {
    flags: 0,
    trigger: { kind: "material", name: "GLASS" },
    mode: "texturechange",
    intactPixelmap: "INTACT",
    levels: [
      {
        threshold: 1,
        flags: 0,
        collisionMode: mode,
        pixelmaps: ["BROKEN"],
        connotations: payload,
      },
    ],
    reserved: [0, 0, 0, 0],
  };
  const runtime = new WorldDestruction(root, [spec], {
    textures: new Map([["broken", new Texture()]]),
    random: () => 0,
    onConnotations: () => events.push("effect"),
  });
  runtime.configureSmashQueue(queue);
  const contact = (point = new Vector3(0.25, 0.25, 0)) =>
    runtime.handleContact({
      actor: mesh,
      faceIndex: 0,
      material: "GLASS",
      normalImpulse: 2,
      kind: "body",
      point,
      timeMs: 100,
    });
  return { runtime, mesh, queue, events, contact };
}
function seamFlags(mesh) {
  const positions = mesh.geometry.getAttribute("position"),
    flags = mesh.geometry.userData.sourceFaceFlags,
    out = [];
  for (let face = 0; face < positions.count / 3; face++)
    for (let edge = 0; edge < 3; edge++) {
      const a = face * 3 + edge,
        b = face * 3 + ((edge + 1) % 3);
      if (positions.getX(a) === 0.5 && positions.getX(b) === 0.5)
        out.push({
          flags: flags[face],
          suppressed: !!(flags[face] & (1 << edge)),
        });
    }
  return out;
}
test("captured native selector masks and two remembered source-face slots retain unrelated bits", () => {
  assert.deepEqual(
    NATIVE_SMASH_EDGE_SELECTORS.map(({ face, mask }) => [face, mask]),
    [
      [1, 4],
      [0, 1],
      [0, 2],
      [1, 2],
    ],
  );
  const a = { flags: 0x80 },
    b = { flags: 0x40 },
    state = createNativeSmashEdgeState();
  prepareNativeSmashEdge(state, a, 4, false, true);
  prepareNativeSmashEdge(state, b, 2, false, true);
  assert.deepEqual([a.flags, b.flags], [0x80, 0x40]);
  assert.equal(restoreNativeSmashEdgeMasks(state), true);
  assert.deepEqual([a.flags, b.flags], [0x84, 0x42]);
  assert.equal(restoreNativeSmashEdgeMasks(state), false);
});
test("accepted edges prepare native source-face masks before deferred tiers or effects", () => {
  const f = fixture();
  const result = f.contact();
  assert.equal(result.changed, true);
  assert.equal(f.queue.count, 2);
  assert.equal(f.events.length, 0);
  assert.ok(
    f.mesh.geometry.userData.worldSmashFaceModes.every(
      (mode) => mode === "solid",
    ),
  );
  const seam = seamFlags(f.mesh);
  assert.ok(seam.length >= 2);
  // Probe selects the neighbouring quad's second raw triangle. The installed
  // selector addresses source face/partner literally, without geometric relabeling.
  assert.deepEqual(
    f.runtime.meshes.get(f.mesh).original.map((face) => face.flags),
    [0x86, 0x81, 0x84, 0x81],
  );
  assert.equal(seam.filter((edge) => edge.suppressed).length, 1);
  assert.ok(seam.every((edge) => edge.flags & 0x80));
});
test("solid and full-queue preparation retain seam masks without applying them", () => {
  for (const fixtureArgs of [
    ["solid", 20],
    ["edges", 0],
  ]) {
    const f = fixture(...fixtureArgs);
    f.contact();
    assert.ok(seamFlags(f.mesh).every((edge) => !edge.suppressed));
    assert.equal(f.events.length, 0);
  }
});
test("pending duplicate cannot acquire an edge cap or new direct masks", () => {
  const f = fixture();
  f.contact();
  const before = Array.from(f.mesh.geometry.userData.sourceFaceFlags);
  const result = f.contact();
  assert.equal(result.threshold, undefined);
  assert.deepEqual(
    Array.from(f.mesh.geometry.userData.sourceFaceFlags),
    before,
  );
  assert.equal(f.queue.count, 2);
});

test("higher pending edges restore remembered raw masks and publish subdivided geometry", () => {
  const f = fixture("solid");
  const first = f.runtime.specs[0].levels[0];
  f.runtime.specs[0].levels.push({
    ...first,
    threshold: 3,
    collisionMode: "edges",
  });
  f.contact();
  const revision = f.runtime.geometryRevision;
  assert.ok(seamFlags(f.mesh).every((edge) => !edge.suppressed));
  const result = f.runtime.handleContact({
    actor: f.mesh,
    faceIndex: 0,
    material: "GLASS",
    normalImpulse: 4,
    kind: "body",
    point: new Vector3(0.25, 0.25, 0),
    timeMs: 101,
  });
  assert.equal(result.threshold, 3);
  assert.ok(f.runtime.geometryRevision > revision);
  assert.ok(seamFlags(f.mesh).some((edge) => edge.suppressed));
  assert.deepEqual(
    f.mesh.geometry.userData.sourceFaces.map((face) => face.flags),
    [...f.mesh.geometry.userData.sourceFaceFlags],
    "immediate edge masks must agree for collision and prepared-model readers",
  );
  assert.equal(f.queue.count, 2);
  assert.equal(f.events.length, 0);
});
test("replacement resolves exact MODEL instance and fires before connotations, same identity stays silent", () => {
  const f = fixture();
  const identity = {},
    replacementIdentity = {},
    calls = [];
  f.mesh.name = "PROP.ACT";
  f.mesh.geometry.userData.c2NativeModelIdentity = identity;
  const replacement = {
    name: "REPLACEMENT.DAT",
    flags: 0,
    pivot: [0, 0, 0],
    positions: new Float32Array(),
    uvs: new Float32Array(),
    materials: [],
    faces: [],
  };
  const spec = {
    flags: 0,
    trigger: { kind: "model", name: "PROP.ACT" },
    mode: "replacemodel",
    levels: [],
    reserved: [0, 0, 0, 0],
    removalThreshold: 1,
    connotations: payload,
    replacement: {
      model: "REPLACEMENT.DAT",
      fire: { chance: 100, parameters: [1, 2, 3] },
    },
  };
  let same = true,
    disposed = 0;
  const runtime = new WorldDestruction(f.mesh.parent, [spec], {
    models: new Map([["replacement", replacement]]),
    resolveReplacementModel: () => {
      const geometry = f.mesh.geometry.clone();
      geometry.addEventListener("dispose", () => disposed++);
      return {
        geometry,
        materials: f.mesh.material,
        identity: same ? identity : replacementIdentity,
      };
    },
    onReplacementFire: (actor, fire) => calls.push(["fire", actor, fire]),
    onConnotations: () => calls.push(["effect"]),
  });
  const contact = {
    actor: f.mesh,
    normalImpulse: 2,
    kind: "body",
    point: new Vector3(),
    timeMs: 100,
  };
  assert.equal(runtime.handleContact(contact).changed, false);
  assert.equal(disposed, 1);
  assert.deepEqual(calls, []);
  same = false;
  assert.equal(runtime.handleContact(contact).changed, true);
  assert.deepEqual(
    calls.map((call) => call[0]),
    ["fire", "effect"],
  );
  assert.equal(
    f.mesh.geometry.userData.c2NativeModelIdentity,
    replacementIdentity,
  );
  assert.equal(runtime.handleContact(contact).changed, false);
  assert.deepEqual(
    calls.map((call) => call[0]),
    ["fire", "effect"],
  );
  // Another normal MODEL mutation can make this authored replacement eligible
  // again. Native guards the live pointer; it has no permanent actor latch.
  f.mesh.geometry.userData.c2NativeModelIdentity = identity;
  assert.equal(runtime.handleContact(contact).changed, true);
  assert.deepEqual(
    calls.map((call) => call[0]),
    ["fire", "effect", "fire", "effect"],
  );
});

test("UV clipping preserves raw NULL independently of ACT inheritance and allocates the tile MAT", async () => {
  const { Assets } = await import("../src/content.ts");
  const assets = new Assets();
  const source = {
    name: "GLASS",
    rgba: [255, 255, 255, 255],
    flags: 5,
    ambient: 1,
    diffuse: 0,
    specular: 0,
    power: 20,
    uvTransform: [1, 0, 0, 1, 0, 0],
    fogMin: 0,
    fogMax: 0,
    fogColor: 0,
  };
  const inherited = assets.registerGeneratedMaterial(source, "inheritance"),
    other = assets.registerGeneratedMaterial(
      { ...source, name: "actual raw MAT" },
      "raw",
    );
  const f = fixture("solid");
  f.mesh.material = assets.getNativeRenderMaterial(inherited);
  f.mesh.geometry.userData.c2RawFaceMaterials = [null, null, other, other];
  const uv = f.mesh.geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2);
  f.runtime.assets.cloneMaterial = (material) =>
    assets.cloneNativeMaterial(material);
  f.contact();
  const raw = f.mesh.geometry.userData.c2RawFaceMaterials;
  assert.ok(
    raw.some((material) => material === null),
    "unmodified raw NULL faces keep ACT inheritance",
  );
  assert.ok(
    raw.some((material) => material === other),
    "actual source MAT pointers survive separately from inherited render material",
  );
  const allocated = [...new Set(raw)].filter(
    (material) => material && material !== other,
  );
  assert.equal(allocated.length, 1);
  assert.notEqual(allocated[0], inherited);
  assert.equal(
    assets.materialArena.materialAddress(allocated[0]).resolved,
    true,
  );
  assert.ok(assets.materialArena.materialAddress(allocated[0]).address > 0);
  const options = assets.getNativeModelPreparedOptions(f.mesh.geometry);
  assert.equal(options.materialPointerProvenance, "host-resource-addresses");
  for (let index = 0; index < raw.length; index++)
    assert.equal(
      options.materialPointers.get(index + 1),
      raw[index] === null
        ? 0
        : assets.materialArena.materialAddress(raw[index]).address,
    );
  const { prepareNativeNonCarSmokeSampler } = await import(
    "../src/noncar-debris.ts"
  );
  const sampler = prepareNativeNonCarSmokeSampler(f.mesh, options);
  assert.ok(sampler.firstGroupCount > 0);
  assert.equal(sampler.sampleVertex(0, new Vector3()), true);
});
