import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parseNativePedGoreOption } from "../src/ped-gore-options.ts";

test("source GoreLevel values map to the inverted internal level", () => {
  assert.equal(parseNativePedGoreOption("GoreLevel 0"), 2);
  assert.equal(parseNativePedGoreOption("GoreLevel 1"), 1);
  assert.equal(parseNativePedGoreOption("GoreLevel 2"), 0);
  assert.equal(parseNativePedGoreOption("OtherOption 1\n"), 1);
});

test("parser trims rows, strips comments, matches case exactly and uses the last duplicate", () => {
  assert.equal(
    parseNativePedGoreOption(
      "  // ignored\nGoreLevel 0 // source default\n gorelevel 2\nGoreLevel 2 // last wins\n",
    ),
    0,
  );
});

test("malformed, missing-value, fractional and out-of-range GoreLevel rows fail clearly", () => {
  for (const text of [
    "GoreLevel",
    "GoreLevel x",
    "GoreLevel 1.0",
    "GoreLevel -1",
    "GoreLevel 3",
    "GoreLevel 1 extra",
  ])
    assert.throws(() => parseNativePedGoreOption(text), /GoreLevel/);
});

for (const tree of ["data", "adv_data"])
  test(`original ${tree} OPTIONS level matches the parsed source data`, async (t) => {
    const root = process.env.CARMA2_ROOT ?? "carma2_orig",
      path = `${root}/${tree}/OPTIONS.TXT`;
    if (!existsSync(path))
      return t.skip(`Original ${tree} OPTIONS unavailable`);
    assert.equal(
      parseNativePedGoreOption(await readFile(path, "utf8")),
      2,
      tree,
    );
  });
