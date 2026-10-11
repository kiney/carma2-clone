import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { Box3, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from "three";
import { OilRuntime, validNativeOilSurface } from "../src/physics/oil.ts";
import { NativeRandom } from "../src/native-random.ts";
import { parseSmashableEnvironment } from "../src/world-smash.ts";
import { decodeText } from "../src/formats.ts";

const f = Math.fround;
const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const floor = { normal: v(0, 1, 0) };
function source(position = v()) {
  const matrix = new Matrix4().setPosition(position);
  const bounds = new Box3(v(-1, -0.2, -2), v(1, 0.8, 2));
  return {
    identity: {},
    position,
    matrix,
    bounds,
    readPosition: () => position,
    readMatrix: () => matrix,
    readModelBounds: () => bounds,
  };
}
function config(overrides = {}) {
  return {
    delayMs: 0,
    initialHalfSize: 0.2,
    fullSize: [0.35, 0.6],
    growthPerMs: [0.000089, 0.000301],
    friction: [0.01, 0.15],
    smearDistance: [1.5, 2.5],
    material: new MeshBasicMaterial(),
    smearMaterial: new MeshBasicMaterial(),
    ...overrides,
  };
}
function car(position = v()) {
  return {
    state: {
      position,
      velocity: v(),
      angularVelocity: v(),
      orientation: new Quaternion(),
    },
  };
}
function nativeCar(driver = 6) {
  return {
    identity: {},
    driver,
    velocity: v(),
    position: v(),
    damage: { engine: 0, transmission: 0 },
    readVelocity() {
      return this.velocity;
    },
    readPosition() {
      return this.position;
    },
    readDamage() {
      return this.damage;
    },
  };
}
const sampled = (lo, hi, n) => f(f(lo) + (n / 32768) * (f(hi) - f(lo)));

test("authored delay retains live ACT/model providers and two allocator draws", () => {
  const rng = new NativeRandom(99),
    expected = new NativeRandom(99);
  const runtime = new OilRuntime({ random: rng.random });
  const input = source(v(2, 7, 3));
  const spec = config({ delayMs: 300.9 });
  const expectedFull = sampled(0.35, 0.6, expected.nextInteger());
  const expectedGrowth = sampled(0.000089, 0.000301, expected.nextInteger());
  const spill = runtime.queueAuthoredSpill(input, spec, 1000);
  assert.equal(spill.fullSize, expectedFull);
  assert.equal(spill.growRate, expectedGrowth);
  assert.equal(spill.spillTime, 1300);
  assert.equal(spill.yaw, 0);
  assert.equal(rng.state, expected.state);
  let calls = 0;
  const projector = (position, size, body, retained) => {
    calls++;
    assert.equal(body, null);
    assert.equal(retained.source, input);
    assert.equal(retained.source.readModelBounds(), input.bounds);
    assert.equal(retained.source.readMatrix(), input.matrix);
    assert.deepEqual(position.toArray(), [12, 9, -8]);
    assert.equal(size, expectedFull);
    return { position: v(position.x, 0, position.z), ...floor };
  };
  input.position.set(12, 9, -8);
  input.matrix.setPosition(input.position);
  runtime.update(1299, projector);
  assert.equal(calls, 0);
  assert.equal(rng.state, expected.state);
  const yawSample = expected.nextInteger();
  runtime.update(1300, projector);
  assert.equal(calls, 1);
  assert.equal(spill.yaw, (yawSample * 2 * Math.PI) / 32768);
  assert.equal(rng.state, expected.state);
  assert.equal(spill.currentSize, f(0.2));
  assert.equal(spill.mesh.children[0].material, spec.material);
  assert.deepEqual(spill.position.toArray(), [12, 0, -8]);
  assert.deepEqual(
    new Vector3().setFromMatrixPosition(spill.mesh.matrix).toArray(),
    [12, 0, -8],
  );
  runtime.update(1400, projector);
  assert.equal(spill.currentSize, f(f(0.2) + 100 * expectedGrowth));
  runtime.update(100000000, projector);
  assert.equal(spill.currentSize, expectedFull);
  assert.equal(spill.stopTime, 0);
});

test("failed eligible placement consumes yaw while velocity and damage exits do not", () => {
  let draws = 0;
  const runtime = new OilRuntime({ random: () => (++draws, 0) });
  const player = nativeCar(8);
  const spill = runtime.queueAuthoredSpill(source(), config(), 0, {
    nativeCar: player,
  });
  assert.equal(draws, 2);
  player.velocity.x = f(1 / 6.9 / 100);
  runtime.update(1, () => assert.fail("stationarity uses strict bound"));
  assert.equal(draws, 2);
  assert.equal(spill.pending, true);
  player.velocity.x = 0;
  runtime.update(2, () =>
    assert.fail("living player damage oil is ineligible"),
  );
  assert.equal(draws, 2);
  assert.equal(runtime.spills.includes(spill), false);
  player.damage.engine = 99;
  const accepted = runtime.queueAuthoredSpill(source(), config(), 3, {
    nativeCar: player,
  });
  runtime.update(3, () => null);
  assert.equal(draws, 5);
  assert.equal(runtime.spills.includes(accepted), false);
  const nullCar = runtime.queueAuthoredSpill(source(), config(), 4);
  runtime.update(4, () => ({ position: v(), ...floor }));
  assert.equal(draws, 8);
  assert.equal(nullCar.pending, false);
});

test("charged action35 uses installed literal growth bounds and remains repeatable without pCar", () => {
  let draws = 0;
  const runtime = new OilRuntime({ random: () => (++draws, 0) });
  const actor = source();
  const first = runtime.queueChargedSpill(actor, 100);
  const second = runtime.queueChargedSpill(actor, 100);
  assert.ok(first && second);
  assert.equal(draws, 4);
  assert.equal(first.authored, true);
  assert.equal(first.nativeCar, undefined);
  assert.equal(first.initialSize, f(0.2));
  assert.equal(first.growRate, f(0.00009));
  assert.equal(
    first.mesh.children[0].material,
    second.mesh.children[0].material,
  );
  runtime.update(100, () => ({ position: v(), ...floor }));
  assert.equal(draws, 6);
  runtime.update(1100);
  assert.equal(first.currentSize, f(f(0.2) + 1000 * f(0.00009)));
});

test("native overlap consumes slot-major wheel2/3/0/1 draws and retains final smear material", () => {
  let sample = 0;
  const runtime = new OilRuntime({ random: () => sample++ / 32768 });
  const first = config({ friction: [0, 1], smearDistance: [1, 10] });
  const second = config({ friction: [0, 1], smearDistance: [1, 10] });
  runtime.queueAuthoredSpill(source(), first, 0);
  runtime.queueAuthoredSpill(source(), second, 0);
  runtime.update(0, () => ({ position: v(), ...floor }));
  assert.equal(sample, 6); // two allocator draws per record, two placement yaws
  const receiver = car();
  runtime.setWheelBroadphaseMask(receiver, 3);
  const factors = runtime.wheelFactors(receiver, [v(), v(), v(), v()], {
    driver: 8,
  });
  assert.equal(sample, 22); // four wheels * two draws * two overlapping slots
  for (const [ordinal, wheel] of [2, 3, 0, 1].entries()) {
    assert.equal(factors[wheel], sampled(0, 1, 14 + 2 * ordinal));
    assert.equal(
      runtime.wheelOilRemaining(receiver, wheel),
      sampled(1, 10, 15 + 2 * ordinal),
    );
    assert.equal(
      runtime.wheelOilMaterial(receiver, wheel),
      second.smearMaterial,
    );
  }
  runtime.setWheelBroadphaseMask(receiver, 0);
  assert.deepEqual(
    runtime.wheelFactors(receiver, [v(), v(), v(), v()]),
    factors,
  );
  assert.equal(sample, 22);
  assert.deepEqual(
    runtime.wheelFactors(receiver, [v(), v(), v(), v()], { driver: 5 }),
    [1, 1, 1, 1],
  );
  assert.equal(sample, 22);
});

test("zero-width authored ranges consume draws; zero maximum friction suppresses wheel draws", () => {
  let draws = 0;
  const runtime = new OilRuntime({ random: () => (++draws, 0.7) });
  const spec = config({
    fullSize: [1, 1],
    growthPerMs: [0, 0],
    friction: [0.2, 0.2],
    smearDistance: [1, 1],
  });
  runtime.queueAuthoredSpill(source(), spec, 0);
  runtime.update(0, () => ({ position: v(), ...floor }));
  const receiver = car();
  runtime.setWheelBroadphaseMask(receiver, 1);
  assert.equal(
    runtime.wheelFactors(receiver, [v(), null, null, null])[0],
    f(0.2),
  );
  assert.equal(draws, 5);
  runtime.queueAuthoredSpill(
    source(),
    config({
      friction: [0, 0],
      smearDistance: undefined,
      smearMaterial: undefined,
    }),
    0,
  );
  runtime.update(0, () => ({ position: v(), ...floor }));
  runtime.setWheelBroadphaseMask(receiver, 2);
  runtime.wheelFactors(receiver, [v(), v(), v(), v()]);
  assert.equal(draws, 8);
});

test("authored and command oil share32 slots; future timestamp replacement preserves first tie and pending pose", () => {
  const runtime = new OilRuntime({ random: () => 0 });
  const earliest = runtime.queueAuthoredSpill(source(v(6, 0, 7)), config(), 0, {
    surface: floor,
  });
  runtime.update(0);
  for (let i = 1; i < 32; i++)
    runtime.queueAuthoredSpill(source(), config({ delayMs: 10000 }), 10);
  const receiver = car();
  runtime.setWheelBroadphaseMask(receiver, 1);
  const replacing = runtime.queueAuthoredSpill(
    source(v(100, 0, 100)),
    config({ delayMs: 5000 }),
    20,
  );
  assert.equal(runtime.spills.length, 32);
  assert.equal(runtime.spills[0], replacing);
  assert.equal(runtime.spills.includes(earliest), false);
  assert.deepEqual(replacing.position.toArray(), [6, 0, 7]);
  assert.equal(replacing.mesh.visible, false);
  assert.equal(
    runtime.wheelFactors(receiver, [
      v(6 * 6.9, 0, 7 * 6.9),
      null,
      null,
      null,
    ])[0],
    f(0.01),
  );
  // All timestamps are future relative to21: native keeps initial slot0.
  const command = runtime.queueSpill(null, v(), 21, { surface: floor });
  assert.equal(runtime.spills[0], command);
  assert.equal(runtime.spills.includes(replacing), false);
});

test("car duplicate gate compares source ACT and delayed timestamp; null-car world calls remain repeatable", () => {
  const runtime = new OilRuntime({ random: () => 0 });
  const actor = source();
  const first = runtime.queueAuthoredSpill(
    actor,
    config({ delayMs: 300 }),
    1000,
    { nativeCar: nativeCar(6) },
  );
  assert.ok(first);
  assert.equal(
    runtime.queueAuthoredSpill(actor, config(), 6299, {
      nativeCar: nativeCar(8),
    }),
    null,
  );
  assert.ok(
    runtime.queueAuthoredSpill(actor, config(), 6300, {
      nativeCar: nativeCar(6),
    }),
  );
  assert.ok(runtime.queueAuthoredSpill(actor, config(), 6300));
  assert.ok(runtime.queueAuthoredSpill(actor, config(), 6300));
});

test("native uint32 delay comparison and retained invalidated wheel fields stay explicit", () => {
  const runtime = new OilRuntime({ random: () => 0 });
  const wrapping = runtime.queueAuthoredSpill(
    source(),
    config({ delayMs: 20 }),
    0xfffffff0,
  );
  assert.equal(wrapping.spillTime, 4);
  runtime.update(0xfffffff1, () => null);
  assert.equal(runtime.spills[0], null);
  const receiver = car();
  // Source graphics mask is retained from before the invalidating spill pass.
  runtime.setWheelBroadphaseMask(receiver, 1);
  assert.equal(
    runtime.wheelFactors(receiver, [v(), null, null, null])[0],
    f(0.01),
  );
  runtime.setWheelBroadphaseMask(receiver, 0);
  runtime.consumeOilMark(receiver, 0, 100);
  assert.equal(runtime.wheelFactors(receiver, [v(), null, null, null])[0], 1);
});

test("source Float32 normal threshold and full tilted basis are retained without quaternion normalization", () => {
  const below = f(f(0.97) - 2 ** -24);
  assert.equal(validNativeOilSurface({ normal: v(0, below, 0) }), false);
  assert.equal(validNativeOilSurface({ normal: v(0, f(0.97), 0) }), true);
  const runtime = new OilRuntime({ random: () => 0 });
  const normal = v(f(0.1), f(0.98), f(0.17));
  const spill = runtime.queueAuthoredSpill(source(), config(), 0);
  runtime.update(0, () => ({ position: v(4, 5, 6), normal }));
  const x = new Vector3().setFromMatrixColumn(spill.mesh.matrix, 0);
  const y = new Vector3().setFromMatrixColumn(spill.mesh.matrix, 1);
  const z = new Vector3().setFromMatrixColumn(spill.mesh.matrix, 2);
  assert.deepEqual(x.toArray(), [normal.y, -normal.x, 0]);
  assert.deepEqual(y.toArray(), normal.toArray());
  assert.deepEqual(z.toArray(), [0, -normal.z, normal.y]);
  assert.notEqual(x.length(), 1);
});

test("native car COM displacement freezes size and borrowed materials survive runtime disposal", () => {
  const runtime = new OilRuntime({ random: () => 0 });
  const owner = nativeCar(6),
    spec = config();
  let disposed = 0;
  spec.material.addEventListener("dispose", () => disposed++);
  spec.smearMaterial.addEventListener("dispose", () => disposed++);
  const spill = runtime.queueAuthoredSpill(source(v(20, 0, 0)), spec, 0, {
    nativeCar: owner,
  });
  runtime.update(0, () => ({ position: v(), ...floor }));
  owner.position.x = 0.1;
  runtime.update(100);
  const lastSize = spill.currentSize;
  owner.position.x = 0.6;
  runtime.update(200);
  assert.equal(spill.stopTime, 200);
  assert.equal(spill.currentSize, lastSize);
  runtime.update(999999);
  assert.equal(spill.mesh.visible, true);
  assert.equal(spill.currentSize, lastSize);
  runtime.dispose();
  assert.equal(disposed, 0);
});

test("missing source/model and nonfinite authored parameters fail before RNG", () => {
  let draws = 0;
  const runtime = new OilRuntime({ random: () => (++draws, 0) });
  assert.throws(
    () => runtime.queueAuthoredSpill({ identity: {} }, config(), 0),
    /provider/,
  );
  assert.throws(
    () =>
      runtime.queueAuthoredSpill(source(), config({ fullSize: [0, NaN] }), 0),
    /parameters/,
  );
  assert.throws(
    () =>
      runtime.queueAuthoredSpill(
        source(),
        config({ smearDistance: undefined }),
        0,
      ),
    /parameters/,
  );
  assert.throws(() => runtime.setWheelBroadphaseMask(car(), -1), /mask/);
  assert.equal(draws, 0);
});

let originals = true;
try {
  await access(
    new URL("../carma2_orig/data/PEDS/settings.txt", import.meta.url),
  );
} catch {
  originals = false;
}
test(
  "original Stock/Advanced GIBSLICK data exercises authored shared oil/material parameters",
  { skip: !originals },
  async () => {
    for (const tree of ["data", "adv_data"]) {
      const text = decodeText(
        await readFile(
          new URL(`../carma2_orig/${tree}/PEDS/settings.txt`, import.meta.url),
        ),
      );
      const rows = text
        .slice(text.indexOf("// GIB SLICK!"))
        .split(/\r?\n/)
        .map((l) => l.split("//")[0].trim())
        .filter(Boolean)
        .slice(0, 6);
      const fixture = `1\n0\nTEST.MAT\nnochange\n0\n0\n0\n0\n${rows.join("\n")}\n0\n0\n0\n0\nnone\n0\n9\n8\n7\n6`;
      const slick = parseSmashableEnvironment(fixture)[0].connotations.slick;
      assert.equal(slick.material, "GIBSLICK");
      assert.equal(slick.secondMaterial, "GIBSMEAR.MAT");
      assert.deepEqual(slick.firstPair, [0.2, 1]);
      const spec = config({
        delayMs: slick.first[0],
        growthPerMs: slick.first.slice(1),
        initialHalfSize: slick.second[0],
        fullSize: slick.second.slice(1),
        friction: slick.firstPair,
        smearDistance: slick.secondPair,
      });
      const runtime = new OilRuntime({ random: () => 0 });
      const spill = runtime.queueAuthoredSpill(source(), spec, 100);
      runtime.update(399, () => assert.fail("original300ms delay"));
      runtime.update(400, () => ({ position: v(), ...floor }));
      assert.equal(spill.currentSize, f(0.001));
      assert.equal(spill.fullSize, f(0.05));
      runtime.update(1400);
      assert.equal(spill.currentSize, f(f(0.001) + 1000 * f(0.00001)));
      const receiver = car();
      runtime.setWheelBroadphaseMask(receiver, 1);
      assert.equal(
        runtime.wheelFactors(receiver, [v(), null, null, null])[0],
        f(0.2),
      );
      assert.equal(runtime.wheelOilRemaining(receiver, 0), 1);
      assert.equal(runtime.wheelOilMaterial(receiver, 0), spec.smearMaterial);
      await access(
        new URL(
          `../carma2_orig/${tree}/PEDS/GIBLETS/PIX8/GIBSLICK.PIX`,
          import.meta.url,
        ),
      );
      await access(
        new URL(
          `../carma2_orig/${tree}/MATERIAL/GIBSMEAR.MAT`,
          import.meta.url,
        ),
      );
    }
  },
);
