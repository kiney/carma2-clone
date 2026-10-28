import test from "node:test";
import assert from "node:assert/strict";
import { WastedFeedback } from "../src/wasted.ts";
import {
  NativeFont,
  acceptsFancyHeadup,
  fancyHeadupOffsets,
  legacyPolyfontId,
  nativePolyfontSpec,
  parseFancyHeadupSlot,
  parseScrollerMessages,
} from "../src/native-font.ts";
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
    assert.equal(feedback.fancy(24, 4_000), true);
    assert.deepEqual(feedback.fancySnapshot, {
      index: 24,
      startedAt: 4_000,
      stage: 0,
      offset: 425,
      endOffset: -425,
      text: "YOU ARE WASTED",
      fontId: 21,
      slot: { x: 320, y: 400, justification: "centre" },
    });
    assert.equal(feedback.fancy(20, 4_050, { mapView: 2 }), false);
    assert.equal(feedback.fancySnapshot.index, 24);
    assert.equal(feedback.fancy(20, 6_000), false);
    assert.equal(feedback.fancy(20, 6_001), true);
    assert.equal(feedback.fancySnapshot.text, "YOU WASTED 'EM");
    assert.equal(feedback.fancySnapshot.index, 20);
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

test("fancy headup priority uses unsigned time, map suppression, and equality acceptance", () => {
  assert.equal(acceptsFancyHeadup(-1, 0, 2, 0, 2), false);
  assert.equal(acceptsFancyHeadup(4, 100, 3, 2_100), false);
  assert.equal(acceptsFancyHeadup(4, 100, 3, 2_101), true);
  assert.equal(acceptsFancyHeadup(4, 100, 4, 100), true);
  assert.equal(acceptsFancyHeadup(4, 100, 5, 100), true);
  assert.equal(acceptsFancyHeadup(4, 0xfffffff0, 3, 0x7), false);
  assert.equal(acceptsFancyHeadup(4, 0xfffffff0, 3, 0x7c0), false);
  assert.equal(acceptsFancyHeadup(4, 0xfffffff0, 3, 0x7c1), true);
});

test("fancy headup loads authored slot 6 from both HEADUP tables", () => {
  // A seven-row table puts its index-6 entry after the seven-row count.
  const rows = [
    "7",
    ...Array.from(
      { length: 7 },
      (_, i) => `0,${100 + i},${200 + i},1,${i === 6 ? "rl" : "ch"},-1`,
    ),
    "7",
    ...Array.from(
      { length: 7 },
      (_, i) => `0,${300 + i},${400 + i},1,${i === 6 ? "cc" : "ch"},-1`,
    ),
  ];
  assert.deepEqual(parseFancyHeadupSlot(rows.join("\n"), true), {
    x: 306,
    y: 406,
    justification: "centre",
  });
  assert.throws(
    () =>
      parseFancyHeadupSlot(
        ["0", "7", ...Array(7).fill("0,1,2,3,ch,-1")].join("\n"),
      ),
    /external table has 0 rows/,
  );
  assert.throws(
    () =>
      parseFancyHeadupSlot(
        [
          "7",
          ...Array(7).fill("0,1,2,3,ch,-1"),
          "7",
          ...Array(6).fill("0,1,2,3,ch,-1"),
        ].join("\n"),
        true,
      ),
    /declares 7 internal rows but only 6 are present/,
  );
});

test("fancy headup offsets preserve authored justification and font palettes", () => {
  assert.deepEqual(fancyHeadupOffsets(200, "left"), {
    initial: 320,
    end: -200,
  });
  assert.deepEqual(fancyHeadupOffsets(201, "right"), {
    initial: 420,
    end: 320,
  });
  assert.deepEqual(fancyHeadupOffsets(201, "centre"), {
    initial: 420,
    end: -420,
  });
  assert.deepEqual(nativePolyfontSpec(21), { name: "Big_Italic", colour: 21 });
  assert.deepEqual(nativePolyfontSpec(24), { name: "Big_Italic", colour: 24 });
  assert.deepEqual(nativePolyfontSpec(25), { name: "NetPosFont", colour: 25 });
  assert.deepEqual(nativePolyfontSpec(26), { name: "hand15lo", colour: 26 });
  assert.equal(legacyPolyfontId(4), 21);
  assert.equal(legacyPolyfontId(6), 18);
  assert.equal(legacyPolyfontId(24), undefined);
});

test("fancy drawing forwards authored x plus scroll offset with HEADUP alignment", () => {
  for (const [justification, initial, expected] of [
    ["left", 320, [420, 200, "left"]],
    ["right", 340, [440, 200, "right"]],
    ["centre", 340, [440, 200, "centre"]],
  ]) {
    const feedback = new WastedFeedback({}, { playSound: () => {} });
    const draws = [];
    const spyFont = {
      width: () => 40,
      draw: (...args) => draws.push(args),
    };
    feedback.startFancy("TEXT", 3, 0, spyFont, {
      x: 100,
      y: 200,
      justification,
    });
    const context = {
      canvas: { width: 640, height: 480 },
      save() {},
      scale() {},
      restore() {},
    };
    feedback.draw(context, 0);
    assert.equal(feedback.fancySnapshot.offset, initial);
    assert.deepEqual(draws[0].slice(2), expected);
  }
});

test("SCROLLERS parser rejects truncated or oversized tables", () => {
  assert.throws(() => parseScrollerMessages("2\n4,21,ONE"), /declares 2 rows/);
  assert.throws(() => parseScrollerMessages("47"), /maximum is 46/);
  assert.throws(() => parseScrollerMessages("1\n4,nope,ONE"), /font ID/);
});

test("fancy travel uses native frame period independently of a predicted clock regression", () => {
  const feedback = new WastedFeedback({}, { playSound() {} });
  feedback.wasted("player", "you", "YOU", 1000);
  feedback.state(1040, 40);
  assert.equal(feedback.fancySnapshot.offset, 307);
  feedback.state(1000, 40);
  assert.equal(feedback.fancySnapshot.offset, 294);
  feedback.state(1000, 0);
  assert.equal(
    feedback.fancySnapshot.offset,
    294,
    "paused frames do not scroll",
  );
});
