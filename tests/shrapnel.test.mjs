import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ShrapnelSystem, shrapnelRotation } from "../src/shrapnel.ts";
import { SparkSystem } from "../src/sparks.ts";

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const f = Math.fround;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const material = (name) =>
  Object.assign(new THREE.MeshBasicMaterial(), { name });
const black = material("M14.MAT"),
  first = material("CAR-A.MAT"),
  second = material("CAR-B.MAT");
const geometry = () =>
  new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 2, 0, 0, 0, 2, 0], 3),
  );
const options = (extra = {}) => ({
  models: [geometry(), geometry()],
  blackMaterial: black,
  carMaterials: () => [first, second],
  random: () => 0.5,
  ...extra,
});
const source = (extra = {}) => ({
  position: v(1, 2, 3),
  velocity: v(1, -2, 3),
  normal: v(1, 0, 0),
  forceLength: 10,
  cars: [new THREE.Object3D(), new THREE.Object3D()],
  ...extra,
});

test("native initialization consumes five draws per slot and half-scales original model clones", () => {
  const input = options(),
    system = new ShrapnelSystem(input);
  assert.equal(system.stats.randomDraws, 150);
  const record = system.snapshot().records[0];
  assert.deepEqual(record.axis.toArray(), [1, 0, 0]);
  assert.equal(record.shear1, 0);
  assert.equal(record.shear2, 0);
  assert.equal(
    system.group.children[0].geometry.getAttribute("position").getX(1),
    1,
  );
  assert.equal(input.models[0].getAttribute("position").getX(1), 2);
  assert.equal(
    system.group.children[0].geometry,
    system.group.children[2].geometry,
  );
  assert.notEqual(
    system.group.children[0].geometry,
    system.group.children[1].geometry,
  );
  system.dispose();
});

test("force threshold and truncate-before-twelve count boundaries are retained", () => {
  const system = new ShrapnelSystem(options());
  assert.equal(system.spawn(source({ forceLength: 9.999 })).length, 0);
  assert.equal(system.stats.randomDraws, 150);
  assert.equal(system.spawn(source()).length, 12);
  assert.equal(system.spawn(source({ forceLength: 19.999 })).length, 12);
  assert.equal(system.spawn(source({ forceLength: 20 })).length, 20);
  assert.equal(system.stats.active, 30);
  assert.equal(system.stats.overwritten, 14);
  assert.equal(system.stats.cursor, 14);
  system.clear();
  assert.equal(system.stats.cursor, 14);
  assert.equal(system.spawn(source())[0], 14);
  system.dispose();
});

test("world spawn projects scatter and applies source downward-velocity lift", () => {
  const system = new ShrapnelSystem(options());
  system.spawn(source());
  const record = system.snapshot().records[0];
  const amp = f(30 * f(3) * f(0.005)),
    baseY = f(f(0.3));
  const yLow = f(0.3 - baseY);
  assert.equal(record.velocity.x, 1);
  close(record.velocity.y, f(baseY + f((yLow + amp) / 2)));
  assert.equal(record.velocity.z, 3);
  assert.equal(record.material, "CAR-B.MAT");
  assert.equal(system.stats.randomDraws, 150 + 12 * 6);
  system.dispose();
});

test("black material branch consumes four draws; explicit material arrays use one choice", () => {
  const system = new ShrapnelSystem(options());
  system.spawn(source({ random: () => 0 }));
  assert.equal(system.snapshot().records[0].material, "M14.MAT");
  assert.equal(system.stats.randomDraws, 150 + 12 * 4);
  system.spawn(source({ materials: [first, second], random: () => 0.5 }));
  assert.equal(system.snapshot().records[12].material, "CAR-B.MAT");
  assert.equal(system.stats.randomDraws, 150 + 24 * 4);
  system.dispose();
});

test("sync first movement does not advance age; gravity and drag use native constants", () => {
  const system = new ShrapnelSystem(options());
  system.spawn(source({ timeSyncMs: 80 }));
  const initial = system.snapshot().records[0];
  system.update(12000, 40);
  let record = system.snapshot().records[0];
  assert.equal(record.age, 0);
  assert.equal(record.sync, 0);
  close(record.matrix[12], f(1 + initial.velocity.x * 80 * f(0.001)));
  close(record.matrix[13], f(2 + initial.velocity.y * 80 * f(0.001)));
  const beforeDrag = initial.velocity.clone();
  beforeDrag.y = f(beforeDrag.y - 400 * f(0.00014492753623188405));
  const drag = Math.max(
    f(0.1),
    1 - beforeDrag.length() * f(1 / 1.4) * 40 * f(0.001),
  );
  close(record.velocity.y, f(beforeDrag.y * drag));
  system.update(12040, 40);
  record = system.snapshot().records[0];
  assert.equal(record.age, 40);
  system.dispose();
});

test("strict age greater than 1000 has a final visible frame and next-frame removal", () => {
  const system = new ShrapnelSystem(options());
  system.spawn(source());
  system.update(1000, 1000);
  assert.equal(system.snapshot().records[0].age, 1000);
  assert.equal(system.stats.active, 12);
  system.update(1001, 1);
  assert.equal(system.snapshot().records[0].age, -1);
  assert.equal(system.stats.visible, 12);
  system.update(1002, 1);
  assert.equal(system.stats.active, 0);
  assert.equal(system.stats.visible, 0);
  system.dispose();
});

test("source age angle truncation and X shear preserve rotation and translation conventions", () => {
  const matrix = shrapnelRotation(40, v(0, 0, 1), 2, 3);
  const c = f(Math.round(Math.cos((39 * Math.PI) / 180) * 1e6) / 1e6);
  const s = f(Math.round(Math.sin((39 * Math.PI) / 180) * 1e6) / 1e6);
  close(matrix.elements[0], f(c - 2 * s));
  close(matrix.elements[1], f(s + 2 * c));
  assert.equal(matrix.elements[2], 3);
  assert.equal(matrix.elements[12], 0);
});

test("spark outlet shares source RNG and emits no shrapnel below its own force gate", () => {
  const fragments = new ShrapnelSystem(options());
  const sparks = new SparkSystem({
    random: () => 0.5,
    shrapnelOutlet: (packet) => fragments.spawnFromSpark(packet),
  });
  const input = {
    position: v(),
    velocity: v(0, 2, 0),
    force: v(1, 0, 0),
    sparkiness: 10,
    car: new THREE.Object3D(),
  };
  sparks.spawnWorld(input);
  assert.equal(fragments.stats.created, 0);
  assert.equal(fragments.stats.randomDraws, 150);
  sparks.spawnWorld({ ...input, force: v(10, 0, 0), sparkiness: 1 });
  assert.equal(fragments.stats.created, 12);
  assert.equal(fragments.stats.randomDraws, 222);
  assert.ok(sparks.stats.randomDraws > 72);
  sparks.dispose();
  fragments.dispose();
});

test("missing providers keep source random accounting and expose unresolved rendering", () => {
  const system = new ShrapnelSystem({
    random: () => 0.5,
    carMaterials: () => [],
  });
  system.spawn(source());
  assert.equal(system.stats.active, 12);
  assert.equal(system.stats.visible, 0);
  assert.equal(system.stats.randomDraws, 222);
  assert.match(system.diagnostics.join(), /FRAG4/);
  assert.match(system.diagnostics.join(), /material provider/);
  assert.throws(() => system.spawn(source({ materials: [] })), /Empty/);
  assert.throws(
    () => system.spawn(source({ forceLength: Infinity })),
    /scalar/,
  );
  assert.throws(() => system.update(0, -1), /clock/);
  system.dispose();
  assert.equal(system.group.children.length, 0);
  assert.deepEqual(system.spawn(source()), []);
});
