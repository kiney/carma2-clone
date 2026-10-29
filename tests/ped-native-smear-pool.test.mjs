import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { SkidMarkSystem } from "../src/skidmarks.ts";
import {
  accumulateNativePedWorldSmear,
  consumeNativePedWorldSmear,
} from "../src/ped-native-blood-phases.ts";

const f = Math.fround;
function fixture() {
  const road = new THREE.MeshBasicMaterial(),
    blood = new THREE.MeshBasicMaterial();
  road.name = "SKIDMARK.MAT";
  blood.name = "PEDSMEAR";
  const system = new SkidMarkSystem({
    resolveMaterial: (name) => (name === road.name ? road : undefined),
  });
  const wheel = (car, x) =>
    system.singlePhysicsWheelSample({
      car,
      wheel: 0,
      requested: true,
      position: new THREE.Vector3(x, 0, 0),
      normal: new THREE.Vector3(0, 1, 0),
      skidMaterial: road.name,
      contact: { present: true },
    });
  return { system, road, blood, wheel };
}
const section = (extra = {}) => ({
  id: -1,
  start: [0, 0, 0],
  end: [0, 0, 0],
  position: [0.1, 0, 0],
  previousPosition: [0, 0, 0],
  normal: [0, 1, 0],
  previousNormal: [0, 1, 0],
  width: f(0.2),
  totalDistance: 0,
  ...extra,
});
const nextFloat = (value, offset) => {
  const buffer = new ArrayBuffer(4),
    view = new DataView(buffer);
  view.setFloat32(0, value, true);
  view.setUint32(0, view.getUint32(0, true) + offset, true);
  return view.getFloat32(0, true);
};
const widthOf = (mark) => Math.hypot(...mark.matrix.slice(8, 11));

test("native pedestrian sections and wheels share one100-slot pool and insertion cursor", () => {
  const h = fixture(),
    car = new THREE.Group();
  assert.equal(h.wheel(car, 0).status, "armed");
  assert.equal(h.wheel(car, 0.1).id, 0);
  const ped = h.system.nativeSection(
    section({ previousPosition: [1, 0, 0], position: [1.1, 0, 0] }),
    h.blood,
  );
  assert.equal(ped.id, 1);
  assert.equal(h.system.group.children.length, 100);
  assert.equal(h.system.snapshot().marks.length, 100);
  for (let i = 0; i < 99; i++)
    assert.equal(
      h.system.nativeSection(
        section({ previousPosition: [i + 2, 0, 0], position: [i + 2.1, 0, 0] }),
        h.blood,
      ).id,
      (i + 2) % 100,
    );
  assert.equal(h.system.debug.active, 100);
  assert.equal(h.system.debug.cursor, 1);
  assert.equal(h.system.debug.overwrites, 1);
  assert.equal(h.system.snapshot().marks[0].material, "PEDSMEAR");
  assert.equal(
    h.wheel(car, 0.2).id,
    1,
    "wheel sees its overwritten source slot material and uses shared cursor",
  );
  assert.equal(h.system.snapshot().marks[1].material, "SKIDMARK.MAT");
  const next = h.system.nativeSection(
    section({ ...ped, previousPosition: [1.1, 0, 0], position: [1.2, 0, 0] }),
    h.blood,
  );
  assert.equal(next.id, 2, "pedestrian also observes shared slot overwrite");
  assert.equal(h.system.debug.overwrites, 3);
  assert.equal(h.system.group.children.length, 100);
  h.system.dispose();
  h.road.dispose();
  h.blood.dispose();
});

test("variable native width is Float32, controls UV scale and survives section extension", () => {
  const h = fixture(),
    first = section({ width: 0.2 });
  const a = h.system.nativeSection(first, h.blood);
  assert.deepEqual(a, {
    stop: false,
    id: 0,
    start: [0, 0, 0],
    end: [f(0.1), 0, 0],
  });
  let mark = h.system.snapshot().marks[0];
  assert.equal(widthOf(mark), f(0.2));
  assert.equal(mark.uv[0], 0);
  assert.equal(mark.uv[4], f(f(0.1) / f(0.2)));
  const b = h.system.nativeSection(
    section({
      ...a,
      previousPosition: [0.1, 0, 0],
      position: [0.3, 0, 0],
      width: 0.21,
    }),
    h.blood,
  );
  assert.equal(b.id, a.id);
  assert.equal(h.system.debug.extended, 1);
  assert.deepEqual(b.start, a.start);
  assert.deepEqual(
    b.end,
    a.end,
    "native extension leaves source section history endpoints unchanged",
  );
  mark = h.system.snapshot().marks[0];
  assert.equal(widthOf(mark), f(0.21));
  assert.equal(mark.uv[0], 0, "LastChance supplies total texture distance0");
  assert.equal(mark.uv[4], f(f(0.3) / f(0.21)));
  const changed = h.system.nativeSection(
    section({
      ...b,
      previousPosition: [0.3, 0, 0],
      position: [0.4, 0, 0],
      width: 0.4,
    }),
    h.blood,
  );
  assert.equal(
    changed.id,
    1,
    "width ratio outside source factor2 starts a new section",
  );
  assert.deepEqual(changed.start, [f(0.3), 0, 0]);
  assert.equal(widthOf(h.system.snapshot().marks[1]), f(0.4));
  h.system.dispose();
  h.road.dispose();
  h.blood.dispose();
});

test("native section continuity accepts exact.997 and.01, rejects strict outside values", () => {
  for (const extra of [
    { normal: [0, f(0.997), 0] },
    { position: [0.1, f(0.01), 0] },
  ]) {
    const h = fixture();
    assert.equal(h.system.nativeSection(section(extra), h.blood).stop, false);
    assert.equal(h.system.debug.created, 1);
    h.system.dispose();
    h.road.dispose();
    h.blood.dispose();
  }
  for (const extra of [
    { normal: [0, nextFloat(0.997, -1), 0] },
    { position: [0.1, nextFloat(0.01, 1), 0] },
  ]) {
    const h = fixture(),
      start = [1, 2, 3],
      end = [4, 5, 6];
    const result = h.system.nativeSection(
      section({ id: 12, start, end, ...extra }),
      h.blood,
    );
    assert.deepEqual(result, { stop: true, id: -1, start, end });
    assert.equal(h.system.debug.created, 0);
    assert.equal(h.system.debug.cursor, 0);
    h.system.dispose();
    h.road.dispose();
    h.blood.dispose();
  }
});

test("wide pedestrian marks retain the source fixed.05 turn tolerance", () => {
  const h = fixture();
  const a = h.system.nativeSection(section({ width: 0.4 }), h.blood);
  const b = h.system.nativeSection(
    section({
      ...a,
      width: 0.4,
      previousPosition: [0.1, 0, 0],
      position: [0.2, 0, 0.06],
    }),
    h.blood,
  );
  assert.equal(b.stop, false);
  assert.equal(b.id, 1);
  assert.equal(h.system.debug.extended, 0);
  h.system.dispose();
  h.road.dispose();
  h.blood.dispose();
});

test("native direct sections omit wheel spacing and preserve tiny-segment source transform", () => {
  const h = fixture();
  const a = h.system.nativeSection(
    section({ position: [0.0001, 0, 0] }),
    h.blood,
  );
  assert.equal(a.stop, false);
  assert.equal(a.id, 0);
  const mark = h.system.snapshot().marks[0];
  assert.equal(mark.matrix[0], f(0.001));
  assert.equal(mark.matrix[5], 1);
  assert.equal(mark.matrix[10], f(0.001));
  assert.equal(h.system.debug.created, 1);
  h.system.dispose();
  h.road.dispose();
  h.blood.dispose();
});

test("actual process smear consumer uses shared native sections and retained cache fields", () => {
  const h = fixture(),
    bytes = new Uint8Array(0x12c),
    view = new DataView(bytes.buffer);
  const host = { skidSection: (s) => h.system.nativeSection(s, h.blood) };
  const contact = (x, z) =>
    accumulateNativePedWorldSmear(bytes, {
      goreLevel: 2,
      volumeGravity: null,
      hitPoints: 0,
      otherPresent: false,
      point: [x, 0, z],
      velocity: [1, 0, 0],
      face: { normal: [0, 1, 0] },
    });
  contact(0, 0);
  contact(0, 0.2);
  consumeNativePedWorldSmear(bytes, true, host);
  assert.equal(h.system.debug.active, 0);
  view.setUint32(0xc4, view.getUint32(0xc4, true) & ~2, true);
  contact(0.1, 0);
  contact(0.1, 0.2);
  const emitted = consumeNativePedWorldSmear(bytes, true, host);
  assert.deepEqual(emitted.requiredProviders, []);
  assert.equal(emitted.emitted, 1);
  assert.equal(view.getInt16(0xc8, true), 0);
  assert.equal(view.getFloat32(0xcc, true), 0);
  assert.equal(view.getFloat32(0xd8, true), f(0.1));
  assert.equal(widthOf(h.system.snapshot().marks[0]), f(f(0.2) + f(0.01)));
  assert.equal(h.system.group.children.length, 100);
  h.system.dispose();
  h.road.dispose();
  h.blood.dispose();
});

test("invalid source state cannot mutate the pool or turn failure into a successful stop", () => {
  const h = fixture();
  for (const extra of [
    { width: 0 },
    { width: NaN },
    { id: 40000 },
    { position: [NaN, 0, 0] },
  ])
    assert.throws(
      () => h.system.nativeSection(section(extra), h.blood),
      /Invalid/,
    );
  assert.throws(
    () => h.system.nativeSection(section(), null),
    /actual material/,
  );
  assert.equal(h.system.debug.created, 0);
  h.system.dispose();
  assert.throws(() => h.system.nativeSection(section(), h.blood), /disposed/);
  h.road.dispose();
  h.blood.dispose();
});
