import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { Quaternion, Vector3 } from "three";
import { parseNonCarMechanics } from "../src/noncars.ts";
import { decodeText } from "../src/formats.ts";
import { createAssetStore } from "../server/assets.mjs";
import {
  NONCAR_FLAGS,
  createNonCarMotorState,
  activateNonCarMotor,
  updateNonCarMotorWake,
  notifyNonCarBodyContact,
  notifyNonCarDrivenOn,
  applyNonCarMotionForces,
  applyNonCarTumble,
  nonCarBendExceedsThreshold,
  nonCarTorqueExceedsThreshold,
} from "../src/physics/noncar-motion.ts";

const close = (actual, expected, tolerance = 1e-10) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} != ${expected}`,
  );
const impulseG = 0.4 / 6.9;
function mechanics({
  axis = "0,1,0",
  commands = "RISE_WHEN_HIT\nRISE_WHEN_DRIVEN_ON\nNUMBER_OF_PUSHES\n3",
  snap = 10,
} = {}) {
  return parseNonCarMechanics(
    `101\n7\n0,1,0\n0,0,0\n1\nbox\n-1,0,-1\n1,2,1\n2,4\n2,2,2\n${snap}\n6.9\n0\nWORLD_TRANSLATION_JOINT\n0,0,0\n${axis}\n3\n4\n2\n1\n2\n1000\n${commands}\nEND`,
  );
}
function body(mech) {
  return {
    state: {
      position: new Vector3(),
      orientation: new Quaternion(),
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
    },
    properties: {
      mass: mech.freeMass,
      centerOfMass: new Vector3(...mech.centerOfMass),
      inertia: new Vector3(...mech.inertiaPerMass).multiplyScalar(
        mech.freeMass,
      ),
      worldFriction: 0,
    },
  };
}
function step(
  mech,
  object,
  motor,
  previousVelocity = new Vector3(),
  nowMs = 100,
  collisionFlags = 0,
) {
  return applyNonCarMotionForces(mech, object, motor, {
    nowMs,
    previousVelocity,
    collisionFlags,
  });
}

test("noncar motor preserves source high flags and exact four-wheel activation", () => {
  const mech = mechanics(),
    motor = createNonCarMotorState(mech),
    owner = {};
  assert.equal(motor.sleeping, true);
  assert.equal(
    motor.flags,
    NONCAR_FLAGS.translation |
      NONCAR_FLAGS.riseWhenHit |
      NONCAR_FLAGS.riseWhenDrivenOn,
  );
  assert.equal(
    notifyNonCarDrivenOn(mech, motor, [owner, owner, owner, null], owner),
    false,
  );
  assert.equal(
    notifyNonCarDrivenOn(mech, motor, [owner, owner, owner], owner),
    false,
  );
  assert.equal(
    notifyNonCarDrivenOn(mech, motor, [owner, owner, owner, owner], owner),
    true,
  );
  assert.equal(motor.flags & 0xff, 1);
  assert.equal(
    notifyNonCarDrivenOn(mech, motor, [owner, owner, owner, owner], owner),
    false,
  );
  motor.flags |= 0x300;
  activateNonCarMotor(motor);
  assert.equal(
    motor.flags & 0xffff,
    0x301,
    "explicit activation preserves return-counter byte",
  );
});

test("body collision starts hit motors, world contact does not", () => {
  const mech = mechanics(),
    object = body(mech),
    motor = createNonCarMotorState(mech);
  assert.equal(step(mech, object, motor, new Vector3(), 100, 1), false);
  assert.equal(motor.flags & 0xff, 0);
  step(mech, object, motor, new Vector3(), 100, 2);
  assert.equal(motor.flags & 0xff, 1);
  close(object.state.velocity.y, 3 * impulseG * Math.exp(-0.43));
  const inactive = mechanics({ commands: "" }),
    other = createNonCarMotorState(inactive);
  notifyNonCarBodyContact(inactive, other);
  assert.equal(other.flags & 0xff, 0);
  assert.equal(other.sleeping, false);
});

test("fixed-step platform impulses combine signed axis acceleration, gravity and decay", () => {
  const mech = mechanics(),
    object = body(mech),
    motor = createNonCarMotorState(mech);
  activateNonCarMotor(motor);
  object.state.velocity.set(1, 0, 2);
  step(mech, object, motor, object.state.velocity.clone());
  const decay = Math.exp(-0.43);
  close(object.state.velocity.x, decay);
  close(object.state.velocity.y, 3 * impulseG * decay);
  close(object.state.velocity.z, 2 * decay);
  const downward = mechanics({ axis: "0,-1,0" }),
    downBody = body(downward),
    downMotor = createNonCarMotorState(downward);
  activateNonCarMotor(downMotor);
  step(downward, downBody, downMotor);
  close(downBody.state.velocity.y, -5 * impulseG * decay);
  object.state.orientation.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
  object.state.velocity.set(0, 0, 0);
  step(mech, object, motor);
  close(object.state.velocity.x, -4 * impulseG * decay);
  close(object.state.velocity.y, -impulseG * decay);
});

test("contact stalls count pushes, start one pause, strictly expire and return", () => {
  const mech = mechanics(),
    object = body(mech),
    motor = createNonCarMotorState(mech);
  activateNonCarMotor(motor);
  // Contact solver stopped an upward motor: observed v=0, saved v=0.2.
  step(mech, object, motor, new Vector3(0, 0.2, 0), 100, 2);
  assert.equal(motor.flags & 0xff, 2);
  assert.equal(motor.pauseUntilMs, 1100);
  object.state.velocity.set(0, 0, 0);
  step(mech, object, motor, new Vector3(0, 0.2, 0), 140, 2);
  assert.equal(motor.flags & 0xff, 3);
  assert.equal(motor.pauseUntilMs, 1100);
  object.state.velocity.set(0, 0, 0);
  object.state.angularVelocity.set(1, 2, 3);
  step(mech, object, motor, new Vector3(0, 0.2, 0), 180, 2);
  assert.equal(motor.flags & 0xffff, 0);
  assert.equal(motor.sleeping, true);
  assert.equal(object.state.velocity.lengthSq(), 0);
  assert.equal(object.state.angularVelocity.lengthSq(), 0);
  assert.equal(step(mech, object, motor, new Vector3(), 1100), false);
  assert.equal(step(mech, object, motor, new Vector3(), 1101), true);
  assert.equal(motor.flags & 0xffff, 0x100);
  close(object.state.velocity.y, -3 * impulseG * Math.exp(-0.86));
  object.state.velocity.set(0, 0, 0);
  step(mech, object, motor, new Vector3(0, -0.2, 0), 1141);
  assert.equal(motor.flags & 0xffff, 0);
  assert.equal(motor.pauseUntilMs, 0);
  assert.equal(motor.sleeping, true);
});

test("motor stalls require signed impulse and speed thresholds, not small speed alone", () => {
  const mech = mechanics(),
    object = body(mech),
    motor = createNonCarMotorState(mech);
  activateNonCarMotor(motor);
  step(mech, object, motor);
  assert.equal(motor.pauseUntilMs, 0);
  object.state.velocity.set(0, 0.01, 0);
  step(mech, object, motor, new Vector3(0, 0.2, 0));
  assert.equal(motor.pauseUntilMs, 0, "v above 0.005 keeps motor moving");
  object.state.velocity.set(0, 0, 0);
  step(mech, object, motor, new Vector3(0, 0.049, 0));
  assert.equal(motor.pauseUntilMs, 0, "impulse below 0.05 keeps motor moving");
  assert.throws(() => updateNonCarMotorWake(motor, NaN), /clock/);
});

test("free-body gravity and source bend/torque release boundaries", () => {
  const mech = mechanics(),
    object = body(mech),
    motor = createNonCarMotorState(mech);
  delete mech.worldJoint;
  motor.flags &= ~NONCAR_FLAGS.translation;
  motor.sleeping = false;
  step(mech, object, motor);
  close(object.state.velocity.y, -impulseG);
  assert.equal(nonCarTorqueExceedsThreshold(mech, new Vector3(1, 0, 0)), false);
  assert.equal(
    nonCarTorqueExceedsThreshold(mech, new Vector3(1.0001, 0, 0)),
    true,
  );
  object.state.orientation.setFromAxisAngle(
    new Vector3(1, 0, 0),
    (Math.PI / 180) * 11,
  );
  assert.equal(nonCarBendExceedsThreshold(mech, object), true);
  object.state.orientation.setFromAxisAngle(
    new Vector3(1, 0, 0),
    (Math.PI / 180) * 9,
  );
  assert.equal(nonCarBendExceedsThreshold(mech, object), false);
  mech.snapAngleDegrees = 0;
  object.state.orientation.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
  assert.equal(nonCarBendExceedsThreshold(mech, object), false);
});

test("source TUMBLE requires contact and speed and respects axis-speed and magnitude limits", () => {
  const mech = mechanics(),
    object = body(mech);
  object.state.velocity.set(2, 0, 0);
  const tumble = { factor: 2, threshold: 1 },
    size = new Vector3(2, 2, 2),
    normal = new Vector3(0, 1, 0);
  assert.equal(applyNonCarTumble(object, tumble, size, normal, false), false);
  assert.equal(applyNonCarTumble(object, tumble, size, normal, true), true);
  close(
    object.state.angularVelocity.z,
    (-object.properties.mass * 2 * 0.1 * 1 * 0.5 * 2) /
      object.properties.inertia.z,
  );
  object.state.angularVelocity.set(0, 0, -2);
  assert.equal(applyNonCarTumble(object, tumble, size, normal, true), false);
  object.state.angularVelocity.set(0, 0, 0);
  applyNonCarTumble(object, { factor: 1e7, threshold: 1 }, size, normal, true);
  close(object.state.angularVelocity.length(), 20);
});

let originalAssetsAvailable = true;
try {
  await access(new URL("../carma2_orig", import.meta.url));
} catch {
  originalAssetsAvailable = false;
}
test(
  "stock lift data produces native source motor increments with both axis signs",
  { skip: !originalAssetsAvailable },
  async () => {
    const assets = await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
    for (const path of [
      "data/NONCARS/01sumobit2.txt",
      "data/NONCARS/03BIGDOOR.txt",
      "data/NONCARS/07silo_door.txt",
      "data/NONCARS/08silo_ftdrbot.txt",
    ]) {
      const bytes = await assets.read(path);
      if (!bytes) continue;
      const mech = parseNonCarMechanics(decodeText(bytes), path),
        object = body(mech),
        motor = createNonCarMotorState(mech);
      const joint = mech.worldJoint;
      assert.equal(joint.kind, "translation");
      activateNonCarMotor(motor);
      step(mech, object, motor);
      const expected = new Vector3(...joint.axis).multiplyScalar(
        joint.forwardAcceleration * impulseG,
      );
      expected.y -= impulseG;
      expected.multiplyScalar(Math.exp(-0.43 * joint.forwardResistance));
      close(object.state.velocity.distanceTo(expected), 0);
      // The physical impulse depends on the original mass, not a fixed prop mass.
      close(
        object.state.velocity.y * object.properties.mass,
        expected.y * mech.freeMass,
      );
    }
  },
);
