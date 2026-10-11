import test from "node:test";
import assert from "node:assert/strict";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  MeshBasicMaterial,
  Texture,
  Vector3,
} from "three";
import { ShardRuntime } from "../src/smash-shards.ts";

const close = (actual, expected, tolerance = 1e-7) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );
const speed = (changes = {}) => ({
  towards: [0, 0],
  impacteeVelocityFactor: 0,
  randomVelocityMax: 0,
  randomUpVelocityMax: 0,
  randomNormalVelocityMax: 0,
  randomSpinRateMax: 0,
  ...changes,
});
const spec = (changes = {}) => ({
  kind: "shards",
  speed: speed(),
  lifetimeSeconds: [0.75, 1.25],
  shard: { scalar: 1, integer: 0, material: "GLASS.MAT" },
  ...changes,
});
function geometry(points = [0, 0, 0, 1, 0, 0, 0, 1, 0]) {
  const result = new BufferGeometry();
  result.setAttribute("position", new Float32BufferAttribute(points, 3));
  result.setAttribute(
    "uv",
    new Float32BufferAttribute(
      points.flatMap((_, i) => (i % 3 === 2 ? [] : [points[i]])),
      2,
    ),
  );
  return result;
}
const source = (changes = {}) => ({
  geometry: geometry(),
  matrixWorld: new Matrix4(),
  impacteeVelocity: new Vector3(),
  timeMs: 100,
  ...changes,
});
const setup = (options = {}) => {
  const scene = new Group();
  const material = new MeshBasicMaterial();
  const runtime = new ShardRuntime(scene, new Map([["GLASS.MAT", material]]), {
    random: () => 0.5,
    ...options,
  });
  return { scene, material, runtime };
};

test("authored scalar is a squared-edge subdivision threshold and preserves UVs and area", () => {
  const { scene, runtime } = setup();
  const sourceGeometry = geometry([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]);
  const original = Array.from(sourceGeometry.getAttribute("position").array);
  const result = runtime.spawn(
    spec({ shard: { scalar: 0.005, integer: 0, material: "GLASS.MAT" } }),
    source({ geometry: sourceGeometry }),
  );
  assert.ok(result.created > 1 && result.created <= 200);
  assert.equal(result.created, result.triangles);
  let area = 0;
  for (const mesh of scene.children) {
    const positions = mesh.geometry.getAttribute("position"),
      uv = mesh.geometry.getAttribute("uv");
    const points = [0, 1, 2].map((index) =>
      new Vector3().fromBufferAttribute(positions, index).add(mesh.position),
    );
    area +=
      points[1]
        .clone()
        .sub(points[0])
        .cross(points[2].clone().sub(points[0]))
        .length() / 2;
    points.forEach((point, index) => {
      close(point.x, uv.getX(index));
      close(point.y, uv.getY(index));
    });
  }
  close(area, 0.005);
  assert.deepEqual(
    Array.from(sourceGeometry.getAttribute("position").array),
    original,
  );
  runtime.dispose();
});

test("integer low bit selects shared refined cloud centre rather than a shard count", () => {
  const points = [
    0, 0, 0, 0.01, 0, 0, 0, 0.01, 0, 10, 0, 0, 10.01, 0, 0, 10, 0.01, 0,
  ];
  for (const integer of [0, 1, 2, 3]) {
    const { runtime } = setup();
    const result = runtime.spawn(
      spec({ shard: { scalar: 100, integer, material: "GLASS.MAT" } }),
      source({
        geometry: geometry(points),
        matrixWorld: new Matrix4().makeTranslation(2, 3, 4),
      }),
    );
    assert.equal(result.created, 2);
    const [first, second] = runtime.snapshot().fragments;
    close(second.position[0] - first.position[0], integer & 1 ? 0 : 10, 1e-6);
    close(first.position[2], 4);
    runtime.dispose();
  }
});

test("native movement applies size factor, independent normal samples and authored spin divided by ten", () => {
  const { runtime } = setup({ random: () => 0.75 });
  runtime.spawn(
    spec({
      shard: { scalar: 100, integer: 0, material: "GLASS.MAT" },
      speed: speed({
        towards: [100, 200],
        impacteeVelocityFactor: 1,
        randomVelocityMax: 10,
        randomUpVelocityMax: 2,
        randomNormalVelocityMax: 4,
        randomSpinRateMax: 100,
      }),
    }),
    source({ impacteeVelocity: new Vector3(10, 0, 0) }),
  );
  const fragment = runtime.snapshot().fragments[0];
  close(fragment.velocity[0], 7.5);
  close(fragment.velocity[1], 4);
  close(fragment.velocity[2], 5.5);
  fragment.spin.forEach((component) => close(component, 2.5 / Math.sqrt(3)));
  assert.equal(fragment.visibleUntilMs, 1225);
  assert.equal(fragment.endMs, 1350);
  runtime.dispose();
});

test("gravity integrates in native units, rotation uses BRender angle quantization, and the first movement update is skipped", () => {
  const { runtime } = setup({ random: () => 0.75, gravity: 2 });
  runtime.update(0);
  runtime.update(1);
  runtime.spawn(
    spec({
      shard: { scalar: 100, integer: 0, material: "GLASS.MAT" },
      lifetimeSeconds: [5, 5],
      speed: speed({ impacteeVelocityFactor: 1, randomSpinRateMax: 100 }),
    }),
    source({ impacteeVelocity: new Vector3(6.9, 6.9, 0) }),
  );
  const first = runtime.snapshot().fragments[0];
  runtime.update(100);
  assert.deepEqual(runtime.snapshot().fragments[0].position, first.position);
  runtime.update(600);
  const after = runtime.snapshot().fragments[0];
  close(after.position[0] - first.position[0], 0.25);
  close(
    after.position[1] - first.position[1],
    (3.45 * 0.5 - 4.9 * 2 * 0.25) / 6.9,
  );
  close(after.velocity[1], 3.45 - 9.8 * 2 * 0.5);
  const angle =
    (Math.trunc((2.5 * 0.5 * 65536) / (2 * Math.PI)) * 2 * Math.PI) / 65536;
  close(after.quaternion[3], Math.cos(angle / 2));
  runtime.dispose();
});

test("small triangles use the native bounds sum speed factor", () => {
  const { runtime } = setup();
  runtime.spawn(
    spec({ speed: speed({ impacteeVelocityFactor: 1 }) }),
    source({
      geometry: geometry([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0]),
      impacteeVelocity: new Vector3(10, 0, 0),
    }),
  );
  close(runtime.snapshot().fragments[0].velocity[0], 9);
  runtime.dispose();
});

test("material eligibility, transformed geometry normals and original texture ownership are preserved", () => {
  const { runtime, material, scene } = setup({ random: () => 0.5 });
  const texture = new Texture();
  texture.matrix.setUvTransform(2, 3, 4, 5, 0.25, 0.5, 0.5);
  const originalMatrix = texture.matrix.elements.slice();
  material.map = texture;
  const sourceGeometry = geometry([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0,
  ]);
  sourceGeometry.addGroup(0, 3, 0);
  sourceGeometry.addGroup(3, 3, 1);
  const result = runtime.spawn(
    spec({
      shard: { scalar: 100, integer: 0, material: "glass.mat" },
      speed: speed({ randomNormalVelocityMax: 4 }),
    }),
    source({
      geometry: sourceGeometry,
      materialSlots: [1],
      matrixWorld: new Matrix4().makeRotationY(Math.PI / 2),
    }),
  );
  assert.equal(result.created, 1);
  close(runtime.snapshot().fragments[0].velocity[0], 2);
  close(runtime.snapshot().fragments[0].velocity[2], 0);
  assert.equal(scene.children[0].material.side, DoubleSide);
  assert.notEqual(scene.children[0].material.map, texture);
  assert.equal(scene.children[0].material.map.image, texture.image);
  assert.deepEqual(
    scene.children[0].material.map.matrix.elements,
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
  );
  assert.deepEqual(texture.matrix.elements, originalMatrix);
  assert.notEqual(scene.children[0].material, material);
  let textureDisposals = 0,
    materialDisposals = 0;
  texture.addEventListener("dispose", () => textureDisposals++);
  material.addEventListener("dispose", () => materialDisposals++);
  runtime.dispose();
  assert.equal(textureDisposals, 0);
  assert.equal(materialDisposals, 0);
  assert.equal(scene.children.length, 0);
});

test("200 same-priority shards exhaust the pool and expire after the max lifetime without collisions or fade", () => {
  const { runtime, scene } = setup({ random: () => 0 });
  runtime.update(0);
  runtime.update(1);
  const noSplit = spec({
    shard: { scalar: 100, integer: 0, material: "GLASS.MAT" },
  });
  for (let i = 0; i < 200; i++)
    assert.equal(runtime.spawn(noSplit, source()).created, 1);
  assert.deepEqual(runtime.spawn(noSplit, source()), {
    created: 0,
    triangles: 1,
    sourceTruncated: false,
    reason: "pool-full",
  });
  runtime.update(100);
  runtime.update(850);
  assert.equal(runtime.snapshot().visible, 0);
  assert.equal(runtime.snapshot().active, 200);
  assert.ok(runtime.snapshot().fragments[0].position[1] < 0);
  runtime.update(1350);
  assert.equal(runtime.snapshot().active, 0);
  assert.equal(scene.children.length, 0);
  assert.equal(runtime.spawn(noSplit, source({ timeMs: 1350 })).created, 1);
  runtime.dispose();
});

test("zero previous-time sentinel skips all fragment work and stores the current time", () => {
  const { runtime, scene } = setup();
  const shortLife = spec({
    lifetimeSeconds: [0.5, 0.5],
    shard: { scalar: 100, integer: 0, material: "GLASS.MAT" },
  });
  runtime.spawn(shortLife, source({ timeMs: 0 }));
  const before = runtime.snapshot().fragments[0];
  const initialVisible = scene.children[0].visible;
  runtime.update(1000);
  assert.equal(runtime.snapshot().active, 1);
  const after = runtime.snapshot().fragments[0];
  assert.deepEqual(after.position, before.position);
  assert.deepEqual(after.velocity, before.velocity);
  assert.equal(runtime.snapshot().visible, initialVisible ? 1 : 0);
  runtime.update(1001);
  assert.equal(runtime.snapshot().active, 0);
  runtime.dispose();
});

test("native signed delta integrates backwards, restores visibility, and quantizes a negative rotation", () => {
  const { runtime } = setup({ gravity: 1 });
  runtime.update(10);
  runtime.spawn(
    spec({
      lifetimeSeconds: [1, 3],
      shard: { scalar: 100, integer: 0, material: "GLASS.MAT" },
    }),
    source({ timeMs: 0 }),
  );
  runtime.update(2000);
  const fragment = runtime.fragments[0];
  fragment.mesh.position.set(0, 0, 0);
  fragment.velocity.set(0, 0, 0);
  fragment.spin.set(0, 0, 1);
  assert.equal(fragment.firstUpdate, false);
  assert.equal(fragment.mesh.visible, false);
  runtime.update(1032);
  const after = runtime.snapshot().fragments[0];
  assert.equal(runtime.snapshot().active, 1);
  close(after.velocity[1], 9.486400604248047, 1e-12);
  close(after.position[1], -0.6654229164123535, 1e-12);
  assert.equal(runtime.snapshot().visible, 1);
  const signedAngleUnits = Math.round(
    (2 * Math.atan2(after.quaternion[2], after.quaternion[3]) * 65536) /
      (2 * Math.PI),
  );
  assert.equal(signedAngleUnits, -10096);
  runtime.dispose();
});

test("time before birth or after one member lifetime removes its whole group", () => {
  for (const mode of ["before-birth", "expired-member"]) {
    const { runtime } = setup();
    runtime.update(1);
    if (mode === "before-birth") {
      runtime.spawn(
        spec({ lifetimeSeconds: [5, 5] }),
        source({ timeMs: 0, groupId: 77 }),
      );
      runtime.spawn(
        spec({ lifetimeSeconds: [5, 5] }),
        source({ timeMs: 100, groupId: 77 }),
      );
      runtime.update(50);
    } else {
      runtime.spawn(
        spec({ lifetimeSeconds: [0.1, 0.1] }),
        source({ timeMs: 0, groupId: 78 }),
      );
      runtime.spawn(
        spec({ lifetimeSeconds: [2, 2] }),
        source({ timeMs: 0, groupId: 78 }),
      );
      runtime.update(2);
      runtime.update(200);
    }
    assert.equal(runtime.snapshot().active, 0);
    runtime.dispose();
  }
});

test("clear removes shards without resetting the native global update clock", () => {
  const { runtime } = setup();
  runtime.update(10);
  runtime.update(20);
  runtime.spawn(spec({ lifetimeSeconds: [10, 10] }), source({ timeMs: 0 }));
  runtime.clear();
  runtime.spawn(spec({ lifetimeSeconds: [10, 10] }), source({ timeMs: 0 }));
  const fragment = runtime.fragments[0];
  fragment.mesh.position.set(0, 0, 0);
  fragment.velocity.set(6.9, 0, 0);
  fragment.spin.set(0, 0, 0);
  fragment.firstUpdate = false;
  runtime.update(15);
  close(
    runtime.snapshot().fragments[0].position[0],
    Math.fround(Math.fround(-5) * Math.fround(0.001)),
    1e-12,
  );
  runtime.dispose();
});

test("invalid geometry and random inputs fail explicitly and source geometry is bounded", () => {
  const { runtime } = setup();
  const invalid = geometry();
  invalid.setIndex([0, 1, 100]);
  assert.throws(
    () => runtime.spawn(spec(), source({ geometry: invalid })),
    /vertex index/,
  );
  const oversized = geometry(
    Array.from({ length: 603 }, (_, index) => (index % 3 === 0 ? index : 0)),
  );
  const bounded = runtime.spawn(
    spec({ shard: { scalar: 100000000, integer: 0, material: "GLASS.MAT" } }),
    source({ geometry: oversized }),
  );
  assert.equal(bounded.sourceTruncated, true);
  assert.ok(bounded.created <= 200);
  runtime.dispose();
  const { runtime: bad } = setup({ random: () => 1 });
  assert.throws(() => bad.spawn(spec(), source()), /random/);
  bad.dispose();
});

test("linked source vertex and face limits apply independently while refinement keeps its 200 item capacity", () => {
  const points = [];
  for (let face = 0; face < 60; face++) {
    const x = face * 2;
    points.push(x, 0, 0, x + 1, 0, 0, x, 1, 0);
  }
  const sourceGeometry = geometry(points);
  const { runtime } = setup();
  const byVertices = runtime.spawn(
    spec({ shard: { scalar: 1e9, integer: 0, material: "GLASS.MAT" } }),
    source({
      geometry: sourceGeometry,
      sourceVertexLimit: 50,
      sourceFaceLimit: 100,
    }),
  );
  assert.equal(byVertices.created, 16);
  assert.equal(byVertices.triangles, 16);
  assert.equal(byVertices.sourceTruncated, true);
  runtime.clear();
  const byFaces = runtime.spawn(
    spec({ shard: { scalar: 1e9, integer: 0, material: "GLASS.MAT" } }),
    source({
      geometry: sourceGeometry,
      sourceVertexLimit: 100,
      sourceFaceLimit: 7,
    }),
  );
  assert.equal(byFaces.created, 7);
  assert.equal(byFaces.triangles, 7);
  assert.equal(byFaces.sourceTruncated, true);
  runtime.clear();
  const refined = runtime.spawn(
    spec({ shard: { scalar: 0.0001, integer: 0, material: "GLASS.MAT" } }),
    source(),
  );
  assert.ok(refined.created > 1 && refined.created <= 200);
  assert.equal(refined.triangles, refined.created);
  assert.equal(refined.sourceTruncated, false);
  assert.equal(runtime.snapshot().capacity, 200);
  runtime.dispose();
});

test("sourceVertexIndices merges renderer splits and keeps the first live position and UV", () => {
  const sourceGeometry = geometry([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 99, 99, 0, 98, 99, 0, 99, 98, 0,
  ]);
  sourceGeometry.setAttribute(
    "uv",
    new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 9, 9, 8, 9, 9, 8], 2),
  );
  sourceGeometry.userData.sourceVertexIndices = new Uint32Array([
    0, 1, 2, 0, 2, 3,
  ]);
  const { runtime, scene } = setup();
  const result = runtime.spawn(
    spec({ shard: { scalar: 1e9, integer: 0, material: "GLASS.MAT" } }),
    source({
      geometry: sourceGeometry,
      sourceVertexLimit: 4,
      sourceFaceLimit: 2,
    }),
  );
  assert.equal(result.created, 2);
  assert.equal(result.sourceTruncated, false);
  const second = scene.children[1];
  const points = second.geometry.getAttribute("position");
  const uv = second.geometry.getAttribute("uv");
  const worldPoints = [0, 1, 2].map((i) =>
    new Vector3().fromBufferAttribute(points, i).add(second.position),
  );
  worldPoints.forEach((point, i) => {
    const expected = [
      [0, 0, 0],
      [0, 1, 0],
      [99, 98, 0],
    ][i];
    point.toArray().forEach((value, axis) => close(value, expected[axis]));
  });
  assert.deepEqual(
    [uv.getX(0), uv.getY(0), uv.getX(1), uv.getY(1), uv.getX(2), uv.getY(2)],
    [0, 0, 0, 1, 9, 8],
  );
  runtime.dispose();
});

test("malformed sourceVertexIndices mappings and limits fail with useful errors", () => {
  const { runtime } = setup();
  const invalid = geometry();
  invalid.userData.sourceVertexIndices = [0, 1];
  assert.throws(
    () => runtime.spawn(spec(), source({ geometry: invalid })),
    /sourceVertexIndices mapping/,
  );
  assert.throws(
    () => runtime.spawn(spec(), source({ sourceFaceLimit: 201 })),
    /sourceFaceLimit/,
  );
  runtime.dispose();
});

test("normal magnitudes and spin components consume independent native random samples", () => {
  const values = [
    0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0, 0.5, 0.75, 0, 0.5,
    0.75, 0.5,
  ];
  const { runtime } = setup({ random: () => values.shift() ?? 0.5 });
  runtime.spawn(
    spec({
      shard: { scalar: 100, integer: 0, material: "GLASS.MAT" },
      speed: speed({ randomNormalVelocityMax: 4, randomSpinRateMax: 20 }),
    }),
    source({ geometry: geometry([0, 0, 0, 1, -1, 0, 1, 0, -1]) }),
  );
  const fragment = runtime.snapshot().fragments[0];
  close(fragment.velocity[0], 0);
  close(fragment.velocity[1], 2 / Math.sqrt(3));
  close(fragment.velocity[2], 3 / Math.sqrt(3));
  close(fragment.spin[0], -1 / Math.sqrt(3));
  close(fragment.spin[1], 0);
  close(fragment.spin[2], 0.5 / Math.sqrt(3));
  assert.equal(values.length, 0);
  runtime.dispose();
});

test("same-name materials in different original cars keep independent textures", () => {
  const { runtime, scene, material } = setup();
  material.map = new Texture({ car: "first" });
  const other = new MeshBasicMaterial({ map: new Texture({ car: "second" }) });
  runtime.spawn(
    spec({ shard: { scalar: 100, integer: 0, material: "GLASS.MAT" } }),
    source(),
  );
  runtime.spawn(
    spec({ shard: { scalar: 100, integer: 0, material: "glass.mat" } }),
    source({ materials: new Map([["Glass.Mat", other]]) }),
  );
  assert.equal(scene.children.length, 2);
  assert.equal(scene.children[0].material.map.image, material.map.image);
  assert.equal(scene.children[1].material.map.image, other.map.image);
  assert.notEqual(scene.children[0].material.map, material.map);
  assert.notEqual(scene.children[1].material.map, other.map);
  assert.notEqual(scene.children[0].material, scene.children[1].material);
  runtime.dispose();
  assert.equal(other.map.isTexture, true);
});
