import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parseCameraSettings } from "../src/camera/settings.ts";

const synthetic = `
// unrelated camera comment
// Hithers, general then cockpit mode
0.125 0.25
99.5 // yOn
77.123 // CAMERA ANGLE
`;

test("camera settings parse inline and preceding labels with native quantization", () => {
  assert.deepEqual(parseCameraSettings(synthetic), {
    hitherGeneral: Math.fround(Math.fround(0.125) * 2),
    hitherCockpit: Math.fround(Math.fround(0.25) * 2),
    far: 99.5,
    fovDegrees: 77.123,
    fovAngle16: Math.trunc((77.123 * 65536) / 360),
    runtimeFovDegrees: (Math.trunc((77.123 * 65536) / 360) * 360) / 65536,
  });
});

test("camera parser rejects missing, duplicate, malformed, nonfinite and out-of-range fields", () => {
  const cases = [
    "",
    synthetic.replace("// Hithers, general then cockpit mode\n0.125 0.25", ""),
    synthetic.replace("99.5 // yOn", "NaN // Yon"),
    synthetic.replace("99.5 // yOn", "99.5 100 // Yon"),
    synthetic.replace("99.5 // yOn", "0.1 // Yon"),
    synthetic.replace("99.5 // yOn", "99.5 // Yon multiplier"),
    synthetic.replace("77.123 // CAMERA ANGLE", "180 // Camera angle"),
    `${synthetic}\n12 // camera angle`,
    synthetic.replace("0.125 0.25", "0.125 nope"),
  ];
  for (const text of cases) assert.throws(() => parseCameraSettings(text));
  assert.throws(
    () =>
      parseCameraSettings(`
// Hithers, general then cockpit mode
1 1
1.5 // Yon
55 // Camera angle
`),
    /outside supported bounds/,
    "far plane must exceed doubled runtime hither values",
  );
});

test("installed Stock and Advanced GENERAL camera values parse correctly", async (t) => {
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original installation is absent");
    return;
  }
  const assets = await createAssetStore();
  for (const path of ["data/GENERAL.TXT", "adv_data/GENERAL.TXT"]) {
    const bytes = await assets.read(path);
    assert.ok(bytes, `installed GENERAL exists: ${path}`);
    assert.deepEqual(parseCameraSettings(decodeText(bytes)), {
      hitherGeneral: Math.fround(Math.fround(0.03) * 2),
      hitherCockpit: Math.fround(Math.fround(0.01) * 2),
      far: 35,
      fovDegrees: 55.55,
      fovAngle16: 10112,
      runtimeFovDegrees: (10112 * 360) / 65536,
    });
  }
});
