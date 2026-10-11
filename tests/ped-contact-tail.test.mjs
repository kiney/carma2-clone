import test from "node:test";
import assert from "node:assert/strict";
import {
  passivePedContact,
  activePedContact,
  resolvePedContactDamage,
} from "../src/physics/ped-contact.ts";
function input() {
  return {
    settings: {
      severDamage: 40,
      severChance: 10,
      maxSurvivableInitialImpact: 1,
      damagePerForce: 1000,
    },
    form: {
      personalityMass: Math.fround(0.068),
      simpleBodyMass: Math.fround(0.068),
      boneCount: 10,
      nonHumanoid: false,
    },
    state: {
      hitPoints: 100,
      flags: 0x40,
      immortal: false,
      exploding: false,
      brittle: false,
      goreLevel: 2,
      removedBoneMask: 0,
      headMissing: false,
    },
    other: {
      type: 1,
      ownerPresent: true,
      mass: 1,
      velocity: { x: Math.sqrt(0.41), y: 0, z: 0 },
    },
  };
}
test("passive native prelude wraps the impact WORD and runs before the common tail; flag40 gate skips it", () => {
  const events = [],
    packet = {
      ...input(),
      characterVelocity: { x: 0, y: 0, z: 0 },
      pedRigidType: 2,
      impactCount: 0xffff,
    };
  packet.passivePrelude = (prelude) => events.push(["prelude", prelude]);
  packet.damageTail = (tail) => {
    assert.equal(events[0][0], "prelude");
    events.push(["tail", tail.damage]);
    return {
      health: resolvePedContactDamage(
        tail.damage,
        tail.form,
        tail.state,
        tail.aliveMove,
        tail.deadMove,
      ),
      unresolved: [],
    };
  };
  const result = passivePedContact(packet);
  assert.equal(result.impactCount, 0);
  assert.deepEqual(events[0], [
    "prelude",
    { impactCount: 0, resetHaltCount: true, clearDirectionInterpolation: true },
  ]);
  assert.equal(events.length, 2);
  events.length = 0;
  packet.state.flags &= ~0x40;
  assert.equal(passivePedContact(packet).eligible, false);
  assert.equal(events.length, 0);
});

test("passive contact executes source common tail once with normalized D and post-sever head mask", () => {
  const packet = {
    ...input(),
    characterVelocity: { x: 0, y: 0, z: 0 },
    pedRigidType: 2,
    impactCount: 3,
  };
  const preview = passivePedContact(packet);
  assert.equal(preview.damage, 40);
  assert.equal(preview.hitPoints, 60);
  let calls = 0;
  const actual = passivePedContact({
    ...packet,
    damageTail: (q) => {
      calls++;
      assert.equal(q.damage, 40);
      assert.equal(q.aliveMove, 90);
      assert.equal(q.deadMove, 91);
      assert.equal(q.state.hitPoints, 100);
      return {
        health: resolvePedContactDamage(
          q.damage,
          q.form,
          { ...q.state, removedBoneMask: 2, headMissing: true },
          q.aliveMove,
          q.deadMove,
        ),
        unresolved: [],
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(actual.hitPoints, 0);
  assert.equal(actual.killed, true);
  assert.equal(actual.helperReactionMoveId, 91);
  assert.equal(actual.reactionMoveId, 94);
  assert.equal(actual.impactCount, 4);
  assert.equal(actual.collisionFilterA, 0x20000);
  assert.deepEqual(actual.unresolved, []);
});
test("active contact uses first lambda, preserves caller pin flags and never reruns a supplied HP tail", () => {
  const packet = {
    ...input(),
    pedRigidType: 2,
    pedOwnerPresent: true,
    replay: false,
    totalLambda: 50,
    firstRowLambda: 0.042,
    pedVelocityY: 0,
    worldForce: { x: 1, y: 0, z: 0 },
    faceNormal: null,
  };
  let calls = 0;
  const result = activePedContact({
    ...packet,
    damageTail: (q) => {
      calls++;
      assert.equal(q.aliveMove, -1);
      assert.equal(q.deadMove, 94);
      return {
        health: resolvePedContactDamage(
          q.damage,
          q.form,
          { ...q.state, removedBoneMask: 4 },
          q.aliveMove,
          q.deadMove,
        ),
        unresolved: [],
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.hitPoints, 100 - result.damage);
  assert.equal(result.flags & 4, 4);
  assert.deepEqual(result.unresolved, []);
  const zero = activePedContact({
    ...packet,
    firstRowLambda: 0,
    damageTail: () => {
      throw new Error("zero input entered common tail");
    },
  });
  assert.equal(zero.applied, false);
});
test("missing upstream owner returns explicit incomplete-tail diagnostics instead of applying a preview", () => {
  const result = passivePedContact({
    ...input(),
    characterVelocity: { x: 0, y: 0, z: 0 },
    pedRigidType: 2,
    impactCount: 0,
    damageTail: () => ({
      health: null,
      unresolved: ["actual-model-registration"],
    }),
  });
  assert.ok(result.unresolved.includes("bone-severing-outlet-before-HP-tail"));
  assert.ok(result.unresolved.includes("source-common-HP-tail-not-complete"));
  assert.ok(result.unresolved.includes("actual-model-registration"));
});
