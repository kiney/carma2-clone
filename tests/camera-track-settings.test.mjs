import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parseTrackCameraSettings } from "../src/camera/track-settings.ts";

const footer = `
1 // number of splash files
SPLASH.PIX // splash image
0.75 // Yon multiplier
test-track.TXT
`;

test("track Yon parser reads the loader's final float before its filename", () => {
  assert.equal(parseTrackCameraSettings(footer), Math.fround(0.75));
  assert.equal(parseTrackCameraSettings(footer.replace("0.75", "1.25")), 1.25);
  assert.equal(parseTrackCameraSettings(footer.replace("0.75", "0")), 0);
  assert.equal(parseTrackCameraSettings(footer.replace("0.75", "-0.5")), -0.5);
});

test("track Yon parser rejects malformed or ambiguous native footer values", () => {
  for (const text of [
    "",
    "splash.TXT",
    footer.replace("0.75 // Yon multiplier", "NaN // Yon multiplier"),
    footer.replace("0.75 // Yon multiplier", "1e100 // Yon multiplier"),
    footer.replace("0.75 // Yon multiplier", "1.0 2.0 // Yon multiplier"),
    footer.replace("test-track.TXT", "not-a-track-file"),
    `${footer}\n2.0\n`,
  ])
    assert.throws(() => parseTrackCameraSettings(text));
});

test("installed Stock and Advanced race tracks retain their authored Yon value", async (t) => {
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original installation is absent");
    return;
  }
  const assets = await createAssetStore();
  for (const root of ["data/RACES/", "adv_data/RACES/"]) {
    const tracks = assets.manifest.filter((asset) => {
      const path = asset.path.toLowerCase();
      if (!path.startsWith(root.toLowerCase()) || !path.endsWith(".txt"))
        return false;
      return true;
    });
    const validTracks = [];
    for (const asset of tracks) {
      const bytes = await assets.read(asset.path);
      assert.ok(bytes, `installed race track exists: ${asset.path}`);
      const text = decodeText(bytes);
      const finalLine = text
        .split(/\r?\n/)
        .map((line) => line.split("//", 1)[0].trim())
        .filter(Boolean)
        .at(-1);
      if (
        finalLine?.toLowerCase() !== asset.path.split("/").at(-1).toLowerCase()
      )
        continue;
      validTracks.push(asset.path);
      assert.equal(parseTrackCameraSettings(text), 1, asset.path);
    }
    assert.ok(
      validTracks.length > 40,
      `${root} track count ${validTracks.length}`,
    );
  }
});
