import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion } from "three";
import {
  DeferredContactFriction,
  resolveContacts,
} from "../src/physics/contact.ts";
import { createBallJoint } from "../src/physics/joint.ts";
import {
  DT,
  v,
  identity,
  kineticEnergy,
  rigidBody,
  worldContact,
  makeRunawayFixture,
  collectEmitterControls,
  contradictoryPacket,
  observeProductionRows,
} from "./support/runaway-contact-fixture.mjs";

const near = (actual, expected, tolerance = 1e-7) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );
const impulseSum = (impacts) =>
  impacts.reduce((sum, row) => sum + row.normalImpulse, 0);
const assertUnilateral = (impacts) =>
  assert.ok(
    impacts.every(
      (row) => Number.isFinite(row.normalImpulse) && row.normalImpulse >= 0,
    ),
    "every unilateral normal multiplier must be finite and nonnegative",
  );
const finite = (body) =>
  [body.state.position, body.state.velocity, body.state.angularVelocity].every(
    (vector) => vector.toArray().every(Number.isFinite),
  ) && body.state.orientation.toArray().every(Number.isFinite);
const changedBy = (body, before) =>
  body.state.velocity.distanceTo(before.velocity) +
  body.state.angularVelocity.distanceTo(before.omega);
const motion = (body) => ({
  velocity: body.state.velocity.clone(),
  omega: body.state.angularVelocity.clone(),
});

// C2's .01 resting/impact bias permits a little positive work. The measured
// source-only reproduction gains .00816 at mass .05; .02 leaves substantial
// room for that native behavior while rejecting the million-unit energy jump.
const directBiasAllowance = (mass) => (0.02 * mass) / 0.05;

for (const mode of ["source", "guard"]) {
  test(`ordinary ${mode} emitter still produces a useful bounded collision`, () => {
    const fixture = makeRunawayFixture();
    try {
      const rows = collectEmitterControls(fixture)[mode];
      assert.ok(rows.length > 0, `${mode} contact coverage must remain live`);
      const before = motion(fixture.body),
        initial = kineticEnergy(fixture.body);
      const impacts = resolveContacts(rows, DT);
      assertUnilateral(impacts);
      assert.ok(
        impulseSum(impacts) > 1e-7,
        "geometry must produce a physical response",
      );
      assert.ok(
        changedBy(fixture.body, before) > 1e-4,
        "collision response cannot be silently disabled",
      );
      assert.ok(
        kineticEnergy(fixture.body) <=
          initial + directBiasAllowance(fixture.body.properties.mass),
      );
      assert.ok(finite(fixture.body));
    } finally {
      fixture.dispose();
    }
  });
}

for (const offset of [0, 0.00243293]) {
  test(`raw contradictory world packet has bounded impulse and energy (lever offset ${offset})`, () => {
    const fixture = makeRunawayFixture();
    try {
      const { body } = fixture;
      const initial = kineticEnergy(body);
      const impacts = resolveContacts(
        contradictoryPacket(body, { offset }),
        DT,
      );
      assert.ok(finite(body));
      assertUnilateral(impacts);
      // For the near-dependent fixture the authenticated original solver gives
      // partial lambda [0.0003020222357, 0], status -1. We allow a generous
      // physical envelope, without requiring a particular failure API or pivot.
      assert.ok(
        impulseSum(impacts) <= 0.1,
        `near-canceling constraints must not emit enormous damage impulses: ${impulseSum(impacts)}`,
      );
      assert.ok(
        kineticEnergy(body) <=
          initial + directBiasAllowance(body.properties.mass),
        "unrealizable opposed demands must not become kinetic energy",
      );
    } finally {
      fixture.dispose();
    }
  });
}

test("rigidly rotated and mass-scaled contradictory packet remains bounded beside its analytical single-row control", () => {
  const rotation = new Quaternion().setFromAxisAngle(
    v(1, -2, 3).normalize(),
    0.71,
  );
  const fixture = makeRunawayFixture({
    mass: 0.2,
    rotation,
    translation: v(4, -2, 1),
  });
  try {
    const { body } = fixture;
    const initialMotion = motion(body),
      initial = kineticEnergy(body);
    const rows = contradictoryPacket(body, { rotation });
    const control = rows[1];
    const com = body.properties.centerOfMass
      .clone()
      .applyQuaternion(rotation)
      .add(body.state.position);
    const lever = control.point.clone().sub(com);
    const torqueLocal = lever
      .clone()
      .cross(control.normal)
      .applyQuaternion(rotation.clone().invert());
    const inverseEffectiveMass =
      1 / body.properties.mass +
      torqueLocal.x ** 2 / body.properties.inertia.x +
      torqueLocal.y ** 2 / body.properties.inertia.y +
      torqueLocal.z ** 2 / body.properties.inertia.z;
    const closing = -control.normal.dot(
      body.state.velocity
        .clone()
        .add(body.state.angularVelocity.clone().cross(lever)),
    );
    assert.ok(
      closing > 1,
      "the independent control must be an ordinary closing collision",
    );
    const ordinary = resolveContacts([control], DT);
    assert.ok(ordinary.length > 0, "the ordinary control cannot disappear");
    assertUnilateral(ordinary);
    near(
      ordinary[0].normalImpulse,
      (0.01 + 1.001 * closing) / inverseEffectiveMass,
    );
    assert.ok(
      ordinary[0].normalImpulse > 1e-4,
      "the ordinary closing row must produce a meaningful impulse",
    );
    assert.ok(changedBy(body, initialMotion) > 1e-3);
    assert.ok(
      kineticEnergy(body) <=
        initial + directBiasAllowance(body.properties.mass),
    );

    body.state.velocity.copy(initialMotion.velocity);
    body.state.angularVelocity.copy(initialMotion.omega);
    const impacts = resolveContacts(rows, DT);
    assert.ok(finite(body));
    assertUnilateral(impacts);
    assert.ok(
      impulseSum(impacts) <= (0.1 * body.properties.mass) / 0.05,
      "rotation and mass scaling must not reintroduce enormous opposing impulses",
    );
    assert.ok(
      kineticEnergy(body) <=
        initial + directBiasAllowance(body.properties.mass),
      "a change of rigid frame must preserve the physical energy bound",
    );
  } finally {
    fixture.dispose();
  }
});

const productionCases = [
  { name: "reported shallow plane", options: {} },
  {
    name: "tilted frame, opposite slope and heavier owner",
    options: {
      slope: -2e-6,
      mass: 0.2,
      wallFriction: 0.2,
      rotation: new Quaternion().setFromAxisAngle(v(1, 1, 1).normalize(), 0.63),
      translation: v(1.25, -0.75, 0.3),
    },
  },
];
for (const { name, options } of productionCases) {
  test(`full production tick keeps first and subsequent responses bounded: ${name}`, () => {
    const fixture = makeRunawayFixture(options);
    try {
      const { body, simulation } = fixture;
      const packets = observeProductionRows(simulation);
      const initial = kineticEnergy(body),
        before = motion(body);
      const responseEnergies = [];
      simulation.onLocalResponseTrace = (event) => {
        if (event.phase === "response")
          responseEnergies.push(kineticEnergy(body));
      };
      simulation.step();
      assert.ok(
        finite(body),
        "the complete production step must remain finite",
      );
      // One gravity update and native bias work are allowed; no damping or
      // escape containment is needed to make a normal first collision safe.
      const allowance = (0.06 * body.properties.mass) / 0.05;
      assert.ok(
        responseEnergies.every((energy) => energy <= initial + allowance),
        `first/contact retry energy escaped its physical envelope: ${Math.max(...responseEnergies)}`,
      );
      assert.ok(kineticEnergy(body) <= initial + allowance);
      assert.ok(
        packets.some((rows) => rows.some((row) => row.a === body && !row.b)),
        "actual production world collection must remain enabled",
      );
      assert.ok(
        simulation.lastImpacts.some(
          (row) => row.a === body && !row.b && row.normalImpulse > 1e-7,
        ),
        "admitted production geometry must cause a useful world impulse",
      );
      assert.ok(changedBy(body, before) > 1e-3);
    } finally {
      fixture.dispose();
    }
  });
}

test("independent floor and wall remain active through the production merge", () => {
  const fixture = makeRunawayFixture({
    slope: 0,
    wall: true,
    position: v(0.1, 0.05, 0),
    velocity: v(-4, -2, 1),
    spin: 0,
  });
  try {
    const { simulation, body } = fixture;
    const initial = kineticEnergy(body);
    simulation.step();
    const applied = simulation.lastImpacts.filter(
      (row) => row.a === body && !row.b && row.normalImpulse > 1e-7,
    );
    assert.ok(
      applied.some((row) => Math.abs(row.normal.x) > 0.9),
      "independent wall response must survive admission",
    );
    assert.ok(
      applied.some((row) => Math.abs(row.normal.y) > 0.9),
      "independent floor response must survive admission",
    );
    assert.ok(
      body.state.velocity.x > -1,
      "the car must not pass through the wall at its incoming speed",
    );
    assert.ok(
      body.state.velocity.y > -1,
      "the floor must oppose downward motion",
    );
    assert.ok(kineticEnergy(body) <= initial + 0.06);
    assert.ok(finite(body));
  } finally {
    fixture.dispose();
  }
});

test("high speed oblique finite-plane collision retains normal response and tangential travel", () => {
  const fixture = makeRunawayFixture({
    slope: 0.03,
    position: v(0.4, 0.5, -0.5),
    velocity: v(8, -25, 6),
    spin: 0,
    twoSided: false,
  });
  try {
    const { body, simulation } = fixture;
    const initial = kineticEnergy(body);
    simulation.step();
    const applied = simulation.lastImpacts.filter(
      (row) => row.a === body && !row.b && row.normalImpulse > 1e-7,
    );
    assert.ok(
      impulseSum(applied) > 0.3,
      "a high-speed real crossing must receive substantial normal impulse",
    );
    assert.ok(
      body.state.velocity.y > -10,
      "collision coverage must stop most inward speed",
    );
    assert.ok(
      body.state.velocity.z > 5,
      "zero-friction oblique travel must remain playable",
    );
    assert.ok(kineticEnergy(body) <= initial + 0.06);
    assert.ok(finite(body));
  } finally {
    fixture.dispose();
  }
});

test("opposite normals at independent levers remain a valid two-contact rotational stop", () => {
  const body = rigidBody({ mass: 2, inertia: v(2, 2, 1), omega: v(0, 0, -3) });
  const rows = [
    worldContact(body, v(1), v(0, 1)),
    worldContact(body, v(-1), v(0, -1)),
  ];
  const initial = kineticEnergy(body);
  const impacts = resolveContacts(rows, DT);
  assert.ok(
    impacts.every((row) => row.normalImpulse > 1),
    "opposite directions alone do not make an invalid packet",
  );
  near(body.state.velocity.length(), 0);
  near(body.state.angularVelocity.z, 0.013);
  assert.ok(kineticEnergy(body) < initial);
});

test("ordinary contacts retain native bias across masses, rigid rotations and independent corner normals", () => {
  for (const mass of [0.05, 2, 12])
    for (const angle of [0, 0.37, 1.1]) {
      const rotation = new Quaternion().setFromAxisAngle(
        v(1, 2, -1).normalize(),
        angle,
      );
      const body = rigidBody({
        mass,
        rotation,
        velocity: v(-3, -2, 1).applyQuaternion(rotation),
      });
      const rows = [
        worldContact(body, v(), v(1).applyQuaternion(rotation)),
        worldContact(body, v(), v(0, 1).applyQuaternion(rotation)),
      ];
      const impacts = resolveContacts(rows, DT);
      assert.ok(
        impacts.every((row) => row.normalImpulse > mass),
        "both genuine corner normals must contribute",
      );
      const localVelocity = body.state.velocity
        .clone()
        .applyQuaternion(rotation.clone().invert());
      near(localVelocity.x, 0.013);
      near(localVelocity.y, 0.012);
      near(localVelocity.z, 1);
    }
});

test("off-center car/car impact conserves momentum and applies the expected angular response", () => {
  const a = rigidBody({
    mass: 2,
    velocity: v(8, 0, 2),
    position: v(-1, 0, 0),
    inertia: v(2, 4, 6),
  });
  const b = rigidBody({
    mass: 5,
    velocity: v(-3, 0, -1),
    position: v(1, 0, 0),
    inertia: v(5, 7, 9),
  });
  const point = v(0, 0, 0.8),
    normal = v(-1);
  const momentum = a.state.velocity
    .clone()
    .multiplyScalar(2)
    .addScaledVector(b.state.velocity, 5);
  const initial = kineticEnergy(a) + kineticEnergy(b);
  const expected =
    (11 * 1.001 + 0.01) / (1 / 2 + 1 / 5 + 0.8 ** 2 / 4 + 0.8 ** 2 / 7);
  // Defer friction to isolate the normal effective-mass formula and torque.
  const [impact] = resolveContacts(
    [worldContact(a, point, normal, b)],
    DT,
    [],
    undefined,
    new DeferredContactFriction(),
  );
  near(impact.normalImpulse, expected);
  assert.ok(
    impact.normalImpulse > 10,
    "a strong ordinary collision must not be filtered away",
  );
  const afterMomentum = a.state.velocity
    .clone()
    .multiplyScalar(2)
    .addScaledVector(b.state.velocity, 5);
  near(afterMomentum.distanceTo(momentum), 0);
  near(a.state.angularVelocity.y, (-0.8 * expected) / 4);
  near(b.state.angularVelocity.y, (0.8 * expected) / 7);
  assert.ok(kineticEnergy(a) + kineticEnergy(b) < initial);
});

test("redundant same-direction rows retain a meaningful aggregate contact response", () => {
  const body = rigidBody({ mass: 2, velocity: v(0, -4) });
  const rows = [-1, 1].flatMap((x) =>
    [-1, 1].map((z) => worldContact(body, v(x, 0, z), v(0, 1))),
  );
  const initial = kineticEnergy(body);
  const impacts = resolveContacts(rows, DT);
  near(impulseSum(impacts), 8.028);
  near(body.state.velocity.y, 0.014);
  near(body.state.angularVelocity.length(), 0);
  assert.ok(kineticEnergy(body) < initial);
});

test("protected bilateral joint reactions remain signed beside a real world contact", () => {
  const parent = rigidBody({ mass: 2, velocity: v(0, -3) });
  const child = rigidBody({ mass: 1, velocity: v(3, -3) });
  const joint = createBallJoint(child, parent, v(), v());
  const initial = kineticEnergy(parent) + kineticEnergy(child);
  let reactions = [];
  const [impact] = resolveContacts(
    [worldContact(parent, v(), v(0, 1))],
    DT,
    [joint],
    (_impacts, joints) => {
      reactions = joints;
    },
  );
  assert.ok(impact.normalImpulse > 9, "contact must stop both linked masses");
  near(parent.state.velocity.y, 0.013);
  near(child.state.velocity.y, 0.013);
  near(parent.state.velocity.x, 1);
  near(child.state.velocity.x, 1);
  assert.ok(
    reactions.some((reaction) => reaction.normalImpulse < -1),
    "bilateral rows must retain a negative reaction",
  );
  assert.ok(kineticEnergy(parent) + kineticEnergy(child) < initial);
});
