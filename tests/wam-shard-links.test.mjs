import test from "node:test";
import assert from "node:assert/strict";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { captureShardSourceLink, ShardRuntime } from "../src/smash-shards.ts";
import { DamageSystem } from "../src/damage.ts";

function geometry(faces = 2) {
  const result = new BufferGeometry();
  const points = Array.from({ length: faces }, (_, face) => [
    face,
    0,
    0,
    face + 0.1,
    0,
    0,
    face,
    0.1,
    0,
  ]).flat();
  result.setAttribute("position", new Float32BufferAttribute(points, 3));
  result.setAttribute(
    "uv",
    new Float32BufferAttribute(
      points.flatMap((value, i) => (i % 3 === 2 ? [] : [value])),
      2,
    ),
  );
  result.addGroup(0, 3, 0);
  if (faces > 1) result.addGroup(3, (faces - 1) * 3, 1);
  return result;
}
const spec = {
  kind: "shards",
  speed: {
    towards: [0, 0],
    impacteeVelocityFactor: 0,
    randomVelocityMax: 0,
    randomUpVelocityMax: 0,
    randomNormalVelocityMax: 0,
    randomSpinRateMax: 0,
  },
  lifetimeSeconds: [1, 1],
  shard: { scalar: 100, integer: 0, material: "BITS.MAT" },
};
function spawn(link, currentGeometry = link.geometry) {
  const scene = new Group();
  const runtime = new ShardRuntime(
    scene,
    new Map([["BITS.MAT", new MeshBasicMaterial()]]),
    { random: () => 0.5 },
  );
  const result = runtime.spawn(spec, {
    geometry: currentGeometry,
    sourceLink: link,
    materialSlots: [],
    matrixWorld: new Matrix4(),
    impacteeVelocity: new Vector3(),
    timeMs: 100,
  });
  return { scene, runtime, result };
}

test("captured material-local tuples survive draw groups/range/index mutation and read live positions and UV", () => {
  const original = geometry();
  const link = captureShardSourceLink({
    geometry: original,
    materialSlots: [0],
    sourceVertexLimit: 50,
    sourceFaceLimit: 50,
  });
  assert.ok(
    Object.isFrozen(link) &&
      Object.isFrozen(link.faces) &&
      Object.isFrozen(link.faces[0]),
  );
  original.clearGroups();
  original.setDrawRange(3, 3);
  original.setIndex([3, 4, 5]);
  original.getAttribute("position").setX(0, 9);
  original.getAttribute("uv").setXY(0, 0.25, 0.75);
  const { result, scene, runtime } = spawn(link);
  assert.equal(result.created, 1);
  const mesh = scene.children[0];
  assert.ok(
    Math.abs(
      mesh.geometry.getAttribute("position").getX(0) + mesh.position.x - 9,
    ) < 1e-6,
  );
  assert.equal(mesh.geometry.getAttribute("uv").getX(0), 0.25);
  assert.equal(mesh.geometry.getAttribute("uv").getY(0), 0.75);
  runtime.dispose();
});

test("captured link bounds and original MODEL survive replacement render geometry", () => {
  const original = geometry(18);
  const link = captureShardSourceLink({
    geometry: original,
    materialSlots: [0, 1],
    sourceVertexLimit: 50,
    sourceFaceLimit: 50,
  });
  assert.equal(link.renderVertices.length, 48);
  assert.equal(link.faces.length, 16);
  assert.equal(link.truncated, true);
  const faceBound = captureShardSourceLink({
    geometry: original,
    sourceVertexLimit: 50,
    sourceFaceLimit: 2,
  });
  assert.equal(faceBound.faces.length, 2);
  assert.equal(faceBound.truncated, true);
  const replacement = new BufferGeometry();
  const { result, runtime } = spawn(link, replacement);
  assert.equal(result.created, 16);
  assert.equal(result.sourceTruncated, true);
  runtime.dispose();
});

function wam(threshold = 0.00001) {
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
    "BODY.DAT",
    "normal",
    "boring",
    "1",
    "GLASS.MAT",
    "INTACT.PIX",
    "1",
    String(threshold),
    "0",
    "0",
    "0",
    "0",
    "none",
    "0",
    "0",
    "0",
    "0",
    "none",
    "0",
    "1",
    "BROKEN.PIX",
  ].join("\n");
}
test("WAM captures the principal MODEL once and retains source eligibility across full repair", async () => {
  const group = new Group();
  group.name = "TEST";
  const actor = new Group();
  actor.name = "BODY.DAT";
  group.add(actor);
  const material = new MeshBasicMaterial();
  material.name = "GLASS.MAT";
  const principal = new Mesh(geometry(), [material, material]);
  actor.add(principal);
  const lower = new Mesh(geometry(), [material, material]);
  actor.add(lower);
  const path = "data/CARS/TEST/TEST.WAM";
  const damage = new DamageSystem(
    { resolve: () => path, text: async () => wam(), textures: new Map() },
    group,
    "TEST.TXT\nTEST.WAM",
  );
  await damage.init();
  const events = [];
  damage.onWamSmash = (event) => events.push(event);
  const impact = () => damage.impact(new Vector3(), new Vector3(0, 0, 1), 0.5);
  impact();
  assert.equal(events.length, 1);
  const link = events[0].shardSourceLink;
  assert.equal(events[0].mesh, principal);
  assert.equal(link.faces.length, 2);
  principal.geometry.setDrawRange(0, 0);
  principal.geometry.clearGroups();
  damage.repair();
  impact();
  assert.equal(events.length, 2);
  assert.equal(events[1].shardSourceLink, link);
  assert.equal(events[1].mesh, principal);
  const { result, runtime } = spawn(link);
  assert.equal(result.created, 2);
  runtime.dispose();
});

async function linkedDamage(sourceGeometry, threshold, materialCount = 1) {
  const group = new Group();
  group.name = "TEST";
  const actor = new Group();
  actor.name = "BODY.DAT";
  group.add(actor);
  const material = new MeshBasicMaterial();
  material.name = "GLASS.MAT";
  actor.add(
    new Mesh(
      sourceGeometry,
      materialCount === 1 ? material : Array(materialCount).fill(material),
    ),
  );
  const damage = new DamageSystem(
    {
      resolve: () => "data/CARS/TEST/TEST.WAM",
      text: async () => wam(threshold),
      textures: new Map(),
    },
    group,
    "TEST.TXT\nTEST.WAM",
  );
  await damage.init();
  const events = [];
  damage.onWamSmash = (event) => events.push(event);
  return { damage, events };
}

test("WAM threshold uses one centroid across duplicate matching material slots", async () => {
  const source = geometry();
  const positions = source.getAttribute("position");
  for (let i = 0; i < positions.count; i++)
    positions.setX(i, positions.getX(i) + (i < 3 ? -2 : 1));
  // The two material slots share the same authored MAT identity/name. Their
  // admitted six MODEL vertices average (0.0333333,0.0333333,0).
  const { damage, events } = await linkedDamage(source, 0.1, 2);
  damage.impact(new Vector3(1 / 30, 1 / 30, 0), new Vector3(0, 0, 1), 0.5);
  assert.equal(
    events.length,
    1,
    "one authored smash uses its combined centroid",
  );
  assert.equal(events[0].shardSourceLink.renderVertices.length, 6);
});

test("WAM threshold centroid includes exactly the first fifty admitted unique MODEL vertices", async () => {
  const source = new BufferGeometry();
  const points = [0, 0, 0, 1, 0, 0];
  for (let i = 2; i < 50; i++) points.push(0.1, i / 1000, 0);
  points.push(1000, 1000, 0);
  source.setAttribute("position", new Float32BufferAttribute(points, 3));
  source.setIndex(Array.from({ length: 49 }, (_, i) => [0, 1, i + 2]).flat());
  const mean = new Vector3();
  const positions = source.getAttribute("position");
  for (let i = 0; i < 50; i++)
    mean.add(new Vector3().fromBufferAttribute(positions, i));
  mean.divideScalar(50).add(new Vector3(0.1, 0, 0));
  // Source equation: force .5 * softness1 * distortion .0135 / distance .1.
  for (const [threshold, expected] of [
    [0.0674999, 1],
    [0.0675001, 0],
  ]) {
    const { damage, events } = await linkedDamage(source, threshold);
    damage.impact(mean, new Vector3(0, 0, 1), 0.5);
    assert.equal(
      events.length,
      expected,
      `threshold ${threshold} crosses numerical magnitude .0675`,
    );
    if (events.length) {
      assert.equal(events[0].shardSourceLink.renderVertices.length, 50);
      assert.equal(events[0].shardSourceLink.truncated, true);
    }
  }
});
