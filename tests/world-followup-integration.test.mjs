import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Vector3,
} from "three";
import { WorldDestruction } from "../src/world-destruction.ts";
import { WorldFollowupRuntime } from "../src/world-followup.ts";
import { NativeDelayedSideEffects } from "../src/smash-delayed.ts";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText, parseAct, parseDat } from "../src/formats.ts";
import { createModelGeometry } from "../src/render-geometry.ts";
import { parseTrackSmashables } from "../src/world-smash.ts";

const connotations = () => ({
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
});
const spec = (trigger, options = {}) => ({
  flags: 0,
  trigger,
  mode: "nochange",
  levels: [],
  removalThreshold: 0,
  reserved: [0, 0, 0, 0],
  connotations: connotations(),
  ...options,
});
const geometry = (triangles) => {
  const result = new BufferGeometry();
  result.setAttribute(
    "position",
    new Float32BufferAttribute(triangles.flat(2), 3),
  );
  result.computeVertexNormals();
  return result;
};
const triangle = [
  [-1, -1, 0],
  [1, -1, 0],
  [0, 1, 0],
];
function fixture(
  specs,
  triangles = [triangle],
  { name = "PYLON.ACT", model = "PYLON.DAT", material = "STONE" } = {},
) {
  const root = new Group(),
    actor = new Group(),
    mat = new MeshLambertMaterial();
  actor.name = name;
  mat.name = material;
  const mesh = new Mesh(geometry(triangles), mat);
  mesh.name = model;
  root.add(actor);
  actor.add(mesh);
  const effects = [];
  const runtime = new WorldDestruction(root, specs, {
    onConnotations: (data, contact) => effects.push({ data, contact }),
    random: () => 0,
  });
  const query = (min = [-2, -2, -1], max = [2, 2, 1], options) =>
    runtime.collectFollowupFaces(
      { min, max, trackMatrix: new Matrix4().elements },
      400,
      options,
    );
  const contact = (normalImpulse = 0.01, extra = {}) => ({
    actor: mesh,
    material,
    faceIndex: 0,
    normalImpulse,
    kind: "body",
    point: new Vector3(),
    timeMs: 100,
    ...extra,
  });
  return { root, actor, mesh, runtime, effects, query, contact };
}
function queued(fixture, target = "*.DAT", options = {}) {
  const pool = new NativeDelayedSideEffects(),
    due = [];
  let draws = 0;
  const runtime = new WorldFollowupRuntime({
    delayed: pool,
    readTimeMs: () => 100,
    readTrackMatrix: () => new Matrix4().elements,
    collectFaces: (query, capacity) =>
      fixture.runtime.collectFollowupFaces(query, capacity, options),
    random: () => {
      draws++;
      return 0;
    },
    onDue: (context) => due.push(context),
  });
  const source = {
    actor: {},
    readMatrix: () => new Matrix4().elements,
    readVelocity: () => [1, 2, 3],
  };
  const inserted = runtime.enqueue(
    [
      {
        target,
        coordinates: "absolute",
        min: [-100, -100, -100],
        max: [100, 100, 100],
        delaySeconds: [0, 0],
        direction: "away",
        strength: 10,
      },
    ],
    source,
    5,
  );
  pool.update(100, (entry, now) => entry.context.advance(now));
  return { inserted, due, draws };
}

test("collector clips triangles against cuboid, includes pass-through faces, and uses live target pose", () => {
  const f = fixture(
    [spec({ kind: "model", name: "PYLON.ACT" })],
    [
      [
        [2, 0, 0],
        [0, 2, 0],
        [2, 2, 0],
      ], // AABB overlaps origin, triangle does not.
      [
        [-5, -5, 0],
        [5, -5, 0],
        [0, 5, 0],
      ], // Cuboid lies inside; no triangle vertex lies in it.
    ],
  );
  f.mesh.geometry.userData.worldSmashFaceModes = ["solid", "passthrough"];
  assert.deepEqual(
    f.query([-0.1, -0.1, -1], [0.1, 0.1, 1]).map((face) => face.faceIndex),
    [1],
  );
  const pose = new Matrix4().makeTranslation(20, 0, 0);
  const options = {
    readActorPose: (actor) => (actor === f.actor ? pose : undefined),
  };
  assert.equal(f.query([-0.1, -0.1, -1], [0.1, 0.1, 1], options).length, 0);
  const selected = f.query([19.9, -0.1, -1], [20.1, 0.1, 1], options);
  assert.equal(selected.length, 1);
  assert.deepEqual(selected[0].actor.readTranslation(), [20, 0, 0]);
  assert.deepEqual(selected[0].source, {
    actor: f.mesh,
    faceIndex: 1,
    material: "STONE",
  });
});

test("collector face400 cap precedes target registration and preserves source group identity", () => {
  const model = spec({ kind: "model", name: "PYLON.ACT" });
  const f = fixture([model], [triangle]);
  const unboundActor = new Group(),
    mat = new MeshLambertMaterial();
  mat.name = "UNBOUND";
  unboundActor.name = "UNREGISTERED.ACT";
  const unboundMesh = new Mesh(
    geometry(Array.from({ length: 400 }, () => triangle)),
    mat,
  );
  unboundActor.add(unboundMesh);
  f.root.remove(f.actor);
  f.root.add(unboundActor, f.actor);
  assert.equal(f.query().length, 400);
  const capped = queued(f);
  assert.equal(capped.inserted, 0);
  assert.equal(capped.draws, 0);
  f.root.remove(unboundActor);
  f.mesh.geometry.addGroup(0, 3, 0);
  const admitted = queued(f);
  assert.equal(admitted.inserted, 1);
  assert.equal(admitted.due[0].face.actor.identity, f.actor);
  assert.equal(admitted.due[0].face.groupIndex, 0);
});

test("material binding owns selection before ordinary ACT; registration survives runtime ACT renaming", () => {
  const ordinary = spec({ kind: "model", name: "PYLON.ACT" });
  const material = spec({ kind: "material", name: "GLASS.MAT" });
  const f = fixture([ordinary, material], [triangle], {
    material: "GLASS.MAT",
  });
  f.actor.name = "pyl0122.ACT";
  assert.equal(f.actor.userData.worldSmashOriginalIdentifier, "PYLON.ACT");
  const faces = f.query();
  assert.equal(faces[0].actor.ordinarySpec, ordinary);
  assert.equal(faces[0].material.spec, material);
  assert.equal(
    queued(f).inserted,
    0,
    "material selector rejection does not fall through to ACT",
  );
  const admitted = queued(f, "*.MAT");
  assert.equal(admitted.inserted, 1);
  assert.equal(admitted.due[0].targetSpec, material);
  assert.equal(admitted.due[0].targetKind, "material");
  const low = f.runtime.handleFollowup(f.contact(), material);
  assert.deepEqual(
    low.changes.map((change) => change.spec),
    [material],
  );
  assert.equal(f.effects[0].contact.actor, f.mesh);
});

test("followup bypasses .02 contact gate while retaining authored body flags and removal thresholds", () => {
  const ordinary = spec(
    { kind: "model", name: "PYLON.ACT" },
    { removalThreshold: 0.005 },
  );
  const f = fixture([ordinary]);
  assert.equal(f.runtime.handleContact(f.contact(0.01)).changed, false);
  assert.equal(
    f.runtime.handleFollowup(f.contact(0.004), ordinary).changed,
    false,
  );
  const source = new Group(),
    velocity = new Vector3(3, 4, 5),
    force = new Vector3(0, 10, 0);
  const accepted = f.runtime.handleFollowup(
    f.contact(0.01, {
      bodyActor: source,
      impacteeVelocity: velocity,
      effectForce: force,
    }),
    ordinary,
  );
  assert.equal(accepted.changed, true);
  assert.equal(f.effects[0].contact.bodyActor, source);
  assert.equal(f.effects[0].contact.impacteeVelocity, velocity);
  assert.equal(f.effects[0].contact.effectForce, force);
  const suppressed = fixture([
    spec({ kind: "model", name: "PYLON.ACT" }, { flags: 2 }),
  ]);
  assert.equal(
    suppressed.runtime.handleFollowup(
      suppressed.contact(),
      suppressed.runtime.specs[0],
    ).changed,
    false,
  );
});

test("numbered due Bash selection uses only flag2, excludes material/ordinary specs, and accepts released actor", () => {
  for (const argument of [1, 2, 4, 3, 6]) {
    const numbered = spec(
      { kind: "number", name: "&20", index: 20, argument },
      { flags: 2 },
    );
    const ordinary = spec({ kind: "model", name: "PYLON.ACT" });
    const material = spec({ kind: "material", name: "STONE" });
    const f = fixture([material, ordinary, numbered], [triangle], {
      name: "&20!anything",
    });
    const result = f.runtime.handleFollowup(f.contact(), undefined, true);
    assert.deepEqual(
      result.changes.map((change) => change.spec),
      argument & 2 ? [numbered] : [],
      `due flag ${argument} routes BashObject only`,
    );
    const normal = fixture([numbered], [triangle], { name: "&20!anything" });
    assert.equal(
      normal.runtime.handleContact(normal.contact(0.03)).changed,
      !!(argument & 4),
      `normal released contact flag ${argument}`,
    );
    const attached = fixture([numbered], [triangle], { name: "&20 anything" });
    assert.equal(
      attached.runtime.handleContact(attached.contact(0.03)).changed,
      !!(argument & 1),
      `normal attached contact flag ${argument}`,
    );
  }
  const f = fixture(
    [spec({ kind: "number", name: "&20", index: 20, argument: 2 })],
    [triangle],
    { name: "&20!anything" },
  );
  assert.equal(
    queued(f, "&*", { isRegisteredNoncar: (actor) => actor === f.actor })
      .inserted,
    0,
    "released numbered ACT is excluded during candidate collection",
  );
});

test("original Stock/Advanced Carrier ACT/model names retain authoritative model binding and due spec", async (t) => {
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original installation is absent");
    return;
  }
  const assets = await createAssetStore();
  for (const base of ["data", "adv_data"]) {
    const folder = `${base}/RACES/Carrier_mission/`;
    const specs = parseTrackSmashables(
      decodeText(await assets.read(`${folder}CARRIER_mission.txt`)),
    );
    const core = specs.find(
      (s) => s.trigger.name.toLowerCase() === "&core.act",
    );
    const nodes = parseAct(await assets.read(`${folder}CARRIER_mission.act`));
    let coreNode;
    const visit = (list) => {
      for (const node of list) {
        if (node.model?.toLowerCase() === "&core.act") coreNode = node;
        visit(node.children);
      }
    };
    visit(nodes);
    assert.ok(coreNode);
    assert.equal(coreNode.name, "&coR0122.ACT");
    let coreModel;
    for (const entry of assets.manifest.filter(
      (e) =>
        e.path.toLowerCase().startsWith(folder.toLowerCase()) &&
        /\.dat$/i.test(e.path),
    )) {
      coreModel ??= parseDat(await assets.read(entry.path)).find(
        (model) => model.name.toLowerCase() === "&core.act",
      );
      if (coreModel) break;
    }
    assert.ok(coreModel);
    const f = fixture([core], [triangle], {
      name: coreNode.name,
      model: coreNode.model,
    });
    f.mesh.geometry = createModelGeometry(coreModel);
    const faces = f.query([-1000, -1000, -1000], [1000, 1000, 1000]);
    assert.ok(faces.length > 0);
    assert.equal(faces[0].actor.ordinarySpec, core);
    assert.equal(faces[0].actor.identity, f.actor);
    assert.equal(faces[0].actor.readIdentifier(), coreNode.name);
    const pending = queued(f);
    assert.equal(
      pending.inserted,
      1,
      `${base}: ordinary wildcard dedups model faces to one ACT task`,
    );
    assert.equal(pending.due[0].targetSpec, core);
  }
});
