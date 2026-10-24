import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { parsePix } from "../src/formats.ts";

const u32 = (value) => {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value);
  return out;
};
const u16 = (value) => {
  const out = Buffer.alloc(2);
  out.writeUInt16BE(value);
  return out;
};
function legacyRgb565({
  headerLength = 21,
  width = 2,
  height = 1,
  rowBytes = width * 2,
  reserved = Buffer.alloc(6),
  pixelCount = width * height,
  pixelSize = 2,
  dataLength = rowBytes * height,
  pixels = Buffer.from([0xf8, 0x00, 0x07, 0xe0]),
  end = Buffer.concat([u32(0), u32(0)]),
  trailing = Buffer.alloc(0),
} = {}) {
  return Buffer.concat([
    u32(0x3d),
    u32(headerLength),
    Buffer.from([5]),
    u16(rowBytes),
    u16(width),
    u16(height),
    reserved,
    Buffer.from([0]),
    u32(0x21),
    u32(dataLength),
    u32(pixelCount),
    u32(pixelSize),
    pixels,
    end,
    trailing,
  ]);
}

test("headerless CarEd C2 RGB565 fragment parses with a bounded END record", () => {
  const [map] = parsePix(legacyRgb565());
  assert.equal(map.name, "");
  assert.deepEqual([map.width, map.height, map.format], [2, 1, 5]);
  assert.deepEqual([...map.rgba], [255, 0, 0, 255, 0, 255, 0, 255]);
});

test("legacy RGB565 reader rejects inconsistent lengths, metadata, and trailing bytes", () => {
  for (const bytes of [
    legacyRgb565({ headerLength: 20 }),
    legacyRgb565({ reserved: Buffer.from([0, 0, 0, 0, 0, 1]) }),
    legacyRgb565({ pixelCount: 1 }),
    legacyRgb565({ pixelSize: 4 }),
    legacyRgb565({ dataLength: 3 }),
    legacyRgb565({ end: Buffer.concat([u32(0), u32(1)]) }),
    legacyRgb565({ trailing: Buffer.from([0]) }),
  ])
    assert.throws(() => parsePix(bytes), /PIX:/);
});

test("standalone RGB565 reader checks truncated records and respects view offsets", () => {
  const bytes = legacyRgb565();
  for (let end = 1; end < bytes.length; end++)
    assert.throws(
      () => parsePix(bytes.subarray(0, end)),
      /PIX:/,
      `truncated at ${end}`,
    );
  const padded = Buffer.concat([
    Buffer.alloc(7, 0xff),
    bytes,
    Buffer.alloc(3, 0xff),
  ]);
  assert.deepEqual(
    parsePix(padded.subarray(7, 7 + bytes.length))[0].rgba,
    parsePix(bytes)[0].rgba,
  );
});

test("all installed Advanced standalone PIX16 fragments parse as RGB565 maps", async (t) => {
  const root = process.env.CARMA2_ROOT ?? "carma2_orig";
  try {
    await access(root);
  } catch {
    t.skip(`original installation absent: ${root}`);
    return;
  }
  const store = await createAssetStore(root);
  const paths = store.manifest
    .filter(
      (entry) =>
        /^adv_data\/intrface\/carimage\//i.test(entry.path) &&
        /\/pix16\/[^/]+\.pix$/i.test(entry.path),
    )
    .map((entry) => entry.path);
  assert.equal(paths.length, 96);
  for (const path of paths) {
    const maps = parsePix(new Uint8Array(await store.read(path)));
    assert.equal(maps.length, 1, path);
    assert.deepEqual(
      [maps[0].width, maps[0].height, maps[0].format],
      [64, 64, 5],
      path,
    );
  }
});
