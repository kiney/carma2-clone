import test from "node:test";
import assert from "node:assert/strict";
import { WastedFeedback } from "../src/wasted.ts";
import { NativeFont, parseScrollerMessages } from "../src/native-font.ts";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { existsSync } from "node:fs";

test("wasted events dedupe, play a supplied original sound once and reset per race", async () => {
  const played = [];
  const feedback = new WastedFeedback(
    {},
    { playSound: (id) => played.push(id) },
  );
  assert.equal(feedback.wasted("player", 0, "YOU", 100, 5400), true);
  assert.equal(feedback.wasted("player", 0, "YOU", 200, 5400), false);
  assert.deepEqual(played, [5400]);
  assert.equal(feedback.state(10_099).playerVisible, true);
  assert.equal(feedback.state(10_100).playerVisible, false);
  feedback.reset();
  assert.equal(feedback.wasted("player", 0, "YOU", 10_101), true);
});

test(
  "installed C2 wasted lettering uses SCROLLERS34 and archived italic glyphs",
  { skip: !existsSync(new URL("../carma2_orig/data", import.meta.url)) },
  async () => {
    const store = await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
    const assets = {
      bytes: (path) => store.read(path),
      text: async (path) => decodeText(await store.read(path)),
    };
    const messages = parseScrollerMessages(
      await assets.text("data/SCROLLERS.TXT"),
    );
    assert.deepEqual(messages[34], { font: 21, text: "YOU ARE WASTED" });
    const font = new NativeFont();
    await font.init(assets, "Big_Italic", 21);
    assert.equal(font.height, 24);
    assert.equal(font.width(messages[34].text), 210);
    for (const character of "YOUAREWASTED") {
      const glyph = font.glyphs.get(character.charCodeAt(0));
      assert.ok(glyph, `Original glyph missing: ${character}`);
      assert.equal(
        glyph.size,
        32,
        "Native glyph quad is 32px; metadata line height is 24px",
      );
      assert.ok(
        glyph.rgba.some((value, index) => index % 4 === 3 && value > 0),
      );
      assert.ok(
        glyph.rgba.some((value, index) => index % 4 === 3 && value === 0),
      );
    }
    const feedback = new WastedFeedback(assets, { playSound: () => {} });
    await feedback.init();
    feedback.wasted("player", 0, "YOU", 0, 5400);
    // 425px travel, truncated separately on each native HUD update.
    feedback.state(1_308);
    assert.equal(feedback.playerTextVisible, true);
    feedback.state(2_308); // strict >1000 hold gate
    feedback.state(2_309); // transition to exit, without consuming this frame's travel
    feedback.state(3_617); // exit passes -425
    assert.equal(feedback.playerTextVisible, false);
    assert.equal(feedback.state(3_618).playerVisible, true);
    feedback.reset();
    feedback.wasted("rival", 1, "RIPPER", 0, 5400);
    assert.equal(feedback.fancyVisible, false);
    feedback.wasted("rival", 2, "BRUISER", 40, 5400, true);
    assert.equal(feedback.fancyVisible, true);
    assert.equal(feedback.playerTextVisible, false);
    feedback.wasted("player", 0, "YOU", 80, 5400);
    feedback.wasted("rival", 3, "SCREWIE", 120, 5400, true);
    assert.equal(
      feedback.playerTextVisible,
      true,
      "Native fancy priority keeps player wasting above a rival reward",
    );
  },
);

test("rival headup flashes at the native cadence and expires after five seconds", () => {
  const feedback = new WastedFeedback({}, { playSound: () => {} });
  feedback.wasted("rival", 7, "RIPPER", 1_000);
  assert.deepEqual(feedback.state(1_000), {
    playerVisible: false,
    rivalLabel: "RIPPER",
    rivalVisible: true,
  });
  assert.equal(feedback.state(1_150).rivalVisible, true);
  assert.equal(feedback.state(1_151).rivalVisible, false);
  assert.equal(feedback.state(6_000).rivalLabel, "RIPPER");
  assert.equal(feedback.state(6_001).rivalLabel, undefined);
});

test("queued rival labels receive a full head interval and oldest is dropped at capacity", () => {
  const feedback = new WastedFeedback({}, { playSound: () => {} });
  for (let id = 0; id < 5; id++) feedback.wasted("rival", id, `R${id}`, 100);
  feedback.wasted("rival", 5, "R5", 200);
  assert.equal(feedback.state(5_200).rivalLabel, "R1");
  assert.equal(feedback.state(10_201).rivalLabel, "R2");
});
