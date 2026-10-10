import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import {
  GlobalGravityState,
  parseDefaultGravityMultiplier,
} from "../src/physics/global-gravity.ts";

test("GENERAL gravity parser reads only the labeled scalar", () => {
  assert.equal(
    parseDefaultGravityMultiplier(
      `other\n5\n// default Gravity Multiplier\n0.75 // source value\n`,
    ),
    0.75,
  );
  assert.equal(
    parseDefaultGravityMultiplier("// default Gravity Multiplier\n-0.25"),
    -0.25,
  );
  assert.equal(
    parseDefaultGravityMultiplier("// default Gravity Multiplier\n0"),
    0,
  );
  for (const text of [
    "",
    "// something else\n1",
    "// default Gravity Multiplier\n",
    "// default Gravity Multiplier\n1\n// default Gravity Multiplier\n2",
    "// default Gravity Multiplier\n1 2",
    "// default Gravity Multiplier\nNaN",
    "// default Gravity Multiplier\nInfinity",
  ]) {
    assert.throws(() => parseDefaultGravityMultiplier(text));
  }
});

test("global gravity powerup assigns its first parameter and reset restores default", () => {
  const gravity = new GlobalGravityState(0.75);
  assert.equal(gravity.multiplier, 0.75);
  assert.equal(gravity.setPowerup([0, 99]), 0);
  assert.equal(
    gravity.setPowerup([0.2]),
    Math.fround(0.2),
    "assignment does not multiply current value",
  );
  assert.equal(gravity.setPowerup([4]), 4);
  assert.equal(gravity.reset(), 0.75);
  assert.equal(gravity.setPowerup([-1]), -1);
  for (const params of [[], [NaN], [Infinity]])
    assert.throws(() => gravity.setPowerup(params));
  assert.throws(() => new GlobalGravityState(NaN));
  assert.throws(() => new GlobalGravityState(1e39));
  assert.throws(() => gravity.setPowerup([1e39]));
});

test("installed Stock and Advanced GENERAL files provide a parseable default", async (t) => {
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
    assert.equal(parseDefaultGravityMultiplier(decodeText(bytes)), 1, path);
  }
});
