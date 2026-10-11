import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  SkidMarkSystem,
  skidContactEligible,
  skidMarkTransform,
} from "../src/skidmarks.ts";

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);
function fixture() {
  const road = new THREE.MeshBasicMaterial();
  road.name = "SKIDMARK.MAT";
  const oil = new THREE.MeshBasicMaterial();
  oil.name = "OILSMEAR.MAT";
  const other = new THREE.MeshBasicMaterial();
  other.name = "DESKID.MAT";
  const materials = new Map([road, oil, other].map((m) => [m.name, m]));
  const system = new SkidMarkSystem({
    resolveMaterial: (name) => materials.get(name),
  });
  const car = new THREE.Group();
  const sample = (x, extra = {}) =>
    system.singlePhysicsWheelSample({
      car,
      wheel: 0,
      requested: true,
      position: v(x),
      normal: v(0, 1),
      skidMaterial: road.name,
      contact: { present: true },
      ...extra,
    });
  return { system, car, sample, road, oil, other };
}

test("native first sample arms; minimum spacing retains the earlier contact", () => {
  const { system, car, sample } = fixture();
  assert.equal(sample(0).status, "armed");
  assert.equal(sample(0.04).status, "spacing");
  assert.deepEqual(system.snapshot(car).wheels[0].previous, [0, 0, 0]);
  assert.equal(sample(Math.fround(0.05)).status, "created");
  const mark = system.snapshot().marks[0];
  close(mark.matrix[0], 0.05);
  close(mark.matrix[10], 0.05);
  close(mark.position[0], 0.025);
  close(mark.uv[4], 1);
  system.dispose();
});

test("normal and plane continuity reject a section and consume travelled oil", () => {
  const { system, sample } = fixture();
  const oilState = {
    oilRemaining: 1,
    suspensionDistance: 0,
    suspensionHeight: 1,
  };
  sample(0, oilState);
  const rejected = sample(0.1, { ...oilState, position: v(0.1, 0.02) });
  assert.equal(rejected.status, "discontinuity");
  assert.equal(rejected.id, -1);
  close(rejected.oilRemaining, 1 - Math.sqrt(0.01 + 0.0004));
  assert.equal(system.debug.active, 0);
  assert.equal(sample(0.2, oilState).status, "armed");
  assert.equal(
    sample(0.3, { ...oilState, normal: v(0.1, Math.sqrt(0.99)) }).status,
    "discontinuity",
  );
  system.dispose();
});

test("installed length threshold allows one extension past .5, then allocates", () => {
  const { system, sample } = fixture();
  sample(0);
  assert.equal(sample(0.1).status, "created");
  assert.equal(sample(0.4).status, "extended");
  assert.equal(sample(0.6).status, "extended");
  const first = system.snapshot().marks[0];
  close(first.matrix[0], 0.6);
  close(first.uv[0], 8);
  close(first.uv[4], 20);
  assert.equal(sample(0.7).status, "created");
  assert.equal(system.debug.active, 2);
  const second = system.snapshot().marks[1];
  close(second.matrix[0], 0.1);
  close(second.position[0], 0.65);
  close(second.uv[0], 12);
  system.dispose();
});

test("turn and reversal tests create separate sections; old marks persist", () => {
  const { system, sample } = fixture();
  sample(0);
  sample(0.1);
  assert.equal(sample(0.2, { position: v(0.2, 0, 0.06) }).status, "created");
  assert.equal(sample(0.1, { position: v(0.1, 0, 0.06) }).status, "created");
  assert.equal(sample(0.1, { requested: false }).status, "stopped");
  assert.equal(system.debug.active, 3);
  assert.equal(sample(0.3).status, "armed");
  system.dispose();
});

test("contact filtering uses nested pixelmap type and exact identifier form", () => {
  assert.equal(skidContactEligible({ present: false }), false);
  assert.equal(skidContactEligible({ present: true, pixelmapType: 18 }), false);
  assert.equal(
    skidContactEligible({ present: true, materialName: "abcde|ghijkl" }),
    false,
  );
  assert.equal(
    skidContactEligible({ present: true, materialName: "abcde|ghijk" }),
    true,
  );
  const { system, sample } = fixture();
  assert.equal(
    sample(0, { contact: { present: true, pixelmapType: 18 } }).status,
    "idle",
  );
  sample(0);
  sample(0.1);
  assert.equal(sample(0.2, { contact: { present: false } }).status, "stopped");
  assert.equal(system.debug.active, 1);
  system.dispose();
});

test("oil independently requests marks, selects smear and consumes length", () => {
  const { system, sample } = fixture();
  const fields = {
    requested: false,
    oilRemaining: 0.2,
    suspensionDistance: 0,
    suspensionHeight: 1,
  };
  assert.equal(sample(0, fields).status, "armed");
  const created = sample(0.1, fields);
  assert.equal(created.status, "created");
  close(created.oilRemaining, 0.1);
  assert.equal(system.snapshot().marks[0].material, "OILSMEAR.MAT");
  const exhausted = sample(0.3, {
    ...fields,
    oilRemaining: created.oilRemaining,
  });
  assert.equal(exhausted.oilRemaining, 0);
  system.dispose();
});

test("material changes create sections; missing material clears the active run", () => {
  const { system, sample } = fixture();
  sample(0);
  sample(0.1);
  assert.equal(sample(0.2, { skidMaterial: "DESKID.MAT" }).status, "created");
  assert.equal(sample(0.3, { skidMaterial: "missing" }).status, "stopped");
  assert.equal(system.debug.active, 2);
  assert.equal(system.diagnostics.length, 1);
  assert.equal(sample(0.4).status, "armed");
  system.dispose();
});

test("100 persistent records overwrite in a ring; clear retains insertion cursor", () => {
  const { system, sample } = fixture();
  for (let i = 0; i < 101; i++) {
    const car = new THREE.Group();
    sample(i * 2, { car });
    assert.equal(sample(i * 2 + 0.1, { car }).id, i % 100);
  }
  assert.equal(system.debug.active, 100);
  assert.equal(system.debug.overwrites, 1);
  assert.equal(system.debug.cursor, 1);
  close(system.snapshot().marks[0].position[0], 200.05);
  system.clear();
  assert.equal(system.debug.active, 0);
  const car = new THREE.Group();
  sample(0, { car });
  assert.equal(sample(0.1, { car }).id, 1);
  system.dispose();
});

test("sloped source transform has authored width, continuous UVs and tiny Y=1", () => {
  const normal = v(0, Math.SQRT1_2, Math.SQRT1_2);
  const mark = skidMarkTransform(v(), v(0.2), normal, 0.15);
  close(Math.hypot(...mark.matrix.elements.slice(8, 11)), 0.05);
  close(mark.uv[0], 3);
  close(mark.uv[4], 7);
  const tiny = skidMarkTransform(v(), v(0.0001), normal, 0.15);
  assert.equal(tiny.uv, null);
  close(tiny.matrix.elements[0], 0.001);
  assert.equal(tiny.matrix.elements[5], 1);
  close(tiny.matrix.elements[10], 0.001);
});

test("invalid inputs fail before pool mutation; borrowed materials are not disposed", () => {
  const { system, sample, road } = fixture();
  assert.throws(() => sample(0, { wheel: 4 }), /wheel/);
  assert.throws(() => sample(Infinity), /vector/);
  assert.throws(() => sample(0, { oilRemaining: 1 }), /suspension/);
  assert.throws(() => skidMarkTransform(v(), v(1), v(0, 1), 0, 0), /mapping/);
  assert.throws(
    () => skidMarkTransform(v(), v(1), v(0, 1), 0, 1e-100),
    /mapping/,
  );
  assert.equal(system.debug.active, 0);
  let disposed = false;
  road.addEventListener("dispose", () => {
    disposed = true;
  });
  sample(0);
  sample(0.1);
  system.dispose();
  system.dispose();
  assert.equal(disposed, false);
  assert.equal(system.group.children.length, 0);
});
