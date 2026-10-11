import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parseTrackSmashables } from "../src/world-smash.ts";
import {
  NativeSmashPowerupQueue,
  enqueueConnotationPowerup,
  consumeSmashAward,
} from "../src/smash-gameplay.ts";

const award = (frequency = "singleshot", first = 3000, second = 20) => ({
  frequency,
  first,
  second,
  integerFirst: 132,
  integerSecond: 0,
});
const human = { physics: { type: 1, driver: 8 }, effectMagnitude: 10 };

test("queue50 retains argument-one barriers and grants then respawns in insertion order", () => {
  const queue = new NativeSmashPowerupQueue();
  const car = {},
    actor = {},
    calls = [];
  queue.enqueue({ car, index: 14, actor: null });
  queue.enqueue({ car, index: 7, actor });
  const grant = (entry) => calls.push(["grant", entry.index, entry.actor]);
  const respawn = (index, owner) => calls.push(["respawn", index, owner]);
  assert.equal(queue.flush(1, grant, respawn), 0);
  assert.equal(queue.count, 2);
  assert.deepEqual(calls, []);
  assert.equal(queue.flush(0, grant, respawn), 2);
  assert.deepEqual(calls, [
    ["grant", 14, null],
    ["respawn", 14, null],
    ["grant", 7, actor],
    ["respawn", 7, actor],
  ]);
  assert.equal(queue.count, 0);
});

test("queue50 does not deduplicate and consumed slots retain capacity during dynamic drain", () => {
  const queue = new NativeSmashPowerupQueue(),
    car = {};
  for (let i = 0; i < 50; i++)
    assert.equal(queue.enqueue({ car, index: 14, actor: null }), true);
  assert.equal(queue.enqueue({ car, index: 14, actor: null }), false);
  let granted = 0;
  assert.equal(
    queue.flush(0, () => {
      granted++;
      assert.equal(queue.enqueue({ car, index: 1, actor: null }), false);
    }),
    50,
  );
  assert.equal(granted, 50);
  assert.equal(queue.enqueue({ car, index: 14, actor: null }), true);
  const indices = [];
  assert.equal(
    queue.flush(0, (entry) => {
      indices.push(entry.index);
      if (entry.index === 14) queue.enqueue({ car, index: 7, actor: null });
    }),
    2,
  );
  assert.deepEqual(indices, [14, 7], "native rereads the live count");
});

test("connotation powerup requires human car physics, a live nearby position, and null respawn actor", () => {
  const queue = new NativeSmashPowerupQueue(),
    car = {};
  const physics = { type: 1, owner: { car, driver: 8 }, position: [0, 0, 0] };
  for (const invalid of [
    undefined,
    { ...physics, type: 2 },
    { ...physics, owner: undefined },
    { ...physics, owner: { car, driver: 6 } },
  ])
    assert.equal(
      enqueueConnotationPowerup(queue, 14, invalid, [0, 0, 0]),
      false,
    );
  assert.equal(enqueueConnotationPowerup(queue, 0, physics, [0, 0, 0]), false);
  assert.equal(
    enqueueConnotationPowerup(queue, 14, physics, [0, 0, 0], true),
    false,
  );
  assert.equal(enqueueConnotationPowerup(queue, 14, physics, [1, 1, 0]), false);
  assert.equal(
    enqueueConnotationPowerup(queue, 14, physics, [1, 1 - 1e-9, 0]),
    false,
    "the native inputs are float32 before the strict squared-distance gate",
  );
  assert.equal(
    enqueueConnotationPowerup(queue, 14, physics, [1, 0.999, 0]),
    true,
  );
  physics.position = [10, 0, 0];
  assert.equal(enqueueConnotationPowerup(queue, 14, physics, [0, 0, 0]), false);
  queue.flush(0, (entry) =>
    assert.deepEqual(entry, { car, index: 14, actor: null }),
  );
});

test("single-shot eligibility persists without a timestamp and rejected contacts do not consume it", () => {
  const state = { awarded: false };
  assert.equal(
    consumeSmashAward(award(), state, { effectMagnitude: 10 }),
    null,
  );
  assert.equal(
    consumeSmashAward(award(), state, { ...human, suppressed: true }),
    null,
  );
  assert.equal(
    consumeSmashAward(award(), state, {
      ...human,
      physics: { type: 1, driver: 6 },
    }),
    null,
  );
  assert.equal(state.awarded, false);
  assert.deepEqual(consumeSmashAward(award(), state, human), {
    credits: 3000,
    timeSeconds: 20,
    textIndex: 132,
    fancyIndex: 0,
  });
  assert.equal(
    consumeSmashAward(award(), state, { ...human, effectMagnitude: 999 }),
    null,
  );
  assert.equal(
    consumeSmashAward(award(), { awarded: false }, human).credits,
    3000,
    "a separate native runtime connotation retains its own latch",
  );
});

test("repeated awards retain human eligibility; regardless bypasses owner and latch gates", () => {
  const state = { awarded: true };
  assert.equal(
    consumeSmashAward(award("repeated"), state, human).credits,
    3000,
  );
  assert.equal(
    consumeSmashAward(award("repeated"), state, {
      ...human,
      physics: { type: 2, driver: 8 },
    }),
    null,
  );
  assert.equal(
    consumeSmashAward(award("doitregardless"), state, { effectMagnitude: 0 })
      .credits,
    3000,
  );
  assert.equal(consumeSmashAward(award("none"), state, human), null);
});

test("native positive amounts truncate; negative coefficients scale, cap, then round", () => {
  const consume = (first, second, effectMagnitude = 10) =>
    consumeSmashAward(
      award("repeated", first, second),
      { awarded: false },
      { ...human, effectMagnitude },
    );
  assert.deepEqual(consume(125.9, 19.9), {
    credits: 125,
    timeSeconds: 19,
    textIndex: 132,
    fancyIndex: 0,
  });
  assert.equal(consume(-14.9, -0.4).credits, 100);
  assert.equal(consume(-15, -0.8).credits, 200);
  assert.equal(consume(-15, -0.8).timeSeconds, 10);
  assert.equal(consume(-9999, -9999).credits, 20000);
  assert.equal(consume(-9999, -9999).timeSeconds, 60);
  assert.equal(consume(-10, -1, 25).credits, 300);
  assert.equal(consume(-10, -1, 25).timeSeconds, 25);
  assert.equal(
    consume(-10, -1, 2).credits,
    0,
    "caller supplies direct impulse or queued starting speed explicitly",
  );
  assert.equal(consume(0, 0).credits, 0);
  assert.equal(consume(0, 0).timeSeconds, 0);
});

test("financial outlet guards consume the latch while preserving authored HUD outputs", () => {
  const state = { awarded: false };
  assert.deepEqual(
    consumeSmashAward(award(), state, { ...human, raceFinished: true }),
    {
      credits: 0,
      timeSeconds: 0,
      textIndex: 132,
      fancyIndex: 0,
    },
  );
  assert.equal(state.awarded, true);
  assert.equal(consumeSmashAward(award(), state, human), null);
  assert.equal(
    consumeSmashAward(
      award(),
      { awarded: false },
      { ...human, noTimeAwards: true, creditMultiplier: 2 },
    ).credits,
    6000,
  );
  assert.equal(
    consumeSmashAward(
      award(),
      { awarded: false },
      { ...human, noTimeAwards: true },
    ).timeSeconds,
    0,
  );
  assert.equal(
    consumeSmashAward(
      award(),
      { awarded: false },
      { ...human, creditMultiplier: 0 },
    ).credits,
    3000,
  );
});

test("installed Stock and Advanced carrier/desert payloads exercise awards, mine index14 and followups", async (t) => {
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original installation is absent");
    return;
  }
  const assets = await createAssetStore();
  for (const base of ["data", "adv_data"]) {
    const parse = async (path) => {
      const bytes = await assets.read(`${base}/RACES/${path}`);
      assert.ok(bytes);
      return parseTrackSmashables(decodeText(bytes));
    };
    const carrier = await parse("Carrier_mission/CARRIER_mission.txt");
    const core = carrier.find(
      (s) => s.trigger.name.toLowerCase() === "&core.act",
    );
    assert.deepEqual(core.connotations.award, award());
    assert.equal(core.connotations.roomCode, 14);
    assert.equal(core.connotations.sideEffects[0].target, "*.DAT");
    assert.deepEqual(core.connotations.sideEffects[0].delaySeconds, [2, 2]);
    const desert = await parse("desert_mission/desert_mission.txt");
    const numbered = desert.find((s) => s.trigger.name === "&92");
    assert.equal(numbered.mode, "nochange");
    assert.equal(numbered.connotations.award.frequency, "singleshot");
    assert.equal(numbered.connotations.roomCode, 14);
  }
});
