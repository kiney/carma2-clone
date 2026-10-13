import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { parseNonCarMechanics } from "../src/noncars.ts";
import { createNonCarBody } from "../src/physics/noncar-body.ts";
import { advanceRigidBody } from "../src/physics/integrate.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { WorldCollision } from "../src/world.ts";

// Independent source-shaped NONCARS fixture. Rotation locking isolates normal
// momentum; zero authored OBJECT_FRICTION disables tangent impulses. The world
// skip exercises the early-return path which previously left stale candidates.
function prop(
  x,
  z = 0,
  { awake = false, vx = 0, ignoreWorld = true, mechanicsIndex = 7 } = {},
) {
  const actor = new Group();
  actor.name = `&${String(mechanicsIndex).padStart(2, "0")}c0001.ACT`;
  actor.position.set(x, 1, z);
  const mechanics = parseNonCarMechanics(
    `101\n${mechanicsIndex}\n0,0,0\n0,-.1,0\n1\nbox\n-.1,-.1,-.1\n.1,.1,.1\n.1,2\n.2,.2,.2\n0\n0\n0\nINFINITE_I\nOBJECT_FRICTION\n0\n${ignoreWorld ? "IGNORE_WORLD_COLLISIONS\n" : ""}END`,
  );
  const body = createNonCarBody(actor, mechanics);
  body.motor.sleeping = !awake;
  body.properties.immovable = !awake;
  body.state.velocity.x = vx;
  return body;
}
function simulation(bodies) {
  const scene = new Group();
  for (const body of bodies) scene.add(body.actor);
  const sim = new VehicleSimulation(new WorldCollision(scene), scene);
  for (const body of bodies) {
    sim.addNonCar(body);
    // These pair-response fixtures use registered movers/sleeping neighbors,
    // not unpulled scenery without MODEL/native collection metadata.
    assert.ok(
      sim.admitNonCar(body, {
        wake: !body.motor.sleeping,
        resetVelocity: false,
      }),
    );
  }
  return sim;
}
const close = (actual, expected, tolerance = 1e-8) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} != ${expected}`,
  );
const momentum = (bodies) =>
  bodies.reduce(
    (sum, body) => sum + body.properties.mass * body.state.velocity.x,
    0,
  );
const energy = (bodies) =>
  bodies.reduce(
    (sum, body) =>
      sum + 0.5 * body.properties.mass * body.state.velocity.x ** 2,
    0,
  );
const applied = (sim) =>
  sim.lastImpacts.filter(
    (impact) => impact.sourceType !== 9 && impact.normalImpulse > 1e-8,
  );
const pair = (impact, a, b) =>
  (impact.a === a && impact.b === b) || (impact.a === b && impact.b === a);

test("post-impulse pair recollection hits a third prop absent from the initial trajectory", () => {
  const a = prop(-0.25, 0, { awake: true, vx: 4 }),
    b = prop(0, 0, { awake: true }),
    c = prop(0.23);
  const bodies = [a, b, c],
    sim = simulation(bodies);
  // The initial candidate has A/B contact, but B is stationary and C cannot
  // be hit until the A/B impulse changes B's candidate trajectory.
  for (const body of bodies) advanceRigidBody(body, 0.04, true);
  const initial = sim.collectBodyContacts(bodies);
  assert.ok(initial.length > 0);
  assert.ok(initial.every((contact) => pair(contact, a, b)));
  const beforeMomentum = momentum(bodies),
    beforeEnergy = energy(bodies);
  try {
    sim.step();
    assert.ok(
      applied(sim).some((impact) => pair(impact, b, c)),
      "new B/C crossing must be solved in the same tick",
    );
    assert.equal(c.motor.sleeping, false);
    assert.ok(c.state.velocity.x > 0.5);
    close(momentum(bodies), beforeMomentum);
    assert.ok(
      energy(bodies) <= beforeEnergy + 0.001,
      "the redirect must not repeatedly reapply the old A/B bounce",
    );
    assert.ok(
      bodies.every((body) =>
        body.state.position.toArray().every(Number.isFinite),
      ),
    );
  } finally {
    sim.dispose();
  }
});

test("world-skipping and ordinary props have the same single body-pair impulse", () => {
  const results = [];
  for (const ignoreWorld of [false, true]) {
    const a = prop(-0.25, 0, { awake: true, vx: 4, ignoreWorld }),
      b = prop(0, 0, { awake: true, ignoreWorld });
    const bodies = [a, b],
      sim = simulation(bodies);
    const initialMomentum = momentum(bodies),
      initialEnergy = energy(bodies);
    try {
      sim.step();
      close(momentum(bodies), initialMomentum);
      assert.ok(
        energy(bodies) < initialEnergy,
        "a resting branch must not reuse the old incoming candidate",
      );
      assert.ok(a.state.velocity.x > 1 && a.state.velocity.x < 3);
      assert.ok(b.state.velocity.x > 1 && b.state.velocity.x < 3);
      // Four source pair rows constitute this one impulse solve. Previous stale
      // prediction generated36 rows and velocities -14.007/+18.007 in one tick.
      assert.equal(applied(sim).length, 4);
      results.push(bodies.map((body) => body.state.velocity.x));
      sim.step();
      assert.equal(
        applied(sim).length,
        0,
        "separating boxes do not acquire an extra bounce next tick",
      );
      close(momentum(bodies), initialMomentum);
    } finally {
      sim.dispose();
    }
  }
  results[0].forEach((value, index) => close(value, results[1][index]));
});

test("forty disconnected loose-prop wakes each rebuild their own collision group", () => {
  const count = 40,
    pairs = [],
    bodies = [];
  for (let index = 0; index < count; index++) {
    // Forty mechanics types each own one dedicated slot and share forty
    // extras. All eighty bodies fit the actual NONCAR and PHIL capacities.
    const a = prop(-0.25, index * 2, {
        awake: true,
        vx: 4,
        mechanicsIndex: index,
      }),
      b = prop(0, index * 2, { mechanicsIndex: index });
    pairs.push([a, b]);
    bodies.push(a, b);
  }
  const sim = simulation(bodies);
  const originalPrepare = sim.preparePedContacts;
  const wokeBeforeSolve = new Set();
  sim.preparePedContacts = function (contacts) {
    const sleeping = new Set(
      contacts.flatMap((contact) =>
        pairs.flatMap(([, b]) =>
          b.motor.sleeping && (contact.a === b || contact.b === b) ? [b] : [],
        ),
      ),
    );
    const prepared = originalPrepare.call(this, contacts);
    // Native geometry wake precedes lambda construction. Each sleeping owner
    // must be movable before these rows can enter the response matrix.
    for (const b of sleeping) {
      assert.equal(b.motor.sleeping, false);
      assert.equal(b.properties.immovable, false);
      wokeBeforeSolve.add(b);
    }
    return prepared;
  };
  try {
    sim.step();
    assert.equal(wokeBeforeSolve.size, count);
    for (const [index, [a, b]] of pairs.entries()) {
      assert.equal(b.motor.sleeping, false, `group${index} must wake`);
      assert.equal(b.properties.immovable, false);
      const impacts = sim.lastImpacts.filter((impact) => pair(impact, a, b));
      assert.ok(
        impacts.some(
          (impact) => impact.sourceType !== 9 && impact.normalImpulse > 0.001,
        ),
        `group${index} must rebuild after wake`,
      );
      close(momentum([a, b]), 0.4);
      close(a.state.velocity.x, pairs[0][0].state.velocity.x);
      close(b.state.velocity.x, pairs[0][1].state.velocity.x);
      assert.ok(energy([a, b]) < 0.8);
    }
    // Native retry budget applies to the connected object group (HW0x4ba450),
    // so unrelated groups after the30th must still exchange their momentum.
    assert.ok(pairs.at(-1)[1].state.velocity.x > 1);
  } finally {
    sim.preparePedContacts = originalPrepare;
    sim.dispose();
  }
});

test("stationary loose-prop overlap does not cause repeated resting impulses", () => {
  const a = prop(-0.19, 0, { awake: true }),
    b = prop(0, 0, { awake: true });
  const sim = simulation([a, b]);
  try {
    for (let tick = 0; tick < 20; tick++) {
      sim.step();
      close(a.state.velocity.x, 0);
      close(b.state.velocity.x, 0);
      assert.equal(applied(sim).length, 0);
    }
  } finally {
    sim.dispose();
  }
});
