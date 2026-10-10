import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import {
  applyVehicleForces,
  createMotionContext,
  createMotionParameters,
  initializeMotion,
  C2_WORLD_SCALE,
} from "../src/physics/motion.ts";
import { NativeOpponentSpeedController } from "../src/physics/opponent-speed.ts";

const S = C2_WORLD_SCALE;
const near = (a, b, tolerance = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const vector = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const mechanics = (mass = 2) => {
  const wheel = (x, z, steerable, give) => ({
    type: 0,
    identifier: "wheel",
    actor: "wheel",
    position: [x, 0, z],
    positionFromActor: false,
    steerableFlag: +steerable,
    drivenFlag: +steerable,
    steerable,
    driven: steerable,
    suspensionGive: give,
    damping: 0.7,
    slippingFrictionReduction: 0.8,
    frictionAngles: [60, 60],
    tractionMultiplier: 1,
    rollingResistance: 0,
  });
  return {
    mechanicsVersion: 1,
    minimumTurningCircle: 1,
    brakeMultiplier: 0.8,
    brakingStrengthMultiplier: 0.6,
    gearCount: 5,
    speedAtRedline: 120,
    highestGearAcceleration: 3,
    root: {
      type: "root",
      identifier: "root",
      actor: "root",
      jointType: "none",
      centerOfMass: [0, 0, 0],
      mass,
      inertiaDimensions: [0.2, 0.1, 0.6],
      inertia: [
        (mass * (0.1 ** 2 + 0.6 ** 2)) / 12,
        (mass * (0.2 ** 2 + 0.6 ** 2)) / 12,
        (mass * (0.1 ** 2 + 0.2 ** 2)) / 12,
      ],
      downforceBalanceSpeed: 30,
    },
    wheels: [
      wheel(-0.1, 0.3, false, 0.08),
      wheel(0.1, 0.3, false, 0.08),
      wheel(-0.1, -0.3, true, 0.12),
      wheel(0.1, -0.3, true, 0.12),
    ],
    shapes: [
      { kind: "box", bounds: { min: [-0.1, 0, -0.3], max: [0.1, 0.15, 0.3] } },
    ],
    subPartCount: 0,
  };
};

function makeState(parameters, velocity = vector()) {
  const state = initializeMotion(
    {
      position: vector(),
      orientation: new Quaternion(),
      velocity,
      angularVelocity: vector(),
    },
    parameters,
  );
  state.driver = 6;
  state.wheelLengths.fill(parameters.wheelPositions[0].y);
  return state;
}

function flatGround(parameters, friction = 1) {
  const ride = parameters.wheelPositions[0].y;
  return {
    raycast() {
      return {
        distance: ride / S,
        normal: vector(0, 1),
        friction,
        rollingResistance: 0,
        downforce: 0,
      };
    },
  };
}

test("AI wheel-force commands persist through PHIL steps despite player inputs", () => {
  const parameters = createMotionParameters(mechanics());
  const quiet = makeState(parameters);
  const noisy = makeState(parameters);
  for (const state of [quiet, noisy]) {
    state.accForce = 4;
    state.brakeForce = 0.75;
    state.curvature = 0.12;
    state.rpm = 3200;
    state.tractionRpm = 2100;
    state.gear = 3;
  }
  const context = createMotionContext();
  const ground = flatGround(parameters);
  const command = { accForce: quiet.accForce, brakeForce: quiet.brakeForce };
  for (let frame = 0; frame < 3; frame++) {
    const quietDebug = applyVehicleForces(
      quiet,
      { throttle: 0, steer: 1, brake: 0, handbrake: false },
      0.04,
      parameters,
      ground,
      context,
    );
    const noisyDebug = applyVehicleForces(
      noisy,
      { throttle: 1, steer: 1, brake: 1, handbrake: false },
      0.04,
      parameters,
      ground,
      context,
    );
    near(quietDebug.force.x, noisyDebug.force.x);
    near(quietDebug.force.y, noisyDebug.force.y);
    near(quietDebug.force.z, noisyDebug.force.z);
    assert.deepEqual(noisy.velocity.toArray(), quiet.velocity.toArray());
    assert.equal(noisy.accForce, command.accForce);
    assert.equal(noisy.brakeForce, command.brakeForce);
    assert.equal(noisy.curvature, 0.12);
    assert.equal(noisy.rpm, 3200);
    assert.equal(noisy.gear, 3);
  }
});

test("AI command curvature remains unclamped while common damage is temporary", () => {
  const parameters = createMotionParameters(mechanics());
  const ai = makeState(parameters);
  const human = makeState(parameters);
  human.driver = 8;
  for (const state of [ai, human]) {
    state.curvature = parameters.maxCurve * 2;
    state.steeringDamageCurvature = 0.05;
  }
  const ground = flatGround(parameters);
  for (const state of [ai, human])
    applyVehicleForces(
      state,
      { throttle: 0, steer: 1, brake: 0, handbrake: false },
      0.04,
      parameters,
      ground,
      createMotionContext(),
    );

  near(ai.curvature, parameters.maxCurve * 2);
  near(human.curvature, parameters.maxCurve - 0.05);
});

test("speed-controller factors reach rear axle traction and frozen braking", () => {
  const parameters = createMotionParameters(mechanics());
  const ground = flatGround(parameters);
  const inputFor = (factor) =>
    new NativeOpponentSpeedController().update({
      desiredSpeed: 0.2,
      velocity: vector(),
      factor,
      engineDamage: 0,
      transmissionDamage: 0,
      mass: parameters.mass,
      dtMs: 40,
    });
  const acceleration1 = inputFor(1);
  const acceleration2 = inputFor(2);
  near(acceleration1.acceleration, 0.7000000178813935);
  near(acceleration2.acceleration, 1.400000035762787);

  const runPowered = (forces) => {
    const state = makeState(parameters);
    state.accForce = forces.accForce;
    state.brakeForce = forces.brakeForce;
    const debug = applyVehicleForces(
      state,
      { throttle: 0, steer: 0, brake: 0, handbrake: false },
      0.04,
      parameters,
      ground,
      createMotionContext(),
    );
    return { state, debug };
  };
  const first = runPowered(acceleration1);
  const second = runPowered(acceleration2);
  near(first.debug.force.z, -acceleration1.accForce);
  near(second.debug.force.z, -acceleration2.accForce);
  near(second.debug.force.z, first.debug.force.z * 2);
  assert.ok(first.state.velocity.z < 0);
  assert.ok(second.state.velocity.z < first.state.velocity.z);
  assert.ok(first.debug.wheelTyreForces[0] > 0);
  assert.ok(first.debug.wheelTyreForces[1] > 0);

  const frozenForces = inputFor(0);
  assert.equal(frozenForces.brakeForce, 15 * parameters.mass);
  const frozenState = makeState(parameters, vector(0, 0, -0.3));
  frozenState.brakeForce = frozenForces.brakeForce;
  const beforeSpeed = -frozenState.velocity.z * S;
  const frozenDebug = applyVehicleForces(
    frozenState,
    { throttle: 1, steer: -1, brake: 0, handbrake: false },
    0.04,
    parameters,
    ground,
    createMotionContext(),
  );
  const afterSpeed = -frozenState.velocity.z * S;
  assert.ok(
    afterSpeed < beforeSpeed,
    `${afterSpeed} should be < ${beforeSpeed}`,
  );
  assert.ok(frozenDebug.wheelTyreForces.every((force) => force > 0));
});

test("wheel traction caps limit larger AI controller commands", () => {
  const parameters = createMotionParameters(mechanics());
  const ground = flatGround(parameters);
  const run = (accForce) => {
    const state = makeState(parameters);
    state.accForce = accForce;
    return applyVehicleForces(
      state,
      { throttle: 0, steer: 0, brake: 0, handbrake: false },
      0.04,
      parameters,
      ground,
      createMotionContext(),
    );
  };
  const moderate = run(24);
  const saturated = run(48);
  near(moderate.force.z, saturated.force.z);
  assert.ok(moderate.wheelCapacities[0] > 0);
  assert.ok(moderate.wheelTyreForces[0] <= moderate.wheelCapacities[0]);
  assert.ok(moderate.wheelTyreForces[1] <= moderate.wheelCapacities[1]);
});
