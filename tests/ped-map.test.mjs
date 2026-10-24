import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Group, Vector3 } from "three";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText, parsePix } from "../src/formats.ts";
import { createRace } from "../src/gameplay.ts";
import { createVehicle } from "../src/legacy-arcade.ts";
import {
  PowerupSystem,
  parsePowerups,
  isPowerupImplemented,
} from "../src/powerups.ts";
import { PedestrianSystem } from "../src/pedestrians.ts";
import {
  pedestrianMapEnabled,
  pedestrianMapEligible,
  pedestrianMapColor,
  drawPedestrianMapPoint,
} from "../src/ped-map.ts";

function table(definitions) {
  return [
    definitions.length,
    ...definitions.flatMap((d) => [
      d.message ?? "Pedestrian map",
      "none",
      -1,
      d.duration ?? 0,
      0,
      d.action,
      0,
      0,
      d.group ?? 0,
      0,
      0,
    ]),
  ].join("\n");
}
async function fixture(definitions, driver = 8) {
  const system = await new PowerupSystem(
    { text: async () => table(definitions) },
    new Group(),
  ).init();
  const car = createVehicle(new Vector3()),
    race = createRace([]);
  car.driver = driver;
  return {
    system,
    car,
    race,
    grant(index) {
      return system.grant(index, car, race);
    },
    sample(dt = 0) {
      return system.update(dt, car, race);
    },
  };
}

test("action29 follows whole-race source duration, cancellation and a fresh race owner", async () => {
  const f = await fixture([{ action: 29 }, { action: 51, duration: -1 }]);
  assert.equal(f.system.pedestriansOnMap, false);
  assert.equal(f.sample().pedestriansOnMap, false);
  f.grant(0);
  assert.equal(
    f.system.pedestriansOnMap,
    true,
    "paused debug grants are visible immediately",
  );
  assert.equal(
    f.sample(1000).pedestriansOnMap,
    true,
    "duration0 never invents a timeout",
  );
  f.grant(0);
  assert.equal(f.sample(1000).pedestriansOnMap, true);
  f.grant(1);
  assert.equal(f.sample().pedestriansOnMap, false);
  f.grant(0);
  f.system.dispose();
  assert.equal(f.system.pedestriansOnMap, false);
  const next = await fixture([{ action: 29 }]);
  assert.equal(next.sample().pedestriansOnMap, false);
  next.system.dispose();
});

test("authored timed map definitions renew and expire after the complete physics window", async () => {
  const f = await fixture([{ action: 29, duration: 1 }]);
  f.grant(0);
  f.sample(0.75);
  f.grant(0);
  assert.equal(f.sample(0.25).pedestriansOnMap, true);
  assert.equal(f.system.beginFrame(0.75, f.car, f.race).pedestriansOnMap, true);
  assert.equal(f.system.finishFrame().pedestriansOnMap, false);
  f.system.dispose();
});

test("map set and reset handlers retain native local-human driver guards", async () => {
  for (const driver of [0, 5, 6, 7, 9, undefined]) {
    const f = await fixture([{ action: 29, duration: 1 }], driver);
    // Passing undefined to fixture uses its default, so explicitly retain it.
    f.car.driver = driver;
    f.grant(0);
    assert.equal(f.sample().pedestriansOnMap, false, `driver${driver}`);
    assert.equal(f.sample(1).pedestriansOnMap, false);
    f.system.dispose();
  }
  const f = await fixture([
    { action: 29, duration: 3 },
    { action: 29, duration: 1 },
  ]);
  f.grant(0);
  f.system.grant(1, { ...f.car, driver: 6 }, f.race);
  assert.equal(
    f.sample(1).pedestriansOnMap,
    true,
    "nonhuman loss does not reset the human flag",
  );
  assert.equal(f.sample(2).pedestriansOnMap, false);
  f.system.dispose();
});

test("map group removal uses normal lifecycle before another incoming handler", async () => {
  const f = await fixture([
    { action: 29, group: 0x8000 },
    { action: 7, duration: -1, group: 0x8000 },
  ]);
  f.grant(0);
  f.grant(1);
  assert.equal(f.sample().pedestriansOnMap, false);
  f.system.dispose();
});

test("single-player policy shows living processed peds and mission target groups", () => {
  const off = { effectActive: false, raceType: "carma" };
  const on = { ...off, effectActive: true };
  assert.equal(pedestrianMapEnabled(off), false);
  assert.equal(pedestrianMapEligible(true, true, 3, off), false);
  assert.equal(pedestrianMapEligible(true, true, 3, on), true);
  assert.equal(pedestrianMapEligible(false, true, 3, on), false);
  assert.equal(pedestrianMapEligible(true, false, 3, on), false);
  const mission = {
    effectActive: false,
    raceType: "peds",
    targetGroups: [3, 7],
  };
  assert.equal(pedestrianMapEnabled(mission), true);
  assert.equal(pedestrianMapEligible(true, true, 3, mission), true);
  assert.equal(pedestrianMapEligible(true, true, 4, mission), false);
  assert.equal(
    pedestrianMapEligible(true, true, 4, { ...mission, effectActive: true }),
    false,
    "the map effect does not override a mission's selected-target filter",
  );
  assert.equal(
    pedestrianMapEnabled({ ...off, raceType: "smashAndPed" }),
    false,
  );
});

test("lightweight population iteration borrows eligible live positions without diagnostic clones", () => {
  const peds = Object.create(PedestrianSystem.prototype);
  const position = new Vector3(4, 5, 6);
  peds.peds = [
    {
      alive: true,
      active: true,
      spec: { group: 3 },
      object: { position, visible: false },
    },
    {
      alive: false,
      active: true,
      spec: { group: 3 },
      object: { position: new Vector3() },
    },
    {
      alive: true,
      active: false,
      spec: { group: 3 },
      object: { position: new Vector3() },
    },
    {
      alive: true,
      active: true,
      spec: { group: 4 },
      object: { position: new Vector3() },
    },
  ];
  Object.defineProperty(peds, "states", {
    get() {
      throw new Error("Diagnostic state snapshots must not be read");
    },
  });
  const selected = [];
  peds.forEachMapPedestrian(
    { effectActive: false, raceType: "peds", targetGroups: [3] },
    (p) => selected.push(p),
  );
  assert.deepEqual(selected, [position]);
  assert.equal(selected[0], position);
});

test("marker renderer uses actual palette52 and float clipping before integer truncation", () => {
  const palette = new Uint8Array(256 * 4);
  palette.set([19, 71, 143, 255], 52 * 4);
  assert.equal(pedestrianMapColor(palette), "rgb(19, 71, 143)");
  assert.equal(pedestrianMapColor(), undefined);
  assert.equal(pedestrianMapColor(new Uint8Array(52 * 4)), undefined);
  const calls = [],
    context = {
      canvas: { width: 220, height: 220 },
      fillRect(...args) {
        calls.push(args);
      },
    };
  for (const [x, y] of [
    [-0.01, 1],
    [1, -0.01],
    [220, 1],
    [1, 220],
    [NaN, 0],
    [0, Infinity],
  ])
    assert.equal(drawPedestrianMapPoint(context, x, y), false);
  assert.equal(drawPedestrianMapPoint(context, 0, 0), true);
  assert.equal(drawPedestrianMapPoint(context, 219.99, 17.75), true);
  assert.deepEqual(calls, [
    [0, 0, 1, 1],
    [219, 17, 1, 1],
  ]);
});

const originalRoot =
  process.env.CARMA2_ROOT ??
  fileURLToPath(new URL("../carma2_orig", import.meta.url));
test("original Stock/Advanced map definition and render palette feed the implemented owner", async (t) => {
  let store;
  try {
    store = await createAssetStore(originalRoot);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip("Local original installation absent");
    return;
  }
  const parsed = parsePix(await store.read("data/Reg/PALETTES/DRRENDER.PAL"));
  const palette = parsed[0].palette ?? parsed[0].rgba;
  const offset = 52 * 4;
  assert.equal(
    pedestrianMapColor(palette),
    `rgb(${palette[offset]}, ${palette[offset + 1]}, ${palette[offset + 2]})`,
  );
  for (const path of ["data/powerup.txt", "adv_data/powerup.txt"]) {
    const text = decodeText(await store.read(path));
    const definitions = parsePowerups(text),
      d = definitions[24];
    assert.equal(d.action, 29);
    assert.equal(d.duration, 0);
    assert.equal(d.icon, "pedsonmap");
    assert.equal(isPowerupImplemented(d), true);
    const system = await new PowerupSystem(
      { text: async () => text },
      new Group(),
    ).init();
    const car = createVehicle(new Vector3()),
      race = createRace([]);
    car.driver = 8;
    system.grant(24, car, race);
    assert.equal(system.update(100, car, race).pedestriansOnMap, true, path);
    system.grant(93, car, race);
    assert.equal(system.update(0, car, race).pedestriansOnMap, false, path);
    system.dispose();
  }
});
