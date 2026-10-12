import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Assets } from "../src/content.ts";
import { createAssetStore } from "../server/assets.mjs";
import { captureNativeTrackSceneLayout } from "../src/native-track-scene-layout.ts";
import { prepareNativeWorldScene } from "../src/native-world-scene.ts";
import { captureWorldSource } from "../src/world-source.ts";
import { WorldCollision } from "../src/world.ts";
import { parseTrackSmashables } from "../src/world-smash.ts";
import { NativeResourceArena } from "../src/native-resource-arena.ts";
import {
  createNativeTrackModelResource,
  prepareNativeTrackResource,
} from "../src/native-track-resources.ts";
import {
  createNativeActorOrder,
  knownNativeActorValue as known,
} from "../src/native-actor-order.ts";

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const material = (name = "road") => ({
  name,
  rgba: [80, 80, 80, 255],
  flags: 4096,
  ambient: 1,
  diffuse: 0,
  specular: 0,
  power: 20,
  uvTransform: [1, 0, 0, 1, 0, 0],
});
const query = {
  bounds: new THREE.Box3(
    new THREE.Vector3(-10, -10, -10),
    new THREE.Vector3(10, 10, 10),
  ),
  matrix: new THREE.Matrix4(),
};
const model = {
  name: "road",
  flags: 0x80,
  pivot: [0, 0, 0],
  positions: Float32Array.from([-1, 0, -1, 0, 0, 1, 1, 0, -1]),
  uvs: new Float32Array(6),
  materials: ["road"],
  faces: [{ indices: [0, 1, 2], material: 1, flags: 0, smoothing: 0 }],
};
function fixture() {
  const mat = material(),
    resource = createNativeTrackModelResource(model, () => known(mat), 4).value;
  assert.ok(prepareNativeTrackResource(resource).resolved);
  const raw = (name, children = []) => ({
    name,
    type: 1,
    renderStyle: 4,
    transform: I,
    model: "road",
    children,
  });
  const state = createNativeActorOrder([raw("&animated", [raw("&01a0000")])], {
    model: () => known(resource),
  });
  const objects = new Map(state.actors.map((a) => [a, new THREE.Group()]));
  const scene = {
    layout: {
      originX: -10,
      originZ: -10,
      columnSizeX: 20,
      columnSizeZ: 20,
      countX: 1,
      countZ: 1,
    },
    columns: [[state.roots[0]]],
    additionalActors: null,
    nonTrackActors: createNativeActorOrder([
      { name: "nontrack", type: 0, renderStyle: 0, transform: I, children: [] },
    ]).roots[0],
    blackMaterial: mat,
    resources: new Map([[resource, resource]]),
    actorObjects: objects,
    faceActors: objects,
    actors: state.actors,
    noncars: [],
    provenance: "native-query-with-host-resource-addresses",
  };
  const world = new WorldCollision(
    new THREE.Group(),
    undefined,
    undefined,
    scene,
  );
  return { world, state, objects };
}
test("production collector emits MODEL before child and runs stop/pull after a full prefix", () => {
  const { world, state, objects } = fixture(),
    events = [];
  const faces = world.collectFaces(query, 1, true, {
    stopGroovidelic: (o) => events.push(["stop", o]),
    pullActorFromWorld: (o) => {
      events.push(["pull", o]);
      return null;
    },
  });
  assert.equal(faces.length, 1);
  assert.equal(faces[0].native.actor, state.roots[0]);
  assert.deepEqual(events, [
    ["stop", objects.get(state.roots[0])],
    ["pull", objects.get(state.actors[1])],
  ]);
  assert.deepEqual(faces[0].a.toArray(), [-1, 0, -1]);
  events.length = 0;
  assert.deepEqual(
    world.collectFaces(query, 0, true, {
      pullActorFromWorld: (o) => {
        events.push(o);
        return null;
      },
    }),
    [],
  );
  assert.deepEqual(events, [objects.get(state.actors[1])]);
});
test("model emission global false retains native pull callbacks and NONE prunes", () => {
  const { world, state, objects } = fixture();
  let pulls = 0;
  assert.deepEqual(
    world.collectFaces(query, 4, false, {
      pullActorFromWorld: () => {
        pulls++;
        return null;
      },
    }),
    [],
  );
  assert.equal(pulls, 1);
  objects.get(state.roots[0]).userData.worldSmashDisabled = true;
  world.collectFaces(query, 4, true, {
    pullActorFromWorld: () => {
      pulls++;
      return null;
    },
  });
  assert.equal(pulls, 1);
});
for (const root of ["data", "adv_data"])
  test(`original ${root} production collector owns prepared columns, noncar normalization and migration`, async (t) => {
    let store;
    try {
      store = await createAssetStore(process.env.CARMA2_ROOT || "carma2_orig");
    } catch (error) {
      if (/ENOENT|Original installation/.test(String(error))) {
        t.skip("original installation unavailable");
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
      const bytes = await store.read(path);
      if (!bytes) throw new Error(`missing:${path}`);
      return new Uint8Array(bytes);
    };
    const scene = await assets.scene(`${root}/RACES/newcity1`, "newcity1"),
      original = JSON.stringify(scene.sourceActors),
      layout = captureNativeTrackSceneLayout(scene);
    assert.equal(layout.resolved, true);
    const black = material("M14.MAT"),
      defaultTrack = material("gDefault_track_material");
    scene.materialArena.allocateMaterial(black);
    scene.materialArena.allocateMaterial(defaultTrack);
    const text = new TextDecoder().decode(
        await store.read(`${root}/RACES/newcity1/newcity1.TXT`),
      ),
      specs = parseTrackSmashables(text);
    const modes = [
      "nochange",
      "decal",
      "texturechange",
      "remove",
      "replacemodel",
      "crush",
    ];
    const nativeSpecs = specs.map((s) => ({
      material:
        s.trigger.kind === "material"
          ? (scene.findSourceMaterial(s.trigger.name) ?? null)
          : null,
      triggerType:
        s.trigger.kind === "material" ? 0 : s.trigger.kind === "model" ? 1 : 2,
      mode: modes.indexOf(s.mode),
      levelCount: s.levels.length,
    }));
    let visits = 0;
    const native = prepareNativeWorldScene(scene, {
      initialLayout: layout,
      blackMaterial: black,
      defaultTrackMaterial: defaultTrack,
      smashSpecs: nativeSpecs,
      actorSpecs: [],
      race: null,
      pixelBits: 16,
      spawnPedsOnFace: () => {
        visits++;
      },
    });
    assert.equal(
      JSON.stringify(scene.sourceActors),
      original,
      "source ACT immutable",
    );
    assert.equal(native.columns.flat().filter(Boolean).length, 212);
    assert.equal(
      native.actors.filter((a) => a.provenance.startsWith("native MungeFaces"))
        .length,
      26,
    );
    assert.ok(visits > 10000);
    const migrated = [...new Set(native.resources.values())].filter(
      (r) => r.source === null,
    );
    assert.equal(
      migrated.reduce((n, r) => n + r.current.faces.length, 0),
      126,
    );
    for (const name of ["&07c0533.ACT", "&07c0069.ACT"]) {
      const actor = native.actors.find((a) => a.source?.name === name);
      assert.ok(actor);
      for (let row = 0; row < 3; row++)
        assert.ok(
          Math.abs(
            actor.matrix
              .slice(row * 3, row * 3 + 3)
              .reduce((n, x) => n + x * x, 0) - 1,
          ) < 1e-6,
        );
    }
    const snapshot = captureWorldSource(scene.group, {
        modelPreparation: "track",
        initialNativeLayout: layout,
      }),
      world = new WorldCollision(scene.group, undefined, snapshot, native);
    const all = new THREE.Box3(
      new THREE.Vector3(...layout.initialBounds.min),
      new THREE.Vector3(...layout.initialBounds.max),
    ).expandByScalar(1);
    const faces = world.collectFaces(
      { bounds: all, matrix: new THREE.Matrix4() },
      300,
      true,
    );
    assert.equal(faces.length, 300);
    assert.ok(
      faces.every((s) => s.native && s.actor && Number.isFinite(s.constant)),
    );
    assert.ok(
      faces.every(
        (s) => s.native.model.prepared.revision === s.native.model.revision,
      ),
    );
  });

test("successful pull removes ACT from query roots while retaining source identity", () => {
  const { world, state, objects } = fixture(),
    child = state.actors[1],
    pulled = {};
  const faces = world.collectFaces(query, 3, true, {
    pullActorFromWorld: (object) =>
      object === objects.get(child) ? pulled : null,
  });
  assert.equal(faces.length, 1);
  assert.equal(child.parent, world.nativeScene.nonTrackActors);
  assert.equal(state.roots[0].firstChild, null);
  assert.equal(world.collectFaces(query, 3, true).length, 1);
});

test("retained render ACT reparent keeps the source-local native collector transform", () => {
  const { world, state, objects } = fixture(),
    parent = objects.get(state.roots[0]),
    child = objects.get(state.actors[1]);
  parent.position.x = 2;
  child.position.x = 3;
  parent.add(child);
  parent.updateMatrixWorld(true);
  const before = world
    .collectFaces(query, 4, true)
    .map((face) => face.a.toArray());
  const renderRoot = new THREE.Group();
  renderRoot.attach(child);
  renderRoot.updateMatrixWorld(true);
  assert.equal(child.position.x, 5);
  assert.deepEqual(
    world.collectFaces(query, 4, true).map((face) => face.a.toArray()),
    before,
  );
  assert.equal(state.actors[1].matrix[9], 3);
});

test("live geometry mutation invalidates prepared MODEL while preserving immutable DAT", () => {
  const { world, state } = fixture(),
    actor = state.roots[0],
    resource = actor.localModel.value;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(model.positions, 3),
  );
  geometry.userData.sourceFaceFlags = Uint8Array.of(3);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = model.name;
  const arena = new NativeResourceArena();
  arena.allocateMaterial(resource.current.faces[0].material);
  world.nativeScene.arena = arena;
  world.nativeScene.meshes = new Map([[actor, mesh]]);
  world.nativeScene.initialGeometries = new Map([[actor, geometry]]);
  world.collectFaces(query, 4, true); // First explicit admission of this mutable mesh.
  geometry.getAttribute("position").setY(0, 2);
  geometry.getAttribute("position").needsUpdate = true;
  world.invalidateActors([mesh]);
  assert.notEqual(
    actor.localModel.value,
    resource,
    "explicit local mutation synchronizes MODEL before the next collector callback",
  );
  const emitted = world.collectFaces(query, 4, true)[0];
  assert.equal(emitted.a.y, 2);
  assert.equal(emitted.native.sourceFaceIndex, 0);
  assert.equal(emitted.faceFlags, 3);
  assert.equal(
    model.positions[1],
    0,
    "authored original geometry is unchanged",
  );
  assert.notEqual(
    actor.localModel.value,
    resource,
    "private current MODEL owns changed raw data",
  );
  assert.equal(
    emitted.native.model.prepared.revision,
    emitted.native.model.revision,
  );
  const preparedOwner = actor.localModel.value;
  geometry.userData.sourceFaceFlags[0] = 5;
  world.invalidateActors([mesh]);
  assert.notEqual(
    actor.localModel.value,
    preparedOwner,
    "explicit mutation detects in-place RAW metadata without scanning unrelated MODELs",
  );
  assert.equal(world.collectFaces(query, 4, true)[0].faceFlags, 5);
  assert.equal(
    emitted.faceFlags,
    3,
    "old callback surfaces remain independent snapshots",
  );
});

test("face outlet captures before stop and stop retains borrowed ACT matrix storage", () => {
  const { world, state, objects } = fixture(),
    parent = objects.get(state.roots[0]),
    child = objects.get(state.actors[1]);
  parent.add(child);
  const storage = state.roots[0].matrix,
    events = [];
  const faces = world.collectFaces(query, 4, true, {
    onFace: (surface) => events.push(["face", surface.a.x]),
    stopGroovidelic: (object) => {
      events.push(["stop", object.position.x]);
      if (object === parent) object.position.x = 2;
    },
  });
  assert.equal(state.roots[0].matrix, storage);
  assert.deepEqual(events, [
    ["face", -1],
    ["stop", 0],
    ["face", 1],
    ["stop", 0],
  ]);
  assert.equal(
    faces[0].a.x,
    -1,
    "already emitted vertices retain pre-stop pose",
  );
  assert.equal(
    faces[1].a.x,
    1,
    "later child borrows the changed source ACT pMat",
  );
});

function drivableFixture() {
  const world = new WorldCollision(new THREE.Group());
  const makeOwner = (height = 0) => {
    const vertices = [];
    for (const x of [-1, 1])
      for (const y of [-0.1, 0.1])
        for (const z of [-1, 1]) vertices.push(new THREE.Vector3(x, y, z));
    const hull = {
      vertices,
      edges: [],
      faces: [
        [1, 0, 0, 1],
        [-1, 0, 0, 1],
        [0, 1, 0, 0.1],
        [0, -1, 0, 0.1],
        [0, 0, 1, 1],
        [0, 0, -1, 1],
      ].map(([x, y, z, constant]) => ({
        normal: new THREE.Vector3(x, y, z),
        constant,
        indices: [],
      })),
    };
    const owner = {
      hulls: [hull],
      state: {
        position: new THREE.Vector3(0, height, 0),
        orientation: new THREE.Quaternion(),
        velocity: new THREE.Vector3(2, 0, 0),
        angularVelocity: new THREE.Vector3(),
      },
      properties: {
        mass: 1,
        inertia: new THREE.Vector3(1, 1, 1),
        centerOfMass: new THREE.Vector3(),
        worldFriction: 1,
      },
    };
    world.addDynamic(owner, new THREE.Group());
    return owner;
  };
  return { world, makeOwner };
}
test("drivable wheel phase snapshots only first50 PHIL owners and preserves equal-hit order", () => {
  const { world, makeOwner } = drivableFixture();
  const owners = Array.from({ length: 51 }, () => makeOwner());
  owners[50].state.position.y = 0.5;
  const origin = new THREE.Vector3(0, 2, 0),
    direction = new THREE.Vector3(0, -1, 0);
  world.setDrivableOwnerOrder(owners);
  let hit = world.drivableWheelRaycast(origin, direction, 3);
  assert.equal(hit.body, owners[0], "closer owner51 is outside the snapshot");
  assert.ok(Math.abs(hit.distance - 1.9) < 1e-6);
  assert.deepEqual(hit.normal.toArray(), [0, 1, 0]);
  assert.deepEqual(hit.velocity.toArray(), [2, 0, 0]);
  world.setDrivableOwnerOrder([...owners].reverse());
  hit = world.drivableWheelRaycast(origin, direction, 3);
  assert.equal(hit.body, owners[50], "linked admission order controls the cap");
  world.setDrivableOwnerOrder([owners[1], owners[0]]);
  assert.equal(
    world.drivableWheelRaycast(origin, direction, 3).body,
    owners[1],
  );
});
test("drivable wheel shape pass cannot be masked by uncached static geometry or moving-world", () => {
  const { world, makeOwner } = drivableFixture(),
    owner = makeOwner();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, 1, -1, 0, 1, 1, 1, 1, -1], 3),
  );
  const staticFace = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  // The unrestricted diagnostic ray sees this static face at distance1. It
  // must never suppress the later drivable hit at1.9 after a full300 cache.
  const staticRoot = new THREE.Group();
  staticRoot.add(staticFace);
  const isolated = new WorldCollision(staticRoot);
  isolated.addDynamic(owner, new THREE.Group());
  const moving = makeOwner(1.5);
  moving.kind = "moving-world";
  isolated.addDynamic(moving, new THREE.Group(), true, true);
  isolated.setDrivableOwnerOrder([moving, owner]);
  const origin = new THREE.Vector3(0, 2, 0),
    direction = new THREE.Vector3(0, -1, 0);
  assert.equal(isolated.wheelRaycast(origin, direction, 3).body, undefined);
  const hit = isolated.drivableWheelRaycast(origin, direction, 3);
  assert.equal(hit.body, owner);
  assert.ok(Math.abs(hit.distance - 1.9) < 1e-6);
  assert.equal(
    hit.surface,
    undefined,
    "native owner shape has no cached MODEL row",
  );
  owner.hulls.unshift({ ...owner.hulls[0], faces: [], vertices: [] });
  assert.equal(
    isolated.drivableWheelRaycast(origin, direction, 3).body,
    owner,
    "wheel phase follows successor shape links rather than camera head-only query",
  );
  assert.equal(
    isolated.drivableWheelRaycast(new THREE.Vector3(), direction, 3),
    null,
    "start-inside shape sentinel does not become a boundary wheel hit",
  );
});

test("native replacement verifies copied DAT tables and restores face ownership after compaction", async () => {
  const { createModelGeometry } = await import("../src/render-geometry.ts");
  const { world, state } = fixture(),
    actor = state.roots[0];
  const mat = actor.localModel.value.current.faces[0].material;
  const replacementModel = {
    ...model,
    name: "replacement",
    pivot: [0, 0.25, 0],
    positions: Float32Array.from([-1, 1, -1, 0, 1, 1, 1, 1, -1, 2, 1, -1]),
    uvs: new Float32Array(8),
    faces: [
      { indices: [0, 1, 2], material: 1, flags: 0, smoothing: 0 },
      { indices: [2, 1, 3], material: 1, flags: 1, smoothing: 0 },
    ],
  };
  const replacement = createNativeTrackModelResource(
    replacementModel,
    () => known(mat),
    4,
  ).value;
  assert.ok(prepareNativeTrackResource(replacement).resolved);
  world.nativeScene.resources.set(replacement, replacement);
  world.nativeScene.findModelResource = (name) =>
    name === replacementModel.name ? replacement : undefined;
  const arena = new NativeResourceArena();
  arena.allocateMaterial(mat);
  world.nativeScene.arena = arena;
  const mesh = new THREE.Mesh(
    createModelGeometry(model),
    new THREE.MeshBasicMaterial(),
  );
  mesh.name = model.name;
  world.nativeScene.meshes = new Map([[actor, mesh]]);
  world.collectFaces(query, 4);
  const fullGeometry = createModelGeometry(replacementModel);
  assert.notEqual(
    fullGeometry.userData.sourcePositions,
    replacementModel.positions,
  );
  mesh.geometry = fullGeometry;
  mesh.name = replacementModel.name;
  let faces = world
    .collectFaces(query, 4)
    .filter((face) => face.native.actor === actor);
  assert.equal(
    actor.localModel.value,
    replacement,
    "copied canonical metadata resolves actual loaded identity",
  );
  assert.equal(faces.length, 2);
  assert.ok(
    faces.every((face) => face.a.y === 0.75),
    "native raw-minus-pivot convention is retained",
  );
  const compact = new THREE.BufferGeometry();
  compact.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([1, 1, -1, 0, 1, 1, 2, 1, -1], 3),
  );
  compact.userData.worldSmashSourceFaces = [1];
  mesh.geometry = compact;
  faces = world
    .collectFaces(query, 4)
    .filter((face) => face.native.actor === actor);
  assert.equal(faces.length, 1);
  assert.equal(faces[0].native.sourceFaceIndex, 1);
  assert.equal(
    faces[0].a.y,
    0.75,
    "mutation preserves the same pivot subtraction",
  );
  mesh.geometry = fullGeometry;
  faces = world
    .collectFaces(query, 4)
    .filter((face) => face.native.actor === actor);
  assert.equal(
    faces.length,
    2,
    "restored topology retains admitted ownership beyond last compacted tables",
  );
  assert.deepEqual(
    faces.map((face) => face.native.sourceFaceIndex).sort(),
    [0, 1],
  );
});

for (const root of ["data", "adv_data"])
  test(`original ${root} Desert missing registry lookup is native NULL rather than an unresolved provider`, async (t) => {
    let store;
    try {
      store = await createAssetStore(process.env.CARMA2_ROOT || "carma2_orig");
    } catch (error) {
      if (/ENOENT|Original installation/.test(String(error))) {
        t.skip("original installation unavailable");
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
      const bytes = await store.read(path);
      if (!bytes) throw new Error(`missing:${path}`);
      return new Uint8Array(bytes);
    };
    const scene = await assets.scene(
      `${root}/RACES/desert_mission`,
      "desert_mission",
    );
    assert.ok(
      scene.sourceMaterialStorage.some((mat) => mat.name === "!/75WATER"),
      "literal resource is admitted",
    );
    assert.equal(
      scene.findSourceMaterial("!/75WATER"),
      undefined,
      "native slash pattern terminator has no matching registry name",
    );
    const layout = captureNativeTrackSceneLayout(scene);
    assert.ok(layout.resolved);
    const defaultTrack = material("gDefault_track_material"),
      black = material("M14.MAT");
    scene.materialArena.allocateMaterial(defaultTrack);
    scene.materialArena.allocateMaterial(black);
    const native = prepareNativeWorldScene(scene, {
      initialLayout: layout,
      defaultTrackMaterial: defaultTrack,
      blackMaterial: black,
      smashSpecs: [],
      actorSpecs: [],
      race: null,
      pixelBits: 16,
      spawnPedsOnFace: () => {},
    });
    let absentFaces = 0;
    for (const resource of new Set(native.resources.values())) {
      const dat = resource.source;
      if (!dat) continue;
      for (const face of resource.current.faces) {
        const original = dat.faces[face.sourceFaceIndex];
        if (
          original.material &&
          dat.materials[original.material - 1] === "!/75WATER"
        ) {
          assert.equal(
            face.material,
            null,
            "installed MATERIAL_INDEX stores actual lookup NULL",
          );
          absentFaces++;
        }
      }
    }
    assert.ok(absentFaces > 0);
    const world = new WorldCollision(scene.group, undefined, undefined, native);
    const all = new THREE.Box3(
      new THREE.Vector3(...layout.initialBounds.min),
      new THREE.Vector3(...layout.initialBounds.max),
    ).expandByScalar(1);
    const faces = world.collectFaces(
      { bounds: all, matrix: new THREE.Matrix4() },
      300,
    );
    assert.equal(faces.length, 300);
    assert.ok(
      faces.every((face) => face.native && Number.isFinite(face.constant)),
    );
    scene.dispose();
    assets.releaseRaceResources();
  });

test("common MODEL registration supplies cold Junknet and global copies retain MAT leases across race release", async (t) => {
  let store;
  try {
    store = await createAssetStore(process.env.CARMA2_ROOT || "carma2_orig");
  } catch (error) {
    if (/ENOENT|Original installation/.test(String(error))) {
      t.skip("original installation unavailable");
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
    const bytes = await store.read(path);
    if (!bytes) throw new Error(`missing:${path}`);
    return new Uint8Array(bytes);
  };
  await assets.common(() => {});
  const prepare = async (root, stem) => {
    const scene = await assets.scene(`${root}/RACES/${stem}`, stem);
    const layout = captureNativeTrackSceneLayout(scene);
    assert.ok(layout.resolved);
    const materials = assets.generatedTrackMaterials();
    const native = prepareNativeWorldScene(scene, {
      initialLayout: layout,
      ...materials,
      smashSpecs: [],
      actorSpecs: [],
      race: null,
      pixelBits: 16,
      spawnPedsOnFace: () => {},
      retainChangingPowerupMaterial: (mat) => assets.retainNativeMaterial(mat),
    });
    return { scene, native };
  };
  const initial = await prepare("data", "newcity1");
  assert.equal(
    initial.native.actors.filter(
      (actor) =>
        initial.native.actorObjects.get(actor)?.userData
          .c2NativePowerupRender === "changing",
    ).length,
    0,
    "default Newcity does not fabricate first changing-model initialization",
  );
  initial.scene.dispose();
  assets.releaseRaceResources();
  const first = await prepare("data", "Junknet");
  assert.equal(
    first.scene.sourceModelStorage.some((model) =>
      /^&70powerup1\.act$/i.test(model.name),
    ),
    false,
    "Junknet has no local power MODEL",
  );
  const commonPowerModel = first.scene.findSourceModel("&70powerup1.ACT");
  assert.ok(
    commonPowerModel,
    "genuine common registered MODEL fills the source lookup",
  );
  const commonBindings =
    first.scene.sourceModelMaterialBindings.get(commonPowerModel);
  assert.ok(commonBindings);
  const commonResource = first.native.resources.get(commonPowerModel);
  assert.ok(commonResource);
  assert.deepEqual(
    commonResource.current.faces.map((face) => face.material),
    commonPowerModel.faces.map((face) =>
      face.material ? commonBindings[face.material - 1] : null,
    ),
    "lazy common MODEL preparation preserves its startup DAT material bindings",
  );
  const changed = first.native.actors.find(
    (actor) =>
      first.native.actorObjects.get(actor)?.userData.c2NativePowerupRender ===
      "changing",
  );
  assert.ok(changed);
  const identity = changed.localModel.value;
  const mats = [
    ...new Set(
      identity.current.faces.map((face) => face.material).filter(Boolean),
    ),
  ];
  assert.ok(mats.length > 0);
  const addresses = mats.map((mat) =>
    assets.materialArena.materialAddress(mat),
  );
  assert.ok(addresses.every((value) => value.resolved));
  first.scene.dispose();
  assets.releaseRaceResources();
  assert.deepEqual(
    mats.map((mat) => assets.materialArena.materialAddress(mat)),
    addresses,
    "retained copied-face MAT allocations stay live at the same host addresses",
  );
  const next = await prepare("adv_data", "Junknet");
  const reused = next.native.actors.find(
    (actor) =>
      next.native.actorObjects.get(actor)?.userData.c2NativePowerupRender ===
      "changing",
  );
  assert.equal(
    reused.localModel.value,
    identity,
    "installed process-global MODEL identity survives race reload",
  );
  assert.equal(next.native.resources.get(identity), identity);
  assert.ok(identity.current.flags & 0x20);
  assert.equal(identity.prepared.revision, identity.revision);
  next.scene.dispose();
  assets.releaseRaceResources();
});
