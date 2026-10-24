import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { Vector3 } from "three";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parseTrackConfig, parseRaceCatalog } from "../src/config.ts";
import {
  assessRaceAvailability,
  isUsableCheckpoint,
} from "../src/race-availability.ts";
import { createRace, updateRace, completeRace } from "../src/gameplay.ts";
import { applyRaceObjectives } from "../src/rules.ts";

const gate = [
  [0, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [1, 0, 0],
];
const config = (changes = {}) => ({
  ...parseTrackConfig(""),
  start: [0, 0, 0],
  checkpoints: [{ points: gate, timerIncrement: null }],
  ...changes,
});
const definition = (raceType = "carma", changes = {}) => ({
  raceType,
  mission: false,
  laps: 3,
  initialTimer: [120, 100, 80],
  ...changes,
});
const assess = (
  track = config(),
  race = definition(),
  resources = { geometry: true },
) => assessRaceAvailability(track, race, resources);

test("missing start or actor is unavailable, while absent rules are explicitly practice", () => {
  assert.deepEqual(
    assess(config({ start: null }), definition(), { geometry: false }).reasons,
    ["The track actor file is missing.", "No valid player start is defined."],
  );
  assert.equal(assess(config({ start: [0, NaN, 0] })).mode, "unavailable");
  assert.equal(
    assess(config(), definition(), {
      geometry: true,
      configurationError: "bad data",
    }).mode,
    "unavailable",
  );
  assert.equal(
    assessRaceAvailability(config(), undefined, { geometry: true }).mode,
    "free-drive",
  );
  assert.equal(assess(config(), definition(97)).mode, "free-drive");
});

test("checkpoint eligibility follows the real plane threshold and compound gate alternatives", () => {
  assert.equal(isUsableCheckpoint(gate), true);
  assert.equal(
    isUsableCheckpoint([
      [0, 0, 0],
      [1e300, 0, 0],
      [0, 1e300, 0],
    ]),
    false,
  );
  const flat = [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [3, 0, 0],
  ];
  assert.equal(isUsableCheckpoint(flat), false);
  assert.equal(isUsableCheckpoint([...flat, ...gate]), true);
  assert.equal(
    isUsableCheckpoint([
      [0, 0, 0],
      [0, NaN, 0],
      [1, 1, 0],
    ]),
    false,
  );
  assert.equal(
    assess(
      config({ checkpoints: [{ points: flat }] }),
      definition("checkpoints"),
    ).mode,
    "free-drive",
  );
  assert.equal(
    assess(config({ checkpoints: [] }), definition("carma")).mode,
    "combat",
  );
  assert.equal(assess(config(), definition("checkpoints")).mode, "race");
  assert.equal(
    assess(config(), definition("checkpoints", { laps: 0 })).mode,
    "free-drive",
  );
});

test("non-lap missions do not require checkpoint gates", () => {
  for (const raceType of ["peds", "cars", "smash", "smashAndPed"]) {
    const value = assess(
      config({ checkpoints: [] }),
      definition(raceType, { mission: true, laps: null }),
    );
    assert.equal(value.mode, "race", raceType);
    assert.equal(value.label, "Mission");
  }
});

test("practice stays drivable without fabricated laps, time expiry or completion payout", () => {
  const race = createRace([{ points: gate.map((p) => new Vector3(...p)) }], {
    practice: true,
    timeLimit: 0,
  });
  const credits = race.credits;
  const events = updateRace(
    race,
    new Vector3(0.5, 0.5, -1),
    new Vector3(0.5, 0.5, 1),
    3600,
  );
  assert.deepEqual(events, []);
  assert.equal(race.status, "racing");
  assert.equal(race.timeLeft, 0);
  assert.equal(race.elapsed, 3600);
  assert.equal(race.nextCheckpoint, 0);
  const result = applyRaceObjectives(race, undefined, {
    opponentsTotal: 1,
    opponentsWasted: 1,
    pedestriansTotal: 1,
    pedestriansKilled: 1,
  });
  assert.equal(result.completed, false);
  assert.equal(result.supported, false);
  assert.equal(completeRace(race, 0), false);
  assert.equal(race.credits, credits);
  assert.equal(race.status, "racing");
});

test("normal checkpoint races still finish and time out", () => {
  const race = createRace([{ points: gate.map((p) => new Vector3(...p)) }], {
    laps: 1,
    timeLimit: 120,
  });
  assert.equal(
    updateRace(race, new Vector3(0.5, 0.5, -1), new Vector3(0.5, 0.5, 1), 1).at(
      -1,
    ).type,
    "completed",
  );
  const timed = createRace([], { timeLimit: 1 });
  assert.equal(
    updateRace(timed, new Vector3(), new Vector3(), 2).at(-1).type,
    "failed",
  );
});

test("installed Nuke, gate-less arenas and real non-lap missions are distinguished", async (t) => {
  const installation = process.env.CARMA2_ROOT || "carma2_orig";
  try {
    await access(installation);
  } catch {
    t.skip("Original installation absent");
    return;
  }
  const store = await createAssetStore(installation);
  const lookup = new Map(
    store.manifest.map((e) => [e.path.toLowerCase(), e.path]),
  );
  for (const source of ["data", "adv_data"]) {
    const catalogPath = lookup.get(`${source}/races.txt`);
    if (!catalogPath) continue;
    const catalog = parseRaceCatalog(
      decodeText(await store.read(catalogPath)),
    ).races;
    const read = async (stem) => {
      const path = lookup.get(`${source}/races/${stem}/${stem}.txt`);
      assert.ok(path, stem);
      const cfg = parseTrackConfig(decodeText(await store.read(path)));
      const def = catalog.find(
        (r) => r.raceFilename.toLowerCase() === `${stem}.txt`,
      );
      return assessRaceAvailability(cfg, def, {
        geometry: lookup.has(path.replace(/\.txt$/i, ".act").toLowerCase()),
      });
    };
    assert.equal((await read("nuke")).mode, "unavailable");
    assert.equal((await read("airport_mission")).mode, "race");
    assert.equal((await read("newcity4")).mode, "race");
    assert.equal((await read("newcity1")).mode, "race");
    assert.equal((await read("newsumo")).mode, "free-drive");
    const arena = await read("arena1");
    assert.equal(arena.mode, source === "adv_data" ? "race" : "free-drive");
  }
});
