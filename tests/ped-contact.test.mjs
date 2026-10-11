import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parsePedContactSettings,
  normalisePedContactDamage,
  resolvePedContactDamage,
  passivePedContact,
  activePedContact,
} from "../src/physics/ped-contact.ts";

const f = Math.fround;
const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const settings = {
  severDamage: 40,
  severChance: 10,
  maxSurvivableInitialImpact: 8,
  damagePerForce: 250,
};
const form = {
  personalityMass: 0.068,
  simpleBodyMass: 0.068,
  boneCount: 12,
  nonHumanoid: false,
};
const state = {
  hitPoints: 100,
  flags: 0x40,
  immortal: false,
  exploding: false,
  brittle: false,
  goreLevel: 0,
  removedBoneMask: 0,
  headMissing: false,
};
const other = { type: 1, ownerPresent: true, mass: 1, velocity: v(0.5) };
const passive = (extra = {}) =>
  passivePedContact({
    settings,
    form,
    state,
    other,
    characterVelocity: v(),
    pedRigidType: 2,
    impactCount: 0,
    ...extra,
  });
const active = (extra = {}) =>
  activePedContact({
    settings,
    form,
    state,
    other,
    pedRigidType: 2,
    pedOwnerPresent: true,
    replay: false,
    totalLambda: 0.1,
    firstRowLambda: 0.1,
    pedVelocityY: 0,
    worldForce: v(2, 3, 4),
    faceNormal: v(0, 1, 0),
    ...extra,
  });

test("original settings contact records and malformed input bounds", async (t) => {
  let text;
  try {
    text = await readFile(
      new URL("../carma2_orig/data/PEDS/settings.txt", import.meta.url),
      "utf8",
    );
  } catch (error) {
    if (error.code === "ENOENT")
      return t.skip("Original installation unavailable");
    throw error;
  }
  assert.deepEqual(parsePedContactSettings(text), settings);
  assert.throws(() => parsePedContactSettings("1\n2"), /Incomplete/);
  assert.throws(
    () =>
      parsePedContactSettings(
        text.replace(/\b8(?=\s*\/\/ Maximum survivable)/, "0"),
      ),
    /Invalid/,
  );
});

test("mass-normalised damage retains the installed double constant / Float32 mass boundary", () => {
  // 0.068 double / f32(0.068) is slightly less than one: native 100 becomes99.
  assert.equal(normalisePedContactDamage(100, form, state), 99);
  assert.equal(normalisePedContactDamage(101, form, state), 100);
  assert.equal(
    normalisePedContactDamage(100, { ...form, simpleBodyMass: 0.136 }, state),
    24,
  );
  assert.equal(normalisePedContactDamage(-10, form, state), -9);
  assert.equal(
    normalisePedContactDamage(
      0,
      { ...form, nonHumanoid: true },
      { ...state, brittle: true },
    ),
    100,
  );
});

test("HP tail supports survival, fatal threshold, immortal state and signed-byte subtraction", () => {
  assert.deepEqual(resolvePedContactDamage(99, form, state, 90, 92), {
    damage: 99,
    effectiveDamage: 99,
    hitPoints: 1,
    wasAlive: true,
    killed: false,
    survived: true,
    reactionMoveId: 90,
    reactionAction: 5,
  });
  assert.equal(resolvePedContactDamage(100, form, state, 90, 92).hitPoints, 0);
  assert.equal(
    resolvePedContactDamage(2, form, { ...state, hitPoints: 1 }, 90, 92)
      .hitPoints,
    -1,
  );
  assert.equal(
    resolvePedContactDamage(-40, form, state, 90, 92).hitPoints,
    -116,
  );
  assert.equal(
    resolvePedContactDamage(100, form, { ...state, immortal: true }, 90, 92)
      .hitPoints,
    1,
  );
  assert.equal(
    resolvePedContactDamage(2, form, { ...state, headMissing: true }, 90, 92)
      .hitPoints,
    0,
  );
  const nonHumanoid = resolvePedContactDamage(
    10,
    { ...form, nonHumanoid: true },
    { ...state, removedBoneMask: 1 },
    90,
    92,
  );
  assert.equal(nonHumanoid.hitPoints, 0);
  assert.equal(nonHumanoid.effectiveDamage, 0);
  assert.equal(
    resolvePedContactDamage(-10, form, { ...state, hitPoints: -1 }, 90, 92)
      .hitPoints,
    -1,
  );
  assert.equal(
    resolvePedContactDamage(50, form, { ...state, hitPoints: -1 }, 90, 92)
      .reactionMoveId,
    -1,
  );
});

test("passive callback uses momentum difference rather than relative speed and gates bit40", () => {
  const result = passive();
  assert.equal(result.momentumSquared, 0.25);
  assert.equal(result.rawDamage, 3);
  assert.equal(result.damage, 2);
  assert.equal(result.hitPoints, 98);
  assert.equal(result.reactionMoveId, 90);
  const equalVelocity = passive({ characterVelocity: v(0.5) });
  assert.ok(
    equalVelocity.momentumSquared > 0.2,
    "equal velocities do not cancel different masses",
  );
  assert.deepEqual(passive({ state: { ...state, flags: 0 } }), {
    eligible: false,
    reason: "ped-flag40-clear",
  });
  const stationaryOther = passive({
    other: null,
    characterVelocity: v(1, 2, 3),
  });
  const m = f(0.068);
  assert.equal(
    stationaryOther.momentumSquared,
    m * m + f(-m * 2) ** 2 + f(-m * 3) ** 2,
  );
});

test("passive fatal helper move91/92 is immediately replaced by94/actionDead", () => {
  const low = passive({
    other: { ...other, velocity: v(3) },
    impactCount: 65535,
  });
  assert.equal(low.deadImpactMove, 91);
  assert.equal(low.helperReactionMoveId, 91);
  assert.equal(low.reactionMoveId, 94);
  assert.equal(low.reactionAction, 6);
  assert.equal(low.impactCount, 0);
  assert.equal(low.collisionFilterA, 0x20000);
  const high = passive({
    other: { ...other, velocity: v(4) },
    pedRigidType: 5,
  });
  assert.equal(high.deadImpactMove, 92);
  assert.equal(high.collisionFilterA, 0x40000);
  assert.equal(high.collisionFilterB, 0x40000);
});

test("active dispatcher gates group sum but HP uses first row lambda", () => {
  const result = active({ totalLambda: 20, firstRowLambda: 0.004 });
  assert.equal(result.rawDamage, 1);
  assert.equal(result.damage, 0);
  assert.equal(result.hitPoints, 100);
  assert.equal(result.reactionMoveId, -1);
  assert.equal(active({ totalLambda: f(0.0005) }).eligible, false);
  assert.equal(active({ totalLambda: f(0.000500001) }).eligible, true);
  assert.equal(active({ pedRigidType: 5 }).eligible, false);
  assert.equal(active({ other: { ...other, type: 3 } }).reason, "ped-ped");
  assert.equal(
    active({ other: { ...other, type: 3, ownerPresent: false } }).eligible,
    true,
  );
  assert.equal(active({ replay: true }).eligible, false);
  assert.equal(active({ pedOwnerPresent: false }).eligible, false);
});

test("active damage world coefficient, negative lambda and zero early return", () => {
  assert.equal(active().rawDamage, 25);
  assert.equal(active({ other: null }).rawDamage, 37);
  assert.equal(active({ firstRowLambda: -0.1 }).rawDamage, -25);
  assert.equal(
    active({ firstRowLambda: -0.1, state: { ...state, flags: 6 } }).pinned,
    false,
  );
  const zero = active({ firstRowLambda: 0.001, state: { ...state, flags: 6 } });
  assert.equal(zero.applied, false);
  assert.equal(
    zero.flags,
    6,
    "native zero integer damage returns before pinned flag handling",
  );
});

test("downward native velocity and owned special mass multiply active lambda exactly once", () => {
  assert.equal(active({ pedVelocityY: f(-1.7) }).multiplier, 10);
  assert.equal(active({ pedVelocityY: f(-1.6999998) }).multiplier, 1);
  const special = { ...other, type: 32 };
  assert.equal(
    active({ other: special, specialMass: 1, pedVelocityY: -2 }).multiplier,
    10,
  );
  assert.equal(
    active({ other: { ...special, ownerPresent: false }, specialMass: 1 })
      .multiplier,
    1,
  );
  assert.equal(
    active({ other: special }).unresolved.includes("special-type32-mass"),
    true,
  );
  assert.equal(
    passive({ other: special, specialMass: 1 }).momentumSquared,
    2.5,
  );
});

test("contact plane flags accumulate across body/world calls before native pinned move96", () => {
  const body = active();
  assert.equal(body.flags, 0x44);
  const world = active({
    other: null,
    faceNormal: v(1, 0, 0),
    state: { ...state, flags: body.flags },
  });
  assert.equal(world.flags, 0x4e);
  assert.equal(world.pinned, true);
  assert.equal(world.reactionMoveId, 96);
  const repeat = active({
    other: null,
    state: { ...state, flags: world.flags },
  });
  assert.equal(repeat.pinned, false);
  assert.equal(
    active({ other: null, faceNormal: v(0, f(0.706999), 0) }).flags & 2,
    2,
  );
  assert.equal(
    active({ other: null, faceNormal: v(0, f(0.707), 0) }).flags & 2,
    0,
  );
  assert.equal(active({ firstRowLambda: f(0.01) }).flags & 4, 0);
  assert.equal(active({ firstRowLambda: f(0.010001) }).flags & 4, 4);
});

test("exploding / nonhumanoid damage and severing providers are explicit without hidden RNG", () => {
  const exploding = { ...state, exploding: true };
  assert.equal(passive({ state: exploding }).rawDamage, 200);
  assert.equal(active({ state: exploding }).rawDamage, 480);
  const pending = active({
    firstRowLambda: 0.4,
    state: { ...state, goreLevel: 2 },
  });
  assert.deepEqual(pending.unresolved, ["bone-severing-outlet-before-HP-tail"]);
  assert.deepEqual(
    active({
      firstRowLambda: 0.4,
      state: { ...state, goreLevel: 2, immortal: true },
    }).unresolved,
    [],
  );
});

test("finite native inputs and owned vector copies prevent solver state mutation", () => {
  const worldForce = v(1.123456789, 2, 3),
    original = { ...worldForce };
  const result = active({ worldForce });
  assert.deepEqual(worldForce, original);
  assert.notEqual(result.worldForce, worldForce);
  assert.equal(result.worldForce.x, f(worldForce.x));
  assert.throws(() => active({ firstRowLambda: NaN }), /Invalid/);
  assert.throws(
    () => passive({ form: { ...form, simpleBodyMass: 0 } }),
    /Invalid/,
  );
  assert.throws(() => passive({ characterVelocity: v(Infinity) }), /Invalid/);
  assert.throws(() => active({ totalLambda: 1e100 }), /Invalid/);
  assert.throws(
    () =>
      resolvePedContactDamage(1, form, { ...state, hitPoints: 128 }, 90, 94),
    /Invalid/,
  );
});
