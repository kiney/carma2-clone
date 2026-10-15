import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Group,
  Mesh,
  MeshLambertMaterial,
  Vector3,
} from "three";
import {
  parseWam,
  DamageSystem,
  modelRepairCoordinate,
} from "../src/damage.ts";
import { parseTwt } from "../server/assets.mjs";
import { parseAct, parseDat } from "../src/formats.ts";
import { createModelGeometry } from "../src/render-geometry.ts";
import {
  bendPoint,
  compressedBendReference,
} from "../src/physics/structural.ts";
import {
  createDetachmentSchedulingContext,
  detachmentQueueSize,
} from "../src/physics/attachment.ts";

const connotations = ["0", "0", "0", "none", "0", "0", "0", "0", "none", "0"];
function smash() {
  return [
    "GLASS.MAT",
    "INTACT.PIX",
    "2",
    "0.0005",
    "1",
    ...connotations,
    "1",
    "CRACKED.PIX",
    "0.002",
    "0",
    ...connotations,
    "1",
    "BROKEN.PIX",
  ];
}
function wam(parts = ["BODY.DAT", "normal", "boring", "0"]) {
  return [
    "VERSION 4",
    "1",
    "0.1",
    "1",
    "-0.1",
    "0",
    "0",
    "1",
    "0.25",
    "1",
    "-0.25",
    "1",
    "-0.05",
    "0.15",
    "1",
    "0",
    "0,0.16,0.05",
    "1",
    ...parts,
  ].join("\n");
}
function mesh(name = "BODY.DAT", geometry) {
  if (!geometry) {
    geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([
          -0.2, 0.1, -0.4, 0.2, 0.1, -0.4, -0.2, 0.2, -0.4, 0.2, 0.2, -0.4,
        ]),
        3,
      ),
    );
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    geometry.computeVertexNormals();
  }
  const material = new MeshLambertMaterial();
  material.name = "GLASS.MAT";
  const object = new Mesh(geometry, material);
  object.name = name;
  return object;
}
function fakeAssets(text, textures = new Map()) {
  const path = "data/CARS/TEST/TEST.WAM";
  return {
    manifest: [{ path }],
    textures,
    warnings: [],
    resolve: (name) =>
      name.toLowerCase() === path.toLowerCase() ? path : undefined,
    text: async () => text,
  };
}
function systemGroup(object) {
  const group = new Group();
  group.name = "TEST";
  group.add(object);
  return group;
}
function repairedPositions(system, object, pristine) {
  return system.runtimeParts.some(
    ({ actor }) => actor === object || actor === object.parent,
  )
    ? pristine.map(modelRepairCoordinate)
    : pristine;
}
test("model repair uses the original bounded U16 targets while authored snapshots stay precise", () => {
  assert.deepEqual(
    [-11, -10, -0.4, 0, 0.1, 10, 11].map(modelRepairCoordinate),
    [
      -10, -10, -0.3999389708042145, 0.000152587890625, 0.09994658827781677, 10,
      10,
    ],
  );
});

test("first held repair reaches compressed visual targets without changing pristine metadata or collision samples", async () => {
  const object = mesh();
  const pristine = Array.from(object.geometry.attributes.position.array);
  const system = new DamageSystem(
    fakeAssets(wam()),
    systemGroup(object),
    "TEST.TXT\nTEST.WAM",
  );
  await system.init();
  const points = physics(system)[0];
  const shapeOriginal = points.map((point) => point.toArray());
  const vertexOriginal = system.runtimeParts[0].originalVertices.map((point) =>
    point.toArray(),
  );
  system.componentLevels[3] = 12;
  const result = system.repairStep(40, 20);
  assert.ok(
    result.bodyworkRepair > 0,
    "clean DAT coordinates differ slightly from compressed repair targets",
  );
  assert.deepEqual(
    Array.from(object.geometry.attributes.position.array),
    pristine.map(modelRepairCoordinate),
  );
  assert.deepEqual(
    points.map((point) => point.toArray()),
    shapeOriginal,
  );
  assert.deepEqual(
    system.runtimeParts[0].originalVertices.map((point) => point.toArray()),
    vertexOriginal,
  );
  assert.equal(result.cost, 240);
  assert.equal(system.repairStep(40, 20).bodyworkRepair, 0);
});

test("WAM parser reads crush regions, softness, flap hinges, poly samples and smash thresholds", () => {
  const parsed = parseWam(
    wam([
      "DOOR.DAT",
      "hard",
      "flap",
      "0",
      "1",
      "2",
      "1",
      "easy",
      "poly",
      "2",
      "0",
      "3",
      "1",
      ...smash(),
    ]),
  );
  assert.deepEqual(parsed.limits[0], { min: [0.1], max: [-0.1] });
  assert.equal(parsed.bendability, 1);
  assert.deepEqual(parsed.driver.toArray(), [0, 0.16, 0.05]);
  const part = parsed.parts[0];
  assert.equal(part.softnessFactor, 0.5);
  assert.deepEqual(part.hinges, [0, 1, 2]);
  assert.deepEqual(part.shapePoints, [0, 3]);
  assert.equal(part.kevOFlap, 1);
  assert.deepEqual(
    part.smashes[0].levels.map((level) => level.threshold),
    [0.0005, 0.002],
  );
  assert.deepEqual(part.smashes[0].levels[1].pixelmaps, ["BROKEN.PIX"]);
  assert.equal(
    parseWam(wam().replace("VERSION 4", "VERSION 104")).version,
    104,
  );
  assert.throws(() => parseWam("VERSION 3"), /version/);
  assert.throws(
    () => parseWam(wam().split("\n").slice(0, 15).join("\n")),
    /Truncated/,
  );
  assert.throws(
    () => parseWam(wam().replace("\n1\n0.1", "\n-1\n0.1")),
    /count/,
  );
});

function physics(system, version = 4) {
  const shapes = [[new Vector3(-0.4, -0.4, -0.6), new Vector3(0.4, 0.4, 0.6)]];
  system.configurePhysics(
    { root: { mass: 1 }, wheels: [], shapes: [] },
    shapes,
  );
  return shapes;
}
function apply(
  system,
  point,
  force,
  now = 10000,
  direction = new Vector3(0, 0, 1),
) {
  const vector = direction.clone().normalize().multiplyScalar(force);
  return system.applyImpact(
    [point],
    vector.clone().multiplyScalar(2),
    false,
    true,
    now,
    vector,
  );
}

test("source invulnerability rejects ordinary crush admission and preserves model, hull and attachments", async () => {
  const object = mesh();
  const system = new DamageSystem(
    fakeAssets(wam()),
    systemGroup(object),
    "TEST.TXT\nTEST.WAM",
  );
  await system.init();
  const shapes = physics(system);
  const positions = Array.from(object.geometry.attributes.position.array);
  const points = shapes.map((shape) => shape.map((point) => point.toArray()));
  system.damageContext.invulnerable = true;
  const result = apply(system, new Vector3(-0.2, 0.1, -0.4), 10);
  assert.equal(result.queuedForce, 0);
  assert.deepEqual(result.componentEvents, []);
  assert.deepEqual(
    Array.from(object.geometry.attributes.position.array),
    positions,
  );
  assert.deepEqual(
    shapes.map((shape) => shape.map((point) => point.toArray())),
    points,
  );
  assert.ok(system.runtimeParts.every((part) => part.state.phase === 0));
  assert.equal(system.structuralBend, undefined);
  system.damageContext.invulnerable = false;
  apply(system, new Vector3(-0.2, 0.1, -0.4), 0.08);
  assert.notDeepEqual(
    Array.from(object.geometry.attributes.position.array),
    positions,
  );
});

test("original queued-force threshold, fixed radius and region plane govern dents and repair", async () => {
  const object = mesh();
  const pristine = Array.from(object.geometry.attributes.position.array);
  const system = new DamageSystem(
    fakeAssets(wam()),
    systemGroup(object),
    "TEST.TXT\nTEST.WAM",
  );
  await system.init();
  physics(system);
  const point = new Vector3(-0.2, 0.1, -0.4);
  apply(system, point, 0.06);
  assert.deepEqual(
    Array.from(object.geometry.attributes.position.array),
    pristine,
  );
  apply(system, point, 0.08);
  assert.ok(
    Math.abs(
      object.geometry.attributes.position.getZ(0) - (-0.4 + 0.08 * 1.5),
    ) < 1e-6,
  );
  assert.equal(
    object.geometry.attributes.position.getZ(1),
    pristine[5],
    "a distant vertex receives no dent",
  );
  apply(system, new Vector3(-0.2, 0.1, -0.28), 0.5);
  assert.ok(
    Math.abs(object.geometry.attributes.position.getZ(0) + 0.25) < 1e-6,
  );
  system.repair();
  assert.deepEqual(
    Array.from(object.geometry.attributes.position.array),
    pristine.map(modelRepairCoordinate),
  );
  assert.equal(system.repairRevision, 1);
});

test("WAM softness changes displacement and flap hinge vertices are not unconditionally frozen", async () => {
  const objects = [mesh(), mesh(), mesh(), mesh("DOOR.DAT")];
  const texts = [
    wam(),
    wam(["BODY.DAT", "very_hard", "boring", "0"]),
    wam(["BODY.DAT", "uncrushable", "boring", "0"]),
    wam([
      "DOOR.DAT",
      "normal",
      "flap",
      "0",
      "1",
      "2",
      "0",
      "normal",
      "box",
      "0",
    ]),
  ];
  for (let i = 0; i < objects.length; i++) {
    const system = new DamageSystem(
      fakeAssets(texts[i]),
      systemGroup(objects[i]),
      "TEST.TXT\nTEST.WAM",
    );
    await system.init();
    physics(system);
    apply(system, new Vector3(-0.2, 0.1, -0.4), 0.07);
  }
  assert.ok(
    Math.abs(objects[0].geometry.attributes.position.getZ(0) + 0.295) < 1e-6,
  );
  assert.ok(
    Math.abs(objects[1].geometry.attributes.position.getZ(0) + 0.37375) < 1e-6,
  );
  assert.ok(
    Math.abs(objects[2].geometry.attributes.position.getZ(0) + 0.4) < 1e-6,
  );
  assert.ok(
    objects[3].geometry.attributes.position.getZ(0) > -0.4,
    "hinge0 follows original CrushModel eligibility",
  );
});

test("exact ACT actor owns its direct DAT meshes, while child ACT actors require their own WAM entries", async () => {
  const actor = new Group();
  actor.name = "BODY.ACT";
  actor.position.x = 2;
  const model = mesh("DIFFERENT_MODEL.DAT");
  actor.add(model);
  const childActor = new Group();
  childActor.name = "UNLISTED.ACT";
  const unlistedModel = mesh("UNLISTED.DAT");
  childActor.add(unlistedModel);
  actor.add(childActor);
  const group = systemGroup(actor);
  group.rotation.y = 0.7;
  group.position.set(10, 4, 20);
  const system = new DamageSystem(
    fakeAssets(wam(["BODY.ACT", "normal", "boring", "0"])),
    group,
    "TEST.TXT\nTEST.WAM",
  );
  await system.init();
  physics(system);
  apply(system, new Vector3(1.8, 0.1, -0.4), 0.08);
  assert.ok(model.geometry.attributes.position.getZ(0) > -0.4);
  assert.ok(
    Math.abs(unlistedModel.geometry.attributes.position.getZ(0) + 0.4) < 1e-6,
  );
  assert.equal(system.runtimeParts[0].actor, actor);
  assert.ok(system.runtimeParts.every((part) => part.actor !== childActor));
});

test("damage isolates reused DAT geometry and materials", async () => {
  const source = mesh();
  const sibling = new Mesh(source.geometry, source.material);
  const originalGeometry = source.geometry,
    originalMaterial = source.material;
  const system = new DamageSystem(
    fakeAssets(wam()),
    systemGroup(source),
    "TEST.TXT\nTEST.WAM",
  );
  await system.init();
  physics(system);
  assert.notEqual(source.geometry, originalGeometry);
  assert.notEqual(source.material, originalMaterial);
  const pristine = Array.from(sibling.geometry.attributes.position.array);
  apply(system, new Vector3(-0.2, 0.1, -0.4), 0.08);
  assert.notDeepEqual(
    Array.from(source.geometry.attributes.position.array),
    pristine,
  );
  assert.deepEqual(
    Array.from(sibling.geometry.attributes.position.array),
    pristine,
  );
});

test("material thresholds use each impact magnitude, remain monotonic, and repair restores textures", async () => {
  const textures = new Map();
  for (const name of ["intact", "cracked", "broken"]) {
    const texture = new DataTexture();
    texture.name = name;
    textures.set(name, texture);
  }
  const object = mesh();
  object.material.map = textures.get("intact");
  const text = wam(["BODY.DAT", "normal", "boring", "1", ...smash()])
    .replace("\n0.0005\n", "\n0.01\n")
    .replace("\n0.002\n", "\n0.02\n");
  const system = new DamageSystem(
    fakeAssets(text, textures),
    systemGroup(object),
    "TEST.TXT\nTEST.WAM",
  );
  await system.init();
  physics(system);
  const point = new Vector3(-0.2, 0.1, -0.4);
  for (let i = 0; i < 10; i++) apply(system, point, 0.2);
  assert.equal(
    object.material.map.name,
    "cracked",
    "small repeated events do not accumulate texture energy",
  );
  assert.notEqual(object.material.map, textures.get("cracked"));
  apply(system, point, 0.5);
  assert.equal(object.material.map.name, "broken");
  system.repair();
  assert.equal(object.material.map, textures.get("intact"));
});

test("unlinked geometry is unchanged, with idempotent initialization", async () => {
  const object = mesh("UNKNOWN");
  const pristine = Array.from(object.geometry.attributes.position.array);
  const system = new DamageSystem(
    fakeAssets("invalid"),
    systemGroup(object),
    "TEST.TXT",
  );
  await system.init();
  const geometry = object.geometry;
  await system.init();
  assert.equal(object.geometry, geometry);
  apply(system, new Vector3(-0.2, 0.1, -0.4), 1);
  assert.deepEqual(
    Array.from(object.geometry.attributes.position.array),
    pristine,
  );
});

test("detachment accumulates pre-eligibility influence and repair restores parent, transform and component history", async () => {
  const object = mesh();
  object.position.set(0.02, 0, 0);
  const group = systemGroup(object);
  const system = new DamageSystem(
    fakeAssets(
      wam([
        "BODY.DAT",
        "uncrushable",
        "detach",
        "normal",
        "fully_detach",
        "box",
        "0",
      ]),
    ),
    group,
    "TEST.TXT\nTEST.WAM",
  );
  await system.init();
  physics(system);
  const pristine = Array.from(object.geometry.attributes.position.array);
  apply(system, new Vector3(-0.18, 0.1, -0.4), 0.5);
  assert.deepEqual(
    Array.from(object.geometry.attributes.position.array),
    pristine,
  );
  assert.equal(system.detachQueue.length, 1);
  const runtime = system.runtimeParts[0];
  assert.equal(runtime.state.queuedAt, 10000);
  const scene = new Group();
  scene.add(object);
  object.position.set(8, 9, 10);
  runtime.state.phase = 2;
  runtime.state.queuedAt = null;
  system.componentLevels[0] = 99;
  assert.equal(system.wasted, true);
  system.repair();
  assert.equal(object.parent, group);
  assert.deepEqual(object.position.toArray(), [0.02, 0, 0]);
  assert.equal(runtime.state.phase, 0);
  assert.equal(runtime.state.accumulatedForce, 0);
  assert.equal(system.wasted, false);
  assert.equal(system.detachQueue.length, 0);
});

test("two damage systems share source detach spacing and repair releases only its own global reservation", async () => {
  const context = createDetachmentSchedulingContext();
  const make = async (shared) => {
    const object = mesh();
    const system = new DamageSystem(
      fakeAssets(
        wam([
          "BODY.DAT",
          "uncrushable",
          "detach",
          "normal",
          "fully_detach",
          "box",
          "0",
        ]),
      ),
      systemGroup(object),
      "TEST.TXT\nTEST.WAM",
    );
    await system.init();
    physics(system);
    if (shared) system.configureDetachmentScheduling(context);
    return system;
  };
  const first = await make(true),
    second = await make(true),
    standalone = await make(false);
  const point = new Vector3(-0.2, 0.1, -0.4);
  for (const system of [first, second, standalone]) apply(system, point, 0.5);
  assert.equal(first.detachQueue[0].state.queuedAt, 10000);
  assert.equal(second.detachQueue[0].state.queuedAt, 11000);
  assert.equal(standalone.detachQueue[0].state.queuedAt, 10000);
  first.repair();
  assert.equal(detachmentQueueSize(context), 1);
  assert.equal(second.detachQueue[0].state.queuedAt, 11000);
  apply(first, point, 0.5);
  assert.equal(first.detachQueue[0].state.queuedAt, 12000);
  const remainingForce = second.runtimeParts[0].state.accumulatedForce;
  first.repairStep(40, 20);
  assert.equal(
    detachmentQueueSize(context),
    0,
    "source clean held repair clears the global queue",
  );
  assert.equal(second.detachQueue.length, 0);
  assert.equal(second.runtimeParts[0].state.accumulatedForce, remainingForce);
  assert.equal(context.lastScheduled, 12000);
  apply(second, point, 0.07);
  assert.equal(second.detachQueue[0].state.queuedAt, 13000);
});

test("WAM104 leaves collision shape samples intact while WAM4 uses source Y/Z root deformation", async () => {
  for (const version of [4, 104]) {
    const object = mesh();
    const system = new DamageSystem(
      fakeAssets(wam().replace("VERSION 4", `VERSION ${version}`)),
      systemGroup(object),
      "TEST.TXT\nTEST.WAM",
    );
    await system.init();
    const shapes = [
      [
        new Vector3(-0.2, 0.1, -0.4),
        new Vector3(0.4, 0.4, 0.6),
        new Vector3(-0.4, -0.4, -0.6),
      ],
    ];
    system.configurePhysics(
      { root: { mass: 1 }, wheels: [], shapes: [] },
      shapes,
    );
    const original = shapes[0].map((point) => point.clone());
    apply(system, original[0], 0.08);
    if (version === 4) assert.ok(shapes[0][0].z > original[0].z);
    else assert.ok(shapes[0][0].equals(original[0]));
    system.repair();
    assert.ok(shapes[0].every((point, i) => point.equals(original[i])));
  }
});

test("held repair restores fixed coordinate distance and bills proportional component recovery", async () => {
  const object = mesh();
  const system = new DamageSystem(
    fakeAssets(wam()),
    systemGroup(object),
    "TEST.TXT\nTEST.WAM",
  );
  await system.init();
  physics(system);
  system.repair();
  apply(
    system,
    new Vector3().fromBufferAttribute(object.geometry.attributes.position, 0),
    0.08,
  );
  system.componentLevels[0] = 60;
  const first = system.repairStep(40, 20);
  assert.ok(Math.abs(first.bodyworkRepair - 0.002) < 1e-6);
  assert.ok(Math.abs(first.totalDeflection - 0.12) < 1e-6);
  assert.equal(first.componentDifference, 1);
  assert.equal(first.cost, 20);
  assert.equal(system.componentLevels[0], 59);
  assert.ok(
    Math.abs(
      object.geometry.attributes.position.getZ(0) -
        (modelRepairCoordinate(Math.fround(-0.4)) + 0.118),
    ) < 1e-6,
  );
  const final = system.repairStep(10000, 20);
  assert.equal(system.componentLevels[0], 0);
  assert.equal(final.cost, 1180);
  assert.equal(
    object.geometry.attributes.position.getZ(0),
    modelRepairCoordinate(Math.fround(-0.4)),
  );
});

test("source structural branch bends hull, COM and wheels, applies component damage and repairs pristine state", async () => {
  const object = mesh();
  const group = systemGroup(object);
  const system = new DamageSystem(
    fakeAssets(wam()),
    group,
    "TEST.TXT\nTEST.WAM",
  );
  system.damageContext.random = () => 0;
  await system.init();
  const points = [];
  for (const x of [-0.4, 0.4])
    for (const y of [-0.4, 0.4])
      for (const z of [-0.6, 0.6]) points.push(new Vector3(x, y, z));
  const pristine = points.map((point) => point.toArray());
  const originalMesh = Array.from(object.geometry.attributes.position.array);
  const center = new Vector3(0, 0.1, -0.1);
  const wheelPosition = new Vector3(-0.2, 0, -0.4);
  system.configurePhysics(
    {
      root: { mass: 1, centerOfMass: center.toArray() },
      wheels: [{ actor: "LF", position: wheelPosition.toArray() }],
      shapes: [],
    },
    [points],
  );
  apply(system, new Vector3(0, 0.1, -0.6), 3);
  assert.ok(system.structuralBend);
  assert.equal(system.structuralRevision, 1);
  assert.ok(
    points.length > 8,
    "bend-plane edge crossings remain in the hull samples",
  );
  assert.ok(system.currentCenterOfMass.distanceTo(center) > 0);
  assert.ok(system.currentWheelPositions[0].distanceTo(wheelPosition) > 0);
  assert.ok(system.componentLevels[0] >= 80);
  assert.equal(
    system.componentLevels[2],
    0,
    "human driver remains immune to structural damage",
  );
  assert.ok(
    Array.from(object.geometry.attributes.position.array).some(
      (value, index) => value !== originalMesh[index],
    ),
  );
  const bendAngle = system.structuralBend.angleXUnits;
  const oldLevel = system.componentLevels[0];
  const result = system.repairStep(40, 10);
  assert.equal(result.bodyworkRepair, 320 / 65536);
  assert.equal(system.structuralBend.angleXUnits, (bendAngle + 320) & 0xffff);
  const magnitude = (65536 - bendAngle) & 0xffff;
  assert.equal(result.totalDeflection, (2 * magnitude) / 65536);
  assert.equal(
    system.componentLevels[0],
    oldLevel - Math.floor((oldLevel * 320) / (2 * magnitude)),
  );
  system.repair();
  assert.equal(system.structuralBend, undefined);
  assert.deepEqual(
    points.map((point) => point.toArray()),
    pristine,
  );
  assert.deepEqual(system.currentCenterOfMass, center);
  assert.deepEqual(system.currentWheelPositions[0], wheelPosition);
  assert.deepEqual(
    Array.from(object.geometry.attributes.position.array),
    originalMesh.map(modelRepairCoordinate),
  );
});

test("structural transition repair uses compressed pre-bend coordinates and preserves later dents", async () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(
      Float32Array.of(-0.1, 0.1, -0.4, 0.123456, 0.1, 0, -0.1, 0.1, 0.6),
      3,
    ),
  );
  geometry.setIndex([0, 1, 2]);
  const object = mesh("BODY.DAT", geometry);
  const system = new DamageSystem(
    fakeAssets(wam()),
    systemGroup(object),
    "TEST.TXT\nTEST.WAM",
  );
  system.damageContext.random = () => 0;
  await system.init();
  const original = new Vector3().fromBufferAttribute(
    object.geometry.attributes.position,
    1,
  );
  const shape = [];
  for (const x of [-0.4, 0.4])
    for (const y of [-0.4, 0.4])
      for (const z of [-0.6, 0.6]) shape.push(new Vector3(x, y, z));
  system.configurePhysics(
    { root: { mass: 1, centerOfMass: [0, 0.1, -0.1] }, wheels: [], shapes: [] },
    [shape],
  );
  apply(system, new Vector3(0, 0.1, -0.6), 3);
  const previous = system.structuralBend;
  assert.ok(previous);
  const positions = object.geometry.attributes.position;
  positions.setX(1, positions.getX(1) + 0.007);
  const dented = new Vector3().fromBufferAttribute(positions, 1);
  const fixed = new Vector3().fromBufferAttribute(positions, 2);
  system.repairStep(40, 10);
  const next = system.structuralBend;
  assert.ok(next);
  const packed = compressedBendReference(original);
  const expected = dented
    .clone()
    .add(bendPoint(packed, next).sub(bendPoint(packed, previous)));
  expected.fromArray(expected.toArray().map(Math.fround));
  assert.ok(
    new Vector3().fromBufferAttribute(positions, 1).distanceTo(expected) < 1e-8,
  );
  const uncompressed = dented
    .clone()
    .add(bendPoint(original, next).sub(bendPoint(original, previous)));
  assert.ok(
    expected.distanceTo(uncompressed) > 1e-8,
    "binary compressed reference affects the repaired field",
  );
  assert.deepEqual(new Vector3().fromBufferAttribute(positions, 2), fixed);
});

test("high-force failed bending chance follows source and does not fall back to ordinary dent", async () => {
  const object = mesh();
  const pristine = Array.from(object.geometry.attributes.position.array);
  const system = new DamageSystem(
    fakeAssets(wam()),
    systemGroup(object),
    "TEST.TXT\nTEST.WAM",
  );
  system.damageContext.random = () => 0.99;
  await system.init();
  physics(system);
  apply(system, new Vector3(-0.2, 0.1, -0.4), 3);
  assert.equal(system.structuralBend, undefined);
  assert.deepEqual(
    Array.from(object.geometry.attributes.position.array),
    pristine,
  );
});

test("ordinary attached flap buckles and opens before tearing, then repair restores its hinge state", async () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(
      Float32Array.of(0, 0, 0, 0.2, 0, 0, 0.1, 0, 0.2, 0.1, 0, 0.05),
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const object = mesh("HOOD.DAT", geometry);
  const system = new DamageSystem(
    fakeAssets(
      wam([
        "HOOD.DAT",
        "normal",
        "flap",
        "0",
        "1",
        "2",
        "0",
        "normal",
        "box",
        "0",
      ]),
    ),
    systemGroup(object),
    "TEST.TXT\nTEST.WAM",
  );
  system.damageContext.random = () => 0.5;
  await system.init();
  const runtime = system.runtimeParts[0];
  const pristine = Array.from(object.geometry.attributes.position.array);
  apply(system, new Vector3(0.1, 0, 0.2), 0.08, 10000, new Vector3(0, 0, -1));
  assert.equal(runtime.flap.active, true);
  assert.equal(runtime.flap.buckled, true);
  assert.equal(
    runtime.state.queuedAt,
    null,
    "below the normal .1 tear threshold",
  );
  assert.ok(object.geometry.attributes.position.getY(3) < 0);
  assert.equal(object.material.side, 2);
  assert.ok(system.stepFlaps(new Vector3(0, 1.44, 0)) > 0);
  assert.ok(object.quaternion.angleTo(new Group().quaternion) > 0);
  system.repair();
  assert.equal(runtime.flap.active, false);
  assert.equal(runtime.flap.angleUnits, 0);
  assert.equal(object.material.side, 0);
  assert.deepEqual(
    Array.from(object.geometry.attributes.position.array),
    pristine.map(modelRepairCoordinate),
  );
});

test("corner-split rendering preserves authored part indices and counts repair once per source coordinate", async () => {
  const geometry = createModelGeometry({
    positions: Float32Array.of(
      -0.2,
      0.1,
      -0.4,
      -0.15,
      0.1,
      -0.4,
      -0.15,
      0.15,
      -0.4,
      -0.2,
      0.15,
      -0.4,
    ),
    uvs: new Float32Array(8),
    faces: [
      { indices: [0, 1, 2], material: 0, flags: 0, smoothing: 1 },
      { indices: [0, 2, 3], material: 0, flags: 0, smoothing: 2 },
    ],
  });
  const object = mesh("BODY.DAT", geometry);
  const system = new DamageSystem(
    fakeAssets(wam()),
    systemGroup(object),
    "TEST.TXT\nTEST.WAM",
  );
  await system.init();
  assert.equal(object.geometry.attributes.position.count, 6);
  assert.equal(system.runtimeParts[0].originalVertices.length, 4);
  system.repair();
  apply(system, new Vector3(9, 9, 9), 0.08);
  const position = object.geometry.attributes.position;
  position.setZ(0, position.getZ(0) + 0.01);
  position.setZ(3, position.getZ(3) + 0.01);
  position.setZ(1, position.getZ(1) + 0.02);
  system.componentLevels[3] = 60;
  const result = system.repairStep(40, 10);
  assert.ok(Math.abs(result.totalDeflection - 0.03) < 1e-6);
  assert.ok(Math.abs(result.bodyworkRepair - 0.004) < 1e-6);
  assert.equal(position.getZ(0), position.getZ(3));
  assert.equal(system.componentLevels[3], 52);
  assert.ok(
    Array.from(object.geometry.attributes.normal.array).every(Number.isFinite),
  );
});

test("source shell mode rejects component-only repair until an ordinary crush clears it", async () => {
  const object = mesh();
  const system = new DamageSystem(
    fakeAssets(wam()),
    systemGroup(object),
    "TEST.TXT\nTEST.WAM",
  );
  await system.init();
  physics(system);
  system.damagePrograms = {
    softness: 1,
    programs: Object.fromEntries(
      ["top", "bottom", "left", "right", "front", "rear"].map((location) => [
        location,
        {
          location,
          clauses: [
            {
              conditions: [],
              effects: [
                { system: "steering", systemIndex: 3, weaknessFactor: 1 },
              ],
            },
          ],
        },
      ]),
    ),
  };
  system.damageContext.random = () => 0;
  assert.equal(system.useShellModel, false, "fresh initial source state is0");
  system.repair();
  assert.equal(system.useShellModel, true);
  const point = new Vector3(-0.2, 0.1, -0.4);
  system.applyImpact(
    [point],
    new Vector3(0, 0, 0.4),
    false,
    true,
    10000,
    new Vector3(0, 0, 0.05),
  );
  assert.ok(system.componentLevels[3] > 0);
  const before = system.componentLevels[3];
  assert.equal(
    system.useShellModel,
    true,
    "below-threshold component impact does not clear shell mode",
  );
  assert.equal(system.repairStep(40, 20).active, false);
  assert.equal(system.componentLevels[3], before);
  apply(system, point, 0.08);
  assert.equal(system.useShellModel, false);
  assert.equal(system.repairStep(40, 20).active, true);
  system.repairStep(10000, 20);
  system.repairStep(40, 20);
  assert.equal(
    system.useShellModel,
    true,
    "successful clean held repair switches back to shell mode",
  );
});

test("principal LOD no-movement cleanup skips lower LODs; a moving principal repairs every LOD", async () => {
  const actor = new Group();
  actor.name = "BODY.ACT";
  const principal = mesh("HIGH.DAT"),
    lower = mesh("LOW.DAT");
  actor.add(principal, lower);
  const system = new DamageSystem(
    fakeAssets(wam(["BODY.ACT", "normal", "boring", "0"])),
    systemGroup(actor),
    "TEST.TXT\nTEST.WAM",
  );
  await system.init();
  physics(system);
  system.repair();
  apply(system, new Vector3(9, 9, 9), 0.08);
  const p = principal.geometry.attributes.position,
    l = lower.geometry.attributes.position;
  l.setZ(0, l.getZ(0) + 0.01);
  const lowerDamaged = l.getZ(0);
  lower.material.map = new DataTexture();
  const runtime = system.runtimeParts[0];
  runtime.state.accumulatedForce = 0.05;
  const clean = system.repairStep(40, 20);
  assert.equal(clean.bodyworkRepair, 0);
  assert.equal(
    clean.totalDeflection,
    0,
    "lower LOD is excluded by source early return",
  );
  assert.equal(l.getZ(0), lowerDamaged);
  assert.equal(lower.material.map, null);
  assert.equal(runtime.state.accumulatedForce, 0);
  assert.equal(system.useShellModel, true);
  apply(system, new Vector3(9, 9, 9), 0.08);
  p.setZ(0, p.getZ(0) + 0.01);
  runtime.state.accumulatedForce = 0.05;
  const moved = system.repairStep(40, 20);
  assert.ok(Math.abs(moved.bodyworkRepair - 0.004) < 1e-7);
  assert.ok(Math.abs(moved.totalDeflection - 0.02) < 1e-7);
  assert.ok(l.getZ(0) < lowerDamaged);
  assert.equal(
    runtime.state.accumulatedForce,
    0.05,
    "history cleanup waits for the principal no-movement pass",
  );
});

test("component-only repair uses authored per-unit fee and zero-deflection detached parts reattach", async () => {
  const object = mesh();
  const group = systemGroup(object);
  const system = new DamageSystem(
    fakeAssets(
      wam([
        "BODY.DAT",
        "uncrushable",
        "detach",
        "normal",
        "fully_detach",
        "box",
        "0",
      ]),
    ),
    group,
    "TEST.TXT\nTEST.WAM",
  );
  await system.init();
  physics(system);
  apply(system, new Vector3(-0.2, 0.1, -0.4), 0.5);
  const runtime = system.runtimeParts[0];
  runtime.state.phase = 2;
  const elsewhere = new Group();
  elsewhere.add(object);
  system.componentLevels[3] = 12;
  const result = system.repairStep(40, 20);
  assert.ok(
    result.totalDeflection > 0,
    "detached DAT floats have compressed-target deflection",
  );
  assert.equal(result.cost, 0);
  assert.equal(object.parent, group);
  assert.equal(runtime.state.phase, 0);
  assert.equal(system.repairStep(40, 20).cost, 240);
});

async function archive(name) {
  const buffer = await readFile(`carma2_orig/data/CARS/${name}.TWT`);
  const entries = parseTwt(buffer).entries;
  return {
    entries,
    read: (entry) => buffer.subarray(entry.offset, entry.offset + entry.size),
  };
}

test("local Eagle3 splits into independent visual/hull halves and full repair reunites authored geometry", async (t) => {
  const { originalCar } = await import("./support/original-car.mjs");
  const { parseCarMechanics } = await import("../src/mechanics.ts");
  let data;
  try {
    data = await originalCar("EAGLE3");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Original assets absent");
      return;
    }
    throw error;
  }
  const system = new DamageSystem(data.assets, data.group, data.text);
  await system.init();
  const mechanics = parseCarMechanics(data.text);
  const points = mechanics.shapes.map((shape) =>
    shape.vertices.map((point) => new Vector3(...point)),
  );
  system.configurePhysics(mechanics, points);
  system.damageContext.random = () => 0.5;
  const originals = [];
  data.group.traverse((object) => {
    if (object.isMesh)
      originals.push([
        object,
        object.geometry,
        Array.from(object.geometry.attributes.position.array),
      ]);
  });
  const plane = system.prepareSplitPlane(new Vector3(0, 0, 1), 0);
  assert.ok(plane);
  const split = system.splitAtPlane(plane, true);
  assert.ok(split);
  assert.equal(split.disableMotion, true);
  assert.equal(system.snapped, true);
  assert.equal(system.splitRevision, 1);
  assert.ok(split.actor.children.length > 0);
  assert.ok(split.shapes.some((shape) => shape.length >= 4));
  assert.ok(points.some((shape) => shape.length >= 4));
  assert.ok(
    Math.abs(split.positive.mass + split.negative.mass - mechanics.root.mass) <
      1e-10,
  );
  assert.ok(system.componentLevels[0] >= 80);
  assert.equal(
    system.repairStep(100, 10).active,
    false,
    "source held repair cannot reunite a snapped car",
  );
  system.repair();
  assert.equal(system.snapped, false);
  assert.equal(system.splitRevision, 2);
  for (const [mesh, geometry, positions] of originals) {
    assert.equal(mesh.geometry, geometry);
    assert.deepEqual(
      Array.from(mesh.geometry.attributes.position.array),
      repairedPositions(system, mesh, positions),
    );
  }
  points.forEach((shape, index) =>
    assert.equal(shape.length, mechanics.shapes[index].vertices.length),
  );
  assert.equal(
    system.prepareSplitPlane(
      new Vector3(0, 1, 0),
      system.wam.splitY,
      system.wam.splitY,
    ),
    undefined,
    "Eagle's authored zero-height cut lies below its collision hull",
  );
  const roofPlane = system.prepareSplitPlane(new Vector3(0, 1, 0), 0.12, 0.12);
  assert.ok(roofPlane);
  const roofSplit = system.splitAtPlane(roofPlane, true);
  assert.ok(roofSplit);
  assert.equal(roofSplit.disableMotion, false);
  assert.equal(roofSplit.wheelMask.length, mechanics.wheels.length);
  assert.ok(
    roofSplit.wheelMask.every(
      (retained, index) =>
        retained ===
        roofPlane.normal.dot(system.currentWheelPositions[index]) -
          roofPlane.constant >
          0,
    ),
  );
  assert.ok(roofSplit.actor.children.length > 0);
  system.repair();
});

test("source wheel bend shifts preferred pivot GROOVE Y centers and restores them", async (t) => {
  const { originalCar } = await import("./support/original-car.mjs");
  const { parseCarMechanics } = await import("../src/mechanics.ts");
  let data;
  try {
    data = await originalCar("EAGLE3");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Original assets absent");
      return;
    }
    throw error;
  }
  const system = new DamageSystem(data.assets, data.group, data.text);
  await system.init();
  const mechanics = parseCarMechanics(data.text);
  const points = mechanics.shapes.map((shape) =>
    shape.vertices.map((point) => new Vector3(...point)),
  );
  system.configurePhysics(mechanics, points);
  assert.deepEqual(
    [...system.wheelGrooveOffsets.keys()].map((actor) => actor.name).sort(),
    ["FLPIVOT.ACT", "FRPIVOT.ACT", "RLWHEEL.ACT", "RRWHEEL.ACT"],
  );
  system.damageContext.random = () => 0;
  system.applyImpact(
    [new Vector3(0, 0.1, -0.3)],
    new Vector3(0, 0, 5),
    false,
    true,
    10000,
    new Vector3(0, 0, 5),
  );
  assert.ok(system.structuralBend);
  assert.ok(
    [...system.wheelGrooveOffsets.values()].some((value) => value !== 0),
  );
  for (const [actor, offset] of system.wheelGrooveOffsets)
    assert.equal(actor.userData.c2BendPathOffsetY, offset);
  system.repair();
  assert.ok(
    [...system.wheelGrooveOffsets.values()].every((value) => value === 0),
  );
});

test("local Eagle3 and rival archive WAMs parse, and original Eagle meshes visibly deform and repair", async (t) => {
  let eagle;
  try {
    eagle = await archive("EAGLE3");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local game assets absent");
      return;
    }
    throw error;
  }
  const w = parseWam(
    eagle
      .read(eagle.entries.find((entry) => /\.wam$/i.test(entry.name)))
      .toString("latin1"),
  );
  assert.equal(w.parts.length, 18);
  assert.equal(w.parts.filter((part) => part.type === "flap").length, 3);
  assert.equal(
    w.parts.reduce((count, part) => count + part.smashes.length, 0),
    7,
  );
  for (const name of [
    "newhawk",
    "VLAD3",
    "copcar",
    "buggy",
    "piranh4",
    "bigdump",
  ]) {
    const a = await archive(name);
    const data = parseWam(
      a
        .read(a.entries.find((entry) => /\.wam$/i.test(entry.name)))
        .toString("latin1"),
    );
    assert.ok(data.parts.length > 0, `${name} original crush parts parsed`);
  }
  const models = new Map();
  for (const entry of eagle.entries.filter((entry) =>
    /\.dat$/i.test(entry.name),
  )) {
    for (const model of parseDat(eagle.read(entry)))
      models.set(model.name.toLowerCase(), model);
  }
  const group = new Group();
  group.name = "EAGLE3";
  const originals = [];
  function actor(node) {
    const part = new Group();
    part.name = node.name;
    if (node.model) {
      const model = models.get(node.model.toLowerCase());
      if (model) {
        const geometry = new BufferGeometry();
        geometry.setAttribute(
          "position",
          new BufferAttribute(model.positions.slice(), 3),
        );
        geometry.setIndex(model.faces.flatMap((face) => face.indices));
        const object = mesh(model.name, geometry);
        part.add(object);
        originals.push([object, Array.from(model.positions)]);
      }
    }
    node.children.forEach((child) => part.add(actor(child)));
    return part;
  }
  const act = eagle.entries.find((entry) => /^EAGLE3.ACT$/i.test(entry.name));
  parseAct(eagle.read(act)).forEach((node) => group.add(actor(node)));
  const path = "data/CARS/EAGLE3/EAGLE3.WAM";
  const assets = {
    manifest: [{ path }],
    resolve: (name) =>
      name.toLowerCase() === path.toLowerCase() ? path : undefined,
    text: async () =>
      eagle
        .read(eagle.entries.find((entry) => /\.wam$/i.test(entry.name)))
        .toString("latin1"),
  };
  const system = new DamageSystem(assets, group, "EAGLE3.TXT\nEAGLE3.WAM");
  await system.init();
  assert.equal(
    system.runtimeParts.length,
    w.parts.length,
    "each original ACT actor links once, never again for its render Mesh",
  );
  physics(system);
  const nose = originals.find(([object]) =>
    w.parts.some(
      (part) => part.actor.toLowerCase() === object.parent.name.toLowerCase(),
    ),
  );
  assert.ok(nose, "original ACT contains WAM-linked actors");
  group.updateMatrixWorld(true);
  const impact = new Vector3()
    .fromBufferAttribute(nose[0].geometry.attributes.position, 0)
    .applyMatrix4(nose[0].matrixWorld);
  apply(system, impact, 0.5);
  let changed = 0;
  for (const [object, original] of originals) {
    if (
      Array.from(object.geometry.attributes.position.array).some(
        (value, index) => Math.abs(value - original[index]) > 1e-5,
      )
    )
      changed++;
    assert.ok(
      Array.from(object.geometry.attributes.position.array).every(
        Number.isFinite,
      ),
    );
  }
  assert.ok(
    changed >= 1,
    "original WAM-linked model visibly dents at a vertex impact",
  );
  system.repair();
  for (const [object, original] of originals)
    assert.deepEqual(
      Array.from(object.geometry.attributes.position.array),
      repairedPositions(system, object, original),
    );
});

test("native WAM softness commands accept spaced and underscored names", () => {
  for (const [name, expected] of [
    ["very soft", 4],
    ["very hard", 0.25],
    ["very_soft", 4],
    ["very_hard", 0.25],
  ]) {
    const text = wam().replace("\nnormal\n", `\n${name}\n`);
    const parsed = parseWam(text);
    assert.equal(parsed.parts[0].softnessFactor, expected);
  }
});
