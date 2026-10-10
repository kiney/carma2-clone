import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { NativeOpponentSpeedController } from "../src/physics/opponent-speed.ts";

const input = (overrides = {}) => ({
  desiredSpeed: 10,
  velocity: new Vector3(),
  factor: 1,
  engineDamage: 0,
  transmissionDamage: 0,
  mass: 2,
  dtMs: 100,
  ...overrides,
});

test("path-speed PID uses model velocity converted by 6.9 and stores pre-mass history", () => {
  const controller = new NativeOpponentSpeedController();
  const first = controller.update(
    input({ velocity: new Vector3(1, 0, 0), mass: 2 }),
  );
  assert.equal(first.speed, Math.fround(6.9));
  assert.equal(first.error, 10 - Math.fround(6.9));
  assert.equal(first.acceleration, 6.199999855458735);
  assert.equal(first.accForce, 12.399999618530273);
  assert.equal(first.brakeForce, 0);

  const sameControlDifferentMass = new NativeOpponentSpeedController().update(
    input({ velocity: new Vector3(1, 0, 0), mass: 5 }),
  );
  assert.equal(sameControlDifferentMass.acceleration, first.acceleration);
  assert.equal(
    sameControlDifferentMass.accForce,
    Math.fround(first.acceleration * 5),
  );

  const second = controller.update(
    input({ desiredSpeed: 9.9, velocity: new Vector3(1, 0, 0) }),
  );
  assert.equal(second.acceleration, 9.09999894946813);
  assert.equal(second.accForce, 18.199996948242188);
});

test("controller clamps both acceleration signs to damage-adjusted capacity", () => {
  const positive = new NativeOpponentSpeedController().update(
    input({ desiredSpeed: 1000 }),
  );
  assert.equal(positive.acceleration, 12);
  assert.equal(positive.accForce, 24);
  assert.equal(positive.brakeForce, 0);

  const negative = new NativeOpponentSpeedController().update(
    input({ desiredSpeed: 0, velocity: new Vector3(100, 0, 0) }),
  );
  assert.equal(negative.acceleration, -12);
  assert.equal(negative.accForce, 0);
  assert.equal(negative.brakeForce, 24);

  const damaged = new NativeOpponentSpeedController().update(
    input({ desiredSpeed: 1000, engineDamage: 98, transmissionDamage: 98 }),
  );
  assert.equal(damaged.capacity, 1 - Math.fround(0.6) - Math.fround(0.3));
  assert.equal(damaged.acceleration, Math.fround(12 * damaged.capacity));
});

test("native PID retains vertical velocity and Float32 field/store boundaries", () => {
  // Values independently evaluated from installed4af9a2/4b0464–0525.
  // Horizontal steering speed is a different local and cannot replace this.
  const result = new NativeOpponentSpeedController().update(
    input({
      desiredSpeed: 3,
      velocity: new Vector3(0.11, 0.17, 0.23),
      mass: 1.3,
      dtMs: 40,
    }),
  );
  assert.equal(result.speed, 2.1143743991851807);
  assert.equal(result.error, 0.8856256008148193);
  assert.equal(result.acceleration, 3.0996896358439923);
  assert.equal(result.accForce, 4.029596328735352);
});

test("engine and transmission damage thresholds apply distinct linear losses", () => {
  const expected = [
    [50, 0],
    [51, Math.fround(0.0125)],
    [97, 47 * Math.fround(0.0125)],
    [98, Math.fround(0.6)],
    [99, 1],
  ];
  for (const [damage, loss] of expected) {
    const engine = new NativeOpponentSpeedController().update(
      input({ desiredSpeed: 1000, engineDamage: damage }),
    );
    assert.ok(
      Math.abs(engine.capacity - (damage === 99 ? 0 : 1 - loss)) < 1e-12,
    );
    assert.ok(
      Math.abs(engine.acceleration - Math.fround(12 * engine.capacity)) < 1e-12,
    );

    const transmissionLoss =
      damage === 99
        ? 1
        : damage === 98
          ? Math.fround(0.3)
          : damage >= 51
            ? (damage - 50) * Math.fround(0.00625)
            : 0;
    const transmission = new NativeOpponentSpeedController().update(
      input({ desiredSpeed: 1000, transmissionDamage: damage }),
    );
    assert.ok(
      Math.abs(
        transmission.capacity - (damage === 99 ? 0 : 1 - transmissionLoss),
      ) < 1e-12,
    );
    assert.ok(
      Math.abs(
        transmission.acceleration - Math.fround(12 * transmission.capacity),
      ) < 1e-12,
    );
  }
});

test("factor scales desired speed while capacity is at least one", () => {
  const half = new NativeOpponentSpeedController().update(
    input({ factor: 0.5 }),
  );
  assert.equal(half.error, 5);
  assert.equal(half.capacity, 1);
  assert.equal(half.acceleration, 10.000000074505806);

  const double = new NativeOpponentSpeedController().update(
    input({ factor: 2 }),
  );
  assert.equal(double.error, 20);
  assert.equal(double.capacity, 2);
  assert.equal(double.acceleration, 24);

  const negative = new NativeOpponentSpeedController().update(
    input({ factor: -0.5 }),
  );
  assert.equal(negative.capacity, 1);
  assert.equal(negative.error, -5);
});

test("factor zero brakes without changing controller history; reset clears it", () => {
  const withFreeze = new NativeOpponentSpeedController();
  const withoutFreeze = new NativeOpponentSpeedController();
  withFreeze.update(input());
  withoutFreeze.update(input());
  const frozen = withFreeze.update(input({ factor: 0, mass: 3 }));
  assert.deepEqual(
    {
      acceleration: frozen.acceleration,
      accForce: frozen.accForce,
      brake: frozen.brakeForce,
    },
    { acceleration: -15, accForce: 0, brake: 45 },
  );
  const nextInput = input({ desiredSpeed: 9 });
  assert.deepEqual(
    withFreeze.update(nextInput),
    withoutFreeze.update(nextInput),
  );

  withFreeze.reset();
  withoutFreeze.reset();
  assert.deepEqual(withFreeze.update(input()), withoutFreeze.update(input()));
});

test("negative native corner speed requests remain valid braking targets", () => {
  const result = new NativeOpponentSpeedController().update(
    input({ desiredSpeed: -1.4 }),
  );
  assert.ok(result.error < 0);
  assert.ok(result.acceleration < 0);
  assert.equal(result.accForce, 0);
  assert.ok(result.brakeForce > 0);
});

test("opponent speed controller rejects invalid physical and damage inputs", () => {
  const controller = new NativeOpponentSpeedController();
  for (const change of [
    { mass: 0 },
    { mass: -1 },
    { mass: 1e-50 },
    { mass: 1e40 },
    { desiredSpeed: 1e40 },
    { dtMs: 0 },
    { dtMs: Infinity },
    { desiredSpeed: NaN },
    { factor: Infinity },
    { velocity: new Vector3(NaN, 0, 0) },
    { engineDamage: -1 },
    { engineDamage: 101 },
    { engineDamage: 50.5 },
    { transmissionDamage: -1 },
    { transmissionDamage: 101 },
  ])
    assert.throws(() => controller.update(input(change)));
});

test("native curvature slew uses half a unit per second and Float32 stores", async () => {
  const { approachOpponentCurvature } = await import(
    "../src/physics/opponent-speed.ts"
  );
  assert.equal(approachOpponentCurvature(0, 1, 40), Math.fround(0.02));
  assert.equal(approachOpponentCurvature(0, -1, 1000), -0.5);
  assert.equal(approachOpponentCurvature(0.1, 0.11, 40), Math.fround(0.11));
  assert.equal(
    approachOpponentCurvature(0.1, -0.1, 40),
    Math.fround(0.1 - Math.fround(0.02)),
  );
  assert.throws(() => approachOpponentCurvature(0, 1, -1));
});
