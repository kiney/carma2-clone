import assert from "node:assert/strict";
import test from "node:test";
import { DIFFICULTIES, parseDifficultySkill } from "../src/difficulty.ts";
import { createUpgradeState } from "../src/physics/upgrades.ts";

test("difficulty skills map Easy, Medium, and Hard to original table indices", () => {
  assert.deepEqual(
    DIFFICULTIES.map(({ label, skill }) => [label, skill]),
    [
      ["Easy", 0],
      ["Medium", 1],
      ["Hard", 2],
    ],
  );
  assert.equal(parseDifficultySkill("1"), 1);
  assert.equal(parseDifficultySkill("2"), 2);
});

test("missing or invalid stored difficulty defaults safely to Easy", () => {
  for (const value of [null, undefined, "", "invalid", -1, 3, 1.5])
    assert.equal(parseDifficultySkill(value), 0);
});

test("the chosen index selects authored values from controlled three-skill tables", () => {
  const skillValues = (base) => ({
    skill: [base, base + 10, base + 20],
    network: Array(8).fill(base),
  });
  const settings = {
    initial: [skillValues(1), skillValues(2), skillValues(3)],
    potential: [skillValues(4), skillValues(5), skillValues(6)],
    startingMoney: skillValues(1000),
  };
  for (const skill of [0, 1, 2]) {
    const state = createUpgradeState(settings, { skill });
    assert.deepEqual(state.levels, [
      1 + skill * 10,
      2 + skill * 10,
      3 + skill * 10,
    ]);
    assert.deepEqual(state.potential, [
      4 + skill * 10,
      5 + skill * 10,
      6 + skill * 10,
    ]);
    assert.equal(state.credits, 1000 + skill * 10);
  }
});
