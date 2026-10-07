import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseDat,
  parseAct,
  parseMat,
  parsePix,
  decodeText,
  configLines,
} from "../src/formats.ts";
import { createAssetStore } from "../server/assets.mjs";

const bytes = (...items) =>
  Buffer.concat(items.map((v) => (Buffer.isBuffer(v) ? v : Buffer.from(v))));
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const floats = (...values) => {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeFloatBE(v, i * 4));
  return b;
};
const name = (s) => Buffer.from(s + "\0", "latin1");
const chunk = (tag, payload = Buffer.alloc(0), length = payload.length) =>
  bytes(u32(tag), u32(length), payload);
const header = (type) => bytes(u32(0x12), u32(8), u32(type), u32(2));
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

function triangle(vertexIndex = 2) {
  return bytes(
    header(0xface),
    chunk(0x36, bytes(u16(1), name("triangle"))),
    chunk(0x17, bytes(u32(3), floats(0, 0, 0, 2, 0, 0, 0, 1, 0))),
    chunk(0x18, bytes(u32(3), floats(0, 0, 1, 0, 0, 1))),
    chunk(0x35, bytes(u32(1), u16(0), u16(1), u16(vertexIndex), u16(3), [0])),
    chunk(0x16, bytes(u32(1), name("road"))),
    chunk(0x1a, bytes(u32(1), u32(2), u16(1))),
    chunk(0),
  );
}

function datWithNonFiniteFloat(tagToChange, componentIndex = 0) {
  const fixture = Buffer.from(triangle());
  for (let offset = 16; offset < fixture.length; ) {
    const tag = fixture.readUInt32BE(offset);
    const length = fixture.readUInt32BE(offset + 4);
    if (tag === tagToChange) {
      fixture.writeFloatBE(Number.NaN, offset + 12 + componentIndex * 4);
      return fixture;
    }
    offset += 8 + length;
  }
  throw new Error(`DAT chunk ${tagToChange.toString(16)} was not found`);
}

test("DAT keeps vertex coordinates, UVs, smoothing and one-based material indices", () => {
  const [m] = parseDat(triangle());
  assert.equal(m.name, "triangle");
  assert.deepEqual(Array.from(m.positions), [0, 0, 0, 2, 0, 0, 0, 1, 0]);
  assert.deepEqual(Array.from(m.uvs), [0, 0, 1, 0, 0, 1]);
  assert.deepEqual(m.faces, [
    { indices: [0, 1, 2], smoothing: 3, flags: 0, material: 1 },
  ]);
  assert.deepEqual(m.materials, ["road"]);
  assert.throws(() => parseDat(triangle(9)), /vertex index/);
  assert.throws(() => parseDat(triangle().subarray(0, 40)), /truncated/);
});

test("DAT replaces non-finite UV components with zero and reports the fallback", () => {
  const [model] = parseDat(datWithNonFiniteFloat(0x18, 2));
  assert.equal(model.uvs[2], 0);
  assert.ok(model.uvs.every(Number.isFinite));
  assert.deepEqual(model.warnings, [
    "triangle: 1 non-finite UV components replaced with zero",
  ]);
  assert.ok(model.positions.every(Number.isFinite));
});

test("DAT still rejects non-finite XYZ coordinates", () => {
  assert.throws(
    () => parseDat(datWithNonFiniteFloat(0x17)),
    /non-finite coordinate/,
  );
});

test("ACT attaches nested children and preserves local transforms and inherited material references", () => {
  const fixture = bytes(
    header(1),
    chunk(0x23, bytes([0, 4], name("parent"))),
    chunk(0x26, name("road")),
    chunk(0x2b, floats(...identity.slice(0, 9), 10, 20, 30)),
    chunk(0x25),
    chunk(0x23, bytes([1, 0], name("child"))),
    chunk(0x24, name("triangle")),
    chunk(0x30, floats(1, 2, 3)),
    chunk(0x25),
    chunk(0x2a),
    chunk(0),
  );
  const [root] = parseAct(fixture);
  assert.equal(root.material, "road");
  assert.deepEqual(root.transform.slice(9), [10, 20, 30]);
  assert.equal(root.children[0].model, "triangle");
  assert.deepEqual(root.children[0].transform.slice(9), [1, 2, 3]);
  assert.equal(root.children[0].material, undefined);
  assert.throws(
    () => parseAct(bytes(header(1), chunk(0x2a))),
    /without parent/,
  );
});

test("MAT reads both correct lengths and the shipped C2 two-byte overstatement", () => {
  const payload = bytes(
    [100, 150, 200, 128],
    floats(0.1, 0.7, 0, 20),
    u32(4096),
    floats(1, 0, 0, 1, 0.5, 0.25),
    Buffer.alloc(17),
    name("road"),
  );
  for (const padding of [0, 2]) {
    const fixture = bytes(
      header(5),
      chunk(0x3c, payload, payload.length + padding),
      chunk(0x1c, name("tarmac")),
      chunk(0),
    );
    const [m] = parseMat(fixture);
    assert.deepEqual(m.rgba, [100, 150, 200, 128]);
    assert.equal(m.flags, 4096);
    assert.equal(m.texture, "tarmac");
    assert.deepEqual(m.uvTransform, [1, 0, 0, 1, 0.5, 0.25]);
  }
  assert.throws(
    () => parseMat(bytes(header(5), chunk(0x3c, payload.subarray(0, 15)))),
    /truncated/,
  );
});

test("legacy MAT 0x04 reads the original one-byte length overstatement", () => {
  const payload = bytes(
    [255, 255, 255, 255],
    floats(0.2, 0.5, 0.05, 20),
    u16(5),
    floats(1, 0, 0, 1, 0, 0),
    [200, 1],
    name("MUD1.MAT"),
  );
  const fixture = bytes(
    header(5),
    chunk(4, payload, payload.length + 1),
    chunk(0x1c, name("MUD1.PIX")),
    chunk(0),
  );
  assert.equal(parseMat(fixture)[0].texture, "MUD1.PIX");
});

test("MAT follows renamed NUL references with stale lengths and retained zero padding", () => {
  const payload = bytes(
    [255, 255, 255, 255],
    floats(0.2, 0.5, 0.05, 20),
    u16(5),
    floats(1, 0, 0, 1, 0, 0),
    [200, 1],
    name("GIBSMEAR.MAT"),
  );
  const fixture = bytes(
    header(5),
    chunk(4, payload, payload.length - 2),
    chunk(0x1c, bytes(name("GIBSMEAR"), Buffer.alloc(4)), 11),
    chunk(0x1f, name("DRRENDER.TAB"), 11),
    chunk(0),
  );
  assert.equal(parseMat(fixture)[0].texture, "GIBSMEAR");
});

function pixMap(format, width, height, rowBytes, pixelSize, data) {
  return bytes(
    header(2),
    chunk(
      0x3d,
      bytes(
        [format],
        u16(rowBytes),
        u16(width),
        u16(height),
        Buffer.alloc(6),
        name("test"),
      ),
    ),
    chunk(0x21, bytes(u32(data.length / pixelSize), u32(pixelSize), data)),
    chunk(0),
  );
}

test("PIX decodes big-endian RGB565 with padded rows and opaque black", () => {
  const fixture = pixMap(
    5,
    2,
    2,
    6,
    2,
    bytes(
      u16(0xf800),
      u16(0x07e0),
      u16(0xffff),
      u16(0x001f),
      u16(0),
      u16(0xffff),
    ),
  );
  const [p] = parsePix(fixture);
  assert.deepEqual(
    Array.from(p.rgba),
    [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255],
  );
  const corrupt = Buffer.from(fixture);
  corrupt.writeUInt32BE(0xffffffff, 20);
  assert.throws(() => parsePix(corrupt), /truncated/);
});

test("PIX decodes ARGB4444 and indexed colors using an external RGBA palette", () => {
  const [p] = parsePix(pixMap(18, 1, 1, 2, 2, u16(0x8f42)));
  assert.deepEqual(Array.from(p.rgba), [255, 68, 34, 136]);
  const palette = new Uint8Array(1024);
  palette.set([10, 20, 30, 255], 4);
  const [indexed] = parsePix(pixMap(3, 2, 1, 2, 1, bytes([1, 0])), palette);
  assert.deepEqual(Array.from(indexed.rgba), [10, 20, 30, 255, 0, 0, 0, 0]);
  const [black] = parsePix(pixMap(18, 2, 1, 4, 2, bytes(u16(0xf000), u16(0))));
  assert.deepEqual(Array.from(black.rgba), [0, 0, 0, 255, 0, 0, 0, 0]);
});

test("retail text decoder handles byte encoding, tabs, comment key changes and plain lines", () => {
  const encoded = Buffer.from(
    "403c4f5e4869204f99868b7f34645781300965334c0d0a",
    "hex",
  );
  assert.equal(decodeText(encoded), "EAGLE3.TXT\t// Driver");
  assert.deepEqual(
    configLines(
      bytes(encoded, Buffer.from("\n 54.061,0.825,23.629 // spawn\r\n")),
    ),
    ["EAGLE3.TXT", "54.061,0.825,23.629"],
  );
  assert.equal(decodeText(Buffer.from("plain\nlast")), "plain\nlast");
});

let originalsAvailable = true;
try {
  await access(new URL("../carma2_orig", import.meta.url));
} catch {
  originalsAvailable = false;
}
test(
  "read-only real-asset smoke: Eagle car, New City map and render palette",
  { skip: !originalsAvailable },
  async () => {
    const store = await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
    const load = async (path, parse) => {
      const b = await store.read(path);
      assert.ok(b, `asset exists: ${path}`);
      return parse(b);
    };
    const models = await load("data/CARS/EAGLE3/Eagle3.dat", parseDat);
    assert.equal(models.length, 23);
    assert.ok(
      models.some((m) => m.name === "EAGLENEW.DAT" && m.faces.length > 100),
    );
    const actors = await load("data/CARS/EAGLE3/EAGLE3.ACT", parseAct);
    assert.equal(actors[0].model, "EAGLENEW.DAT");
    assert.equal(actors[0].children.length, 19);
    assert.equal(
      (await load("data/CARS/EAGLE3/Eagle3.mat", parseMat)).length,
      47,
    );
    assert.equal(
      (await load("data/CARS/EAGLE3/PIXIES.P16", parsePix)).length,
      17,
    );
    const palette = (await load("data/Reg/PALETTES/DRRENDER.PAL", parsePix))[0]
      .rgba;
    assert.equal(palette.length, 1024);
    assert.deepEqual(Array.from(palette.slice(4, 8)), [93, 3, 3, 255]);
    assert.equal(
      (await load("data/CARS/EAGLE3/PIXIES.P08", (b) => parsePix(b, palette)))
        .length,
      17,
    );
    const city = await load("data/RACES/newcity1/newcity1.dat", parseDat);
    assert.equal(city.length, 249);
    assert.ok(
      city.reduce((sum, model) => sum + model.faces.length, 0) > 10_000,
    );
    const cityRoot = (
      await load("data/RACES/newcity1/newcity1.act", parseAct)
    )[0];
    let count = 0;
    function countNodes(node) {
      count++;
      node.children.forEach(countNodes);
    }
    countNodes(cityRoot);
    assert.ok(count > 1000);
    assert.equal(
      (await load("data/RACES/newcity1/newcity1.mat", parseMat)).length,
      211,
    );
    assert.equal(
      (await load("data/RACES/newcity1/PIXIES.P16", parsePix)).length,
      2,
    );
    for (const path of [
      "data/Reg/MATERIAL/MUD1.MAT",
      "data/Reg/MATERIAL/HORIZON.MAT",
      "data/MATERIAL/GIBSMEAR.MAT",
      "data/RACES/Junkyard/MUD2.MAT",
    ]) {
      assert.ok((await load(path, parseMat)).length, path);
    }
    const config = await load("data/RACES/newcity1/newcity1.txt", configLines);
    assert.equal(config[5], "54.061,0.825,23.629");
  },
);
test("shipped legacy checkpoint actor resolves renamed references with stale lengths", async (t) => {
  let bytes;
  try {
    bytes = await readFile("carma2_orig/data/ACTORS/CPOINT.ACT");
  } catch {
    t.skip("local checkpoint actor absent");
    return;
  }
  const actor = parseAct(bytes)[0];
  assert.equal(actor.model, "DIRECT.DAT");
  assert.equal(actor.material, "SILVER.MAT");
});
