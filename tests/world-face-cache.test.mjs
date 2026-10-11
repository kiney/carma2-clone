import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Matrix4, Vector3, Quaternion } from "three";
import {
  NativeWorldFaceCache,
  nativeWheelExtendedBounds,
} from "../src/physics/world-face-cache.ts";
import { originalCar } from "./support/original-car.mjs";
import { createSimulatedCar } from "../src/physics/simulation.ts";
import { DamageSystem } from "../src/damage.ts";

const f = Math.fround;
const box = () => new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
const translation = (x) => new Matrix4().makeTranslation(x, 0, 0);
const input = (x = 0, old = x) => ({
  bounds: box(),
  matrix: translation(x),
  committedMatrix: translation(old),
});
const near = (a, b) =>
  assert.ok(Math.abs(a - b) < 2e-6, `${a} differs from ${b}`);

test("pose expansion uses committed-to-candidate delta and inverse cube, independently of velocity", () => {
  const cache = new NativeWorldFaceCache(),
    state = cache.createState();
  let query;
  cache.get(
    state,
    { ...input(1, 0), velocity: new Vector3(999, 0, 0) },
    (value) => {
      query = value;
      return ["face"];
    },
  );
  // O=0,A=1: old-to-live shift=-1; its inverse cube shifts +3.
  // union([-2,0],[-1,1])±.0025, union([2,4]), then ±.02.
  near(query.bounds.min.x, f(f(-2 - f(0.0025)) - f(0.02)));
  near(query.bounds.max.x, f(4 + f(0.02)));
  near(query.bounds.min.y, f(f(-1 - f(0.0025)) - f(0.02)));
  assert.equal(query.matrix.elements[12], 1);
  assert.equal(state.inverse.elements[12], -1);
  assert.deepEqual(cache.read(state), ["face"]);
});

test("rotation expansion uses an oriented box and reversed Three matrix products", () => {
  const cache = new NativeWorldFaceCache(),
    state = cache.createState();
  const shape = new Box3(new Vector3(-2, -0.1, -0.1), new Vector3(2, 0.1, 0.1));
  const candidate = new Matrix4().compose(
    new Vector3(7, 0, 9),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
    new Vector3(1, 1, 1),
  );
  const committed = new Matrix4().makeTranslation(7, 0, 9);
  cache.get(
    state,
    { bounds: shape, matrix: candidate, committedMatrix: committed },
    () => [],
  );
  near(state.bounds.min.x, -2.0225);
  near(state.bounds.max.x, 2.0225);
  near(state.bounds.min.z, -2.0225);
  near(state.bounds.max.z, 2.0225);
});

test("strict containment reuses stationary and interior translated queries but refreshes equality", () => {
  const cache = new NativeWorldFaceCache(),
    state = cache.createState();
  let calls = 0;
  const collect = () => [++calls];
  cache.get(state, input(), collect);
  cache.get(state, input(), collect);
  assert.equal(calls, 1);
  cache.get(state, input(0.01), collect);
  assert.equal(calls, 1);
  state.bounds.max.x = 1;
  cache.get(state, input(), collect);
  assert.equal(calls, 2, "touching max plane is not strict containment");
  state.bounds.min.x = -1;
  cache.get(state, input(), collect);
  assert.equal(calls, 3, "touching min plane also refreshes");
});

test("capacity is shared and an exactly full ring repeats collection before committing its epoch", () => {
  const cache = new NativeWorldFaceCache(),
    a = cache.createState(),
    b = cache.createState();
  const maximums = [];
  cache.get(a, input(), (_, max) => {
    maximums.push(max);
    return Array.from({ length: 280 }, (_, i) => `a${i}`);
  });
  cache.get(b, input(), (_, max) => {
    maximums.push(max);
    return Array.from({ length: max }, (_, i) => `b${i}`);
  });
  assert.deepEqual(maximums, [300, 20, 300]);
  assert.equal(cache.count, 300);
  assert.equal(cache.epoch, 2);
  assert.deepEqual([b.start, b.end, b.reference], [0, 300, 2]);
  assert.equal(cache.valid(a), false);
  assert.equal(cache.read(b).length, 300);
});

test("previous epoch entries survive only strictly beyond the overwritten prefix", () => {
  const cache = new NativeWorldFaceCache();
  const fill = (length) => (_, max) =>
    Array.from({ length: Math.min(max, length) }, (_, i) => i);
  const prefix = cache.createState(),
    tail = cache.createState(),
    rollover = cache.createState();
  cache.get(prefix, input(), fill(200));
  cache.get(tail, input(), fill(90));
  cache.get(rollover, input(), fill(10));
  assert.equal(cache.epoch, 2);
  assert.equal(cache.count, 10);
  assert.equal(cache.valid(tail), true);
  assert.equal(cache.read(tail).length, 90);
  tail.start = 10;
  assert.equal(cache.valid(tail), false);
});

test("cache reference remains uint16 while native epoch comparison remains signed integer", () => {
  const cache = new NativeWorldFaceCache(),
    state = cache.createState();
  cache.epoch = 65535;
  cache.get(state, input(), (_, max) => Array(max).fill(1));
  assert.equal(cache.epoch, 65536);
  assert.equal(state.reference, 0);
  assert.equal(
    cache.valid(state),
    false,
    "native does not wrap the DWORD epoch comparison",
  );
});

test("raw world-space flag uses velocity .12, .15 query padding and .005 cached inset", () => {
  const cache = new NativeWorldFaceCache(),
    state = cache.createState();
  let query;
  cache.get(
    state,
    {
      ...input(),
      flags: 1,
      worldBounds: box(),
      velocity: new Vector3(-10, 20, 0),
    },
    (value) => {
      query = value;
      return [];
    },
  );
  near(query.bounds.min.x, -2.35);
  near(query.bounds.max.x, 1.15);
  near(query.bounds.min.y, -1.15);
  near(query.bounds.max.y, 3.55);
  near(state.bounds.min.x, query.bounds.min.x + 0.005);
  near(state.bounds.max.y, query.bounds.max.y - 0.005);
  assert.deepEqual(query.matrix.elements, new Matrix4().elements);
});

test("disabled and parent-sharing flags neither gather nor consume additional slots", () => {
  const cache = new NativeWorldFaceCache(),
    parent = cache.createState(),
    child = cache.createState();
  cache.get(parent, input(), () => ["p"]);
  const never = () => assert.fail("unexpected query");
  assert.deepEqual(cache.get(child, { ...input(), flags: 2, parent }, never), [
    "p",
  ]);
  assert.equal(cache.count, 1);
  assert.deepEqual(cache.get(child, { ...input(), flags: 0x40 }, never), []);
  assert.equal(child.start, child.end);
});

test("no-model flag exposes gather false then clears this object's face range", () => {
  const cache = new NativeWorldFaceCache(),
    state = cache.createState();
  let gather;
  assert.deepEqual(
    cache.get(state, { ...input(), flags: 0x80 }, (_, max, value) => {
      gather = value;
      return [1];
    }),
    [],
  );
  assert.equal(gather, false);
  assert.equal(state.start, state.end);
});

test("suspension extension selects front/rear native heights and leaves other five planes untouched", () => {
  const shape = box();
  const wheels = [
    new Vector3(9, 0, 0),
    new Vector3(9, -999, 0),
    new Vector3(9, -6.9, 0),
    new Vector3(9, -999, 0),
  ];
  const result = nativeWheelExtendedBounds(shape, wheels, [13.8, 3.45]);
  near(result.min.y, -2);
  assert.deepEqual(
    result.min.toArray().filter((_, i) => i !== 1),
    [-1, -1],
  );
  assert.deepEqual(result.max.toArray(), [1, 1, 1]);
  assert.equal(shape.min.y, -1);
});

test("installed Eagle and New Hawk motion fields supply native wheel-extended bb2", async (t) => {
  for (const name of ["EAGLE3", "newhawk"]) {
    let data;
    try {
      data = await originalCar(name);
    } catch (error) {
      if (error.code === "ENOENT") {
        t.skip("Local original installation absent");
        return;
      }
      throw error;
    }
    const damage = new DamageSystem(data.assets, data.group, data.text);
    await damage.init();
    const car = createSimulatedCar(
      data.group,
      data.text,
      damage,
      new Vector3(),
      0,
      true,
    );
    const shape = new Box3().setFromPoints(
      car.hulls.flatMap((hull) => hull.vertices),
    );
    const result = nativeWheelExtendedBounds(
      shape,
      car.motion.wheelPositions,
      car.motion.suspensionLength,
    );
    const rear = f(
      (f(car.motion.wheelPositions[0].y) - f(car.motion.suspensionLength[0])) *
        f(1 / 6.9),
    );
    const front = f(
      (f(car.motion.wheelPositions[2].y) - f(car.motion.suspensionLength[1])) *
        f(1 / 6.9),
    );
    assert.equal(result.min.y, Math.min(shape.min.y, rear, front));
    assert.ok(
      result.min.y < shape.min.y,
      `${name} includes suspension travel below bb1`,
    );
  }
});
