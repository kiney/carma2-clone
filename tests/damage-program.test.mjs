import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import {
  DAMAGE_SYSTEMS,
  evaluateDamageProgram,
  parseDamagePrograms,
} from "../src/damage-program.ts";

let originalAssetsAvailable = true;
try {
  await access(new URL("../carma2_orig", import.meta.url));
} catch {
  originalAssetsAvailable = false;
}

function syntheticHeader({
  version = "VERSION 2",
  firstClause = "always",
} = {}) {
  return `${version}
CAR.TEST.TXT // Name of car
0.7 // softness_factor
START OF DRIVABLE STUFF
0,0,0
END OF DRIVABLE STUFF
5300,5301,5302
stealworthy
1 // top clauses
${firstClause}
1
engine,1.5
1
x<0.3&z>0
2
lf_wheel,0.5
steering,0.25
0
1
always
1
driver,1
0
0
0
0
0
`;
}

test("parses loader-ordered header and all six impact programs", () => {
  const parsed = parseDamagePrograms(syntheticHeader());
  assert.equal(parsed.version, 2);
  assert.equal(parsed.name, "CAR.TEST.TXT");
  assert.equal(parsed.softness, 0.7);
  assert.deepEqual(parsed.engineNoises, [5300, 5301, 5302]);
  assert.equal(parsed.canBeStolen, true);
  assert.deepEqual(Object.keys(parsed.programs), [
    "top",
    "bottom",
    "left",
    "right",
    "front",
    "rear",
  ]);
  assert.deepEqual(parsed.programs.top.clauses[0], {
    conditions: [],
    effects: [{ system: "engine", systemIndex: 0, weaknessFactor: 1.5 }],
  });
  assert.deepEqual(parsed.programs.bottom.clauses[0].conditions, [
    { axis: "x", operator: "<", threshold: 0.3 },
    { axis: "z", operator: ">", threshold: 0 },
  ]);
  assert.deepEqual(parsed.programs.bottom.clauses[0].effects, [
    { system: "lf_wheel", systemIndex: 8, weaknessFactor: 0.5 },
    { system: "steering", systemIndex: 3, weaknessFactor: 0.25 },
  ]);
  assert.deepEqual(DAMAGE_SYSTEMS, [
    "engine",
    "transmission",
    "driver",
    "steering",
    "lf_brake",
    "rf_brake",
    "lr_brake",
    "rr_brake",
    "lf_wheel",
    "rf_wheel",
    "lr_wheel",
    "rr_wheel",
  ]);
});

test("supports legacy unversioned and gender-prefixed headers", () => {
  const noVersion = parseDamagePrograms(
    syntheticHeader({ version: "CAR.TEST.TXT" }).replace(
      "CAR.TEST.TXT\nCAR.TEST.TXT",
      "CAR.TEST.TXT",
    ),
  );
  assert.equal(noVersion.version, 0);
  assert.equal(noVersion.name, "CAR.TEST.TXT");

  const female = parseDamagePrograms(
    syntheticHeader({ version: "VERSION 2" }).replace(
      "VERSION 2\nCAR.TEST.TXT",
      "VERSION 2\nGIRL\nCAR.TEST.TXT",
    ),
  );
  assert.equal(female.name, "CAR.TEST.TXT");
});

test("evaluates strict conditions and includes every matching clause", () => {
  const parsed = parseDamagePrograms(
    syntheticHeader().replace(
      "1 // top clauses\nalways\n1\nengine,1.5",
      "2 // top clauses\nalways\n1\nengine,1.5\nx<0.3&z>0\n1\nsteering,0.25",
    ),
  );
  const top = parsed.programs.top;
  assert.deepEqual(evaluateDamageProgram(top, [0.2, 0.4, 1]), [
    { system: "engine", systemIndex: 0, weaknessFactor: 1.5 },
    { system: "steering", systemIndex: 3, weaknessFactor: 0.25 },
  ]);
  assert.deepEqual(evaluateDamageProgram(top, [0.3, 0.4, 1]), [
    { system: "engine", systemIndex: 0, weaknessFactor: 1.5 },
  ]);
  assert.deepEqual(evaluateDamageProgram(top, [0.2, 0.4, 0]), [
    { system: "engine", systemIndex: 0, weaknessFactor: 1.5 },
  ]);
  assert.throws(() => evaluateDamageProgram(top, [0, Number.NaN, 1]), /finite/);
});

test("rejects malformed conditions, systems, counts, and header order", () => {
  assert.throws(
    () => parseDamagePrograms(syntheticHeader({ firstClause: "x=0.3" })),
    /invalid condition comparison/,
  );
  assert.throws(
    () =>
      parseDamagePrograms(
        syntheticHeader().replace("engine,1.5", "booster,1.5"),
      ),
    /unknown damage system/,
  );
  assert.throws(
    () =>
      parseDamagePrograms(syntheticHeader().replace("1 // top clauses", "129")),
    /bounded integer clause count/,
  );
  assert.throws(
    () =>
      parseDamagePrograms(
        syntheticHeader().replace("START OF DRIVABLE STUFF", "DRIVABLE"),
      ),
    /expected START OF DRIVABLE STUFF/,
  );
});

test(
  "parses stock damage program tables and preserves impact-region differences",
  { skip: !originalAssetsAvailable },
  async () => {
    const assets = await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
    const paths = [
      "data/CARS/EAGLE3/EAGLE3.TXT",
      "data/CARS/delorean/delorean.txt",
      "adv_data/CARS/69mach1/69mach1.txt",
    ];
    const parsed = [];
    for (const path of paths) {
      const bytes = await assets.read(path);
      assert.ok(bytes, `${path} should be present in the stock assets`);
      parsed.push(parseDamagePrograms(decodeText(bytes)));
    }
    assert.ok(parsed.every((car) => car.version === 2));
    assert.equal(new Set(parsed.map((car) => car.name)).size, 3);
    assert.ok(parsed.every((car) => Object.keys(car.programs).length === 6));
    for (const car of parsed) {
      const signatures = Object.values(car.programs).map((program) =>
        JSON.stringify(program.clauses),
      );
      assert.ok(
        new Set(signatures).size > 1,
        `${car.name} should use different programs for different impact regions`,
      );
    }
  },
);
