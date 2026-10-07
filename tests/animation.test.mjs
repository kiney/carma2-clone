import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import { CarAnimation, TextureAnimation } from "../src/animation.ts";
import { Assets } from "../src/content.ts";
import { createAssetStore } from "../server/assets.mjs";

const input = { speed: 0, steer: 0, brake: false, throttle: 0 };
const near = (actual, expected, epsilon = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const section = (kind, entries) =>
  `START OF ${kind}\n${entries.join(`\nNEXT ${kind}\n`)}\nEND OF ${kind}`;
const groove = (actor, animation, ref, axis, pivot = "0,0,0") =>
  `${actor}\nnot a lollipop\nconstant\nno path\n${animation}\n${animation === "rock" ? "absolute" : "controlled"}\n${ref}\n${pivot}\n${axis}${animation === "rock" ? "\n0" : ""}`;
// Independently constructed grammar fixtures; original game data stays on disk.
const carPrefix =
  "2\n7\n8\n4,-1\n3,-1\n6,-1\n5,-1\n-1,-1,2,1\n10,9,-1,-1\n0.14\n0.14\n";
const carConfig = (entries) =>
  carPrefix + section("FUNK", []) + "\n" + section("GROOVE", entries);
const bitFunk = (material) =>
  `${material}\nconstant\npiss off\nnone\nframes\naccurate\ntexturebits\nVB\n4\natlas,2,0,2,0\natlas,2,1,2,0\natlas,2,0,2,1\natlas,2,1,2,1`;
function texture(name) {
  const t = new THREE.DataTexture(new Uint8Array(16).fill(255), 2, 2);
  t.name = name;
  return t;
}

test("car GROOVE controls preserve wheel hubs, explicit pivots and original local matrices", () => {
  const group = new THREE.Group();
  group.rotation.y = 0.37;
  group.position.set(3, 1, -2);
  const wheel = new THREE.Group();
  wheel.name = "wheel.act";
  wheel.position.set(0.4, 0.1, -0.3);
  wheel.rotation.z = 0.2;
  const geometry = new THREE.BoxGeometry(0.06, 0.14, 0.14);
  geometry.translate(0.7, 0.08, 0.2);
  wheel.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  group.add(wheel);
  const steering = new THREE.Group();
  steering.name = "steer";
  steering.position.set(0.1, 0.2, 0.3);
  group.add(steering);
  group.updateMatrixWorld(true);
  const wheelBase = wheel.matrix.clone(),
    steerBase = steering.matrix.clone();
  const hub = new THREE.Vector3(0.7, 0.08, 0.2),
    before = wheel.localToWorld(hub.clone());
  const explicitPivot = new THREE.Vector3(0.2, 0.3, 0.4),
    beforeSteer = steering.localToWorld(explicitPivot.clone());
  const animation = new CarAnimation(
    group,
    carConfig([
      groove("wheel", "spin", 1, "x"),
      groove("steer.act", "rock", 7, "y", "0.2,0.3,0.4"),
    ]),
  );
  assert.equal(animation.wheelCount, 1);
  assert.equal(animation.steeringCount, 1);
  assert.deepEqual(animation.warnings, []);
  animation.update(0.1, { ...input, speed: 0.4, steer: 0.6 });
  group.updateMatrixWorld(true);
  assert.ok(wheel.localToWorld(hub.clone()).distanceTo(before) < 1e-7);
  assert.ok(
    steering.localToWorld(explicitPivot.clone()).distanceTo(beforeSteer) < 1e-7,
  );
  assert.notDeepEqual(wheel.matrix.elements, wheelBase.elements);
  assert.notDeepEqual(steering.matrix.elements, steerBase.elements);
  animation.reset();
  assert.deepEqual(wheel.matrix.elements, wheelBase.elements);
  assert.deepEqual(steering.matrix.elements, steerBase.elements);
  assert.equal(wheel.matrixAutoUpdate, true);
  animation.dispose();
  assert.equal(animation.wheelCount, 0);
});

test("rear FUNK VB bits select idle, reverse, brake and combined atlas cells without changing shared textures", () => {
  const source = texture("atlas"),
    original = texture("original"),
    mat = new THREE.MeshLambertMaterial({ map: original });
  const animation = new TextureAnimation(
    new Map([["rear", mat]]),
    new Map([["atlas", source]]),
    section("FUNK", [bitFunk("rear")]),
  );
  assert.equal(animation.count, 1);
  assert.deepEqual(animation.warnings, []);
  const selected = (state) => {
    animation.update(0, { ...input, ...state });
    return mat.map.matrix.elements;
  };
  let uv = selected({});
  near(uv[0], 0.5);
  near(uv[4], 0.5);
  near(uv[6], 0);
  near(uv[7], 0);
  uv = selected({ speed: -1 });
  near(uv[6], 0.5);
  near(uv[7], 0);
  uv = selected({ brake: true });
  near(uv[6], 0);
  near(uv[7], 0.5);
  uv = selected({ speed: -1, brake: true });
  near(uv[6], 0.5);
  near(uv[7], 0.5);
  uv = selected({ throttle: -1 });
  near(uv[6], 0.5);
  near(uv[7], 0);
  assert.notEqual(mat.map, source);
  assert.deepEqual(source.matrix.elements, new THREE.Matrix3().elements);
  animation.reset();
  near(mat.map.matrix.elements[6], 0);
  near(mat.map.matrix.elements[7], 0);
  animation.dispose();
  assert.equal(mat.map, original);
  assert.equal(animation.count, 0);
  near(mat.emissiveIntensity, 1);
});

test("continuous original frame rates and harmonic percentage UV movement advance with elapsed time", () => {
  const a = texture("a"),
    b = texture("b"),
    c = texture("c");
  const fan = new THREE.MeshBasicMaterial({ map: a }),
    water = new THREE.MeshBasicMaterial({ map: a });
  const config = section("FUNK", [
    "fan\ndistance\npiss off\nnone\nframes\napproximate\ncontinuous\n16\n3\na\nb\nc",
    "water\nconstant\nslither\nharmonic\n0.07,0.1\n12,10\nnone\nnone",
  ]);
  const animation = new TextureAnimation(
    new Map([
      ["fan", fan],
      ["water", water],
    ]),
    new Map([
      ["a", a],
      ["b", b],
      ["c", c],
    ]),
    config,
  );
  assert.equal(animation.count, 2);
  assert.ok(animation.warnings.some((w) => /distance gating/.test(w)));
  assert.equal(fan.map.name, "a");
  animation.update(1 / 16);
  assert.equal(fan.map.name, "b");
  animation.update(1 / 16);
  assert.equal(fan.map.name, "c");
  animation.update(0.875);
  near(water.map.matrix.elements[6], Math.sin(2 * Math.PI * 0.07) * 0.12);
  near(water.map.matrix.elements[7], Math.sin(2 * Math.PI * 0.1) * 0.1);
  animation.dispose();
  assert.equal(water.map, a);
  assert.equal(fan.map, a);
});

test("UUID-indexed rendered material clones with the same name all animate and restore their own maps", () => {
  const source = texture("atlas"),
    originalA = texture("originalA"),
    originalB = texture("originalB");
  const first = new THREE.MeshLambertMaterial({ map: originalA });
  first.name = "Rear.MAT";
  const second = first.clone();
  second.map = originalB;
  const animation = new TextureAnimation(
    new Map([
      [first.uuid, first],
      [second.uuid, second],
    ]),
    new Map([["atlas", source]]),
    section("FUNK", [bitFunk("rear")]),
  );
  assert.equal(animation.count, 2);
  assert.deepEqual(animation.warnings, []);
  animation.update(0, { ...input, speed: -1, brake: true });
  for (const mat of [first, second]) {
    near(mat.map.matrix.elements[6], 0.5);
    near(mat.map.matrix.elements[7], 0.5);
  }
  assert.notEqual(first.map, second.map);
  animation.dispose();
  assert.equal(first.map, originalA);
  assert.equal(second.map, originalB);
  assert.deepEqual(source.matrix.elements, new THREE.Matrix3().elements);
});

test("unsupported and malformed animations are bounded, skipped and reported", () => {
  const source = texture("atlas"),
    mat = new THREE.MeshBasicMaterial({ map: source });
  const unsupported = new TextureAnimation(
    new Map([["rear", mat]]),
    new Map([["atlas", source]]),
    section("FUNK", [
      bitFunk("rear").replace("VB", "TH"),
      bitFunk("rear").replace("atlas,2,0,2,0", "atlas,2,9,2,0"),
    ]),
  );
  assert.equal(unsupported.count, 0);
  assert.equal(unsupported.warnings.length, 2);
  assert.equal(mat.map, source);
  const missingEnd = new CarAnimation(
    new THREE.Group(),
    "START OF GROOVE\nbad",
  );
  assert.ok(missingEnd.warnings.some((w) => /Missing END/.test(w)));
  const huge = new CarAnimation(new THREE.Group(), "x".repeat(4_000_001));
  assert.ok(huge.warnings.some((w) => /size limit/.test(w)));
  const unknownControl = new THREE.Group(),
    actor = new THREE.Group();
  actor.name = "unknown";
  unknownControl.add(actor);
  const unsupportedCar = new CarAnimation(
    unknownControl,
    carConfig([groove("unknown", "spin", 100, "x")]),
  );
  assert.equal(unsupportedCar.wheelCount, 0);
  assert.ok(unsupportedCar.warnings.some((w) => /control reference/.test(w)));
});

let originalsAvailable = true;
try {
  await access(new URL("../carma2_orig", import.meta.url));
} catch {
  originalsAvailable = false;
}
test(
  "read-only original Eagle smoke: all four wheel, steering and rear-light atlas bindings",
  { skip: !originalsAvailable },
  async () => {
    const store = await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
    const assets = new Assets();
    assets.manifest = store.manifest;
    assets.lookup = new Map(
      store.manifest.map((e) => [e.path.toLowerCase(), e.path]),
    );
    assets.bytes = async (path) => {
      const bytes = await store.read(path);
      assert.ok(bytes, path);
      return bytes;
    };
    await assets.pixelmaps("data/Reg/PIXELMAP/PIXIES.P16");
    const car = await assets.scene("data/CARS/EAGLE3", "EAGLE3");
    const config = await assets.text("data/CARS/EAGLE3/EAGLE3.txt");
    const animation = new CarAnimation(car.group, config),
      lights = new TextureAnimation(car.materials, car.textures, config);
    assert.equal(animation.wheelCount, 4, animation.warnings.join("\n"));
    assert.equal(animation.steeringCount, 2, animation.warnings.join("\n"));
    assert.deepEqual(animation.warnings, []);
    assert.equal(lights.count, 2, lights.warnings.join("\n"));
    assert.deepEqual(lights.warnings, []);
    const wheel = car.group.getObjectByName("RRWHEEL.ACT"),
      steer = car.group.getObjectByName("FRPIVOT.ACT");
    assert.ok(wheel);
    assert.ok(steer);
    const beforeWheel = wheel.matrix.clone(),
      beforeSteer = steer.matrix.clone();
    animation.update(0.1, { ...input, speed: 1, steer: 0.5 });
    assert.notDeepEqual(wheel.matrix.elements, beforeWheel.elements);
    assert.notDeepEqual(steer.matrix.elements, beforeSteer.elements);
    lights.update(0, { ...input, brake: true });
    for (const name of ["earlitl", "earlitr"]) {
      const mat = car.materials.get(name);
      assert.ok(mat);
      assert.equal(mat.map.name.toLowerCase(), "ebackall");
      near(mat.map.matrix.elements[0], 0.5);
      near(mat.map.matrix.elements[7], 0.5);
    }
    animation.dispose();
    lights.dispose();
    assert.deepEqual(wheel.matrix.elements, beforeWheel.elements);
  },
);

test(
  "read-only original Junkyard smoke: water UVs and three-frame fan animation",
  { skip: !originalsAvailable },
  async () => {
    const store = await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
    const assets = new Assets();
    assets.manifest = store.manifest;
    assets.lookup = new Map(
      store.manifest.map((e) => [e.path.toLowerCase(), e.path]),
    );
    assets.bytes = async (path) => {
      const bytes = await store.read(path);
      assert.ok(bytes, path);
      return bytes;
    };
    await assets.pixelmaps("data/RACES/JUNK/PIXIES.P16");
    const world = await assets.scene("data/RACES/Junkyard", "JUNKYARD");
    const config = await assets.text("data/RACES/Junkyard/JUNKYARD.txt");
    const water = world.materials.get("!\\75water3"),
      fan = world.materials.get("fan1");
    assert.ok(water);
    assert.ok(fan);
    const originalWater = water.map,
      originalFan = fan.map;
    const animation = new TextureAnimation(
      world.materials,
      world.textures,
      config,
    );
    assert.equal(animation.count, 2, animation.warnings.join("\n"));
    assert.equal(animation.warnings.length, 1);
    assert.match(animation.warnings[0], /distance gating/);
    assert.equal(fan.map.name, "FAN1");
    animation.update(1);
    assert.equal(fan.map.name, "FAN2");
    near(water.map.matrix.elements[6], Math.sin(2 * Math.PI * 0.07) * 0.12);
    near(water.map.matrix.elements[7], Math.sin(2 * Math.PI * 0.1) * 0.1);
    animation.reset();
    assert.equal(fan.map.name, "FAN1");
    near(water.map.matrix.elements[6], 0);
    near(water.map.matrix.elements[7], 0);
    animation.dispose();
    assert.equal(water.map, originalWater);
    assert.equal(fan.map, originalFan);
  },
);
