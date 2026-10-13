import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import {
  DeferredContactFriction,
  resolveContacts,
  resolveContactGroups,
} from "../src/physics/contact.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
function body(mass = 1, velocity = v()) {
  return {
    state: {
      position: v(),
      orientation: new Quaternion(),
      velocity,
      angularVelocity: v(),
    },
    properties: {
      mass,
      inertia: v(1, 1, 1),
      centerOfMass: v(),
      worldFriction: 0,
      objectFriction: 0,
    },
  };
}
const contact = (a, point = v(), normal = v(0, 1, 0)) => ({
  a,
  point,
  normal,
  sourceType: 0,
  faceFriction: 1,
});
const oldBases = (...bodies) =>
  new Map(bodies.map((b) => [b, b.state.orientation.clone()]));

test("deferred single-row friction retains normal equations and standalone immediate behavior", () => {
  const a = body(2, v(4, -2)),
    immediate = body(2, v(4, -2)),
    queue = new DeferredContactFriction(),
    bases = oldBases(a);
  const [impact] = resolveContacts([contact(a)], 0.04, [], undefined, queue);
  const [direct] = resolveContacts([contact(immediate)]);
  near(impact.normalImpulse, 4.024);
  near(a.state.velocity.x, 4);
  near(a.state.velocity.y, 0.012);
  assert.equal(queue.queued, 1);
  assert.equal(queue.applied, 0);
  queue.flush(bases);
  near(impact.tangentImpulse.x, -0.35 * 4.024);
  near(a.state.velocity.x, 4 - (0.35 * 4.024) / 2);
  assert.ok(a.state.velocity.distanceTo(immediate.state.velocity) < 1e-10);
  assert.ok(impact.tangentImpulse.distanceTo(direct.tangentImpulse) < 1e-10);
  assert.equal(queue.applied, 1);
  assert.deepEqual([...queue.affectedBodies], [a]);
});

test("pre-callback local COM lever survives later COM, mass, inertia and contact-point changes", () => {
  const a = body(1, v(0, -5)),
    queue = new DeferredContactFriction(),
    bases = oldBases(a);
  const [impact] = resolveContacts(
    [contact(a, v(0, 1))],
    0.04,
    [],
    () => {
      a.properties.centerOfMass.set(100, 0, 0);
      a.properties.mass = 2;
      a.properties.inertia.set(7, 9, 4);
    },
    queue,
  );
  // Isolate friction from the already applied normal response. The retained
  // r=(0,1,0), tangent=-X gives inverse response .5+1/4 and torque +Z.
  a.state.velocity.set(1, 0, 0);
  a.state.angularVelocity.set(0, 0, 0);
  impact.point.set(200, 100, 300);
  queue.flush(bases);
  near(impact.tangentImpulse.x, -4 / 3);
  near(a.state.velocity.x, 1 / 3);
  near(a.state.angularVelocity.z, 1 / 3);
  near(a.state.angularVelocity.x, 0);
});

test("rejected solves and type9/type11/nonpositive rows never enter the pool", () => {
  for (const mode of ["reject", 9, 11, "zero", "negative"]) {
    const a = body(1, v(1, -2)),
      queue = new DeferredContactFriction();
    resolveContacts(
      [contact(a)],
      0.04,
      [],
      (rows) => {
        if (mode === "reject") return false;
        if (typeof mode === "number") rows[0].sourceType = mode;
        if (mode === "zero") rows[0].normalImpulse = 0;
        if (mode === "negative") rows[0].normalImpulse = -1;
      },
      queue,
    );
    assert.equal(queue.queued, 0, String(mode));
    assert.equal(queue.overflow, 0);
  }
});

test("local normal retries append repeated contacts and retain copied impulse records", () => {
  const a = body(1, v(10, -1)),
    queue = new DeferredContactFriction(),
    bases = oldBases(a),
    impacts = [];
  for (let retry = 0; retry < 3; retry++) {
    a.state.velocity.y = -1;
    impacts.push(resolveContacts([contact(a)], 0.04, [], undefined, queue)[0]);
  }
  assert.equal(queue.queued, 3);
  // The pool retains the accepted lambda/type rather than borrowing mutable
  // impact records retained by the caller for its next response.
  impacts[0].normalImpulse = 100;
  impacts[1].sourceType = 9;
  queue.flush(bases);
  near(a.state.velocity.x, 10 - 3 * 0.35 * 1.011);
  assert.equal(queue.applied, 3);
  for (const impact of impacts) near(impact.tangentImpulse.x, -0.35 * 1.011);
});

test("native fifty-record pool persists across response groups and counts overflow", () => {
  const a = body(1, v(100, -1)),
    queue = new DeferredContactFriction(),
    bases = oldBases(a);
  for (let retry = 0; retry < 59; retry++) {
    a.state.velocity.y = -1;
    resolveContactGroups([contact(a)], 0.04, [], undefined, queue);
  }
  assert.equal(queue.queued, 50);
  assert.equal(queue.overflow, 9);
  queue.flush(bases);
  assert.equal(queue.applied, 50);
  near(a.state.velocity.x, 100 - 50 * 0.35 * 1.011);
  const after = a.state.velocity.clone();
  queue.flush(bases);
  assert.ok(
    a.state.velocity.equals(after),
    "second flush cannot apply rows twice",
  );
});

test("flush uses old linear-velocity basis and accepted candidate gyro/response basis", () => {
  const a = body(1, v(0, 0, -5)),
    queue = new DeferredContactFriction(),
    bases = oldBases(a);
  a.properties.inertia.set(2, 3, 4);
  const [impact] = resolveContacts(
    [contact(a, v(0, 1), v(0, 0, 1))],
    0.04,
    [],
    undefined,
    queue,
  );
  a.state.orientation.setFromAxisAngle(v(0, 0, 1), Math.PI / 2);
  a.state.predictedOrientation = new Quaternion(); // An obsolete full candidate.
  a.state.position.set(7, 8, 9);
  a.state.velocity.set(1, 0, 0);
  a.state.angularVelocity.set(0, 1, 0); // Candidate-local omega=(1,0,0).
  const position = a.state.position.clone(),
    orientation = a.state.orientation.clone(),
    predicted = a.state.predictedOrientation.clone();
  // Old-local V=(1,0,0), candidate-local omega cross saved r=(0,0,1).
  // Candidate rotation maps slip to (0,1,1); remove normal Z. Response is
  // 1+1/Izz=1.25, so impulse is -.8Y and angular change +.2Z.
  queue.flush(bases);
  near(impact.tangentImpulse.y, -0.8);
  near(impact.tangentImpulse.x, 0);
  near(a.state.velocity.x, 1);
  near(a.state.velocity.y, -0.8);
  near(a.state.angularVelocity.y, 1);
  near(a.state.angularVelocity.z, 0.2);
  assert.ok(a.state.position.equals(position));
  assert.ok(a.state.orientation.equals(orientation));
  assert.ok(a.state.predictedOrientation.equals(predicted));
});

test("one local velocity cache spans the deferred pool after candidate rotation", () => {
  const a = body(1, v(0, 0, -5)),
    queue = new DeferredContactFriction(),
    bases = oldBases(a);
  for (let retry = 0; retry < 2; retry++) {
    a.state.velocity.z = -5;
    resolveContacts([contact(a, v(), v(0, 0, 1))], 0.04, [], undefined, queue);
  }
  a.state.orientation.setFromAxisAngle(v(0, 0, 1), Math.PI / 2);
  a.state.velocity.set(3, 0, 0);
  a.state.angularVelocity.set(0, 0, 0);
  queue.flush(bases);
  // Two records decrement the same OLD-local X velocity. Reinitializing
  // from world velocity per record would introduce an unwanted world-X impulse.
  near(a.state.velocity.x, 3);
  near(a.state.velocity.y, -3);
  assert.equal(queue.applied, 2);
});

test("removed-body predicate skips the entire pair and cannot mutate retained poses", () => {
  const a = body(1, v(2, -2)),
    b = body(1),
    queue = new DeferredContactFriction(),
    bases = oldBases(a, b);
  resolveContacts([{ ...contact(a), b }], 0.04, [], undefined, queue);
  const aVelocity = a.state.velocity.clone(),
    bVelocity = b.state.velocity.clone();
  queue.flush(bases, (candidate) => candidate !== b);
  assert.equal(queue.queued, 1);
  assert.equal(queue.applied, 0);
  assert.equal(queue.affectedBodies.size, 0);
  assert.ok(a.state.velocity.equals(aVelocity));
  assert.ok(b.state.velocity.equals(bVelocity));
});

test("zero material friction retains a queued row without reporting an applied impulse", () => {
  const a = body(1, v(2, -2)),
    queue = new DeferredContactFriction(),
    bases = oldBases(a);
  resolveContacts(
    [{ ...contact(a), faceFriction: 0 }],
    0.04,
    [],
    undefined,
    queue,
  );
  queue.flush(bases);
  assert.equal(queue.queued, 1);
  assert.equal(queue.applied, 0);
  assert.equal(queue.affectedBodies.size, 0);
  near(a.state.velocity.x, 2);
});
