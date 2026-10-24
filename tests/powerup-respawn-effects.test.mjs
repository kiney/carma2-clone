import test from "node:test";
import assert from "node:assert/strict";
import { emitPowerupRespawnEffects } from "../src/powerup-respawn-effects.ts";

const explosion = {
  amount: [1, 1],
  delaySeconds: [0, 0],
  offset: [0, 0, 0],
  xFactor: [0, 0],
  yFactor: [0, 0],
  zFactor: [0, 0],
  frameRate: [8, 8],
  scale: [1, 1],
  rotation: "norotate",
  frames: [{ opacity: 1, pixelmap: "TEST.PIX" }],
};
const slick = {
  material: "TEST.MAT",
  first: [0, 0, 0],
  second: [0, 0, 0],
  firstPair: [0, 0],
};
function connotations(overrides = {}) {
  return {
    sounds: [],
    shrapnel: [],
    explosions: [],
    slick: null,
    activations: [],
    sideEffects: [],
    extensionFlags: 0,
    roomCode: 0,
    award: { frequency: "none" },
    variableChanges: [],
    ...overrides,
  };
}

test("respawn effects emit sound, visible explosion, then slick in native outlet order", () => {
  const calls = [];
  const samples = [0.5, 0.5];
  let sampleIndex = 0;
  const actor = { id: "pickup" };
  const groups = [explosion];
  emitPowerupRespawnEffects(
    connotations({ sounds: [4100, 4101], explosions: groups, slick }),
    actor,
    {
      random: () => {
        calls.push(["random", sampleIndex]);
        return samples[sampleIndex++];
      },
      sound: (...args) => calls.push(["sound", ...args]),
      isVisible: (target) => {
        calls.push(["visible", target]);
        return true;
      },
      explode: (...args) => calls.push(["explode", ...args]),
      slick: (...args) => calls.push(["slick", ...args]),
    },
  );
  assert.deepEqual(calls, [
    ["random", 0],
    ["random", 1],
    ["sound", 4101, 1, 1, actor],
    ["visible", actor],
    ["explode", groups, actor],
    ["slick", slick, actor],
  ]);
});

test("single sound still consumes pitch and alternative draws at native fixed-point pitch", () => {
  let draws = 0;
  const sounds = [];
  emitPowerupRespawnEffects(connotations({ sounds: [5402] }), "actor", {
    random: () => [0, 0.5][draws++],
    sound: (...args) => sounds.push(args),
    isVisible: () =>
      assert.fail("no explosion groups need no visibility check"),
    explode: () => assert.fail("no explosion groups"),
    slick: () => assert.fail("no slick"),
  });
  assert.equal(draws, 2);
  assert.deepEqual(sounds, [[5402, 1, 0.875, "actor"]]);
});

test("invisible explosion suppresses only explosions; sound and slick remain independent", () => {
  const calls = [];
  const actor = {};
  emitPowerupRespawnEffects(
    connotations({ sounds: [77], explosions: [explosion], slick }),
    actor,
    {
      random: () => 0.5,
      sound: (...args) => calls.push(["sound", ...args]),
      isVisible: (target) => {
        calls.push(["visible", target]);
        return false;
      },
      explode: () => calls.push(["explode"]),
      slick: (...args) => calls.push(["slick", ...args]),
    },
  );
  assert.deepEqual(calls, [
    ["sound", 77, 1, 1, actor],
    ["visible", actor],
    ["slick", slick, actor],
  ]);
});

test("empty respawn connotations are a no-op and do not draw randomness", () => {
  const calls = [];
  emitPowerupRespawnEffects(
    connotations(),
    {},
    {
      random: () => assert.fail("no sound means no random draw"),
      sound: () => calls.push("sound"),
      isVisible: () => calls.push("visible"),
      explode: () => calls.push("explode"),
      slick: () => calls.push("slick"),
    },
  );
  assert.deepEqual(calls, []);
});

test("respawn path ignores unrelated connotation channels", () => {
  const calls = [];
  emitPowerupRespawnEffects(
    connotations({
      shrapnel: [{ kind: "abstract", materials: ["TEST.MAT"] }],
      activations: [{ nonCarType: 1 }],
      sideEffects: [{ target: "TEST.MAT" }],
      award: { frequency: "doitregardless", first: 100 },
      roomCode: 12,
      variableChanges: [[1, 2]],
    }),
    {},
    {
      random: () => assert.fail("unrelated channels do not draw randomness"),
      sound: () => calls.push("sound"),
      isVisible: () => calls.push("visible"),
      explode: () => calls.push("explode"),
      slick: () => calls.push("slick"),
    },
  );
  assert.deepEqual(calls, []);
});
