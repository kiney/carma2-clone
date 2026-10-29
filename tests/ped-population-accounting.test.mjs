import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { PedPopulationAccounting } from "../src/ped-population-accounting.ts";
import { PedestrianSystem } from "../src/pedestrians.ts";

test("source flag100 counting retains groups independently of physical death", () => {
  const accounting = new PedPopulationAccounting();
  const first = {},
    second = {},
    other = {};
  accounting.enroll(first, 63);
  accounting.enroll(second, 63);
  accounting.enroll(other, 7);
  assert.deepEqual(accounting.oneLess(first), {
    group: 63,
    count: 1,
    total: 1,
  });
  assert.equal(accounting.flags(first), 0x100);
  assert.equal(accounting.oneLess(first), null);
  assert.equal(accounting.alive, 2);
  assert.deepEqual(
    [...accounting.groupCounts],
    [
      [63, { total: 2, killed: 1 }],
      [7, { total: 1, killed: 0 }],
    ],
  );
  assert.throws(() => accounting.oneLess({}), /Unknown/);
  accounting.reset();
  assert.equal(accounting.hits, 0);
  assert.equal(accounting.alive, 3);
  assert.equal(accounting.flags(first), 0);
  accounting.clear();
  assert.equal(accounting.alive, 0);
});

async function fixture(onCount, onHit) {
  const prototype = new THREE.Group();
  prototype.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.28, 0.06),
      new THREE.MeshBasicMaterial(),
    ),
  );
  const floor = new THREE.BufferGeometry();
  floor.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-10, 0, -10, 0, 0, 10, 10, 0, -10], 3),
  );
  const material = new THREE.MeshBasicMaterial();
  material.name = "sidewalk";
  return PedestrianSystem.create(
    {
      manifest: [{ path: "data/PEDS/PEEPS/Alice/Alice.act", size: 1000 }],
      text: async () => "// Group #7\n1\nAlice\n",
      scene: async () => ({ group: prototype.clone(true) }),
    },
    new THREE.Mesh(floor, material),
    "// Ped specs\n1\nsidewalk\n0\n7\n2\n0\n0\n",
    () => 0,
    {
      spawn: new THREE.Vector3(),
      maxCount: 1,
      random: () => 0.5,
      onCount,
      onHit,
    },
  );
}

test("native counting binds a real authored population owner and avoids estimated death transport", async () => {
  const counts = [],
    hits = [];
  const peds = await fixture(
    (event) =>
      counts.push({
        event,
        hits: peds.hits,
        alive: peds.alive,
        group: peds.groupCounts.get(7),
      }),
    (event) => hits.push(event),
  );
  const actor = peds.group.children[0],
    owner = {},
    character = { flags: 0x40 };
  peds.bindNativeCountingOwner(owner, actor, character);
  assert.throws(
    () => peds.bindNativeCountingOwner({}, actor, { flags: 0 }),
    /binding/,
  );
  assert.throws(
    () => peds.bindNativeCountingOwner({}, new THREE.Group(), { flags: 0 }),
    /binding/,
  );
  assert.throws(
    () => peds.oneLessNativePed(owner, { flags: 0x100 }, 100),
    /owner/,
  );
  assert.equal(
    peds.oneLessNativePed(owner, character, 100),
    false,
    "uncommitted source gate cannot count",
  );
  peds.update(0, { position: actor.position.clone(), yaw: 0, speed: 3 });
  assert.equal(
    peds.hits,
    0,
    "native owner excludes competing visual sweep death",
  );
  const before = peds.states[0],
    bloodBefore = peds.bloodStats;
  character.flags |= 0x100;
  assert.equal(peds.oneLessNativePed(owner, character, 101), true);
  assert.equal(peds.oneLessNativePed(owner, character, 102), false);
  assert.equal(counts.length, 1);
  assert.equal(counts[0].hits, 1);
  assert.equal(counts[0].alive, 0);
  assert.deepEqual(counts[0].group, { total: 1, killed: 1 });
  assert.equal(counts[0].event.actor, actor);
  assert.equal(counts[0].event.source, "native");
  assert.equal(counts[0].event.group, 7);
  assert.equal(counts[0].event.timeMs, 101);
  assert.deepEqual(peds.states[0].velocity, before.velocity);
  assert.equal(peds.states[0].corporeal, before.corporeal);
  peds.update(0.1, { position: actor.position.clone(), yaw: 0, speed: 3 });
  assert.deepEqual(
    peds.states[0].velocity,
    before.velocity,
    "no legacy corpse transport",
  );
  assert.deepEqual(peds.bloodStats, bloodBefore);
  assert.equal(
    hits.length,
    0,
    "native counting does not fabricate score inputs",
  );
  peds.reset();
  assert.equal(peds.hits, 0);
  assert.equal(peds.alive, 1);
  peds.update(0, { position: actor.position.clone(), yaw: 0, speed: 3 });
  assert.equal(peds.hits, 1, "normal reset returns owner to sweep counting");
  peds.dispose();
});

test("ordinary counting precedes scoring and existing native binding inherits its once gate", async () => {
  const order = [];
  const peds = await fixture(
    () => order.push(["count", peds.hits, peds.groupCounts.get(7).killed]),
    () => order.push(["score", peds.hits, peds.groupCounts.get(7).killed]),
  );
  const actor = peds.group.children[0];
  peds.update(0, { position: actor.position.clone(), yaw: 0, speed: 3 });
  assert.deepEqual(order, [
    ["count", 1, 1],
    ["score", 1, 1],
  ]);
  const owner = {},
    character = { flags: 0x40, body: { pedestrianFlags: 0x40 } };
  peds.bindNativeCountingOwner(owner, actor, character);
  assert.equal(character.flags, 0x140);
  assert.equal(
    character.body.pedestrianFlags,
    0x140,
    "an already allocated native body inherits the same source gate",
  );
  assert.equal(peds.oneLessNativePed(owner, character, 10), false);
  assert.equal(order.length, 2);
  peds.dispose();
});

test("source vanish releases population once without Kill, score, blood or HP changes", async () => {
  const counts = [],
    hits = [];
  const peds = await fixture(
    (event) => counts.push(event),
    (event) => hits.push(event),
  );
  const actor = peds.group.children[0],
    owner = {},
    character = { flags: 0x40, hitPoints: 100 };
  peds.bindNativeCountingOwner(owner, actor, character);
  const before = peds.states[0],
    bloodBefore = peds.bloodStats;
  assert.equal(peds.oneLessNativePed(owner, character, 12, "vanished"), false);
  character.flags |= 0x80;
  assert.equal(peds.oneLessNativePed(owner, character, 13, "vanished"), true);
  assert.equal(
    character.flags,
    0x1c0,
    "OneLess supplies100 after vanish supplied80",
  );
  assert.equal(character.hitPoints, 100, "vanish does not call Kill");
  assert.equal(peds.oneLessNativePed(owner, character, 14, "vanished"), false);
  assert.equal(peds.oneLessNativePed(owner, character, 15), false);
  assert.equal(peds.hits, 1);
  assert.equal(peds.alive, 0);
  assert.equal(counts.length, 1);
  assert.equal(counts[0].timeMs, 13);
  assert.equal(hits.length, 0, "vanish is not a score-death outlet");
  assert.deepEqual(peds.states[0].velocity, before.velocity);
  assert.deepEqual(peds.bloodStats, bloodBefore);
  peds.reset();
  assert.equal(peds.hits, 0);
  assert.equal(peds.alive, 1);
  peds.dispose();
});

test("inactive napalm scoring does not consume population or mission group counts", async () => {
  const counts = [],
    hits = [];
  const peds = await fixture(
    (event) => counts.push(event),
    (event) => hits.push(event),
  );
  const actor = peds.group.children[0];
  actor.position.set(0, 0, 0);
  const car = { position: new THREE.Vector3(-2, 0, 0), yaw: 0, speed: 0 };
  peds.update(0, car, { gameTimeMs: 1000, cameraPosition: actor.position });
  const source = {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    owner: {},
  };
  peds.useCombatPowerup(49, [], source, 80, 1000);
  peds.update(0, car, { gameTimeMs: 1000, cameraPosition: actor.position });
  assert.equal(peds.states[0].burningUntilMs, 16000);
  peds.update(0, car, {
    gameTimeMs: 1001,
    cameraPosition: new THREE.Vector3(10000, 0, 0),
    immortalPedestrians: true,
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].count, 0);
  assert.equal(counts.length, 0);
  assert.equal(peds.hits, 0);
  assert.equal(peds.alive, 1);
  assert.equal(
    peds.states[0].alive,
    false,
    "physical HP state is independent of OneLessPed",
  );
  assert.deepEqual(peds.groupCounts.get(7), { total: 1, killed: 0 });
  peds.dispose();
});
