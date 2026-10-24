import assert from "node:assert/strict";
import test from "node:test";
import { RaceFeedback, terminalRaceMessage } from "../src/race-feedback.ts";

test("wasted feedback stays actionable after transient messages expire", () => {
  const feedback = new RaceFeedback();
  const terminal = terminalRaceMessage({
    status: "failed",
    playerWasted: true,
    payoutActive: false,
  });
  feedback.notify("DAMAGE BONUS", 100, 2);
  assert.equal(feedback.current(100, false, terminal), "DAMAGE BONUS");
  assert.equal(feedback.current(2101, false, terminal), terminal);
  assert.equal(feedback.current(9000, true, terminal), terminal);
  assert.equal(feedback.current(9001, false, terminal), terminal);
});

test("wasted wreck countdown does not promise restart before it is available", () => {
  assert.equal(
    terminalRaceMessage({
      status: "racing",
      playerWasted: true,
      payoutActive: false,
    }),
    "CAR WASTED · RACE ENDING · PLEASE WAIT",
  );
  assert.equal(
    terminalRaceMessage({
      status: "failed",
      playerWasted: true,
      payoutActive: false,
    }),
    "YOU ARE WASTED · ENTER TO RESTART",
  );
});

test("a non-wasted failure keeps the timeout restart instruction", () => {
  assert.equal(
    terminalRaceMessage({
      status: "failed",
      playerWasted: false,
      payoutActive: false,
    }),
    "OUT OF TIME · ENTER TO RESTART",
  );
});

test("completion keeps the payout skip instruction, then changes to restart", () => {
  const feedback = new RaceFeedback();
  const payout = terminalRaceMessage({
    status: "completed",
    playerWasted: false,
    payoutActive: true,
  });
  feedback.notify("CHECKPOINT!", 0, 1);
  assert.equal(feedback.current(1200, false, payout), payout);
  const finished = terminalRaceMessage({
    status: "completed",
    playerWasted: false,
    payoutActive: false,
  });
  assert.equal(feedback.current(1201, false, finished), finished);
});

test("restart clears transient state and a new racing state has no terminal prompt", () => {
  const feedback = new RaceFeedback();
  feedback.notify("YOU ARE WASTED", 0, 10);
  feedback.clear();
  assert.equal(feedback.current(1, false, undefined), "");
  assert.equal(
    terminalRaceMessage({
      status: "racing",
      playerWasted: false,
      payoutActive: false,
    }),
    undefined,
  );
});
