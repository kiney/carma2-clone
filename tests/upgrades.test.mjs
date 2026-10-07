import test from "node:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import {
  parseUpgradeSettings,
  createUpgradeState,
  upgradeFactors,
  skillValue,
  buyUpgrade,
  gainUpgrade,
  tradeInAPO,
  repairComponents,
  payRepair,
  createRepairControl,
  updateRepairControl,
  setTemporaryMotionPowerup,
  resetTemporaryMotionPowerup,
} from "../src/physics/upgrades.ts";
const originalRoot = fileURLToPath(new URL("../carma2_orig", import.meta.url));
const hasOriginal = existsSync(originalRoot + "/data");
const store = hasOriginal ? await createAssetStore(originalRoot) : undefined;
// Independent numeric fixture keeps formula tests useful without proprietary assets.
const bunch = (skill, network = Array(8).fill(0)) => [
  skill.join(","),
  network.join(","),
];
const fixture = [
  ...bunch([1, 0, 0]),
  ...bunch([1, 0, 0]),
  ...bunch([1, 0, 0]),
  ...bunch([7, 4, 2], Array(8).fill(30)),
  ...bunch([7, 4, 2], Array(8).fill(30)),
  ...bunch([7, 4, 2], Array(8).fill(30)),
  ...bunch([30, 30, 30], Array(8).fill(30)),
  ...bunch([30, 30, 30], Array(8).fill(30)),
  ...bunch([30, 30, 30], Array(8).fill(30)),
  ...bunch([50000, 50000, 75000], Array(8).fill(2000)),
  ...bunch([25000, 25000, 35000], Array(8).fill(1000)),
  ...bunch([50000, 50000, 75000], Array(8).fill(5000)),
  ...bunch([50000, 50000, 75000], Array(8).fill(10000)),
  "1",
  "1.25 // Power starting value",
  "1",
  ".91",
  "1.06",
  "1.06",
  "89",
  ...bunch([10000, 5000, 2500], Array(8).fill(5000)),
  ...bunch([10, 20, 30], [15, 15, 7.5, 7.5, 7.5, 7.5, 7.5, 7.5]),
  ...bunch([1000, 2000, 4000], Array(8).fill(1000)),
  ...bunch([1, 1, 1], [1, 1.5, 1.5, 1.5, 1.5, 1.5, 0.75, 1.5]),
  ...bunch([1, 1, 1], [2, 3, 1, 1, 1, 1, 1, 1]),
];
fixture[0] += " // Initial armour, single player";
const general = store
  ? decodeText(await store.read("data/general.txt"))
  : fixture.join("\n");
const settings = parseUpgradeSettings(general);
const context = { skill: 0 };
const levels = (value) => [value, ...Array(11).fill(0)];
const near = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("original GENERAL skill levels, potential, prices and sequential float APO tables", () => {
  const easy = createUpgradeState(settings, context),
    medium = createUpgradeState(settings, { skill: 1 }),
    hard = createUpgradeState(settings, { skill: 2 });
  assert.deepEqual(easy, {
    levels: [1, 1, 1],
    potential: [7, 7, 7],
    credits: 10000,
  });
  assert.deepEqual(medium, {
    levels: [0, 0, 0],
    potential: [4, 4, 4],
    credits: 5000,
  });
  assert.deepEqual(hard, {
    levels: [0, 0, 0],
    potential: [2, 2, 2],
    credits: 2500,
  });
  assert.deepEqual(settings.cost.skill, [50000, 50000, 75000]);
  assert.deepEqual(settings.tradeIn.skill, [25000, 25000, 35000]);
  const factors = upgradeFactors(easy, settings);
  assert.equal(factors.armour, Math.fround(0.91));
  assert.equal(factors.power, Math.fround(1.25 * Math.fround(1.06)));
  assert.equal(factors.offensive, Math.fround(1.06));
  near(upgradeFactors(medium, settings).power, 1.25);
  assert.equal(settings.factors[1].length, 100);
  for (let i = 1; i < 100; i++)
    assert.equal(
      settings.factors[1][i],
      Math.fround(settings.factors[1][i - 1] * Math.fround(1.06)),
    );
  assert.throws(
    () => upgradeFactors({ levels: [0, 100, 0] }, settings),
    /outside source/,
  );
});
test("advanced GENERAL preserves materially different initial power and economy", async (t) => {
  if (!store) {
    t.skip("Original advanced GENERAL is absent");
    return;
  }
  const advanced = parseUpgradeSettings(
    decodeText(await store.read("adv_data/General.txt")),
  );
  assert.deepEqual(createUpgradeState(advanced, { skill: 1 }), {
    levels: [0, 6, 0],
    potential: [3, 9, 3],
    credits: 20000,
  });
  assert.deepEqual(advanced.cost.skill, [100000, 150000, 200000]);
  near(
    upgradeFactors(createUpgradeState(advanced, { skill: 1 }), advanced).power,
    1.25 * 1.06 ** 6,
  );
});
test("network columns preserve game type costs and original five-column money loader quirk", () => {
  const network = { skill: 2, networkType: 3 };
  assert.deepEqual(createUpgradeState(settings, network), {
    levels: [0, 0, 0],
    potential: [30, 30, 30],
    credits: 5000,
  });
  assert.equal(skillValue(settings.repairCost, network), 7.5);
  assert.equal(
    skillValue(settings.softness, { skill: 0, networkType: 6 }),
    0.75,
  );
  assert.equal(settings.startingMoney.network[7], 5000);
  assert.equal(
    createUpgradeState(settings, { skill: 0, networkType: 7 }).credits,
    0,
  );
  assert.throws(
    () => skillValue(settings.cost, { skill: 0, networkType: 8 }),
    /Invalid/,
  );
});
test("strict parser locates labelled subsection and rejects positional corruption", () => {
  assert.throws(() => parseUpgradeSettings("1,0,0"), /missing Initial/);
  assert.throws(
    () =>
      parseUpgradeSettings(
        general.replace(/1,0,0(\s*\/\/ Initial armour)/, "1,0$1"),
      ),
    /invalid initial armour skill/,
  );
  assert.throws(
    () =>
      parseUpgradeSettings(
        general.slice(0, general.indexOf("// Power starting value")),
      ),
    /missing|invalid/,
  );
});
test("buy and gain respect remaining potential and source credit cost", () => {
  const state = { levels: [1, 1, 1], potential: [2, 7, 7], credits: 50000 };
  assert.equal(buyUpgrade(state, 0, settings, context), "bought");
  assert.equal(state.credits, 0);
  assert.equal(buyUpgrade(state, 0, settings, context), "full");
  assert.equal(buyUpgrade(state, 1, settings, context), "unaffordable");
  assert.equal(gainUpgrade(state, 1, -1), 6);
  assert.equal(gainUpgrade(state, 1, 2), 0);
});
test("trade-in samples all three types and rejects empty ones until enough upgrades are sold", () => {
  const state = { levels: [0, 2, 1], potential: [7, 7, 7], credits: 100 };
  const draws = [0, 1, 0, 2];
  let index = 0;
  assert.deepEqual(
    tradeInAPO(state, 40000, settings, context, () => draws[index++]),
    { remainingCost: 0, sold: [0, 1, 1] },
  );
  assert.equal(index, 4);
  assert.deepEqual(state.levels, [0, 1, 0]);
  assert.equal(state.credits, 50100);
  assert.deepEqual(
    tradeInAPO(state, 60000, settings, context, () => 1),
    { remainingCost: 35000, sold: [0, 1, 0] },
  );
  assert.equal(state.credits, 75100);
  assert.deepEqual(tradeInAPO(state, -10, settings, context), {
    remainingCost: 0,
    sold: [0, 0, 0],
  });
});
test("repair ratios floor each component and repair price truncates each iteration then tens", () => {
  const result = repairComponents(
    [99, 20, 9, ...Array(9).fill(0)],
    0.2,
    1,
    settings,
    { skill: 0 },
  );
  assert.deepEqual(result.damage, [80, 16, 8, ...Array(9).fill(0)]);
  assert.equal(result.cost, 240);
  assert.equal(result.difference, 24);
  // Network 7.5 credits per unit: each one-point unit costs 7, not a rounded total15.
  const network = repairComponents(
    [1, 1, ...Array(10).fill(0)],
    0,
    0,
    settings,
    { skill: 0, networkType: 2 },
  );
  assert.equal(network.cost, 10);
  assert.deepEqual(network.damage, Array(12).fill(0));
  assert.equal(network.finished, false);
  const complete = repairComponents(Array(12).fill(0), 0, 0, settings, context);
  assert.equal(complete.finished, true);
  assert.throws(
    () => repairComponents([1], 0, 0, settings, context),
    /12 damage/,
  );
});
test("repair sells against full bill, clamps overspend, and skips billing during free repair", () => {
  const state = { levels: [1, 1, 0], potential: [7, 7, 7], credits: 30000 };
  const payment = payRepair(state, 40000, settings, context, false, () =>
    state.levels[0] ? 0 : 1,
  );
  assert.deepEqual(payment, { charged: 40000, sold: [1, 1, 0] });
  assert.equal(state.credits, 40000);
  const broke = { levels: [0, 0, 0], potential: [7, 7, 7], credits: 5 };
  payRepair(broke, 20, settings, context);
  assert.equal(broke.credits, 0);
  const free = { levels: [1, 1, 1], potential: [7, 7, 7], credits: 0 };
  assert.deepEqual(payRepair(free, 40000, settings, context, true), {
    charged: 0,
    sold: [0, 0, 0],
  });
  assert.deepEqual(free.levels, [1, 1, 1]);
});
test("repair double-tap follows original 1200ms boundary, hold and auto continuation", () => {
  const c = createRepairControl();
  assert.equal(updateRepairControl(c, true, 2000), true);
  assert.equal(c.autoRepair, false);
  updateRepairControl(c, true, 2100);
  updateRepairControl(c, false, 2200);
  updateRepairControl(c, true, 3299);
  assert.equal(c.autoRepair, true);
  assert.equal(updateRepairControl(c, false, 3500), true);
  assert.equal(updateRepairControl(c, false, 3600, true), false);
  assert.equal(c.autoRepair, true);
  const boundary = createRepairControl();
  updateRepairControl(boundary, true, 2000);
  updateRepairControl(boundary, false, 2200);
  updateRepairControl(boundary, true, 3200);
  assert.equal(boundary.autoRepair, false);
  // Source zero-initialized timestamp enables auto mode on a first press within1200ms.
  const early = createRepairControl();
  updateRepairControl(early, true, 1199);
  assert.equal(early.autoRepair, true);
});

test("temporary engine/grip assignment retains full source suspension parameters, replacement and reset", () => {
  const target = { engineFactor: 1, tyreGripFactor: 1 };
  assert.deepEqual(
    setTemporaryMotionPowerup(target, 9, [4, 5, 2, 3, 0.5, 0.1, 0.2]),
    {
      frontGiveMultiplier: 2,
      rearGiveMultiplier: 3,
      dampingMultiplier: 0.2,
      frontExtraLength: 0.5,
      rearExtraLength: 0.1,
    },
  );
  assert.deepEqual(target, { engineFactor: 4, tyreGripFactor: 5 });
  setTemporaryMotionPowerup(target, 9, [2, 3, 1, 1, 0, 0, 1]);
  assert.deepEqual(target, { engineFactor: 2, tyreGripFactor: 3 });
  setTemporaryMotionPowerup(target, 21, [6]);
  assert.deepEqual(target, { engineFactor: 2, tyreGripFactor: 6 });
  resetTemporaryMotionPowerup(target, 21);
  assert.deepEqual(target, { engineFactor: 2, tyreGripFactor: 1 });
  assert.deepEqual(resetTemporaryMotionPowerup(target, 9), {
    frontGiveMultiplier: 1,
    rearGiveMultiplier: 1,
    dampingMultiplier: 1,
    frontExtraLength: 0,
    rearExtraLength: 0,
  });
  assert.deepEqual(target, { engineFactor: 1, tyreGripFactor: 1 });
  assert.throws(
    () => setTemporaryMotionPowerup(target, 9, [1, 1]),
    /Missing source/,
  );
});
