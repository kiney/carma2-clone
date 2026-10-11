import test from "node:test";
import assert from "node:assert/strict";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parseTrackConfig } from "../src/config.ts";
import {
  applyNativeMaterialFog as fog,
  nativeMaterialFogColor as color,
} from "../src/native-material-fog.ts";

const state = () => ({
  flags: 0x25,
  fogMin: -7,
  fogMax: 9,
  fogColor: 0xdeadbeef,
});
const depth = (extra = {}) => ({
  type: 2,
  start: 4,
  end: 0,
  red: 129,
  green: 103,
  blue: 80,
  baseYon: 35,
  ...extra,
});
const bits = (n) => {
  const b = new DataView(new ArrayBuffer(4));
  b.setFloat32(0, n, true);
  return b.getUint32(0, true);
};
const words = (r) => [r.flags, bits(r.fogMin), bits(r.fogMax), r.fogColor];

test("captured installed function uses10^exponent, retains identity payload and requests ALL", () => {
  const actualIdentity = {},
    texture = {},
    input = { ...state(), actualIdentity, texture };
  const result = fog(input, depth());
  assert.deepEqual(words(result), [0x80025, 0x415ef0a5, 0x420c0000, 0x816750]);
  assert.equal(result.updateMask, 0x7fff);
  assert.equal(result.actualIdentity, actualIdentity);
  assert.equal(result.texture, texture);
  assert.notEqual(result, input);
  assert.deepEqual(input, { ...state(), actualIdentity, texture });
});

test("none clears only fog bit; unsupported signed enum retains historical fields", () => {
  const m = {
    flags: 0xffffffff,
    fogMin: -0,
    fogMax: Infinity,
    fogColor: 0xffabcdef,
  };
  const r = fog(m, depth({ type: -1 }));
  assert.equal(r.flags, 0xfff7ffff);
  assert.ok(Object.is(r.fogMin, -0));
  assert.equal(r.fogMax, Infinity);
  assert.equal(r.fogColor, m.fogColor);
  for (const type of [-2147483648, -2, 3, 2147483647])
    assert.deepEqual(fog(m, depth({ type })), { ...m, updateMask: 0x7fff });
  assert.ok(
    Number.isNaN(fog({ ...m, fogMin: NaN }, depth({ type: -1 })).fogMin),
  );
});

test("darkness and fog select source colours while setting only fog flag", () => {
  for (const [type, expected] of [
    [0, 0],
    [1, 0xf8f8f8],
    [2, 0x816750],
  ]) {
    const r = fog({ ...state(), flags: 0x80000000 }, depth({ type }));
    assert.equal(r.flags, 0x80080000);
    assert.equal(r.fogColor, expected);
    assert.equal(bits(r.fogMin), 0x415ef0a5);
  }
});

test("installed captures distinguish double exponent inputs and signed NEG32 wrap", () => {
  for (const [start, end, min, max] of [
    [-5, 8, 0x42dd5c04, 0x435cd5c7],
    [9, 7, 0x408cffe9, 0x432f6a60],
    [-2147483648, 2147483647, 0, 0x7f800000],
    [4000, -4000, 0, 0],
  ]) {
    const r = fog(state(), depth({ start, end }));
    assert.deepEqual([bits(r.fogMin), bits(r.fogMax)], [min, max]);
  }
  assert.notEqual(bits(Math.fround(10 ** Math.fround(0.8) * 35)), 0x435cd5c7);
});

test("source does not reorder bounds, clamp yon, or discard subnormals/negative zero", () => {
  const r = fog(state(), depth({ start: -5, end: 0 }));
  assert.ok(r.fogMin > r.fogMax);
  const zero = fog(state(), depth({ baseYon: -0 }));
  assert.deepEqual(
    [bits(zero.fogMin), bits(zero.fogMax)],
    [0x80000000, 0x80000000],
  );
  const tiny = fog(
    state(),
    depth({ start: -1, end: 1, baseYon: Math.fround(2 ** -149) }),
  );
  assert.deepEqual([bits(tiny.fogMin), bits(tiny.fogMax)], [1, 1]);
  const invalidArithmetic = fog(
    state(),
    depth({ start: -4000, end: 4000, baseYon: 0 }),
  );
  assert.ok(Number.isNaN(invalidArithmetic.fogMin));
  assert.ok(Number.isNaN(invalidArithmetic.fogMax));
});

test("RGB uses source unsigned result of unmasked signed integer OR/shifts", () => {
  assert.equal(color(129, 103, 80), 0x816750);
  assert.equal(color(0x12345678, 0x76543210, 0x12345678), 0x567e5678);
  assert.equal(color(-1, 0, 0), 0xffff0000);
  assert.equal(color(0, 0, -2147483648), 0x80000000);
  assert.equal(color(0, -1, 0), 0xffffff00);
});

test("rejects nonnative storage before returning a partial descriptor", () => {
  for (const field of ["type", "start", "end", "red", "green", "blue"])
    for (const value of [0.5, 2147483648, -2147483649, NaN])
      assert.throws(() => fog(state(), depth({ [field]: value })), /int32/);
  for (const field of ["flags", "fogColor"])
    assert.throws(() => fog({ ...state(), [field]: -1 }, depth()), /uint32/);
  assert.throws(() => fog(state(), depth({ baseYon: 0.1 })), /stored F32/);
  assert.throws(() => fog({ ...state(), fogMin: 0.1 }, depth()), /stored F32/);
});

for (const root of ["data", "adv_data"])
  for (const [track, start, rgb, min] of [
    ["newcity1", 4, [129, 103, 80], 0x415ef0a5],
    ["airport1", 7, [88, 132, 174], 0x40df7829],
    ["carrier1", 4, [30, 30, 30], 0x415ef0a5],
  ])
    test(`original ${root}/${track} depth cue feeds captured native fog stores`, async (t) => {
      let assets;
      try {
        assets = await createAssetStore();
      } catch (e) {
        if (e.code === "ENOENT") {
          t.skip("Original installation absent");
          return;
        }
        throw e;
      }
      const bytes = await assets.read(`${root}/RACES/${track}/${track}.txt`);
      if (!bytes) {
        t.skip("Original track absent");
        return;
      }
      const cue = parseTrackConfig(decodeText(bytes)).depthCue;
      assert.deepEqual(cue, {
        mode: "colour",
        strength: [start, 0],
        color: rgb,
      });
      const r = fog(
        state(),
        depth({
          start: cue.strength[0],
          end: cue.strength[1],
          red: cue.color[0],
          green: cue.color[1],
          blue: cue.color[2],
        }),
      );
      assert.deepEqual([bits(r.fogMin), bits(r.fogMax)], [min, 0x420c0000]);
      assert.equal(r.fogColor, rgb[0] * 65536 + rgb[1] * 256 + rgb[2]);
    });
