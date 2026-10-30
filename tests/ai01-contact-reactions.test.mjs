import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Group, Vector3 } from "three";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { NativeOpponentFleet } from "../src/ai/runtime.ts";
import { nativeCrashBigBangThreshold } from "../src/ai/crash-reactions.ts";
import { originalCar } from "./support/original-car.mjs";

const nodes = Array.from(
  { length: 12 },
  (_, i) =>
    new Vector3(
      10 * Math.cos((i * Math.PI) / 6),
      0,
      10 * Math.sin((i * Math.PI) / 6),
    ),
);
const sections = nodes.map((_, i) => ({
  nodeIndices: [i, (i + 1) % nodes.length],
  minSpeed: [0, 0],
  maxSpeed: [80, 80],
  width: 4,
  type: 1,
  oneWay: false,
}));
// Installed 0x4adb93 derives this from race index/count and skill.
const threshold = nativeCrashBigBangThreshold(0, 10, 1);

function assertConsumed(rival) {
  assert.deepEqual(rival.contact.flags, {
    grudgeRecent: false,
    bigBang: false,
    scaryBang: false,
  });
  assert.equal(rival.contact.lastHitter, null);
  assert.equal(rival.contact.lastWeHit, null);
}

async function fixture(
  t,
  { strength = 5, playerAttacks = true, aiPair = false, speed = 1 } = {},
) {
  async function load(human) {
    const original = await originalCar("EAGLE3");
    const damage = new DamageSystem(
      original.assets,
      original.group,
      original.text,
    );
    await damage.init();
    damage.damageContext.random = () => 0.5;
    return createSimulatedCar(
      original.group,
      original.text,
      damage,
      new Vector3(),
      0,
      human,
    );
  }
  let player, rival, aiSource;
  try {
    player = await load(true);
    rival = await load(false);
    if (aiPair) aiSource = await load(false);
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local original installation absent");
      return;
    }
    throw error;
  }
  // Empty space isolates car/car contact without adding terrain reactions.
  const simulation = new VehicleSimulation(
    { querySurfaces: () => [], raycast: () => null },
    new Group(),
  );
  simulation.gravityMultiplier = 0;
  simulation.crashClock = () => 9000;
  t.after(() => simulation.dispose());
  simulation.add(player);
  simulation.add(rival);
  if (aiSource) simulation.add(aiSource);
  const fleet = new NativeOpponentFleet(
    nodes,
    sections,
    [{ strengthRating: strength }, { strengthRating: 5 }],
    1,
    player,
    {
      skill: 1,
      raceIndex: 0,
      raceCount: 10,
      viewDistance: 45,
      repairLimits: [120, 240],
      random: () => 0,
      rayFraction: () => 0,
      isPhysicsActive: (body) => simulation.isCarPhysicsActive(body),
      setPhysicsActive: (body, active) =>
        simulation.setCarPhysicsActive(body, active),
      rematerialize: () => {
        throw new Error("Unexpected contact-fixture rematerialization");
      },
      rematerializeNearest: () => {
        throw new Error("Unexpected contact-fixture rematerialization");
      },
      hasFallenOffWorld: () => false,
      repair: (body) => simulation.repair(body),
    },
  );
  fleet.add(rival, 0, 1);
  if (aiSource) {
    fleet.add(aiSource, 1, 1);
    player.state.position.x = 5;
  }
  fleet.update(1000, 40, 1, false);
  const source = aiSource ?? (playerAttacks ? player : rival);
  const victim = aiSource || playerAttacks ? rival : player;
  source.state.position.z = 3;
  source.state.velocity.set(0, 0, -speed);
  source.state.gear = 1;
  source.state.rpm = 2500;
  source.input.throttle = 1;
  source.crashAccelerationKey = source.human;
  source.state.accForce = source.state.brakeForce = 0;
  // Two normal separated frames pass the native first-speed epsilon guard;
  // no crash snapshots or damage accumulators are written by the fixture.
  simulation.update(0.04);
  simulation.update(0.04);
  const sourceBounds = new Box3().setFromPoints(source.shapeVertices.flat());
  const victimBounds = new Box3().setFromPoints(victim.shapeVertices.flat());
  source.state.position.set(
    0,
    0,
    victimBounds.max.z - sourceBounds.min.z + 0.001,
  );
  victim.state.position.set(0, 0, 0);
  const events = [];
  const pairs = [];
  simulation.onImpactPair = (a, b) => pairs.push([a, b]);
  simulation.onCrashAttribution = (attacker, target) => {
    const accumulator = target.crashRecord.accumulator;
    const severity = Math.trunc(
      Math.min(100, Math.sqrt(Math.fround(accumulator) * 300000)),
    );
    const beforeGrudge = fleet.snapshot.catalogGrudges[0];
    const result = fleet.onCrashAttribution(attacker, target);
    events.push({
      attacker,
      target,
      accumulator,
      severity,
      beforeGrudge,
      result,
      afterGrudge: fleet.snapshot.catalogGrudges[0],
      after: fleet.snapshot.rivals[0],
    });
  };
  let steps = 2;
  while (!events.length && steps < 12) {
    simulation.update(0.04);
    steps++;
  }
  t.diagnostic(
    JSON.stringify({
      speed,
      steps,
      severity: events[0]?.severity,
      outcome: events[0]?.result?.outcome,
      accumulator: events[0]?.accumulator,
    }),
  );
  assert.ok(
    events.length,
    "real solver contact reaches native attribution within twelve steps",
  );
  assert.equal(
    events.length,
    1,
    "one accepted pair reaches the normal fleet outlet",
  );
  assert.equal(
    pairs.length,
    1,
    "one normal damage pair reaches the observer before attribution",
  );
  assert.equal(events[0].result.severity, events[0].severity);
  assert.equal(events[0].result.increment, Math.trunc(events[0].severity / 10));
  assert.equal(events[0].attacker, source);
  assert.equal(events[0].target, victim);
  assert.ok(
    simulation.lastImpacts.some((impact) => impact.normalImpulse > 0),
    "solver emitted a physical impulse",
  );
  assert.equal(
    victim.crashRecord.accumulator,
    0,
    "accepted-pair tail cleaned the observed live accumulator",
  );
  assert.equal(
    events[0].after.contact.contactTimeMs,
    1000,
    "AI uses frame time independently of raw crash time 9000",
  );
  return { simulation, fleet, player, rival, source, victim, events, steps };
}

test("real mild player contact leaves the regular racer racing", async (t) => {
  const f = await fixture(t, { speed: 0.75 });
  if (!f) return;
  const e = f.events[0];
  assert.ok(e.severity >= 5 && e.severity < threshold);
  assert.equal(e.result.outcome, "human-hit-ai");
  assert.equal(
    e.afterGrudge,
    Math.min(100, e.beforeGrudge + Math.trunc(e.severity / 10)),
  );
  assert.equal(e.after.contact.flags.bigBang, false);
  assert.equal(e.after.contact.lastHitter, f.player.group.uuid);
  f.fleet.update(1040, 40, 1, false);
  assert.equal(f.fleet.snapshot.rivals[0].objective.objective, "complete-race");
  assertConsumed(f.fleet.snapshot.rivals[0]);
  assert.equal(f.fleet.snapshot.catalogGrudges[0], e.afterGrudge);
});

test("real strong player contact makes a surviving strong racer retaliate", async (t) => {
  const f = await fixture(t, { speed: 2 });
  if (!f) return;
  const e = f.events[0];
  assert.ok(e.severity >= threshold);
  assert.equal(e.result.outcome, "human-hit-ai");
  assert.equal(e.after.contact.flags.bigBang, true);
  assert.equal(
    e.afterGrudge,
    Math.min(100, e.beforeGrudge + Math.trunc(e.severity / 10)),
  );
  assert.equal(f.rival.knackered, false);
  f.fleet.update(1040, 40, 1, false);
  assert.equal(f.fleet.snapshot.rivals[0].objective.objective, "pursue");
  const reactive = f.fleet.snapshot.rivals[0];
  assert.equal(reactive.objective.target, f.player.group.uuid);
  assert.equal(
    f.fleet.snapshot.catalogGrudges[0],
    Math.min(
      100,
      Math.max(20, e.afterGrudge) + Math.trunc(10 + 40 * reactive.nastiness),
    ),
  );
  assertConsumed(reactive);
});

test("real scary player contact makes a surviving weak racer flee while stunned", async (t) => {
  const f = await fixture(t, { strength: 3, speed: 2.2 });
  if (!f) return;
  const e = f.events[0];
  assert.ok(e.severity >= 80);
  assert.equal(e.after.contact.flags.scaryBang, true);
  const stunUntil = 1000 + 1000 + 30 * e.severity;
  assert.equal(e.after.objective.stunUntilMs, stunUntil);
  assert.deepEqual(e.after.forces, {
    accForce: 0,
    brakeForce: 0,
    curvature: 0,
  });
  assert.equal(f.rival.knackered, false);
  f.fleet.update(1040, 40, 1, false);
  const fled = f.fleet.snapshot.rivals[0];
  assert.equal(fled.objective.objective, "run-away");
  assert.equal(fled.objective.stunUntilMs, stunUntil);
  assertConsumed(fled);
  assert.equal(
    f.fleet.snapshot.catalogGrudges[0],
    e.afterGrudge,
    "scary flee precedes retaliation grudge increase",
  );
  f.fleet.update(stunUntil, 40, 1, false);
  assert.deepEqual(f.fleet.snapshot.rivals[0].forces, {
    accForce: 0,
    brakeForce: 0,
    curvature: 0,
  });
  f.fleet.update(stunUntil + 1, 40, 1, false);
  assert.equal(f.fleet.snapshot.rivals[0].objective.objective, "run-away");
  assert.notDeepEqual(
    f.fleet.snapshot.rivals[0].forces,
    { accForce: 0, brakeForce: 0, curvature: 0 },
    "physical escape follower resumes control after strict stun expiry",
  );
});

test("real regular AI contact with a stationary player starts pursuit", async (t) => {
  const f = await fixture(t, { playerAttacks: false, speed: 0.75 });
  if (!f) return;
  const e = f.events[0];
  assert.ok(e.severity >= 5);
  assert.equal(e.result.outcome, "ai-hit-human");
  assert.equal(
    e.afterGrudge,
    Math.max(0, e.beforeGrudge - 2 * Math.trunc(e.severity / 10)),
  );
  assert.equal(e.after.contact.lastWeHit, f.player.group.uuid);
  assert.equal(f.rival.knackered, false);
  f.fleet.update(1040, 40, 1, false);
  assert.equal(f.fleet.snapshot.rivals[0].objective.objective, "pursue");
  const reactive = f.fleet.snapshot.rivals[0];
  assert.equal(reactive.objective.target, f.player.group.uuid);
  assert.equal(
    f.fleet.snapshot.catalogGrudges[0],
    Math.min(
      100,
      Math.max(20, e.afterGrudge) + Math.trunc(10 + 40 * reactive.nastiness),
    ),
  );
  assertConsumed(reactive);
});

test("real regular AI-to-AI contact preserves grudge and does not invent retaliation", async (t) => {
  const f = await fixture(t, { aiPair: true, speed: 0.75 });
  if (!f) return;
  const e = f.events[0];
  assert.ok(e.severity >= 5);
  assert.equal(e.result.outcome, "ai-hit-ai");
  assert.equal(e.afterGrudge, e.beforeGrudge);
  assert.equal(e.after.contact.lastHitter, f.source.group.uuid);
  assert.equal(e.after.contact.flags.grudgeRecent, true);
  assert.deepEqual(f.fleet.snapshot.catalogGrudges, [10, 10]);
  f.fleet.update(1040, 40, 1, false);
  assert.ok(
    f.fleet.snapshot.rivals.every(
      (r) => r.objective.objective === "complete-race",
    ),
  );
  assert.deepEqual(f.fleet.snapshot.catalogGrudges, [10, 10]);
  f.fleet.snapshot.rivals.forEach(assertConsumed);
});
