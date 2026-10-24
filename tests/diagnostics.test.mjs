import assert from "node:assert/strict";
import {
  collectDiagnosticReport,
  serializeDiagnosticReport,
} from "../src/diagnostics.ts";

const input = {
  track: "data/RACES/newcity1/newcity1.txt",
  race: "NICE BEAVER",
  generatedAt: "2026-10-24T12:00:00.000Z",
  providers: [
    {
      source: "Session assets",
      scope: "session",
      messages: ["Missing optional texture", "Missing optional texture", " "],
    },
    {
      source: "Player animation",
      scope: "current race",
      messages: ["Unsupported animation mode"],
    },
  ],
  background: [
    {
      source: "Opponent background loading",
      message: "TEST load rejection",
      race: "NICE BEAVER",
      time: "2026-10-24T11:59:00.000Z",
    },
    {
      source: "Opponent background loading",
      message: "TEST load rejection",
      race: "NICE BEAVER",
      time: "2026-10-24T11:59:30.000Z",
    },
  ],
  populations: {
    opponents: { state: "failed", reason: "injected missing actor" },
    pedestrians: { state: "ready" },
  },
};

const report = collectDiagnosticReport(input);
assert.equal(report.generatedAt, input.generatedAt);
assert.equal(report.track, input.track);
assert.equal(report.race, input.race);
assert.equal(report.total, 6);

const assetGroup = report.groups.find(
  (group) => group.source === "Session assets",
);
assert.equal(assetGroup.scope, "session");
assert.deepEqual(assetGroup.items, [
  { message: "Missing optional texture", count: 2, lastSeenAt: undefined },
]);

const background = report.groups.find((group) =>
  group.source.includes("Opponent background loading"),
);
assert.equal(background.scope, "session");
assert.equal(background.items.length, 1);
assert.equal(background.items[0].count, 2);
assert.match(background.items[0].message, /race when recorded: NICE BEAVER/);
assert.equal(background.items[0].lastSeenAt, "2026-10-24T11:59:30.000Z");

const population = report.groups.find(
  (group) => group.source === "Race population loading",
);
assert.equal(population.scope, "current race");
assert.deepEqual(population.items, [
  {
    message: "Opponent population failed to load: injected missing actor",
    count: 1,
    lastSeenAt: undefined,
  },
]);
assert.equal(
  report.groups.find((group) => group.source === "Player animation").scope,
  "current race",
);
assert.match(serializeDiagnosticReport(report), /"total": 6/);

const empty = collectDiagnosticReport({ providers: [] });
assert.equal(empty.total, 0);
assert.deepEqual(empty.groups, []);

console.log(
  "PASS diagnostics grouping, session scope, deduplication and JSON export",
);
