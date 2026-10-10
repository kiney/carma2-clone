import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { advanceRigidBody } from "../src/physics/integrate.ts";
import {
  createMotionParameters,
  initializeMotion,
  applyVehicleForces,
  allocateTyrePair,
  applyDamagedControls,
  C2_WORLD_SCALE,
  setMotionSuspension,
  resetMotionSuspension,
  createMotionContext,
  wheelBumpinessOffset,
} from "../src/physics/motion.ts";
const S = C2_WORLD_SCALE;
const near = (a, b, tolerance = 1e-8) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const vector = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
function mechanics(mass = 2, comZ = 0, rearGive = 0.08, frontGive = 0.12) {
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
      centerOfMass: [0, 0, comZ],
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
      wheel(-0.1, 0.3, false, rearGive),
      wheel(0.1, 0.3, false, rearGive),
      wheel(-0.1, -0.3, true, frontGive),
      wheel(0.1, -0.3, true, frontGive),
    ],
    shapes: [
      { kind: "box", bounds: { min: [-0.1, 0, -0.3], max: [0.1, 0.15, 0.3] } },
    ],
    subPartCount: 0,
  };
}
const neutral = { throttle: 0, steer: 0, brake: 0, handbrake: false };

test("global car gravity scales raw force and momentum, while wall support bypasses it", () => {
  const p = createMotionParameters(mechanics());
  for (const factor of [0, 0.2, 4]) {
    const s = state(p);
    s.globalGravityMultiplier = factor;
    const dt = 0.04;
    const d = applyVehicleForces(
      s,
      neutral,
      dt,
      p,
      { raycast: () => null },
      createMotionContext(),
    );
    near(d.force.y, -p.mass * 10 * factor);
    const beforeDrag = (-10 * factor * dt) / S;
    const drag =
      1 - (Math.abs(beforeDrag) * dt * 0.0005000000237487257 * S) / p.mass;
    near(p.mass * s.velocity.y, p.mass * beforeDrag * drag);

    const supported = preload(state(p), p);
    supported.wallClimb = true;
    supported.globalGravityMultiplier = factor;
    const road = staticRoad(p, 0);
    const wall = applyVehicleForces(
      supported,
      neutral,
      dt,
      p,
      { raycast: () => ({ ...road.raycast(), normal: vector(1) }) },
      createMotionContext(),
    );
    near(wall.force.x, -p.mass * 10);
    near(
      wall.force.y,
      wall.wheelSpringLoads.reduce((a, b) => a + b, 0),
    );
  }
});

test("native settling distinguishes null volume from raw volume and global divisors", () => {
  const p = createMotionParameters(mechanics());
  const settles = (
    settlingVolumeGravity,
    globalGravityMultiplier = 1,
    volumeGravityFactor = 0.95,
  ) => {
    const s = preload(state(p, vector(0.01)), p);
    Object.assign(s, {
      settlingVolumeGravity,
      globalGravityMultiplier,
      volumeGravityFactor,
    });
    const context = createMotionContext();
    context.stopTimer = 0.6;
    const d = applyVehicleForces(
      s,
      neutral,
      0.04,
      p,
      staticRoad(p, 0),
      context,
    );
    near(d.force.y, 20 - 20 * volumeGravityFactor * globalGravityMultiplier);
    return s.velocity.lengthSq() === 0;
  };
  // All cases have residual force1. Null volume skips both divisions;
  // raw .2 prevents sleep, whereas underwater's raw .52 permits it.
  assert.equal(settles(undefined), true);
  assert.equal(settles(0.2), false);
  assert.equal(settles(1 - (1 - 0.2) * 0.6), true);
  assert.equal(settles(0.2, 4, 0.95 / 4), true);
  assert.equal(settles(undefined, 0.2, 0.95 / 0.2), true);
  // Equal acceleration factors can have different raw settling divisors;
  // depth-mixed .95 must never replace the authored raw .2.
  assert.equal(settles(0.95), true);
});

test("original volume gravity and viscosity reach the actual WheelForces velocity update", () => {
  const p = createMotionParameters(mechanics());
  const s = state(p, vector(4));
  s.volumeGravityFactor = 0.6; // partial water: 1 - (1-.2)*.5
  s.volumeDragFactor = 25; // viscosity50 * depth.5
  const d = applyVehicleForces(
    s,
    neutral,
    0.04,
    p,
    { raycast: () => null },
    createMotionContext(),
  );
  near(d.force.y, -p.mass * 10 * 0.6);
  const vy = (-10 * 0.6 * 0.04) / S;
  const damping =
    1 - (Math.hypot(4, vy) * 0.04 * 0.0005000000237487257 * 25 * S) / p.mass;
  near(s.velocity.x, 4 * damping);
  near(s.velocity.y, vy * damping);
});

test("authored volume material overrides wheel friction without changing spring loads", () => {
  const p = createMotionParameters(mechanics());
  const ordinary = preload(state(p, vector(4, 0, -10)), p);
  const submerged = preload(state(p, vector(4, 0, -10)), p);
  submerged.volumeSurface = { tyreFriction: 0.25, downforce: 0, bumpiness: 0 };
  const road = staticRoad(p);
  const a = applyVehicleForces(
    ordinary,
    neutral,
    0.04,
    p,
    staticRoad(p),
    createMotionContext(),
  );
  const b = applyVehicleForces(
    submerged,
    neutral,
    0.04,
    p,
    {
      ...road,
      raycast(...args) {
        return {
          ...road.raycast(...args),
          surface: { modifier: { tyreFriction: 1 } },
        };
      },
    },
    createMotionContext(),
  );
  assert.deepEqual(a.wheelSpringLoads, b.wheelSpringLoads);
  assert.deepEqual(
    b.wheelRoadFrictions,
    [0.25, 0.25, 0.25, 0.25],
    "safe-position history uses the effective native volume material index",
  );
  for (let i = 0; i < 4; i++)
    near(b.wheelCapacities[i], a.wheelCapacities[i] * 0.25);
});

test("per-wheel native oil factors reduce only the affected tyre capacities", () => {
  const p = createMotionParameters(mechanics());
  const ordinary = preload(state(p, vector(4, 0, -10)), p);
  const oily = preload(state(p, vector(4, 0, -10)), p);
  const road = staticRoad(p);
  const a = applyVehicleForces(
    ordinary,
    neutral,
    0.04,
    p,
    road,
    createMotionContext(),
  );
  const b = applyVehicleForces(
    oily,
    neutral,
    0.04,
    p,
    {
      ...road,
      sampleOil(points, grounded) {
        near(points[0].x, p.wheelPositions[0].x);
        assert.deepEqual(grounded, [true, true, true, true]);
        return [0.08, 1, 0.15, 1];
      },
    },
    createMotionContext(),
  );
  for (let i = 0; i < 4; i++)
    near(b.wheelCapacities[i], a.wheelCapacities[i] * [0.08, 1, 0.15, 1][i]);
  assert.deepEqual(b.oilWheelFactors, [0.08, 1, 0.15, 1]);
  assert.deepEqual(b.wheelSpringLoads, a.wheelSpringLoads);
});
function state(p, velocity = vector()) {
  return initializeMotion(
    {
      position: vector(),
      orientation: new Quaternion(),
      velocity,
      angularVelocity: vector(),
    },
    p,
  );
}
function staticRoad(p, friction = 1, downforce = 0) {
  const ride = p.wheelPositions[0].y;
  return {
    raycast() {
      return {
        distance: ride / S,
        normal: vector(0, 1),
        friction,
        rollingResistance: 0,
        downforce,
      };
    },
  };
}
function preload(s, p) {
  s.wheelLengths.fill(p.wheelPositions[0].y);
  return s;
}

test("wall climbing replaces gravity with the unweighted local support direction", () => {
  const p = createMotionParameters(mechanics());
  const run = (normals, options = {}) => {
    const s = preload(state(p), p);
    Object.assign(s, options);
    let wheel = 0;
    const d = applyVehicleForces(
      s,
      neutral,
      0.04,
      p,
      {
        raycast() {
          const normal = normals[wheel++];
          return normal
            ? {
                distance: p.wheelPositions[0].y / S,
                normal,
                friction: 0,
                rollingResistance: 0,
                downforce: 0,
              }
            : null;
        },
      },
      createMotionContext(),
    );
    return d.force
      .clone()
      .addScaledVector(
        vector(0, 1),
        -d.wheelSpringLoads.reduce((a, b) => a + b, 0),
      );
  };
  const check = (actual, expected) => {
    near(actual.x, expected.x);
    near(actual.y, expected.y);
    near(actual.z, expected.z);
  };
  const wall = Array.from({ length: 4 }, () => vector(1));
  check(run(wall, { wallClimb: true, volumeGravityFactor: 0.25 }), vector(-20));
  const slope = vector(0.6, 0.8);
  check(
    run([slope, slope, slope, slope], { wallClimb: true }),
    vector(-12, -16),
  );
  // Unequal accepted normal vectors are summed before normalization.
  check(
    run([vector(1), vector(0, 1), null, null], { wallClimb: true }),
    vector(-20 / Math.sqrt(2), -20 / Math.sqrt(2)),
  );
  const rotation = new Quaternion().setFromAxisAngle(
    vector(0, 0, 1),
    Math.PI / 2,
  );
  check(run(wall, { wallClimb: true, orientation: rotation }), vector(0, 20));
  check(run(wall), vector(0, -20));
  check(run(wall, { wallClimb: true, driver: 5 }), vector(0, -20));
  check(run(wall, { wallClimb: true, driver: 6 }), vector(-20));
  check(
    run([null, null, null, null], {
      wallClimb: true,
      volumeGravityFactor: 0.25,
    }),
    vector(0, -5),
  );
  check(
    run([vector(1), vector(-1), vector(1), vector(-1)], {
      wallClimb: true,
      volumeGravityFactor: 0.25,
    }),
    vector(0, -5),
  );
  check(
    run([vector(), vector(), vector(), vector()], {
      wallClimb: true,
      volumeGravityFactor: 0.25,
    }),
    vector(0, -5),
  );
  // Nonzero sums at/below 2^-22 take local Y, even in a rotated car.
  for (const magnitude of [2 ** -25, 2 ** -24]) {
    const tiny = Array.from({ length: 4 }, () => vector(magnitude));
    check(
      run(tiny, {
        wallClimb: true,
        orientation: rotation,
        volumeGravityFactor: 0.25,
      }),
      vector(0, -20),
    );
  }
  check(
    run(
      Array.from({ length: 4 }, () => vector(2 ** -23)),
      {
        wallClimb: true,
        orientation: rotation,
      },
    ),
    vector(0, 20),
  );
});

test("wall climbing overrides tyre inclination but retains material, speed and cap", () => {
  const p = createMotionParameters(mechanics());
  const run = (normal, speed, factor, wallClimb, driver = 8) => {
    const s = preload(state(p, vector(0, 0, -speed / S)), p);
    Object.assign(s, { wallClimb, driver });
    const road = staticRoad(p, 0, factor);
    return applyVehicleForces(
      s,
      neutral,
      0.04,
      p,
      { raycast: () => ({ ...road.raycast(), normal }) },
      createMotionContext(),
    ).downforce;
  };
  const slope = vector(0.6, 0.8);
  near(run(slope, 5, 0.5, false), (20 * 5 * 0.8 * 0.5) / 30);
  near(run(slope, 5, 0.5, true), (20 * 5 * 0.5) / 30);
  near(run(vector(1), 5, 0.5, false), 0);
  near(run(vector(1), 5, 0.5, true), (20 * 5 * 0.5) / 30);
  near(run(vector(1), 5, 0.5, true, 5), 0);
  near(run(vector(1), 100, 2, true), 20);
  near(run(vector(1), 5, 0, true), 0);
  near(run(vector(1), 5, -1, true), 0);
});

test("original grouped axle parameters cross gives and normalize tyre angles by static wheel load", () => {
  const source = mechanics(2, 0.06, 0.08, 0.12),
    p = createMotionParameters(source);
  const rearMass = 2 / (Math.abs((0.3 - 0.06) / (-0.3 - 0.06)) + 1);
  near(p.spring[0], (rearMass * 5) / (0.12 * S));
  near(p.spring[1], ((2 - rearMass) * 5) / (0.08 * S));
  near(p.suspensionLength[0], (0.01 + 0.12) * S);
  near(p.suspensionLength[1], (0.01 + 0.08) * S);
  near(p.mu[0], (Math.tan((60 * 157) / 9000) / 4) * Math.sqrt(rearMass * 5));
  near(p.maxCurve, 1 / S);
  near(p.speedRevsRatio, (120 * 4) / 9 / 5 / 6000);
  near(p.forceTorqueRatio, 2 * 3 * 5);
  // Source driven flags intentionally point at the front; original groups by steerable.
  near(p.wheelPositions[0].z, 0.3 * S);
});

test("static loads include COM axle distribution and cancel weight and pitch torque", () => {
  const p = createMotionParameters(mechanics(2, 0.06)),
    s = preload(state(p), p);
  const d = applyVehicleForces(s, neutral, 0.04, p, staticRoad(p));
  const rearLoad = ((-0.3 - 0.06) / (-0.3 - 0.3)) * 2 * 5;
  const frontLoad = ((0.3 - 0.06) / (0.3 + 0.3)) * 2 * 5;
  near(d.wheelSpringLoads[0], rearLoad);
  near(d.wheelSpringLoads[1], rearLoad);
  near(d.wheelSpringLoads[2], frontLoad);
  near(d.wheelSpringLoads[3], frontLoad);
  near(d.force.length(), 0);
  near(d.torque.length(), 0);
  near(s.velocity.length(), 0);
  assert.equal(d.grounded, 4);
});

test("normal spring damper uses old length difference and clamps pulling force", () => {
  const p = createMotionParameters(mechanics()),
    s = preload(state(p), p),
    dt = 0.04;
  const old = p.wheelPositions[0].y;
  s.wheelLengths[0] = old + 0.02;
  s.wheelLengths[1] = old - 0.02;
  const d = applyVehicleForces(s, neutral, dt, p, staticRoad(p));
  near(d.wheelSpringLoads[0], p.mass * 2.5 + (p.damper[0] * 0.02) / dt);
  near(
    d.wheelSpringLoads[1],
    Math.max(0, p.mass * 2.5 - (p.damper[0] * 0.02) / dt),
  );
});

test("wheel capacities obey sqrt instantaneous load and linear road friction", () => {
  const p = createMotionParameters(mechanics()),
    s = preload(state(p, vector(0, 0, -2)), p);
  const d = applyVehicleForces(s, neutral, 0.04, p, staticRoad(p, 0.35));
  for (let i = 0; i < 4; i++)
    near(
      d.wheelCapacities[i],
      Math.sqrt(d.wheelSpringLoads[i]) * p.mu[i < 2 ? 2 : 1] * 0.35,
    );
  const second = preload(state(p, vector(0, 0, -2)), p);
  second.wheelLengths[0] += 0.03;
  const heavier = applyVehicleForces(
    second,
    neutral,
    0.04,
    p,
    staticRoad(p, 0.35),
  );
  near(
    heavier.wheelCapacities[0] / d.wheelCapacities[0],
    Math.sqrt(heavier.wheelSpringLoads[0] / d.wheelSpringLoads[0]),
  );
});

test("pair saturation redistributes one sliding wheel then uses authored dynamic multiplier", () => {
  for (const [d, l, r, el, er, slip] of [
    [5, 3, 9, 2.4, 7.6, false],
    [5, 3, 6, 2.4, 4.8, true],
    [5, 3, 4, 2.4, 3.2, true],
  ]) {
    const result = allocateTyrePair(d, l, r, 0.8);
    near(result[0], el);
    near(result[1], er);
    assert.equal(result[2], slip);
  }
  assert.deepEqual(allocateTyrePair(2, 3, 4, 0.8), [2, 2, false]);
});

test("dry force solver clips sideways demands at paired rear and front capacities", () => {
  const p = createMotionParameters(mechanics()),
    s = preload(state(p, vector(3, 0, -2)), p);
  const d = applyVehicleForces(s, neutral, 0.04, p, staticRoad(p, 0.1));
  assert.equal(s.slipping, 3);
  for (let i = 0; i < 4; i++)
    near(d.wheelTyreForces[i], d.wheelCapacities[i] * p.slipMultiplier);
  assert.ok(d.force.x < 0);
  assert.ok(s.velocity.x < 3);
});

test("inertia, contact lever arm and orientation preserve world/body transformation", () => {
  const p = createMotionParameters(mechanics()),
    a = preload(state(p, vector(1, 0, -2)), p);
  a.curvature = 0.01;
  const q = new Quaternion().setFromAxisAngle(vector(0, 1), Math.PI / 2);
  const b = preload(state(p, a.velocity.clone().applyQuaternion(q)), p);
  b.orientation.copy(q);
  b.curvature = a.curvature;
  const da = applyVehicleForces(
    a,
    { ...neutral, steer: 0.25 },
    0.04,
    p,
    staticRoad(p),
  );
  const db = applyVehicleForces(
    b,
    { ...neutral, steer: 0.25 },
    0.04,
    p,
    staticRoad(p),
  );
  near(db.force.distanceTo(da.force), 0, 1e-7);
  near(b.velocity.distanceTo(a.velocity.clone().applyQuaternion(q)), 0, 1e-7);
  near(
    b.angularVelocity.distanceTo(a.angularVelocity.clone().applyQuaternion(q)),
    0,
    1e-7,
  );
  assert.ok(a.angularVelocity.length() > 0);
});

test("drivetrain launches through neutral rev buildup and drives the non-steer axle", () => {
  const p = createMotionParameters(mechanics()),
    s = preload(state(p), p);
  const road = staticRoad(p);
  for (let i = 0; i < 9; i++)
    applyVehicleForces(s, { ...neutral, throttle: 1 }, 0.04, p, road);
  assert.equal(s.gear, 1);
  assert.ok(s.rpm > 1000);
  const d = applyVehicleForces(s, { ...neutral, throttle: 1 }, 0.04, p, road);
  assert.ok(d.axleForces[0].z < 0);
  near(d.axleForces[1].z, 0);
  assert.ok(s.velocity.z < 0);
});

test("brakes ramp from original mass-scaled initial force and oppose forward travel", () => {
  const p = createMotionParameters(mechanics()),
    s = preload(state(p, vector(0, 0, -3)), p);
  const first = applyVehicleForces(
    s,
    { ...neutral, brake: 1 },
    0.04,
    p,
    staticRoad(p),
  );
  near(s.brakeForce, p.initialBrake);
  assert.ok(first.force.z > 0);
  const previous = s.velocity.z;
  applyVehicleForces(s, { ...neutral, brake: 1 }, 0.04, p, staticRoad(p));
  near(s.brakeForce, p.initialBrake + 0.04 * p.brakeIncrease);
  assert.ok(s.velocity.z > previous);
  applyVehicleForces(s, neutral, 0.04, p, staticRoad(p));
  near(s.brakeForce, 0);
});

test("gravity and linear capped downforce use original scale with no generic damping", () => {
  const p = createMotionParameters(mechanics()),
    s = state(p);
  const air = applyVehicleForces(s, neutral, 0.04, p, { raycast: () => null });
  assert.equal(air.grounded, 0);
  near(air.force.y, -p.mass * 10);
  // Air drag is negligible here but included analytically after gravity.
  const gravityVelocity = (-10 * 0.04) / S;
  near(
    s.velocity.y,
    gravityVelocity *
      (1 -
        (Math.abs(gravityVelocity) * 0.04 * 0.0005000000237487257 * S) /
          p.mass),
  );
  const atSpeed = (speed) => {
    const x = preload(state(p, vector(0, 0, -speed / S)), p);
    return applyVehicleForces(x, neutral, 0.04, p, staticRoad(p, 1, 1));
  };
  near(atSpeed(5).downforce, (p.mass * 10 * 5) / 30);
  near(atSpeed(10).downforce, 2 * atSpeed(5).downforce);
  near(atSpeed(60).downforce, p.mass * 10);
});

test("mass scaling preserves spring-supported acceleration and tyre force per mass", () => {
  const a = createMotionParameters(mechanics(2)),
    b = createMotionParameters(mechanics(8));
  const sa = preload(state(a, vector(1, 0, -2)), a),
    sb = preload(state(b, vector(1, 0, -2)), b);
  const da = applyVehicleForces(sa, neutral, 0.04, a, staticRoad(a));
  const db = applyVehicleForces(sb, neutral, 0.04, b, staticRoad(b));
  for (let i = 0; i < 4; i++) {
    near(db.wheelSpringLoads[i], 4 * da.wheelSpringLoads[i]);
    near(db.wheelCapacities[i], 4 * da.wheelCapacities[i]);
  }
  near(db.force.x / b.mass, da.force.x / a.mass);
});

test("wheel geometry offsets use front/rear damage-order conversion and steering crush offset remains separate", () => {
  const p = createMotionParameters(mechanics()),
    s = preload(state(p, vector(0, 0, -2)), p);
  s.wheelDamageOffsets = [0.002, 0, 0, 0];
  const d = applyVehicleForces(s, neutral, 0.04, p, staticRoad(p));
  near(d.wheelSpringLoads[0], p.mass * 2.5);
  near(
    d.wheelSpringLoads[2],
    p.mass * 2.5 + p.spring[1] * 0.002 * S + (p.damper[1] * 0.002 * S) / 0.04,
  );
  const steeringState = preload(state(p, vector(0, 0, -2)), p);
  steeringState.steeringDamageCurvature = 0.01;
  const steeringDebug = applyVehicleForces(
    steeringState,
    neutral,
    0.04,
    p,
    staticRoad(p),
  );
  assert.ok(Math.abs(steeringDebug.torque.y) > 1e-6);
  near(steeringState.curvature, -0.01 * 0.04);
});

test("source-origin plane spawn remains supported through repeated original 40 ms steps", () => {
  for (const height of [0, 0.005]) {
    const p = createMotionParameters(mechanics(2, 0.06)),
      s = state(p),
      context = createMotionContext();
    s.position.y = height;
    const floor = {
      raycast(origin, direction, maxDistance) {
        const distance = -origin.y / direction.y;
        return distance >= 0 && distance <= maxDistance
          ? {
              distance,
              normal: vector(0, 1),
              friction: 1,
              rollingResistance: 0,
              downforce: 1,
            }
          : null;
      },
    };
    const b = {
      state: s,
      properties: {
        mass: p.mass,
        inertia: p.inertia,
        centerOfMass: p.centerOfMassModel,
        worldFriction: 0.4,
      },
    };
    let maxHeight = s.position.y;
    for (let i = 0; i < 250; i++) {
      applyVehicleForces(s, neutral, 0.04, p, floor, context);
      advanceRigidBody(b, 0.04);
      maxHeight = Math.max(maxHeight, s.position.y);
      assert.ok(Number.isFinite(s.position.y));
    }
    assert.ok(maxHeight < 0.02, `unexpected suspension launch ${maxHeight}`);
    // Original sleep clamp can park within its residual-force threshold.
    near(
      s.position.y,
      0,
      height === 0 ? 1e-8 : p.mass / (S * 2 * (p.spring[0] + p.spring[1])),
    );
    near(s.velocity.length(), 0, 1e-4);
  }
});

test("source damage episodes invert steering and disengage damaged transmission while 99 damage stays latched", () => {
  const p = createMotionParameters(mechanics()),
    s = state(p, vector(0, 0, -1));
  s.componentDamage = [0, 80, 0, 80];
  s.gear = 2;
  let index = 0;
  const samples = [0, 0.5, 0, 0.5];
  const random = () => samples[index++] ?? 0.99;
  const command = { ...neutral, steer: 1 };
  near(applyDamagedControls(s, command, 0.04, random).steer, 1);
  near(applyDamagedControls(s, command, 0.04, random).steer, -1);
  assert.equal(s.gear, 0);
  assert.equal(s.justChangedGear, true);
  s.componentDamage = [0, 99, 0, 99];
  s.gear = 2;
  const later = applyDamagedControls(s, command, 5, () => 0.99);
  near(later.steer, -1);
  assert.equal(s.gear, 0);
});

test("read-only original Eagle source-origin spawn is stable at the original 40 ms timestep", async (t) => {
  const { access } = await import("node:fs/promises");
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original assets unavailable");
    return;
  }
  const { createAssetStore } = await import("../server/assets.mjs");
  const { decodeText } = await import("../src/formats.ts");
  const { parseCarMechanics } = await import("../src/mechanics.ts");
  const store = await createAssetStore(
    new URL("../carma2_orig", import.meta.url).pathname,
  );
  const source = parseCarMechanics(
    decodeText(await store.read("data/CARS/EAGLE3/EAGLE3.txt")),
  );
  const p = createMotionParameters(source),
    s = state(p);
  const b = {
    state: s,
    properties: {
      mass: p.mass,
      inertia: p.inertia,
      centerOfMass: p.centerOfMassModel,
      worldFriction: 0.4,
    },
  };
  const floor = {
    raycast(origin, direction, maxDistance) {
      const distance = -origin.y / direction.y;
      return distance >= 0 && distance <= maxDistance
        ? {
            distance,
            normal: vector(0, 1),
            friction: 1,
            rollingResistance: 0,
            downforce: 1,
          }
        : null;
    },
  };
  for (let i = 0; i < 250; i++) {
    const d = applyVehicleForces(s, neutral, 0.04, p, floor);
    assert.equal(d.grounded, 4);
    near(
      d.wheelSpringLoads.reduce((a, b) => a + b),
      p.mass * 10,
      1e-7,
    );
    advanceRigidBody(b, 0.04);
  }
  near(s.position.length(), 0, 1e-7);
  near(s.velocity.length(), 0, 1e-7);
  near(s.angularVelocity.length(), 0, 1e-7);
});

test("source engine/APO factors scale only throttle torque and grip scales tyre capacities", () => {
  const p = createMotionParameters(mechanics());
  const a = preload(state(p), p),
    b = preload(state(p), p),
    c = preload(state(p), p);
  b.engineFactor = 2;
  b.powerMultiplier = 1.25;
  const none = { ...neutral, throttle: 1 };
  const da = applyVehicleForces(a, none, 0.04, p, staticRoad(p)),
    db = applyVehicleForces(b, none, 0.04, p, staticRoad(p));
  // Neutral gear isolates engine rev integration: idle torque -.2 is not boosted.
  near(a.rpm, 0.04 * 5000 * (1.2 - 0.2));
  near(b.rpm, 0.04 * 5000 * (1.2 * 2 * 1.25 - 0.2));
  for (let i = 0; i < 4; i++) {
    near(da.wheelSpringLoads[i], db.wheelSpringLoads[i]);
    near(da.wheelCapacities[i], db.wheelCapacities[i]);
  }
  c.tyreGripFactor = 1.7;
  const dc = applyVehicleForces(c, neutral, 0.04, p, staticRoad(p));
  for (let i = 0; i < 4; i++) {
    near(dc.wheelSpringLoads[i], da.wheelSpringLoads[i]);
    near(dc.wheelCapacities[i], 1.7 * da.wheelCapacities[i]);
  }
  near(dc.force.y, da.force.y);
  near(dc.downforce, da.downforce);
});

test("source temporary suspension assigns crossed give, spring, damper and metric extra lengths", () => {
  const p = createMotionParameters(mechanics());
  const spring = [...p.spring],
    damper = [...p.damper],
    ride = p.wheelPositions[0].y;
  const values = {
    frontGiveMultiplier: 2,
    rearGiveMultiplier: 4,
    dampingMultiplier: 3,
    frontExtraLength: 0.4,
    rearExtraLength: 0.5,
  };
  setMotionSuspension(p, values);
  near(p.spring[0], spring[0] / 4);
  near(p.spring[1], spring[1] / 2);
  near(p.damper[0], (damper[0] * 3) / 2);
  near(p.damper[1], (damper[1] * 3) / Math.sqrt(2));
  near(p.suspensionLength[0], ride + 0.12 * S * 4 + 0.5);
  near(p.suspensionLength[1], ride + 0.08 * S * 2 + 0.4);
  setMotionSuspension(p, values);
  near(p.spring[0], spring[0] / 4);
  setMotionSuspension(p, {
    frontGiveMultiplier: 1,
    rearGiveMultiplier: 1,
    dampingMultiplier: 1,
    frontExtraLength: 0,
    rearExtraLength: 0,
  });
  near(p.spring[0], spring[0]);
  near(p.damper[1], damper[1]);
  near(p.suspensionLength[1], ride + 0.08 * S);
});

test("bend suspension reset recalculates axle load from current wheel geometry, COM and mass", () => {
  const p = createMotionParameters(mechanics());
  const originalSpring = [...p.spring];
  setMotionSuspension(p, {
    frontGiveMultiplier: 2,
    rearGiveMultiplier: 4,
    dampingMultiplier: 3,
    frontExtraLength: 0.4,
    rearExtraLength: 0.5,
  });
  // Changed geometry gives rear/front lever distances .4/.2 model units.
  // A mass of three therefore assigns one to rear and two to front.
  p.mass = 3;
  p.centerOfMass.z = 0.05 * S;
  p.wheelPositions[0].z = 0.45 * S;
  p.wheelPositions[2].z = -0.15 * S;
  resetMotionSuspension(p);
  near(p.spring[0], 5 / (0.12 * S));
  near(p.spring[1], 10 / (0.08 * S));
  near(p.damper[0], Math.sqrt(5 / (0.12 * S)) * 0.7);
  near(p.damper[1], 2 * Math.sqrt(5 / (0.08 * S)) * 0.7);
  near(p.spring[0] * 0.12 * S + p.spring[1] * 0.08 * S, 15);
  near(p.suspensionLength[0], (0.01 + 0.12) * S);
  near(p.suspensionLength[1], (0.01 + 0.08) * S);
  assert.ok(p.spring[1] > originalSpring[1]);

  // A subsequent powerup derives from this geometry, not initial axle masses.
  setMotionSuspension(p, {
    frontGiveMultiplier: 2,
    rearGiveMultiplier: 4,
    dampingMultiplier: 3,
    frontExtraLength: 0.4,
    rearExtraLength: 0.5,
  });
  near(p.spring[0], 5 / (0.12 * S * 4));
  near(p.spring[1], 10 / (0.08 * S * 2));
  near(p.damper[1], 6 * Math.sqrt(5 / (0.08 * S * 2)) * 0.7);
});

test("shared source stop timer starts at zero and makes sleep depend on car iteration order", () => {
  const p = createMotionParameters(mechanics());
  const parked = () => preload(state(p, vector(0, 0.02, 0)), p);
  const first = parked(),
    second = parked(),
    context = createMotionContext();
  assert.equal(context.stopTimer, 0);
  context.stopTimer = 0.5;
  applyVehicleForces(first, neutral, 0.04, p, staticRoad(p), context);
  assert.ok(first.velocity.y > 0); // Strict >.5 gate, not >=.
  assert.equal(context.stopTimer, Math.fround(0.5 + Math.fround(0.04)));
  applyVehicleForces(second, neutral, 0.04, p, staticRoad(p), context);
  near(second.velocity.length(), 0);
  assert.equal(context.stopTimer, Math.fround(0.5 + Math.fround(0.04)));
  // A third car observes the same global value, not its own fresh timer.
  const third = parked();
  applyVehicleForces(third, neutral, 0.04, p, staticRoad(p), context);
  near(third.velocity.length(), 0);
  assert.equal(first.groundedWheelCount, 4);
});

test("shared timer advances through failed sleep gates and preserves Float32 sentinel boundary", () => {
  const p = createMotionParameters(mechanics()),
    context = createMotionContext();
  const air = {
    raycast() {
      return null;
    },
  };
  let expected = 0;
  for (let i = 0; i < 24; i++) {
    applyVehicleForces(state(p), neutral, 0.04, p, air, context);
    expected = Math.fround(expected + Math.fround(0.04));
    assert.equal(context.stopTimer, expected);
  }
  assert.ok(context.stopTimer < 1);
  applyVehicleForces(state(p), neutral, 0.04, p, air, context);
  assert.equal(context.stopTimer, 100);
  const bouncing = preload(state(p, vector(0, 0.02, 0)), p);
  bouncing.bounceRate = 1;
  context.stopTimer = 0.6;
  applyVehicleForces(bouncing, neutral, 0.04, p, staticRoad(p), context);
  assert.ok(bouncing.velocity.y > 0);
  assert.equal(context.stopTimer, Math.fround(0.6 + Math.fround(0.04)));
  const eligible = preload(state(p, vector(0, 0.02, 0)), p);
  context.stopTimer = 100;
  applyVehicleForces(eligible, neutral, 0.04, p, staticRoad(p), context);
  assert.ok(eligible.velocity.y > 0);
  assert.equal(context.stopTimer, Math.fround(0.04));
});

test("crest downforce uses previous grounding, wheelbase probe, COM fraction and pitch lever", () => {
  const p = createMotionParameters(mechanics(2, 0.06));
  const ready = () => {
    const s = preload(state(p, vector(0, 0, -15 / S)), p);
    s.groundedWheelCount = 4;
    return s;
  };
  const road = (probeSupported) => {
    let call = 0;
    const probes = [];
    return {
      probes,
      raycast(origin, direction, maxDistance) {
        if (++call % 5 === 0) {
          probes.push({
            origin: origin.clone(),
            direction: direction.clone(),
            maxDistance,
          });
          return probeSupported
            ? {
                distance: maxDistance,
                normal: vector(0, 1),
                friction: 1,
                rollingResistance: 0,
                downforce: 1,
              }
            : null;
        }
        return origin.z > 0
          ? {
              distance: p.wheelPositions[0].y / S,
              normal: vector(0, 1),
              friction: 1,
              rollingResistance: 0,
              downforce: 1,
            }
          : null;
      },
    };
  };
  const crest = ready(),
    supported = ready();
  const dropRoad = road(false),
    supportRoad = road(true);
  const a = applyVehicleForces(
    crest,
    neutral,
    0.04,
    p,
    dropRoad,
    createMotionContext(),
  );
  const b = applyVehicleForces(
    supported,
    neutral,
    0.04,
    p,
    supportRoad,
    createMotionContext(),
  );
  near(b.downforce, 10);
  near(a.downforce, 6); // Front-COM distance .36 / wheelbase .6.
  near(a.force.y - b.force.y, 4);
  near(a.torque.x - b.torque.x, (0.3 - 0.06) * S * 6);
  assert.equal(crest.crestDownforce, true);
  assert.equal(supported.crestDownforce, false);
  assert.equal(crest.groundedWheelCount, 2);
  assert.deepEqual(dropRoad.probes[0].origin.toArray(), [0, 0, -0.3]);
  assert.deepEqual(dropRoad.probes[0].direction.toArray(), [0, -1, 0]);
  near(dropRoad.probes[0].maxDistance, 0.6);

  // Once latched, rear-only contact retains the branch without another probe.
  const rearOnly = {
    raycast(origin) {
      return origin.z > 0
        ? {
            distance: p.wheelPositions[0].y / S,
            normal: vector(0, 1),
            friction: 1,
            rollingResistance: 0,
            downforce: 1,
          }
        : null;
    },
  };
  applyVehicleForces(crest, neutral, 0.04, p, rearOnly, createMotionContext());
  assert.equal(crest.crestDownforce, true);
  applyVehicleForces(
    crest,
    neutral,
    0.04,
    p,
    staticRoad(p, 1, 1),
    createMotionContext(),
  );
  assert.equal(crest.crestDownforce, false);
  assert.equal(crest.groundedWheelCount, 4);
});

test("crest probe requires four previous contacts and follows full actor orientation", () => {
  const p = createMotionParameters(mechanics()),
    s = preload(state(p, vector(0, 0, -1)), p);
  s.groundedWheelCount = 3;
  let calls = 0;
  const noFront = {
    raycast(origin) {
      calls++;
      return origin.z > 0
        ? {
            distance: 0.01,
            normal: vector(0, 1),
            friction: 1,
            rollingResistance: 0,
            downforce: 1,
          }
        : null;
    },
  };
  applyVehicleForces(s, neutral, 0.04, p, noFront, createMotionContext());
  assert.equal(calls, 4);
  assert.equal(s.crestDownforce, false);
  s.groundedWheelCount = 4;
  s.orientation.setFromAxisAngle(vector(0, 0, 1), Math.PI / 3);
  s.position.set(3, 2, 4);
  s.velocity.set(0, 0, -1);
  calls = 0;
  let probe;
  const road = {
    raycast(origin, direction, maxDistance) {
      if (++calls === 5) {
        probe = {
          origin: origin.clone(),
          direction: direction.clone(),
          maxDistance,
        };
        return null;
      }
      return calls <= 2
        ? {
            distance: 0.01,
            normal: vector(0, 1).applyQuaternion(s.orientation),
            friction: 1,
            rollingResistance: 0,
            downforce: 1,
          }
        : null;
    },
  };
  applyVehicleForces(s, neutral, 0.04, p, road, createMotionContext());
  assert.equal(s.crestDownforce, true);
  near(
    probe.origin.distanceTo(
      vector(0, 0, -0.3).applyQuaternion(s.orientation).add(s.position),
    ),
    0,
  );
  near(
    probe.direction.distanceTo(vector(0, -1).applyQuaternion(s.orientation)),
    0,
  );
  near(probe.maxDistance, 0.6);
});

test("source bumpiness folds signed metric phases, combined wave and normal projection", () => {
  const coefficient = 2.358490564802196e-5;
  const offset = (x, z) =>
    wheelBumpinessOffset(vector(x, 0, z), vector(0, 1), 0, 1, 1);
  near(offset(0, 0), 0);
  near(offset(1, 0), 112 * coefficient);
  near(offset(2, 0), 624 * coefficient);
  near(offset(3, 0), 112 * coefficient);
  near(offset(4, 0), 0);
  near(offset(-2, -4), 624 * coefficient);
  near(offset(1, 1), 624 * coefficient);
  near(offset(2, 2), 0); // Combined phase folds again.
  near(offset(400 / 512, 0), 0);
  near(offset(401 / 512, 0), coefficient);
  near(offset(401.9 / 512, 0), coefficient); // Truncation toward zero.
  const slope = vector(0.5, Math.sqrt(0.75), 0);
  near(
    wheelBumpinessOffset(vector(1, 0, 0), slope, 2, 0.5, 3),
    624 * coefficient * 0.5 * 3,
  );
});

test("road bumpiness changes wheel travel before damping and can exceed the suspension envelope", () => {
  const p = createMotionParameters(mechanics()),
    s = preload(state(p), p);
  // Place rear-left metric position at spatial-wave peak(x=2,z=0).
  s.position.set(
    (2 - p.wheelPositions[0].x) / S,
    0,
    -p.wheelPositions[0].z / S,
  );
  const bumpRoad = (bumpiness) => ({
    raycast() {
      return {
        distance: p.wheelPositions[0].y / S,
        normal: vector(0, 1),
        friction: 0,
        rollingResistance: 0,
        downforce: 0,
        bumpiness,
      };
    },
  });
  const dt = 0.04,
    offset = 624 * 2.358490564802196e-5;
  const d = applyVehicleForces(
    s,
    neutral,
    dt,
    p,
    bumpRoad(1),
    createMotionContext(),
  );
  near(s.wheelLengths[0], p.wheelPositions[0].y + offset);
  near(
    d.wheelSpringLoads[0],
    p.mass * 2.5 - offset * (p.spring[0] + p.damper[0] / dt),
  );
  const airborne = preload(state(p), p);
  airborne.position.copy(s.position);
  const lost = applyVehicleForces(
    airborne,
    neutral,
    dt,
    p,
    bumpRoad(100),
    createMotionContext(),
  );
  near(lost.wheelSpringLoads[0], 0);
  near(airborne.wheelLengths[0], p.suspensionLength[0]);
});
