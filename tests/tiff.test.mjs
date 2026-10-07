import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { parseTiff } from "../src/tiff.ts";
function tiny() {
  const tags = [
    [256, 4, 1, 1],
    [257, 4, 1, 1],
    [258, 3, 3, 134],
    [259, 3, 1, 1],
    [262, 3, 1, 2],
    [273, 4, 1, 140],
    [277, 3, 1, 3],
    [278, 4, 1, 1],
    [279, 4, 1, 3],
    [284, 3, 1, 1],
  ];
  const data = Buffer.alloc(143);
  data.write("II");
  data.writeUInt16LE(42, 2);
  data.writeUInt32LE(8, 4);
  data.writeUInt16LE(tags.length, 8);
  for (let i = 0; i < tags.length; i++) {
    const at = 10 + i * 12,
      [tag, type, n, value] = tags[i];
    data.writeUInt16LE(tag, at);
    data.writeUInt16LE(type, at + 2);
    data.writeUInt32LE(n, at + 4);
    data.writeUInt32LE(value, at + 8);
  }
  for (let i = 0; i < 3; i++) data.writeUInt16LE(8, 134 + i * 2);
  data.set([255, 80, 20], 140);
  return data;
}
test("baseline TIFF decodes original-style RGB strips without mutating source bytes", () => {
  const source = tiny(),
    copy = Buffer.from(source),
    image = parseTiff(source);
  assert.equal(image.width, 1);
  assert.equal(image.height, 1);
  assert.deepEqual([...image.rgba], [255, 80, 20, 255]);
  assert.deepEqual(source, copy);
});
test("TIFF rejects missing directory offsets, dimensions and excessive tag allocations", () => {
  assert.throws(() => parseTiff(new Uint8Array(7)), /size/);
  const data = tiny();
  data.writeUInt32LE(5000, 4);
  assert.throws(() => parseTiff(data), /offset/);
  const huge = tiny();
  huge.writeUInt32LE(0xffffffff, 10 + 12 * 2 + 4);
  assert.throws(() => parseTiff(huge), /excessive/);
});
test("local original LZW texture decodes when installation exists", async (t) => {
  let source;
  try {
    source = await fs.readFile(
      "carma2_orig/adv_data/RACES/AcidReign/TIFFRGB/64STONE.tif",
    );
  } catch {
    t.skip("local texture not present");
    return;
  }
  const image = parseTiff(source);
  assert.equal(image.width, 64);
  assert.equal(image.height, 64);
  assert.equal(image.rgba.length, 64 * 64 * 4);
});
