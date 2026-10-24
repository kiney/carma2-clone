import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parsePowerupCatalog } from "../src/powerups.ts";
import {
  NativePowerupRespawns,
  parsePowerupRespawnSettings,
  readPowerupRespawnSpecs,
} from "../src/powerup-respawn.ts";

test("respawn masks parse native singleton, unset, and half-open range groups", () => {
  const [first, second] = readPowerupRespawnSpecs(
    ["2", "3", "-10", "2", "-53", "13", "-8", "90", "1", "-98", "0"],
    98,
  );
  assert.deepEqual(
    [...first.keys()].filter((i) => first[i]),
    [
      ...Array.from({ length: 10 }, (_, i) => i + 2),
      ...Array.from({ length: 53 }, (_, i) => i + 13),
      ...Array.from({ length: 8 }, (_, i) => i + 90),
    ],
  );
  assert.deepEqual(
    [...second.keys()].filter((i) => second[i]),
    Array.from({ length: 98 }, (_, i) => i),
  );
  assert.deepEqual(readPowerupRespawnSpecs([], 98), []);
  assert.deepEqual(
    [...readPowerupRespawnSpecs(["1", "2", "1", "0"], 3)[0]],
    [1, 1, 0],
  );
});

test("respawn mask parser rejects truncated, trailing, negative-count, and out-of-bounds data", () => {
  for (const values of [["1"], ["1", "1", "-2"], ["1", "-1"], ["1", "0", "7"]])
    assert.throws(() => readPowerupRespawnSpecs(values, 3), /POWERUP\.TXT/);
  assert.throws(
    () => readPowerupRespawnSpecs(["1", "1", "-3", "2"], 4),
    /range/,
  );
  assert.throws(() => readPowerupRespawnSpecs(["1", "1", "3"], 3), /index/);
  assert.throws(() => readPowerupRespawnSpecs(["-1"], 3), /spec count/);
  assert.throws(() => readPowerupRespawnSpecs(["1", "-1"], 3), /group count/);
});

const simpleConnotations = `
0
0
0
none
0
0
0
0
none
0`;

test("general respawn settings require exact labels and parse connotations using the smash reader", () => {
  const parsed = parsePowerupRespawnSettings(`
90 // Pickup respawn min time (seconds)
60 // Pickup respawn max extra time (seconds)
// Powerup respawn connotations
${simpleConnotations}
`);
  assert.equal(parsed.minimumMs, 90000);
  assert.equal(parsed.extraMs, 60000);
  assert.deepEqual(parsed.connotations, {
    sounds: [],
    shrapnel: [],
    explosions: [],
    slick: null,
    activations: [],
    sideEffects: [],
    extensionFlags: 0,
    extensionArgument: undefined,
    roomCode: 0,
    award: { frequency: "none" },
    variableChanges: [],
  });
  assert.throws(
    () =>
      parsePowerupRespawnSettings(
        `90 // Pickup respawn min time (seconds)\n${simpleConnotations}`,
      ),
    /max extra time/,
  );
  assert.throws(
    () =>
      parsePowerupRespawnSettings(
        `90.5 // Pickup respawn min time (seconds)\n60 // Pickup respawn max extra time (seconds)\n// Powerup respawn connotations\n${simpleConnotations}`,
      ),
    /min time/,
  );
  const negative = parsePowerupRespawnSettings(`
-2 // Pickup respawn min time (seconds)
0 // Pickup respawn max extra time (seconds)
// Powerup respawn connotations
${simpleConnotations}
`);
  assert.equal(negative.minimumMs, -2000);
  assert.equal(negative.extraMs, 0);
  for (const invalidSeconds of [
    "2147483648",
    "-2147483649",
    "9007199254740992",
  ]) {
    assert.throws(
      () =>
        parsePowerupRespawnSettings(`
${invalidSeconds} // Pickup respawn min time (seconds)
0 // Pickup respawn max extra time (seconds)
// Powerup respawn connotations
${simpleConnotations}
`),
      /GENERAL\.TXT:.*signed 32-bit seconds/,
    );
  }
});

test("fixed respawn slots preserve collection order and native signed deadline comparison", () => {
  const enabled = new Uint8Array([0, 1, 1]);
  const queue = new NativePowerupRespawns(enabled, 100, 7);
  const a = {},
    b = {};
  assert.equal(queue.queue(0, a, 1000), false);
  assert.equal(queue.queue(1, null, 1000), false);
  assert.equal(queue.queue(1, a, 1000), true);
  assert.equal(queue.queue(2, b, 1000), true);
  assert.equal(queue.pendingCount, 2);
  const calls = [];
  assert.equal(
    queue.update(1102, (index, actor) => calls.push([index, actor])),
    0,
  );
  assert.equal(queue.pendingCount, 2);
  assert.equal(
    queue.update(1103, (index, actor) => calls.push([index, actor])),
    2,
  );
  assert.deepEqual(calls, [
    [1, a],
    [2, b],
  ]);
  assert.equal(queue.pendingCount, 0);

  const wrapping = new NativePowerupRespawns(enabled, 32, 0);
  assert.equal(wrapping.queue(1, a, 0x7fffffff), true);
  assert.equal(
    wrapping.update(0x7fffffff, () => {}),
    1,
    "native signed comparison treats the wrapped negative deadline as already due",
  );
  assert.equal(wrapping.pendingCount, 0);

  const negativeDelay = new NativePowerupRespawns(enabled, -1, -3);
  negativeDelay.queue(1, a, 0.75);
  assert.equal(
    negativeDelay.update(-3, () => {}),
    0,
  );
  assert.equal(
    negativeDelay.update(-2, () => {}),
    1,
    "sample the integer native clock before adding signed delay fields",
  );
});

test("respawn queue enforces 100 slots, clears, and releases a slot after callback failure", () => {
  const enabled = new Uint8Array([1]);
  const queue = new NativePowerupRespawns(enabled, 0, 0);
  const actors = Array.from({ length: 101 }, () => ({}));
  for (let i = 0; i < 100; i++)
    assert.equal(queue.queue(0, actors[i], 0), true);
  assert.equal(queue.queue(0, actors[100], 0), false);
  assert.equal(queue.pendingCount, 100);
  assert.throws(
    () =>
      queue.update(0, () => {
        throw new Error("respawn callback failure");
      }),
    /callback failure/,
  );
  assert.equal(queue.pendingCount, 99);
  queue.clear();
  assert.equal(queue.pendingCount, 0);

  const reentrant = new NativePowerupRespawns(enabled, 0, 0);
  reentrant.queue(0, actors[0], 0);
  const events = [];
  reentrant.update(0, () => {
    events.push("first");
    reentrant.queue(0, actors[1], 0);
  });
  assert.deepEqual(
    events,
    ["first", "first"],
    "a newly queued later slot is visible during the same physical scan",
  );
  assert.equal(
    reentrant.pendingCount,
    1,
    "the callback reuses the released earlier slot",
  );
  reentrant.update(0, () => events.push("second"));
  assert.deepEqual(events, ["first", "first", "second"]);
  assert.equal(reentrant.pendingCount, 0);
});

test("installed Stock and Advanced respawn records match independently authored native masks", async (t) => {
  const root = process.env.CARMA2_ROOT ?? path.resolve("carma2_orig");
  let assets;
  try {
    assets = await createAssetStore(root);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip("original installation not available");
    return;
  }
  const expectedMasks = [
    [
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
      23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
      41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58,
      59, 60, 61, 62, 63, 64, 65, 90, 91, 92, 93, 94, 95, 96, 97,
    ],
    Array.from({ length: 98 }, (_, i) => i),
  ];
  for (const directory of ["data", "adv_data"]) {
    const powerupText = decodeText(
      await assets.read(`${directory}/POWERUP.TXT`),
    );
    const generalText = decodeText(
      await assets.read(`${directory}/GENERAL.TXT`),
    );
    const definitionsMatch = /^\s*(\d+)\s*\/\/\s*Number of powerups/im.exec(
      powerupText,
    );
    assert.ok(
      definitionsMatch,
      `${directory} powerup table has its definition count`,
    );
    const definitionCount = Number(definitionsMatch[1]);
    const marker = /^\s*\/\/\s*RESPAWN SPECS\s*$/im.exec(powerupText);
    assert.ok(marker, `${directory} powerup table has its respawn section`);
    const after = powerupText.slice(marker.index + marker[0].length);
    const end = after.search(/^\s*\/\/\s*NETWORK AUTO-GOODIES\s*$/im);
    assert.notEqual(
      end,
      -1,
      `${directory} powerup table has a following network section`,
    );
    const values = after
      .slice(0, end)
      .split(/\r?\n/)
      .map((line) => line.split("//", 1)[0].trim())
      .filter(Boolean);
    const [singlePlayer, network] = readPowerupRespawnSpecs(
      values,
      definitionCount,
    );
    assert.deepEqual(parsePowerupCatalog(powerupText).respawnSpecs, [
      singlePlayer,
      network,
    ]);
    assert.deepEqual(
      [...singlePlayer.keys()].filter((i) => singlePlayer[i]),
      expectedMasks[0],
      `${directory} single-player mask`,
    );
    assert.deepEqual(
      [...network.keys()].filter((i) => network[i]),
      expectedMasks[1],
      `${directory} network mask`,
    );
    const settings = parsePowerupRespawnSettings(generalText);
    assert.equal(settings.minimumMs, 90000, `${directory} minimum delay`);
    assert.equal(settings.extraMs, 60000, `${directory} extra delay`);
    assert.deepEqual(
      settings.connotations.sounds,
      [5402],
      `${directory} respawn sound`,
    );
    assert.equal(
      settings.connotations.explosions.length,
      2,
      `${directory} respawn effects`,
    );
  }
});
