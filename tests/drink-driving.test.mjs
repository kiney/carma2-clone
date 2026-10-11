import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { NativeDrinkDriving } from "../src/drink-driving.ts";
import { PowerupSystem } from "../src/powerups.ts";
import {
  createRace,
  createVehicle,
  awardRaceCredits,
  completeRace,
} from "../src/gameplay.ts";

test("native Drink Driving consumes deadline, period and phase in source order and uses the cosine table", () => {
  const draws = [0, 0, 0];
  const state = new NativeDrinkDriving(() => draws.shift());
  state.set([0.075, 1500, 2500, 1], [3], 1000);
  assert.equal(draws.length, 0);
  assert.equal(state.snapshot.periodMs, 1500);
  assert.equal(state.snapshot.phaseMs, 0);
  assert.equal(state.snapshot.nextVoiceMs, 2500);
  for (const [time, cosine] of [
    [0, 1],
    [375, 0],
    [750, -1],
    [1125, 0],
    [1500, 1],
  ]) {
    const expected = Math.trunc(
      (1 + Math.fround(0.075) * cosine) * 70 * (65536 / 360),
    );
    assert.equal(state.fovAngle16(70, time), expected);
  }
  state.reset();
  assert.equal(state.creditMultiplier, 0);
  assert.equal(state.fovAngle16(70, 0), Math.trunc((70 * 65536) / 360));
});

test("native drunk voice compares strict absolute deadlines and consumes pitch, probability, next deadline", () => {
  const draws = [0, 0, 0, 0, 0, 0, 0.5, 0.75, 0];
  const state = new NativeDrinkDriving(() => draws.shift());
  state.set([0.075, 1500, 2500, 1], [3], 1000);
  assert.equal(state.periodic(2500), undefined);
  assert.deepEqual(state.periodic(2501), { id: 3602, playbackRate: 0.75 });
  assert.equal(state.periodic(4001), undefined);
  assert.deepEqual(state.periodic(4002), { id: 3603, playbackRate: 1 });
  assert.equal(draws.length, 0);
});

const table = `3\nDrink Driving\nnone\n-1\n1\n0\n48\n4\n.075\n1500\n2500\n1\n1\n3\n0\n0\n0
Credits\nnone\n-1\n0\n0\n0\n0\n2\n100\n100\n0\n0\n0
Cancel\nnone\n-1\n0\n0\n51\n0\n0\n0\n0\n0\n`;
test("normal grant, earned outlets, renewal, expiry and cancellation share one native credit multiplier", async () => {
  const powerups = await new PowerupSystem(
    { text: async () => table },
    new THREE.Group(),
    () => 0,
  ).init();
  const vehicle = createVehicle(new THREE.Vector3(100, 0, 0));
  const race = createRace([], { credits: 1000 });
  const events = [];
  powerups.grant(0, vehicle, race);
  assert.equal(race.earnedCreditMultiplier, 3);
  assert.equal(awardRaceCredits(race, 300), true);
  assert.equal(race.credits, 1900);
  powerups.grant(1, vehicle, race, (event) => events.push(event));
  assert.equal(race.credits, 2200);
  assert.equal(events[0].amount, 300);
  powerups.update(0.6, vehicle, race);
  powerups.grant(0, vehicle, race);
  powerups.update(0.5, vehicle, race);
  assert.equal(race.earnedCreditMultiplier, 3);
  powerups.update(0.5, vehicle, race);
  assert.equal(race.earnedCreditMultiplier, 0);
  awardRaceCredits(race, 100);
  assert.equal(race.credits, 2300);
  powerups.grant(0, vehicle, race);
  powerups.grant(2, vehicle, race);
  assert.equal(race.earnedCreditMultiplier, 0);
  powerups.grant(0, vehicle, race);
  powerups.dispose();
  assert.equal(race.earnedCreditMultiplier, 0);
});

test("shared native earned credits wrap signed32 and preserve separate final payout behavior", () => {
  const race = createRace([], {
    credits: 0x7ffffff0,
    completionCredits: 100,
    completionTimeCreditRate: 0,
  });
  race.earnedCreditMultiplier = 3;
  awardRaceCredits(race, 16);
  assert.equal(race.credits, -2147483616);
  assert.equal(awardRaceCredits(race, 0.1), false);
  race.credits = 1000;
  completeRace(race);
  assert.equal(race.credits, 1100);
  assert.equal(awardRaceCredits(race, 100), false);
});
