import test from "node:test";
import assert from "node:assert/strict";
import { createVehicle } from "../src/legacy-arcade.ts";
import { fileURLToPath } from "node:url";
import { Group, Vector3 } from "three";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { createRace } from "../src/gameplay.ts";
import { parseCarMechanics } from "../src/mechanics.ts";
import { PowerupSystem } from "../src/powerups.ts";
import {
  createMotionParameters,
  setMotionSuspension,
  resetMotionSuspension,
} from "../src/physics/motion.ts";

const defaults = {
  frontGiveMultiplier: 1,
  rearGiveMultiplier: 1,
  frontExtraLength: 0,
  rearExtraLength: 0,
  dampingMultiplier: 1,
};
const engine = [8, 2.2, 1, 1.5, 0, 0.15, 1.5];
const jelly = [2, 2, 0.25, 0.25, 0.1];
function table(definitions) {
  return [
    definitions.length,
    ...definitions.flatMap((d) => [
      d.message ?? "Overlap fixture",
      "none",
      -1,
      d.duration ?? 30,
      d.initialValue ?? 0,
      d.action,
      d.floats?.length ?? 0,
      ...(d.floats ?? []),
      d.ints?.length ?? 0,
      ...(d.ints ?? []),
      d.group ?? 0,
      0,
      0,
    ]),
  ].join("\n");
}
async function fixture(definitions, root = new Group()) {
  const system = await new PowerupSystem(
    { text: async () => table(definitions) },
    root,
  ).init();
  const car = createVehicle(new Vector3()),
    race = createRace([]);
  return {
    system,
    car,
    race,
    grant(index, event) {
      return system.grant(index, car, race, event);
    },
    sample(dt = 0) {
      return system.update(dt, car, race);
    },
  };
}
function resetTrace(system) {
  const trace = [],
    original = system.resetEffect.bind(system);
  // Observe source handler dispatch order as well as the resulting public fields.
  system.resetEffect = (action) => {
    trace.push(action);
    original(action);
  };
  return trace;
}

test("group cancellation resets every conflicting field before the incoming setter", async () => {
  for (const next of [
    { action: 21, group: 2, floats: [0.2] },
    { action: 20, group: 4, floats: jelly },
  ]) {
    const f = await fixture([
      { action: 9, group: 7, floats: engine, duration: 1 },
      next,
    ]);
    f.grant(0);
    f.sample(0.75);
    f.grant(1);
    let m = f.sample();
    assert.equal(m.accelerationMultiplier, 1);
    assert.equal(m.lateralGripMultiplier, next.action === 21 ? 0.2 : 1);
    assert.deepEqual(
      m.suspension,
      next.action === 21
        ? defaults
        : {
            frontGiveMultiplier: 2,
            rearGiveMultiplier: 2,
            frontExtraLength: 0.25,
            rearExtraLength: 0.25,
            dampingMultiplier: 0.1,
          },
    );
    assert.deepEqual(
      f.sample(0.25),
      m,
      "removed engine deadline cannot reset the new effect",
    );
    f.sample(29.75);
    m = f.sample();
    assert.equal(m.accelerationMultiplier, 1);
    assert.equal(m.lateralGripMultiplier, 1);
    assert.deepEqual(m.suspension, defaults);
    f.system.dispose();
  }
});

test("disjoint grip and suspension coexist, then a broad engine group removes both", async () => {
  const f = await fixture([
    { action: 21, group: 2, floats: [0.2], duration: 1 },
    { action: 20, group: 4, floats: jelly, duration: 2 },
    { action: 9, group: 7, floats: engine, duration: 3 },
  ]);
  f.grant(1);
  f.grant(0);
  assert.equal(f.sample().lateralGripMultiplier, 0.2);
  assert.equal(f.sample().suspension.frontGiveMultiplier, 2);
  f.grant(2);
  assert.equal(f.sample(2).accelerationMultiplier, 8);
  assert.equal(f.sample().lateralGripMultiplier, 2.2);
  assert.equal(f.sample().suspension.rearGiveMultiplier, 1.5);
  assert.equal(f.sample(1).accelerationMultiplier, 1);
  assert.deepEqual(f.sample().suspension, defaults);
  f.system.dispose();
});

test("different zero-group definitions keep independent deadlines even with the same action", async () => {
  const f = await fixture([
    { action: 9, floats: engine, duration: 1 },
    { action: 9, floats: [4, 3, 2, 2, 0.1, 0.1, 2], duration: 2 },
  ]);
  f.grant(0);
  f.sample(0.75);
  f.grant(1);
  assert.equal(f.sample().accelerationMultiplier, 4);
  assert.equal(
    f.sample(0.25).accelerationMultiplier,
    1,
    "first definition still expires and resets the shared field",
  );
  f.grant(1);
  assert.equal(f.sample().accelerationMultiplier, 4);
  assert.equal(
    f.sample(1.75).accelerationMultiplier,
    4,
    "renewal replaced only the second definition's previous deadline",
  );
  assert.equal(f.sample(0.25).accelerationMultiplier, 1);
  f.system.dispose();
});

test("same-record renewal skips its reset and owns its new deadline", async () => {
  const f = await fixture([
    { action: 9, floats: engine, group: 1, duration: 1 },
    { action: 21, floats: [3], group: 0, duration: 3 },
  ]);
  const trace = resetTrace(f.system);
  f.grant(0);
  f.sample(0.75);
  f.grant(0);
  assert.deepEqual(trace, []);
  assert.equal(f.sample(0.25).accelerationMultiplier, 8);
  assert.equal(f.sample(0.75).accelerationMultiplier, 1);
  assert.deepEqual(trace, [9]);
  f.system.dispose();
});

test("conflict removal, expiry and cancellificator dispatch reset handlers in catalog order", async () => {
  for (const operation of ["conflict", "expiry", "cancel", "dispose"]) {
    const f = await fixture([
      { action: 9, floats: engine, group: 1, duration: 1 },
      { action: 20, floats: jelly, group: 4, duration: 1 },
      { action: 21, floats: [3], group: 2, duration: 1 },
      { action: 0, group: 7, duration: -1, ints: [100, 100] },
      { action: 51, duration: -1 },
    ]);
    const trace = resetTrace(f.system);
    f.grant(2);
    f.grant(1);
    f.grant(0);
    if (operation === "conflict") f.grant(3);
    else if (operation === "expiry") {
      f.system.beginFrame(1, f.car, f.race);
      assert.equal(f.car.health, 100);
      assert.equal(trace.length, 0, "expiry follows the physics window");
      f.system.finishFrame();
    } else if (operation === "cancel") f.grant(4);
    else f.system.dispose();
    assert.deepEqual(trace, [9, 20, 21], operation);
    assert.equal(f.sample().accelerationMultiplier, 1);
    assert.equal(f.sample().lateralGripMultiplier, 1);
    assert.deepEqual(f.sample().suspension, defaults);
    f.system.dispose();
  }
});

test("group masks use uint16, including bit15 and truncation of higher bits", async () => {
  for (const [groupA, groupB, conflicts] of [
    [0x8000, 0x8000, true],
    [-32768, 0x8000, true],
    [0x10001, 1, true],
    [0x10000, 0x10000, false],
    [1, 2, false],
  ]) {
    const f = await fixture([
      { action: 9, floats: engine, group: groupA },
      { action: 21, floats: [3], group: groupB },
    ]);
    f.grant(0);
    f.grant(1);
    assert.equal(f.sample().accelerationMultiplier, conflicts ? 1 : 8);
    f.system.dispose();
  }
});

test("instant and unsupported outcomes cancel conflicts before their event; zero duration stays active", async () => {
  for (const action of [0, 7, 43]) {
    const f = await fixture([
      { action: 9, group: 7, floats: engine, duration: 0 },
      { action, group: 2, duration: -1, ints: [100, 100] },
    ]);
    f.grant(0);
    assert.equal(f.sample(100).accelerationMultiplier, 8);
    let event;
    f.grant(1, (e) => {
      event = e;
      assert.equal(f.sample().accelerationMultiplier, 1);
    });
    assert.equal(
      event.kind,
      action === 0 ? "credits" : action === 7 ? "repair" : "unsupported",
    );
    assert.equal(f.sample(100).accelerationMultiplier, 1);
    f.system.dispose();
  }
  const f = await fixture([
    { action: 21, floats: [3], duration: -1, group: 2 },
    { action: 51, duration: -1 },
  ]);
  f.grant(0);
  f.grant(1);
  assert.equal(
    f.sample(100).lateralGripMultiplier,
    3,
    "an instant setter has no active record for the cancellificator to remove",
  );
  f.system.dispose();
});

test("inventory collection defers conflict removal until command use, including rejected handlers", async () => {
  const f = await fixture([
    { action: 9, group: 7, floats: engine },
    { action: 37, group: 2, initialValue: -3, duration: -1 },
  ]);
  f.grant(0);
  f.grant(1);
  assert.equal(f.sample().accelerationMultiplier, 8);
  assert.equal(
    f.system.activateAbility(f.race, () => false),
    false,
  );
  assert.equal(f.system.abilities.get(1).charges, 3);
  assert.equal(f.sample().accelerationMultiplier, 1);
  f.system.dispose();
});

test("swept pickups and debug grants share group cancellation", async () => {
  const root = new Group(),
    actor = new Group();
  actor.name = "&£01overlap";
  actor.position.x = 2;
  root.add(actor);
  const f = await fixture(
    [
      { action: 9, group: 7, floats: engine },
      { action: 21, group: 2, floats: [0.2] },
    ],
    root,
  );
  f.grant(0);
  f.sample();
  f.car.position.x = 3;
  assert.equal(f.sample().accelerationMultiplier, 1);
  assert.equal(f.sample().lateralGripMultiplier, 0.2);
  assert.equal(f.system.pickups[0].collected, true);
  f.system.dispose();
});

const originalRoot =
  process.env.CARMA2_ROOT ??
  fileURLToPath(new URL("../carma2_orig", import.meta.url));
async function originalStore(t) {
  try {
    return await createAssetStore(originalRoot);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip("Local original installation absent");
  }
}
const near = (actual, expected) =>
  assert.ok(
    Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)),
    `${actual} != ${expected}`,
  );
function suspensionConformance(motion, base, values) {
  const multipliers = [values.rearGiveMultiplier, values.frontGiveMultiplier];
  const extras = [values.rearExtraLength, values.frontExtraLength];
  for (let axle = 0; axle < 2; axle++) {
    near(motion.spring[axle], base.spring[axle] / multipliers[axle]);
    near(
      motion.damper[axle],
      (base.damper[axle] * values.dampingMultiplier) /
        Math.sqrt(multipliers[axle]),
    );
    near(
      motion.suspensionLength[axle],
      motion.suspensionBase.rideHeight +
        motion.suspensionBase.give[axle] * multipliers[axle] +
        extras[axle],
    );
  }
}

for (const tablePath of ["data/powerup.txt", "adv_data/powerup.txt"]) {
  test(`${tablePath}: original groups and Eagle/buggy suspension follow grants, replacement and expiry`, async (t) => {
    const store = await originalStore(t);
    if (!store) return;
    const text = decodeText(await store.read(tablePath));
    for (const name of ["EAGLE3", "buggy"]) {
      const source = parseCarMechanics(
        decodeText(await store.read(`data/CARS/${name}/${name}.txt`)),
      );
      const motion = createMotionParameters(source);
      const base = { spring: [...motion.spring], damper: [...motion.damper] };
      const car = createVehicle(new Vector3()),
        race = createRace([]);
      // Explicit expected survivors come from the native reset handlers, rather
      // than a second implementation of the group-cancellation algorithm.
      for (const { sequence, engineIndex, gripIndex, suspensionIndex } of [
        { sequence: [5, 26], gripIndex: 26 },
        { sequence: [5, 23], suspensionIndex: 23 },
        {
          sequence: [26, 23, 5],
          engineIndex: 5,
          gripIndex: 5,
          suspensionIndex: 5,
        },
        { sequence: [23, 42], gripIndex: 42, suspensionIndex: 23 },
        { sequence: [40, 5], engineIndex: 5, gripIndex: 5, suspensionIndex: 5 },
        { sequence: [5, 40], suspensionIndex: 40 },
        { sequence: [49, 42], gripIndex: 42 },
      ]) {
        const system = await new PowerupSystem(
          { text: async () => text },
          new Group(),
        ).init();
        const ds = system.definitions;
        assert.equal(ds[5].groupInclusion, 7);
        assert.equal(ds[23].groupInclusion, 4);
        assert.equal(ds[26].groupInclusion, 2);
        const expectedEngine =
          engineIndex === undefined ? 1 : ds[engineIndex].floatParams[0];
        const expectedGrip =
          gripIndex === undefined
            ? 1
            : ds[gripIndex].floatParams[ds[gripIndex].action === 9 ? 1 : 0];
        let expectedSuspension = defaults;
        if (suspensionIndex !== undefined) {
          const d = ds[suspensionIndex],
            offset = d.action === 9 ? 2 : 0;
          expectedSuspension = {
            frontGiveMultiplier: d.floatParams[offset],
            rearGiveMultiplier: d.floatParams[offset + 1],
            frontExtraLength: d.floatParams[offset + 2],
            rearExtraLength: d.floatParams[offset + 3],
            dampingMultiplier: d.floatParams[offset + 4],
          };
        }
        resetMotionSuspension(motion);
        let previous;
        for (const index of sequence) {
          system.grant(index, car, race);
          const m = system.update(0, car, race);
          if (m.suspension && m.suspension !== previous) {
            setMotionSuspension(motion, m.suspension);
            previous = m.suspension;
          }
        }
        const active = system.update(0, car, race);
        assert.equal(
          active.accelerationMultiplier,
          expectedEngine,
          `${name}: ${sequence}`,
        );
        assert.equal(
          active.lateralGripMultiplier,
          expectedGrip,
          `${name}: ${sequence}`,
        );
        assert.deepEqual(active.suspension ?? defaults, expectedSuspension);
        suspensionConformance(motion, base, expectedSuspension);
        if (engineIndex !== undefined) {
          // Bend/repair invokes a defaults setter independently. An unchanged
          // effect must not reapply itself, while a fresh grant is a new setter.
          resetMotionSuspension(motion);
          assert.equal(system.update(0, car, race).suspension, previous);
          suspensionConformance(motion, base, defaults);
          system.grant(engineIndex, car, race);
          const renewed = system.update(0, car, race).suspension;
          assert.notEqual(renewed, previous);
          setMotionSuspension(motion, renewed);
          suspensionConformance(motion, base, expectedSuspension);
        }
        const m = system.update(30, car, race);
        assert.equal(m.accelerationMultiplier, 1);
        assert.equal(m.lateralGripMultiplier, 1);
        setMotionSuspension(motion, m.suspension);
        suspensionConformance(motion, base, defaults);
        system.dispose();
      }
    }
  });
}
