import test from "node:test";
import assert from "node:assert/strict";
import { parseDustShades } from "../src/dust-shades.ts";
import { createAssetStore } from "../server/assets.mjs";
test("dust shade parser preserves authored RGB and rejects malformed bounded entries", () => {
  assert.deepEqual(
    parseDustShades(
      "2 // number of dust shade tables\n61,84,33\n.25,.5,.75\n227,209,143\n.2,.4,.6",
    ),
    [0x3d5421, 0xe3d18f],
  );
  assert.deepEqual(parseDustShades("// unrelated file"), []);
  for (const text of [
    "9 // number of dust shade tables",
    "-1 // number of dust shade tables",
    "1 // number of dust shade tables\n256,0,0\n0,0,0",
    "1 // number of dust shade tables\n0,0,0\nNaN,0,0",
  ])
    assert.throws(() => parseDustShades(text), /Invalid dust/);
});
test("original Stock/Advanced dust tables remain bounded and parse without proprietary fixtures", async (t) => {
  let store;
  try {
    store = await createAssetStore();
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Original installation absent");
      return;
    }
    throw error;
  }
  const paths = store.manifest.filter((entry) =>
    /(?:^data|^adv_data)\/RACES\/[^/]+\/[^/]+\.txt$/i.test(entry.path),
  );
  const roots = new Set();
  let count = 0;
  for (const entry of paths) {
    const colours = parseDustShades(
      new TextDecoder().decode(await store.read(entry.path)),
    );
    if (!colours.length) continue;
    assert.ok(colours.length <= 8, entry.path);
    roots.add(entry.path.split("/")[0]);
    count++;
  }
  assert.ok(count > 5);
  assert.equal(roots.size, 2);
});
