import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { createRace, updateRace } from "../src/gameplay.ts";
import { MissionVariables } from "../src/mission-variables.ts";
import {
  applyRaceObjectives,
  objectiveText,
  isSupportedRace,
} from "../src/rules.ts";

const progress = (extra = {}) => ({
  opponentsTotal: 4,
  opponentsWasted: 0,
  pedestriansTotal: 20,
  pedestriansKilled: 0,
  ...extra,
});
const definition = (raceType, extra = {}) => ({
  raceType,
  numberOfOpponentsToKill: null,
  opponentsToKill: [],
  numberOfPedGroupsToKill: null,
  pedGroupsToKill: [],
  ...extra,
});

test("classic victories allow all opponents or all pedestrians and award completion exactly once", () => {
  for (const p of [
    progress({ opponentsWasted: 4 }),
    progress({ pedestriansKilled: 20 }),
  ]) {
    const race = createRace([]);
    const result = applyRaceObjectives(race, definition("carma"), p);
    assert.equal(result.completed, true);
    assert.equal(race.status, "completed");
    assert.equal(race.credits, 3000);
    assert.equal(
      applyRaceObjectives(race, definition("carma"), p).completed,
      false,
    );
    assert.equal(race.credits, 3000);
  }
});

test("zero populations and partial asynchronous populations never win automatically", () => {
  const zero = progress({ opponentsTotal: 0, pedestriansTotal: 0 });
  assert.equal(
    applyRaceObjectives(createRace([]), undefined, zero).completed,
    false,
  );
  assert.equal(
    applyRaceObjectives(createRace([]), definition("cars"), zero).completed,
    false,
  );
  assert.equal(
    applyRaceObjectives(createRace([]), definition("peds"), zero).completed,
    false,
  );
  const loading = progress({
    opponentsTotal: 1,
    opponentsWasted: 1,
    opponentsReady: false,
    pedestriansTotal: 1,
    pedestriansKilled: 1,
    pedestriansReady: false,
  });
  assert.equal(
    applyRaceObjectives(createRace([]), definition("carma"), loading).completed,
    false,
  );
});

test("car missions support selected opponent identities and bounded-population fallback totals", () => {
  const selected = definition("cars", {
    numberOfOpponentsToKill: 2,
    opponentsToKill: [7, 12],
  });
  const race = createRace([]);
  assert.equal(
    applyRaceObjectives(
      race,
      selected,
      progress({
        opponentsWasted: 4,
        opponentsWastedIds: new Set([3, 7, 8, 9]),
      }),
    ).completed,
    false,
  );
  assert.equal(
    applyRaceObjectives(
      race,
      selected,
      progress({ opponentsWasted: 2, opponentsWastedIds: new Set([7, 12]) }),
    ).completed,
    true,
  );
  assert.equal(
    applyRaceObjectives(
      createRace([]),
      selected,
      progress({ opponentsWasted: 2 }),
    ).completed,
    true,
  );
  assert.equal(
    applyRaceObjectives(
      createRace([]),
      definition("cars", { numberOfOpponentsToKill: -1 }),
      progress({ opponentsWasted: 3 }),
    ).completed,
    false,
  );
  assert.equal(
    applyRaceObjectives(
      createRace([]),
      definition("cars", { numberOfOpponentsToKill: 12 }),
      progress({ opponentsWasted: 4 }),
    ).completed,
    true,
  );
});

test("pedestrian missions require every specified group when group counts are available", () => {
  const mission = definition("peds", { pedGroupsToKill: [42, 60] });
  const race = createRace([]);
  const groups = new Map([
    [42, { total: 2, killed: 2 }],
    [60, { total: 3, killed: 2 }],
  ]);
  assert.equal(
    applyRaceObjectives(
      race,
      mission,
      progress({ pedestriansKilled: 20, groupCounts: groups }),
    ).completed,
    false,
  );
  groups.get(60).killed = 3;
  assert.equal(
    applyRaceObjectives(race, mission, progress({ groupCounts: groups }))
      .completed,
    true,
  );
  assert.equal(
    applyRaceObjectives(
      createRace([]),
      mission,
      progress({ groupCounts: new Map([[42, { total: 0, killed: 0 }]]) }),
    ).completed,
    false,
  );
  assert.equal(
    applyRaceObjectives(
      createRace([]),
      mission,
      progress({ pedestriansKilled: 20 }),
    ).completed,
    true,
  );
});

test("checkpoint-only missions ignore kills and retain gameplay lap completion without double bonuses", () => {
  const gate = {
    points: [
      new Vector3(-1, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(1, 2, 0),
      new Vector3(-1, 2, 0),
    ],
  };
  const race = createRace([gate], { laps: 1 });
  const mission = definition("checkpoints");
  assert.equal(
    applyRaceObjectives(
      race,
      mission,
      progress({ opponentsWasted: 4, pedestriansKilled: 20 }),
    ).completed,
    false,
  );
  updateRace(race, new Vector3(0, 1, 1), new Vector3(0, 1, -1), 0.1);
  assert.equal(race.status, "completed");
  const credits = race.credits;
  assert.equal(applyRaceObjectives(race, mission, progress()).completed, false);
  assert.equal(race.credits, credits);
});

test("smash missions require their signed target and add pedestrian objectives only when encoded", () => {
  const smash = definition("smash", { smashVariable: 1, smashTarget: 2 });
  const regularKills = progress({ opponentsWasted: 4, pedestriansKilled: 20 });
  const ordinary = createRace([]);
  assert.equal(isSupportedRace(smash), true);
  assert.equal(
    applyRaceObjectives(ordinary, smash, regularKills).completed,
    false,
    "ordinary opponent and pedestrian kills cannot satisfy a smash objective",
  );
  assert.equal(ordinary.credits, 1000);

  const below = applyRaceObjectives(
    ordinary,
    smash,
    progress({ smashValue: 1, opponentsWasted: 4, pedestriansKilled: 20 }),
  );
  assert.equal(below.completed, false);
  assert.match(below.objectiveText, /1\/2/);
  const connotation = new MissionVariables();
  connotation.apply([
    [1, 2],
    [1, -1],
  ]);
  assert.equal(
    applyRaceObjectives(
      ordinary,
      smash,
      progress({ smashValue: connotation.get(1) }),
    ).completed,
    false,
    "victory checks use the final value after the full connotation list",
  );
  assert.equal(
    applyRaceObjectives(ordinary, smash, progress({ smashValue: -1 }))
      .completed,
    false,
    "negative signed runtime values remain below the target",
  );
  const edge = applyRaceObjectives(
    ordinary,
    smash,
    progress({ smashValue: 2 }),
  );
  assert.equal(edge.completed, true, "the exact target completes the mission");
  assert.equal(ordinary.credits, 3000);
  assert.equal(
    applyRaceObjectives(ordinary, smash, progress({ smashValue: 127 }))
      .completed,
    false,
    "an already-ended race cannot award completion twice",
  );
  assert.equal(ordinary.credits, 3000);

  const additive = definition("smashAndPed", {
    smashVariable: 1,
    smashTarget: 2,
    pedGroupsToKill: [56],
  });
  const additiveRace = createRace([]);
  assert.equal(
    applyRaceObjectives(
      additiveRace,
      additive,
      progress({
        smashValue: 2,
        pedestriansKilled: 0,
        groupCounts: new Map([[56, { total: 3, killed: 0 }]]),
      }),
    ).completed,
    true,
    "smashAndPed retains the additive smash threshold without inventing a pedestrian conjunction",
  );
  assert.equal(additiveRace.credits, 3000);

  const failed = createRace([], { timeLimit: 0 });
  assert.equal(
    applyRaceObjectives(failed, smash, progress({ smashValue: 2 })).completed,
    false,
  );
  assert.ok(objectiveText(definition("peds"), progress()).includes("0/20"));
});
