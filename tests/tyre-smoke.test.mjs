import test from "node:test";
import assert from "node:assert/strict";
import { Matrix4, Vector3 } from "three";
import { NativeRandom, sharedNativeRandom } from "../src/native-random.ts";
import {
  NativeTyreEffects,
  selectNativeTyreSmokeWheel,
} from "../src/physics/tyre-smoke.ts";

const f32 = Math.fround;
function stream(values) {
  let count = 0;
  const random = () => {
    assert.ok(count < values.length, "unexpected CRT consumption");
    return values[count++];
  };
  return {
    random,
    get count() {
      return count;
    },
  };
}
function input(overrides = {}) {
  return {
    owner: {},
    driver: 8,
    wheel: 0,
    quotient: 5,
    modifier: { tyreSound: 0, smokeType: 1 },
    wheelPositionPhysics: new Vector3(1, 2, 3),
    oldSuspensionDistance: 0.5,
    actorPhysicsMatrix: new Matrix4().makeTranslation(69, 138, -69),
    omegaBody: new Vector3(0, 2, 0),
    velocityCarSpace: new Vector3(1, 4, -2),
    supportNormalBody: new Vector3(0, 1, 0),
    cachedSoundVelocity: new Vector3(7, 8, 9),
    timeSyncMs: 17,
    ...overrides,
  };
}
function effects(samples, isPlaying = () => false) {
  const rng = stream(samples),
    sounds = [],
    stopped = [];
  const system = new NativeTyreEffects({
    random: rng.random,
    isPlaying,
    startSound(packet) {
      sounds.push(packet);
      return sounds.length + 10;
    },
    stopSound(tag) {
      stopped.push(tag);
    },
  });
  return { system, rng, sounds, stopped };
}

test("tyre producer consumes the channel draw before rejected quotient/material", () => {
  for (const overrides of [
    { quotient: f32(5 - 2 ** -21) },
    { modifier: { tyreSound: -1, smokeType: 1 } },
  ]) {
    const fixture = effects([0.75]);
    assert.deepEqual(fixture.system.produce(input(overrides)), {
      channel: 1,
      admitted: false,
    });
    assert.equal(fixture.rng.count, 1);
  }
  const fixture = effects([0, 0.25]);
  assert.equal(fixture.system.produce(input()).admitted, false);
  assert.equal(fixture.rng.count, 2);
});

test("inclusive quotient5 admission produces source sound then tangent type4 puff", () => {
  const fixture = effects([0.25, 0, 0.5, 0.9]);
  const source = input();
  const packet = fixture.system.produce(source);
  assert.equal(packet.admitted, true);
  assert.equal(fixture.rng.count, 4);
  assert.equal(packet.sound, fixture.sounds[0]);
  assert.equal(packet.sound.volume, 50);
  assert.equal(packet.sound.pitch, 65536);
  assert.equal(packet.sound.speed, 65536);
  assert.equal(packet.sound.repeats, 1);
  assert.equal(packet.sound.soundId, 9004);
  assert.deepEqual(packet.sound.velocity.toArray(), [7, 8, 9]);
  assert.deepEqual(
    packet.puff.position.toArray(),
    [70, 139.5, -66].map((n) => f32(f32(n) * f32(1 / 6.9))),
  );
  assert.deepEqual(packet.puff.velocity.toArray(), [
    f32(6 + f32(6.9)),
    0,
    f32(-2 - 2 * f32(6.9)),
  ]);
  assert.equal(packet.puff.strength, f32(5 * f32(0.04)));
  assert.equal(packet.puff.decay, 1);
  assert.equal(packet.puff.type, 4);
  assert.equal(packet.puff.timeSyncMs, 17);
  assert.deepEqual(source.wheelPositionPhysics.toArray(), [1, 2, 3]);
  assert.deepEqual(source.omegaBody.toArray(), [0, 2, 0]);
});

test("only source smokeType1 emits tyre puffs and tyreSound is an eligibility sentinel", () => {
  for (const smokeType of [0, 2, 3]) {
    const fixture = effects([0, 0, 0, 0]);
    const packet = fixture.system.produce(
      input({ modifier: { tyreSound: 123, smokeType } }),
    );
    assert.equal(packet.sound.soundId, 9000);
    assert.equal(packet.puff, undefined);
    assert.equal(fixture.rng.count, 4);
  }
});

test("shared voices suppress restarts except a different local-human owner", () => {
  const fixture = effects(
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    () => fixture.sounds.length > 0,
  );
  const first = input();
  fixture.system.produce(first);
  const same = fixture.system.produce(first);
  assert.equal(same.sound, undefined);
  assert.ok(same.puff);
  const opponent = fixture.system.produce(input({ driver: 6 }));
  assert.equal(opponent.sound, undefined);
  assert.equal(fixture.system.channels[0].owner, first.owner);
  const local = input();
  assert.ok(fixture.system.produce(local).sound);
  assert.equal(fixture.system.channels[0].owner, local.owner);
  assert.equal(fixture.rng.count, 12);
  fixture.system.stopOwner(first.owner);
  assert.deepEqual(fixture.stopped, []);
  fixture.system.stopOwner(local.owner);
  assert.deepEqual(fixture.stopped, [12]);
  assert.equal(fixture.system.channels[0].tag, 12);
  assert.equal(fixture.system.channels[0].owner, local.owner);
});

test("rear/front caller chooses one wheel even below the skidmark20/60 gate", () => {
  const rng = stream([0.9, 0]);
  assert.deepEqual(
    selectNativeTyreSmokeWheel(
      { axle: 0, demand: 8, capacities: [1, 1], reduction: 0.7 },
      rng.random,
    ),
    { wheel: 0, quotient: 7 },
  );
  assert.deepEqual(
    selectNativeTyreSmokeWheel(
      { axle: 1, demand: 8, capacities: [1, 1], reduction: 0.7 },
      rng.random,
    ),
    { wheel: 3, quotient: 7 },
  );
  assert.equal(rng.count, 2);
  const fixture = effects([0.9, 0, 0, 0, 0]);
  const selection = fixture.system.selectAxle({
    axle: 0,
    demand: 8,
    capacities: [1, 1],
    reduction: 0.7,
  });
  const packet = fixture.system.produce(input(selection));
  assert.equal(packet.sound.volume, 70);
  assert.equal(fixture.rng.count, 5);
});

test("caller preserves its rejected capacity draw and strict residual branch", () => {
  const rng = stream([0.9, 0.9]);
  assert.equal(
    selectNativeTyreSmokeWheel(
      {
        axle: 0,
        demand: 3,
        capacities: [f32(0.1 - 2 ** -27), 1],
        reduction: 0.7,
      },
      rng.random,
    ),
    undefined,
  );
  assert.equal(rng.count, 1);
  assert.ok(
    selectNativeTyreSmokeWheel(
      { axle: 0, demand: 3, capacities: [0.1, 1], reduction: 0.7 },
      rng.random,
    ),
  );
  assert.equal(rng.count, 2, "Float32(.1) is above source double .1");
  const noDraw = () =>
    assert.fail("single-saturation branch must not select randomly");
  assert.equal(
    selectNativeTyreSmokeWheel(
      { axle: 0, demand: 2, capacities: [1, 3], reduction: 1 },
      noDraw,
    ),
    undefined,
  );
  assert.deepEqual(
    selectNativeTyreSmokeWheel(
      { axle: 0, demand: 2, capacities: [1, 2], reduction: 0.5 },
      noDraw,
    ),
    { wheel: 1, quotient: 0.75 },
  );
  assert.deepEqual(
    selectNativeTyreSmokeWheel(
      { axle: 1, demand: 2, capacities: [2, 1], reduction: 0.5 },
      noDraw,
    ),
    { wheel: 2, quotient: 0.75 },
  );
});

test("production default uses the shared CRT even for a rejected producer", () => {
  const saved = sharedNativeRandom.state;
  try {
    sharedNativeRandom.seed(19);
    const expected = new NativeRandom(19);
    expected.nextInteger();
    new NativeTyreEffects({
      isPlaying: () => false,
      startSound: () => 0,
      stopSound() {},
    }).produce(input({ quotient: 0 }));
    assert.equal(sharedNativeRandom.state, expected.state);
  } finally {
    sharedNativeRandom.seed(saved);
  }
});

test("original Eagle and Buggy wheel packets retain source physics units and model-origin lever", async (t) => {
  const { originalCar } = await import("./support/original-car.mjs");
  const { DamageSystem } = await import("../src/damage.ts");
  const { createSimulatedCar } = await import("../src/physics/simulation.ts");
  for (const name of ["EAGLE3", "buggy"]) {
    let data;
    try {
      data = await originalCar(name);
    } catch (error) {
      if (error.code === "ENOENT") {
        t.skip("Original car installation absent");
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
      new Vector3(3, 2, -1),
      0,
      true,
    );
    const wheel = 2,
      wpos = car.motion.wheelPositions[wheel],
      oldd = f32(car.motion.suspensionLength[1] / 2);
    const fixture = effects([0, 0, 0, 0]);
    const packet = fixture.system.produce(
      input({
        owner: car,
        wheel,
        wheelPositionPhysics: wpos,
        oldSuspensionDistance: oldd,
        actorPhysicsMatrix: new Matrix4().makeTranslation(
          3 * 6.9,
          2 * 6.9,
          -6.9,
        ),
        omegaBody: new Vector3(1, 0, 0),
        velocityCarSpace: new Vector3(),
      }),
    );
    const point = new Vector3(
      f32(wpos.x),
      f32(f32(wpos.y) - oldd),
      f32(wpos.z),
    );
    const expectedP = point.clone().add(new Vector3(3 * 6.9, 2 * 6.9, -6.9));
    expectedP.set(
      ...expectedP.toArray().map((v) => f32(f32(v) * f32(1 / 6.9))),
    );
    assert.deepEqual(packet.puff.position.toArray(), expectedP.toArray());
    assert.deepEqual(packet.puff.velocity.toArray(), [0, 0, point.y]);
    assert.notEqual(point.y, f32(point.y - car.motion.centerOfMass.y));
  }
});
