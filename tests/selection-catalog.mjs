import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parseRaceCatalog, parseTrackConfig } from "../src/config.ts";
import {
  groupRaceChoices,
  selectionRaceTypeLabel,
} from "../src/selection-catalog.ts";

const config = (assetReferences, mapTexture) => ({
  version: 1,
  start: null,
  heading: null,
  checkpoints: [],
  laps: null,
  timeLimit: null,
  pathNodes: [],
  pathEdges: [],
  pathSections: [],
  assetReferences,
  mapTexture,
});

function choice(path, source, assetReferences, mapTexture, name = path) {
  return { path, source, name, config: config(assetReferences, mapTexture) };
}

test("groups authored map series, preserves namespace, and puts missions last", () => {
  const environment = ["track.act"];
  const choices = [
    {
      ...choice(
        "data/races/airport1/airport1.txt",
        "data",
        environment,
        "maps/airpmap1.PIX",
        "Runway Runaway",
      ),
      definition: { mission: false, raceType: "carma" },
      catalogOrder: 0,
    },
    {
      ...choice(
        "data/races/airport_mission/airport_mission.txt",
        "data",
        [...environment, "missiontarget.act"],
        "airpmapM.PIX",
        "Mission: Control Freak",
      ),
      definition: { mission: true, raceType: "smash" },
      catalogOrder: 1,
    },
    choice(
      "adv_data/races/airport1/airport1.txt",
      "adv_data",
      environment,
      "airpmap1.PIX",
    ),
    choice("data/races/alone/alone.txt", "data", ["lone.act"], undefined),
  ];
  const groups = groupRaceChoices(choices);
  assert.equal(groups.length, 3);
  const stock = groups.find(
    (group) => group.source === "data" && group.races.length === 2,
  );
  assert.ok(stock);
  assert.equal(stock.name, "Runway Runaway");
  assert.equal(stock.previewRace.name, "Runway Runaway");
  assert.deepEqual(
    stock.races.map((race) => race.name),
    ["Runway Runaway", "Mission: Control Freak"],
  );
  assert.equal(new Set(groups.map((group) => group.id)).size, groups.length);
});

test("missing maps stay isolated and map families never cross source namespaces", () => {
  const groups = groupRaceChoices([
    choice("data/races/city1/city1.txt", "data", ["trackx.act"], undefined),
    choice("data/races/city2/city2.txt", "data", ["trackx.act"], undefined),
    choice(
      "data/races/airport1/airport1.txt",
      "data",
      ["trackx.act"],
      "airpmap1.pix",
    ),
    choice(
      "adv_data/races/airport1/airport1.txt",
      "adv_data",
      ["trackx.act"],
      "airpmap1.pix",
    ),
  ]);
  assert.equal(groups.length, 4);
});

test("group titles use native LOCATION while preserving race event names", () => {
  const ordinary = {
    ...choice(
      "data/races/newcity1/newcity1.txt",
      "data",
      ["trackx.act"],
      "newcmap1.pix",
      "NICE BEAVER",
    ),
    definition: {
      mission: false,
      raceType: "carma",
      description: "LOCATION: BEAVER CITY @R LAPS: 4 @R CHECKPOINTS: 4",
    },
  };
  const mission = {
    ...choice(
      "data/races/newcity_mission/newcity_mission.txt",
      "data",
      ["trackx.act"],
      "newcmapM.pix",
      "MISSION: EYE OF THE BEAVER",
    ),
    definition: {
      mission: true,
      raceType: "smash",
      description: "LOCATION: BEAVER CITY @R Destroy all roof-top antennas",
    },
  };
  const [group] = groupRaceChoices([ordinary, mission]);
  assert.equal(group.name, "BEAVER CITY");
  assert.deepEqual(
    group.races.map((race) => race.name),
    ["NICE BEAVER", "MISSION: EYE OF THE BEAVER"],
  );
});

test("race type labels are friendly and unknown numeric types are contained", () => {
  assert.equal(selectionRaceTypeLabel(), undefined);
  assert.equal(
    selectionRaceTypeLabel({ raceType: "smashAndPed" }),
    "Smash targets and hit pedestrians",
  );
  assert.equal(selectionRaceTypeLabel({ raceType: 97 }), "Special race");
});

let originalAssetsAvailable = true;
try {
  await access(new URL("../carma2_orig", import.meta.url));
} catch {
  originalAssetsAvailable = false;
}

test(
  "original stock and Advanced map series preserve environment boundaries",
  { skip: !originalAssetsAvailable },
  async () => {
    const assets = await createAssetStore();
    const choices = [];
    for (const source of ["data", "adv_data"]) {
      const catalogPath = `${source}/RACES.TXT`;
      const catalogBytes = await assets.read(catalogPath);
      if (!catalogBytes) continue;
      const catalog = parseRaceCatalog(decodeText(catalogBytes));
      const trackFiles = assets.manifest.filter((entry) => {
        const parts = entry.path.split("/");
        if (
          parts.length !== 4 ||
          parts[0].toLowerCase() !== source ||
          parts[1].toLowerCase() !== "races" ||
          !parts[3].toLowerCase().endsWith(".txt")
        )
          return false;
        return parts[2].toLowerCase() === parts[3].slice(0, -4).toLowerCase();
      });
      for (const entry of trackFiles) {
        const filename = entry.path.split("/").at(-1);
        const catalogOrder = catalog.races.findIndex(
          (race) => race.raceFilename.toLowerCase() === filename.toLowerCase(),
        );
        const definition = catalog.races[catalogOrder];
        const siblingAct = entry.path.replace(/\.txt$/i, ".act");
        if (
          !assets.manifest.some(
            (asset) => asset.path.toLowerCase() === siblingAct.toLowerCase(),
          )
        )
          continue;
        const bytes = await assets.read(entry.path);
        if (!bytes) continue;
        choices.push({
          path: entry.path,
          source,
          name: definition?.name || filename.replace(/\.txt$/i, ""),
          definition,
          catalogOrder: catalogOrder >= 0 ? catalogOrder : undefined,
          config: parseTrackConfig(decodeText(bytes)),
        });
      }
    }

    const groups = groupRaceChoices(choices);
    const groupFor = (source, filename) =>
      groups.find((group) =>
        group.races.some(
          (race) =>
            race.source === source &&
            race.path.toLowerCase().endsWith(`/${filename.toLowerCase()}`),
        ),
      );
    for (const source of ["data", "adv_data"]) {
      const airport = groupFor(source, "airport1.txt");
      const mission = groupFor(source, "airport_mission.txt");
      assert.ok(airport, `${source} airport race exists`);
      assert.equal(
        mission?.id,
        airport.id,
        `${source} airport mission reuses the authored environment`,
      );
      assert.equal(
        groupFor(source, "quarry1.txt")?.id,
        groupFor(source, "quarry2.txt")?.id,
      );
      assert.notEqual(
        groupFor(source, "quarry1.txt")?.id,
        groupFor(source, "junkyard.txt")?.id,
      );
      assert.notEqual(
        groupFor(source, "arena1.txt")?.id,
        groupFor(source, "Newsumo.txt")?.id,
      );
      const siloFiles = [
        "silo_mission.txt",
        "silo1.txt",
        "silo2.txt",
        "silo3.txt",
        "SILONET03.txt",
        "silonet1.txt",
        "silonet2.txt",
      ];
      const siloIds = new Set(
        siloFiles.map((filename) => groupFor(source, filename)?.id),
      );
      assert.equal(siloIds.size, 1, `${source} Silo map series stays together`);
    }
    for (const [source, left, right] of [
      ["adv_data", "AvenueOfAtrocities.txt", "BloodOnTheRooftops.txt"],
      ["adv_data", "CoastalCarnage.txt", "HitchHikerHarvest.txt"],
      ["adv_data", "DowntownDevastation.txt", "MangledattheMall.txt"],
      ["adv_data", "HalfwayToHell.txt", "PitStop.txt"],
      ["adv_data", "IcingOnTheQuake.txt", "Slayride.txt"],
      ["adv_data", "MaimStreet.txt", "SlaughterCity.txt"],
    ])
      assert.notEqual(
        groupFor(source, left)?.id,
        groupFor(source, right)?.id,
        `${left} and ${right} have different authored map families`,
      );
    assert.equal(
      choices.length,
      groups.reduce((count, group) => count + group.races.length, 0),
    );
    assert.ok(groups.some((group) => group.source === "data"));
    assert.ok(groups.some((group) => group.source === "adv_data"));
  },
);
