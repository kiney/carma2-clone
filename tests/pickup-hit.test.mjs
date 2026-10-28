import assert from "node:assert/strict";
import test from "node:test";
import { Group, Vector3 } from "three";
import {
  enqueueNativePickupPowerup,
  nativePickupPowerupIndex,
} from "../src/pickup-hit.ts";
import { NativeSmashPowerupQueue } from "../src/smash-gameplay.ts";
import { PowerupSystem } from "../src/powerups.ts";
import { createVehicle } from "../src/legacy-arcade.ts";
import { createRace } from "../src/gameplay.ts";

test("native pickup identifier preserves byte1 marker and the two powerup digits", () => {
  assert.equal(nativePickupPowerupIndex("&£000107"), 0);
  assert.equal(nativePickupPowerupIndex("&£140107"), 14);
  assert.equal(
    nativePickupPowerupIndex("x£990107"),
    99,
    "native checks byte1 rather than requiring an ampersand",
  );
  for (const name of ["&140107", "&£0", "&£0x", "&£-1", ""])
    assert.equal(nativePickupPowerupIndex(name), null, name);
});

function physics(car, driver = 8, type = 1) {
  return { type, owner: { car, driver }, position: [1e6, -1e6, 1e6] };
}

test("HitPowerup queues the actual owner and ACT without a connotation distance gate", () => {
  const queue = new NativeSmashPowerupQueue(),
    car = {},
    actor = {};
  assert.deepEqual(
    enqueueNativePickupPowerup({
      queue,
      car,
      actor,
      index: 0,
      physics: physics(car),
    }),
    { queued: true, mineReaction: false },
  );
  const entries = [];
  queue.flush(1, (entry) => entries.push(entry));
  assert.equal(queue.count, 1);
  queue.flush(0, (entry) => entries.push(entry));
  assert.deepEqual(entries, [{ car, actor, index: 0 }]);
  for (const driver of [0, 2, 3, 5, 6, 7, 9])
    assert.equal(
      enqueueNativePickupPowerup({
        queue,
        actor,
        index: 0,
        physics: physics(car, driver),
      }).queued,
      false,
    );
  assert.equal(
    enqueueNativePickupPowerup({
      queue,
      actor,
      index: 0,
      physics: physics(car, 8, 5),
    }).queued,
    false,
  );
  assert.equal(
    enqueueNativePickupPowerup({ queue, actor, index: 0 }).queued,
    false,
  );
});

test("index14 admits car drivers above5 and otherwise requests the immediate incoming-physics reaction", () => {
  const car = {},
    actor = {};
  for (const driver of [6, 7, 8, 9]) {
    const queue = new NativeSmashPowerupQueue();
    assert.deepEqual(
      enqueueNativePickupPowerup({
        queue,
        actor,
        index: 14,
        physics: physics(car, driver),
      }),
      { queued: true, mineReaction: false },
    );
  }
  for (const driver of [0, 2, 3, 5]) {
    const queue = new NativeSmashPowerupQueue();
    assert.deepEqual(
      enqueueNativePickupPowerup({
        queue,
        actor,
        index: 14,
        physics: physics(car, driver),
      }),
      { queued: false, mineReaction: true },
    );
  }
  const full = new NativeSmashPowerupQueue();
  for (let i = 0; i < 50; i++) full.enqueue({ car, actor: {}, index: 1 });
  assert.deepEqual(
    enqueueNativePickupPowerup({
      queue: full,
      actor,
      index: 0,
      physics: physics(car),
    }),
    { queued: false, mineReaction: false },
  );
  assert.deepEqual(
    enqueueNativePickupPowerup({
      queue: full,
      actor,
      index: 14,
      physics: physics(car),
    }),
    { queued: false, mineReaction: true },
  );
  assert.equal(full.count, 50);
});

const table = [
  15,
  ...Array.from({ length: 15 }, (_, index) => {
    const definition =
      index === 0
        ? { action: 4, ints: [2] }
        : index === 2
          ? { action: 9, duration: 30, floats: [2, 2, 1, 1, 0, 0, 1] }
          : { action: 0, ints: [25, 25] };
    return [
      `Fixture ${index}`,
      "none",
      -1,
      definition.duration ?? -1,
      0,
      definition.action,
      definition.floats?.length ?? 0,
      ...(definition.floats ?? []),
      definition.ints?.length ?? 0,
      ...(definition.ints ?? []),
      0,
      0,
      0,
    ];
  }).flat(),
  1,
  1,
  0, // One respawn specification, enabling only source index0.
].join("\n");

async function fixture(index = 0) {
  const root = new Group(),
    actor = new Group();
  actor.name = `&£${String(index).padStart(2, "0")}0107`;
  actor.position.x = 1000;
  root.add(actor);
  const powerups = await new PowerupSystem(
    { text: async () => table },
    root,
    () => 0,
    [],
    1,
    { minimumMs: 100, extraMs: 0 },
  ).init();
  const vehicle = createVehicle(new Vector3());
  vehicle.driver = 8;
  return {
    powerups,
    actor,
    vehicle,
    race: createRace([]),
    queue: new NativeSmashPowerupQueue(),
  };
}

test("native world ACT hit hides/audio once, retains queue ownership and grants/respawns only at final flush", async () => {
  const f = await fixture(),
    car = { identity: "actual source body" };
  const picked = [],
    events = [];
  f.powerups.onPickup = (definition) => picked.push(definition.index);
  const input = { queue: f.queue, physics: physics(car) };
  assert.deepEqual(f.powerups.hitPickupActor(f.actor, input), {
    handled: true,
    firstHit: true,
    index: 0,
    queued: true,
    mineReaction: false,
  });
  assert.equal(f.actor.visible, false);
  assert.equal(f.actor.userData.c2ActorRenderStyle, 1);
  assert.deepEqual(picked, [0]);
  assert.equal(f.powerups.activeEffectsFor(f.vehicle).length, 0);
  assert.equal(f.powerups.pendingRespawns, 0);
  assert.equal(f.powerups.hitPickupActor(f.actor, input).firstHit, false);
  assert.equal(f.queue.count, 1);
  f.queue.flush(1, () => assert.fail("intermediate barriers retain grants"));
  f.queue.flush(0, (entry) => {
    assert.strictEqual(entry.car, car);
    assert.strictEqual(entry.actor, f.actor);
    assert.equal(
      f.powerups.completeQueuedPickup(
        entry.index,
        entry.actor,
        f.vehicle,
        f.race,
        (event) => events.push(event),
        500,
      ),
      true,
    );
  });
  assert.equal(f.powerups.activeEffectsFor(f.vehicle)[0].index, 2);
  assert.equal(
    f.powerups.pendingRespawns,
    1,
    "respawn uses source index0 rather than random result2",
  );
  assert.deepEqual(picked, [0], "grant cannot replay collection audio");
  assert.equal(
    f.powerups.completeQueuedPickup(0, f.actor, f.vehicle, f.race),
    false,
  );
  assert.equal(f.powerups.updateRespawns(599), 0);
  assert.equal(f.powerups.updateRespawns(600), 1);
  assert.equal(f.actor.visible, true);
  assert.equal(f.powerups.hitPickupActor(f.actor, input).firstHit, true);
  assert.deepEqual(picked, [0, 0]);
  assert.equal(f.queue.count, 1);
  f.powerups.dispose();
});

test("rejected recipients/full queue still consume an ACT but never schedule a grant or respawn", async () => {
  for (const rejected of ["owner", "capacity"]) {
    const f = await fixture(),
      car = {};
    if (rejected === "capacity")
      for (let i = 0; i < 50; i++)
        f.queue.enqueue({ car, actor: null, index: 1 });
    const result = f.powerups.hitPickupActor(f.actor, {
      queue: f.queue,
      physics: physics(car, rejected === "owner" ? 6 : 8),
    });
    assert.equal(result.firstHit, true);
    assert.equal(result.queued, false);
    assert.equal(f.actor.visible, false);
    assert.equal(f.powerups.pendingRespawns, 0);
    assert.equal(
      f.powerups.completeQueuedPickup(0, f.actor, f.vehicle, f.race),
      false,
    );
    f.powerups.dispose();
  }
});

test("ACT hit requires registered identity and visible source; mine fallback precedes ordinary collection", async () => {
  const f = await fixture(14),
    car = {},
    events = [];
  f.powerups.onPickup = () => events.push("pickup");
  const impostor = new Group();
  impostor.name = f.actor.name;
  assert.deepEqual(
    f.powerups.hitPickupActor(impostor, {
      queue: f.queue,
      physics: physics(car),
    }),
    { handled: false },
  );
  f.actor.visible = false;
  assert.equal(
    f.powerups.hitPickupActor(f.actor, {
      queue: f.queue,
      physics: physics(car),
    }).firstHit,
    false,
  );
  f.actor.visible = true;
  assert.equal(
    f.powerups.hitPickupActor(f.actor, {
      queue: f.queue,
      physics: physics(car, 5),
      onMineReaction: () => {
        assert.equal(f.actor.visible, true);
        events.push("mine");
      },
    }).mineReaction,
    true,
  );
  assert.deepEqual(events, ["mine", "pickup"]);
  assert.equal(f.queue.count, 0);
  f.powerups.dispose();
});
