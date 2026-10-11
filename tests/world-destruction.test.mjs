import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Texture,
  Triangle,
  Vector3,
} from "three";
import { WorldDestruction } from "../src/world-destruction.ts";
import { WorldCollision, batchStaticWorld } from "../src/world.ts";
import { captureWorldSource } from "../src/world-source.ts";
import { createAssetStore } from "../server/assets.mjs";
import { parseAct, parseDat, parseMat, decodeText } from "../src/formats.ts";
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
function spec(mode, trigger = { kind: "material", name: "GLASS" }) {
  return {
    flags: 0,
    trigger,
    mode,
    levels: [],
    removalThreshold: 2,
    connotations: connotations(),
    reserved: [0, 0, 0, 0],
  };
}
function textureSpec(mode = "texturechange", flags = 0) {
  return {
    ...spec(mode),
    intactPixelmap: "INTACT",
    levels: [
      {
        threshold: 1,
        flags,
        collisionMode: mode === "decal" ? undefined : "solid",
        connotations: connotations(),
        pixelmaps: ["CRACK"],
      },
      {
        threshold: 3,
        flags: 0,
        collisionMode: mode === "decal" ? undefined : "passthrough",
        connotations: connotations(),
        pixelmaps: ["BROKEN"],
      },
    ],
  };
}
function material(name = "GLASS") {
  const m = new MeshLambertMaterial();
  m.name = name;
  m.map = new Texture();
  return m;
}
function quad(size = 2, x = 0) {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      [
        x,
        0,
        0,
        x + size,
        0,
        0,
        x + size,
        size,
        0,
        x,
        0,
        0,
        x + size,
        size,
        0,
        x,
        size,
        0,
      ],
      3,
    ),
  );
  geometry.setAttribute(
    "uv",
    new Float32BufferAttribute(
      [0, 0, size, 0, size, size, 0, 0, size, size, 0, size],
      2,
    ),
  );
  geometry.computeVertexNormals();
  geometry.userData.sourceFaceFlags = Uint8Array.from([4, 1]);
  return geometry;
}
function rootMesh(name = "PANE", geometry = quad(), mat = material()) {
  const root = new Group(),
    actor = new Group();
  actor.name = name;
  const mesh = new Mesh(geometry, mat);
  mesh.name = name;
  actor.add(mesh);
  root.add(actor);
  return { root, actor, mesh, mat };
}
function textures() {
  return new Map([
    ["crack", new Texture()],
    ["broken", new Texture()],
  ]);
}
const contact = (mesh, impulse, overrides = {}) => ({
  actor: mesh,
  faceIndex: 0,
  material: "GLASS",
  normalImpulse: impulse,
  kind: "body",
  point: new Vector3(0.25, 0.25, 0),
  timeMs: 100,
  ...overrides,
});
function area(mesh, predicate = () => true) {
  const p = mesh.geometry.getAttribute("position"),
    index = mesh.geometry.index;
  let sum = 0;
  for (let i = 0; i < (index?.count ?? p.count); i += 3) {
    if (!predicate(i / 3)) continue;
    const vertices = [0, 1, 2].map((c) =>
      new Vector3().fromBufferAttribute(p, index ? index.getX(i + c) : i + c),
    );
    sum += new Triangle(...vertices).getArea();
  }
  return sum;
}

test("model and numeric actors survive batching and removal keeps other objects intact", () => {
  const { root, actor, mesh } = rootMesh("&PROP.ACT");
  const other = new Group();
  other.name = "OTHER";
  root.add(other);
  const events = [];
  const s = spec("remove", { kind: "model", name: "&PROP.ACT" });
  const runtime = new WorldDestruction(root, [s], {
    onChange: (e) => events.push(e),
  });
  assert.deepEqual(runtime.retainActors, [actor]);
  assert.equal(actor.userData.worldSmashRetained, true);
  assert.equal(runtime.handleContact(contact(mesh, 1.999)).changed, false);
  const hit = runtime.handleContact(contact(mesh, 2));
  assert.equal(hit.threshold, 2);
  assert.equal(actor.visible, false);
  assert.equal(other.visible, true);
  assert.equal(events[0].requiresRebuild, true);
  assert.equal(actor.userData.worldSmashDisabled, true);
  assert.equal(runtime.handleContact(contact(mesh, 20)).changed, false);
  const numbered = rootMesh("&12?0001.ACT");
  const ns = spec("nochange", {
    kind: "number",
    name: "&12",
    index: 12,
    argument: 1,
  });
  ns.flags = 2;
  const nr = new WorldDestruction(numbered.root, [ns]);
  assert.deepEqual(nr.retainActors, [numbered.actor]);
  assert.equal(nr.handleContact(contact(numbered.mesh, 3)).changed, true);
  numbered.actor.name = "&12!0001.ACT";
  assert.equal(
    nr.handleContact(contact(numbered.mesh, 3, { timeMs: 200 })).changed,
    false,
  );
});

test("replacement uses actual supplied model geometry and preserves the ACT transform", async () => {
  const { root, actor, mesh } = rootMesh("PUMP.ACT");
  actor.position.set(4, 5, 6);
  const child = new Group();
  actor.add(child);
  const s = spec("replacemodel", { kind: "model", name: "PUMP.ACT" });
  s.replacement = { model: "BASE.DAT", fire: { chance: 0 } };
  const runtime = new WorldDestruction(root, [s]);
  assert.equal(runtime.handleContact(contact(mesh, 3)).changed, false);
  assert.match(runtime.diagnostics[0], /Missing replacement model/);
  const replacement = quad(0.5);
  await runtime.preload(async (name) => {
    assert.equal(name, "BASE.DAT");
    return { geometry: replacement, materials: material("BASE") };
  });
  const result = runtime.handleContact(contact(mesh, 3));
  assert.equal(result.changed, true);
  assert.equal(result.threshold, 2);
  assert.notEqual(mesh.geometry, replacement);
  assert.equal(area(mesh), 0.25);
  assert.deepEqual(actor.position.toArray(), [4, 5, 6]);
  assert.equal(child.visible, false);
  assert.equal(child.userData.worldSmashDisabled, true);
  assert.equal(mesh.material.name, "BASE");
  assert.equal(runtime.handleContact(contact(mesh, 4)).changed, false);
});

test("replacement removes retained sibling static and dynamic colliders before retry", () => {
  const { root, actor, mesh } = rootMesh("PUMP.ACT");
  const staticChild = new Group(),
    dynamicChild = new Group();
  staticChild.position.x = 5;
  dynamicChild.position.x = 10;
  staticChild.add(new Mesh(quad(1), material("STATIC")));
  dynamicChild.add(new Mesh(quad(1), material("DYNAMIC")));
  dynamicChild.userData.dynamicBody = true;
  actor.add(staticChild, dynamicChild);
  const body = {
    state: {
      position: new Vector3(10, 0, 0),
      orientation: new Quaternion(),
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
    },
    properties: {
      mass: 1,
      inertia: new Vector3(1, 1, 1),
      centerOfMass: new Vector3(),
      worldFriction: 0,
    },
  };
  const collision = new WorldCollision(root);
  collision.addDynamic(body, dynamicChild, true, true);
  const direction = new Vector3(0, 0, -1);
  assert.ok(collision.raycast(new Vector3(5.25, 0.25, 1), direction, 2));
  assert.equal(
    collision.raycast(new Vector3(10.25, 0.25, 1), direction, 2)?.body,
    body,
  );
  const s = spec("replacemodel", { kind: "model", name: "PUMP.ACT" });
  s.replacement = { model: "BASE.DAT", fire: { chance: 0 } };
  const runtime = new WorldDestruction(root, [s], {
    models: new Map([
      ["BASE.DAT", { geometry: quad(0.5), materials: material("BASE") }],
    ]),
  });
  const result = runtime.handleContact(contact(mesh, 3));
  assert.equal(result.changes[0].requiresRebuild, true);
  collision.rebuildStatic();
  collision.invalidateDynamic();
  assert.equal(
    collision.raycast(new Vector3(5.25, 0.25, 1), direction, 2),
    null,
  );
  assert.equal(
    collision.raycast(new Vector3(10.25, 0.25, 1), direction, 2),
    null,
  );
  assert.ok(collision.raycast(new Vector3(0.25, 0.25, 1), direction, 2));
  assert.equal(staticChild.userData.worldSmashDisabled, true);
  assert.equal(dynamicChild.userData.worldSmashDisabled, true);
  assert.equal(mesh.userData.worldSmashDisabled, undefined);
  assert.equal(actor.visible, true);
});

test("texture damage is local to one native UV tile and does not mutate a shared material", () => {
  const { root, mesh, mat } = rootMesh();
  const unaffected = new Mesh(quad(), mat);
  root.add(unaffected);
  const originalMap = mat.map;
  const runtime = new WorldDestruction(root, [textureSpec()], {
    textures: textures(),
    random: () => 0,
  });
  const first = runtime.handleContact(contact(mesh, 1));
  assert.equal(first.changed, true);
  assert.equal(first.threshold, undefined);
  assert.equal(first.changes[0].requiresRebuild, true);
  assert.ok(first.changes[0].affectedFaceIndices.length > 0);
  assert.equal(area(mesh), 4);
  assert.equal(
    area(
      mesh,
      (i) => mesh.geometry.userData.worldSmashFaceModes[i] === "solid",
    ),
    4,
  );
  assert.equal(mat.map, originalMap);
  assert.equal(unaffected.material, mat);
  const patchIndices = first.changes[0].affectedFaceIndices;
  assert.equal(
    area(mesh, (i) => patchIndices.includes(i)),
    1,
  );
  const second = runtime.handleContact(
    contact(mesh, 3, { faceIndex: patchIndices[0] }),
  );
  assert.equal(second.threshold, 3);
  assert.equal(second.changes[0].level, 2);
  assert.equal(
    area(
      mesh,
      (i) => mesh.geometry.userData.worldSmashFaceModes[i] === "passthrough",
    ),
    1,
  );
  assert.equal(area(mesh), 4);
  assert.equal(
    runtime.handleContact(
      contact(mesh, 2, { faceIndex: second.changes[0].affectedFaceIndices[0] }),
    ).changed,
    false,
  );
});

test("material-only UV-tile smashes retain the same rendered and source collision actor through batching", () => {
  const { root, actor, mesh } = rootMesh("original-wall-model");
  root.name = "PP01 1 1 1 1";
  const runtime = new WorldDestruction(root, [textureSpec()], {
    textures: textures(),
    random: () => 0,
  });
  assert.deepEqual(runtime.retainActors, [actor]);
  const source = captureWorldSource(root);
  const rendered = batchStaticWorld(root, runtime.retainActors);
  runtime.root = rendered;
  const world = new WorldCollision(rendered, undefined, source);
  assert.equal(mesh.parent, actor);
  assert.equal(actor.parent, rendered);
  assert.equal(
    rendered.children.length,
    1,
    "no material GPU batch separates mutable original faces",
  );
  const bounds = [new Vector3(-1, -1, -1), new Vector3(3, 3, 1)];
  assert.ok(
    world.querySurfaces(...bounds).every((face) => face.actor === mesh),
  );
  const intactArea = world
    .querySurfaces(...bounds)
    .reduce(
      (sum, face) => sum + new Triangle(face.a, face.b, face.c).getArea(),
      0,
    );
  const first = runtime.handleContact(contact(mesh, 1));
  assert.equal(first.changed, true);
  const second = runtime.handleContact(
    contact(mesh, 3, { faceIndex: first.changes[0].affectedFaceIndices[0] }),
  );
  assert.equal(second.changed, true);
  assert.ok(mesh.geometry.userData.worldSmashFaceModes.includes("passthrough"));
  world.rebuildStatic();
  const solid = world.querySurfaces(...bounds);
  assert.ok(solid.every((face) => face.actor === mesh));
  assert.ok(
    solid.every((face) => face.source === undefined),
    "rewritten tile geometry cannot reuse stale original DAT indices",
  );
  const solidArea = solid.reduce(
    (sum, face) => sum + new Triangle(face.a, face.b, face.c).getArea(),
    0,
  );
  assert.ok(
    Math.abs(intactArea - solidArea - 1) < 1e-6,
    "same visible UV tile leaves collision after original-mesh rewrite",
  );
  runtime.dispose();
});

test("authored texture transforms control tile area and whole-quad flags override tile splitting", () => {
  const fixture = rootMesh();
  fixture.mat.map.matrixAutoUpdate = false;
  fixture.mat.map.matrix.set(2, 0, 0, 0, 2, 0, 0, 0, 1);
  const runtime = new WorldDestruction(fixture.root, [textureSpec()], {
    textures: textures(),
    random: () => 0,
  });
  const result = runtime.handleContact(
    contact(fixture.mesh, 3, { point: new Vector3(0.1, 0.1, 0) }),
  );
  assert.equal(result.changed, true);
  assert.equal(area(fixture.mesh), 4);
  assert.equal(
    area(
      fixture.mesh,
      (i) =>
        fixture.mesh.geometry.userData.worldSmashFaceModes[i] === "passthrough",
    ),
    0.25,
  );
  const whole = rootMesh();
  const wr = new WorldDestruction(
    whole.root,
    [textureSpec("texturechange", 2)],
    { textures: textures(), random: () => 0 },
  );
  const wh = wr.handleContact(contact(whole.mesh, 3, { point: undefined }));
  assert.equal(wh.changed, true);
  assert.equal(
    area(
      whole.mesh,
      (i) =>
        whole.mesh.geometry.userData.worldSmashFaceModes[i] === "passthrough",
    ),
    4,
  );
});

test("two tiles of a single quad retain independent levels", () => {
  const { root, mesh } = rootMesh();
  const runtime = new WorldDestruction(root, [textureSpec()], {
    textures: textures(),
    random: () => 0,
  });
  runtime.handleContact(contact(mesh, 3));
  const remaining = mesh.geometry.userData.worldSmashFaceModes.findIndex(
    (m) => m === "solid",
  );
  const second = runtime.handleContact(
    contact(mesh, 1, {
      faceIndex: remaining,
      point: new Vector3(1.5, 0.25, 0),
    }),
  );
  assert.equal(second.changed, true);
  assert.equal(second.changes[0].level, 1);
  assert.equal(area(mesh), 4);
  assert.equal(
    area(
      mesh,
      (i) => mesh.geometry.userData.worldSmashFaceModes[i] === "passthrough",
    ),
    1,
  );
});

test("decal adds a private overlay while preserving base geometry and collision", () => {
  const { root, mesh, mat } = rootMesh();
  const geometry = mesh.geometry;
  const runtime = new WorldDestruction(root, [textureSpec("decal")], {
    textures: textures(),
    random: () => 0,
  });
  const hit = runtime.handleContact(contact(mesh, 3));
  assert.equal(hit.changed, true);
  assert.equal(hit.threshold, undefined);
  assert.equal(mesh.geometry, geometry);
  assert.equal(mesh.material, mat);
  assert.equal(hit.changes[0].requiresRebuild, false);
  const overlay = hit.changes[0].decal;
  assert.equal(overlay.parent, mesh);
  assert.equal(overlay.userData.skipWorldCollision, true);
  assert.equal(area(overlay), 1);
});

test("native impulse gates, item flags and missing assets never invent damage", () => {
  const { root, mesh } = rootMesh();
  const s = textureSpec();
  const runtime = new WorldDestruction(root, [s], { textures: textures() });
  assert.equal(runtime.handleContact(contact(mesh, 0.02)).changed, false);
  assert.equal(runtime.handleContact(contact(mesh, 0.099)).changed, false);
  s.flags = 2;
  assert.equal(runtime.handleContact(contact(mesh, 4)).changed, false);
  s.flags = 1;
  assert.equal(
    runtime.handleContact(contact(mesh, 4, { kind: "wheel" })).changed,
    false,
  );
  assert.throws(() => runtime.handleContact(contact(mesh, NaN)), /impulse/);
  const missing = new WorldDestruction(root, [textureSpec()]);
  const geo = mesh.geometry;
  assert.equal(missing.handleContact(contact(mesh, 4)).changed, false);
  assert.match(missing.diagnostics[0], /Missing smash pixelmap/);
  assert.equal(mesh.geometry, geo);
  const isolated = new Mesh(new BufferGeometry(), material());
  root.add(isolated);
  assert.equal(runtime.handleContact(contact(isolated, 4)).changed, false);
});

test("nochange connotations deduplicate a source tick and synchronously enqueue noncar activations", () => {
  const { root, mesh } = rootMesh();
  const s = spec("nochange");
  const activation = {
    delaySeconds: [0.1, 0.1],
    coordinates: "relative",
    nonCarType: 7,
    min: [-1, 0, -1],
    max: [1, 2, 1],
    speed: {
      towards: [0, 0],
      impacteeVelocityFactor: 0,
      randomVelocityMax: 0,
      randomUpVelocityMax: 0,
      randomNormalVelocityMax: 0,
      randomSpinRateMax: 0,
    },
  };
  s.connotations.activations.push(activation);
  const fired = [],
    metadata = [];
  const runtime = new WorldDestruction(root, [s], {
    random: () => 0,
    onActivation: (data, event) => fired.push([data, event]),
    onConnotations: (data) => metadata.push(data),
  });
  assert.equal(runtime.handleContact(contact(mesh, 2)).changed, true);
  assert.equal(runtime.handleContact(contact(mesh, 2)).changed, false);
  assert.equal(fired.length, 1);
  runtime.update(199);
  assert.equal(fired.length, 1);
  runtime.update(200);
  assert.equal(fired.length, 1);
  assert.equal(fired[0][0], activation);
  assert.equal(fired[0][1].timeMs, 100);
  assert.equal(metadata[0], s.connotations);
  assert.equal(
    runtime.handleContact(contact(mesh, 2, { timeMs: 200 })).changed,
    true,
  );
  runtime.update(300);
  assert.equal(fired.length, 2);
  runtime.update(299); // Native prediction correction can regress the clock.
  assert.equal(
    fired.length,
    2,
    "clock correction does not replay connotations",
  );
  assert.throws(() => runtime.update(-1), /time/);
});

test("last duplicate trigger binding wins and crossed-level effect flags follow native queue", () => {
  const { root, mesh } = rootMesh();
  const first = textureSpec(),
    last = textureSpec();
  first.levels[0].pixelmaps = ["MISSING"];
  last.levels[0].flags = 1;
  const emitted = [];
  const runtime = new WorldDestruction(root, [first, last], {
    textures: textures(),
    random: () => 0,
    onConnotations: (c) => emitted.push(c),
  });
  const hit = runtime.handleContact(contact(mesh, 3));
  assert.equal(hit.changes.length, 1);
  assert.equal(hit.changes[0].spec, last);
  assert.deepEqual(hit.diagnostics, []);
  assert.equal(hit.changes[0].connotationRepeats, 1);
  assert.deepEqual(emitted, [last.levels[1].connotations]);
  const next = rootMesh();
  const two = textureSpec();
  const both = [];
  const nr = new WorldDestruction(next.root, [two], {
    textures: textures(),
    random: () => 0,
    onConnotations: (c) => both.push(c),
  });
  assert.equal(
    nr.handleContact(contact(next.mesh, 3)).changes[0].connotationRepeats,
    2,
  );
  assert.deepEqual(both, [
    two.levels[1].connotations,
    two.levels[1].connotations,
  ]);
});

let originals = true;
try {
  await access(new URL("../carma2_orig/data.twt", import.meta.url));
} catch {
  originals = false;
}
test(
  "stock airport, desert and carrier replacement definitions retain ACT actors and use supplied DAT models read-only",
  { skip: !originals },
  async () => {
    const assets = await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
    const normalize = (name) =>
      name.replace(/\.(act|dat|mat|pix)$/i, "").toLowerCase();
    let checked = 0;
    for (const track of ["Airport1", "desert1", "Carrier1"]) {
      const entries = assets.manifest.filter((e) =>
        e.path.toLowerCase().startsWith(`data/races/${track.toLowerCase()}/`),
      );
      const config = entries.find((e) => /\.txt$/i.test(e.path));
      const act = entries.find(
        (e) =>
          normalize(e.path.split("/").pop()) === track.toLowerCase() &&
          /\.act$/i.test(e.path),
      );
      const specs = parseTrackSmashables(
        decodeText(await assets.read(config.path)),
        config.path,
      );
      const models = new Map();
      for (const e of entries.filter((e) => /\/[^/]+\.dat$/i.test(e.path)))
        for (const model of parseDat(await assets.read(e.path)))
          models.set(normalize(model.name), model);
      const nodes = parseAct(await assets.read(act.path));
      const flat = [];
      const visit = (list) => {
        for (const node of list) {
          flat.push(node);
          visit(node.children);
        }
      };
      visit(nodes);
      for (const s of specs.filter((s) => s.mode === "replacemodel")) {
        const node = flat.find(
          (n) => normalize(n.model ?? "") === normalize(s.trigger.name),
        );
        assert.ok(node, `${track}: ${s.trigger.name}`);
        const before = models.get(normalize(node.model)),
          after = models.get(normalize(s.replacement.model));
        assert.ok(before);
        assert.ok(after);
        const fixture = rootMesh(
          node.name,
          createModelGeometry(before),
          material(),
        );
        fixture.mesh.name = node.model;
        const runtime = new WorldDestruction(fixture.root, [s], { models });
        assert.deepEqual(runtime.retainActors, [fixture.actor]);
        const result = runtime.handleContact(
          contact(fixture.mesh, Math.max(0.021, s.removalThreshold), {
            material: undefined,
          }),
        );
        assert.equal(result.changed, true, `${track}: ${s.trigger.name}`);
        assert.equal(
          fixture.mesh.geometry.getAttribute("position").count,
          after.faces.length * 3,
        );
        assert.equal(fixture.mesh.name, s.replacement.model);
        assert.equal(result.changes[0].requiresRebuild, true);
        runtime.dispose();
        checked++;
      }
    }
    assert.ok(checked >= 4);
  },
);

test(
  "supplied airport hanger tile changes collision with its source UV transform",
  { skip: !originals },
  async () => {
    const assets = await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
    const specs = parseTrackSmashables(
      decodeText(await assets.read("data/RACES/Airport1/airport1.txt")),
    );
    const authored = specs
      .filter(
        (s) =>
          s.trigger.kind === "material" &&
          s.trigger.name.toLowerCase() === "hangerdoor",
      )
      .at(-1);
    const model = parseDat(
      await assets.read("data/RACES/Airport1/Airport1.dat"),
    ).find((m) =>
      m.faces.some(
        (f) => m.materials[f.material - 1]?.toLowerCase() === "hangerdoor",
      ),
    );
    const matData = assets.manifest.filter((e) =>
      /^data\/RACES\/Airport1\/[^/]+\.mat$/i.test(e.path),
    );
    let descriptor;
    for (const entry of matData)
      for (const m of parseMat(await assets.read(entry.path)))
        if (m.name.toLowerCase() === "hangerdoor") descriptor = m;
    assert.ok(descriptor);
    assert.ok(model);
    assert.ok(authored);
    const geometry = createModelGeometry(model),
      slots = [...new Set(model.faces.map((f) => f.material))];
    const used = slots.map((slot) =>
      material(model.materials[slot - 1] ?? "DEFAULT"),
    );
    const hanger = used.find((m) => m.name.toLowerCase() === "hangerdoor");
    const t = descriptor.uvTransform;
    hanger.map.matrixAutoUpdate = false;
    hanger.map.matrix.set(t[0], t[2], t[4], t[1], t[3], t[5], 0, 0, 1);
    const fixture = rootMesh("source mesh", geometry, used);
    let faceIndex = -1;
    for (let i = 0; i < geometry.index.count; i += 3) {
      const sourceFace = Math.floor(geometry.index.getX(i) / 3);
      if (
        model.materials[model.faces[sourceFace].material - 1]?.toLowerCase() ===
        "hangerdoor"
      ) {
        faceIndex = i / 3;
        break;
      }
    }
    assert.ok(faceIndex >= 0);
    const p = geometry.getAttribute("position"),
      point = new Vector3();
    for (const [c, w] of [
      [0, 0.2],
      [1, 0.3],
      [2, 0.5],
    ])
      point.addScaledVector(
        new Vector3().fromBufferAttribute(
          p,
          geometry.index.getX(faceIndex * 3 + c),
        ),
        w,
      );
    const maps = new Map(
      authored.levels.flatMap((l) =>
        l.pixelmaps.map((name) => [name, new Texture()]),
      ),
    );
    const runtime = new WorldDestruction(fixture.root, specs, {
      textures: maps,
      random: () => 0,
    });
    const before = area(fixture.mesh);
    const result = runtime.handleContact(
      contact(fixture.mesh, authored.levels[0].threshold, {
        faceIndex,
        material: "hangerdoor",
        point,
      }),
    );
    assert.equal(result.changed, true, result.diagnostics.join("; "));
    assert.equal(result.changes[0].spec, authored);
    assert.equal(result.changes[0].collisionMode, "passthrough");
    assert.ok(
      area(
        fixture.mesh,
        (i) =>
          fixture.mesh.geometry.userData.worldSmashFaceModes[i] ===
          "passthrough",
      ) > 0,
    );
    assert.ok(Math.abs(area(fixture.mesh) - before) < 0.001);
    runtime.dispose();
  },
);
