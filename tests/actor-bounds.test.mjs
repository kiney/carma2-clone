import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";
import { parseAct } from "../src/formats.ts";
import { createAssetStore } from "../server/assets.mjs";

const u32 = (value) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
};
const floats = (...values) => {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => bytes.writeFloatBE(value, i * 4));
  return bytes;
};
const chunk = (tag, payload = Buffer.alloc(0)) =>
  Buffer.concat([u32(tag), u32(payload.length), payload]);
const actor = (type, name) =>
  chunk(
    0x23,
    Buffer.concat([Buffer.from([type, 4]), Buffer.from(name + "\0")]),
  );
const header = Buffer.concat([u32(0x12), u32(8), u32(1), u32(2)]);
const file = (...chunks) => Buffer.concat([header, ...chunks]);
const bounds = () => chunk(0x32, floats(-2, -3, -4, 5, 6, 7));
const attached = (type = 5) =>
  file(actor(type, "bound"), bounds(), chunk(0x29), chunk(0));

function flatten(nodes) {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

// Independent chunk walk retains authored float bytes, not parser-derived bounds.
function authoredBounds(bytes) {
  const values = [];
  for (let offset = 16; offset < bytes.length; ) {
    const tag = bytes.readUInt32BE(offset);
    const length = bytes.readUInt32BE(offset + 4);
    const payload = offset + 8;
    if (tag === 0x32) {
      assert.equal(length, 24);
      values.push(
        Array.from({ length: 6 }, (_, i) => bytes.readFloatBE(payload + i * 4)),
      );
      assert.equal(bytes.readUInt32BE(payload + length), 0x29);
      assert.equal(bytes.readUInt32BE(payload + length + 4), 0);
    }
    // Existing retail model/material references can retain stale lengths.
    offset =
      tag === 0x24 || tag === 0x26
        ? bytes.indexOf(0, payload) + 1
        : payload + length;
    assert.ok(offset > payload - 8 && offset <= bytes.length);
  }
  return values;
}

test("ACT min/max bounds attach in model coordinates to types5/6 and generic reader targets", () => {
  for (const type of [0, 1, 5, 6]) {
    const [node] = parseAct(attached(type));
    assert.equal(node.type, type);
    assert.deepEqual(node.bounds, { min: [-2, -3, -4], max: [5, 6, 7] });
    assert.deepEqual(node.transform.slice(9), [0, 0, 0]);
  }
  const [unbounded] = parseAct(file(actor(5, "unbounded"), chunk(0)));
  assert.equal(unbounded.bounds, undefined);
});

test("ACT bounds preserve child ownership, local transform, replacement and degenerate boxes", () => {
  const [root] = parseAct(
    file(
      actor(0, "root"),
      chunk(0x30, floats(10, 20, 30)),
      chunk(0x25),
      actor(5, "first"),
      bounds(),
      chunk(0x29),
      chunk(0x32, floats(1, 2, 3, 1, 2, 3)),
      chunk(0x29),
      chunk(0x2a),
      actor(6, "second"),
      bounds(),
      chunk(0x29),
      chunk(0x2a),
      chunk(0),
    ),
  );
  assert.equal(root.bounds, undefined);
  assert.deepEqual(root.transform.slice(9), [10, 20, 30]);
  assert.deepEqual(root.children[0].bounds, { min: [1, 2, 3], max: [1, 2, 3] });
  assert.deepEqual(root.children[1].bounds, {
    min: [-2, -3, -4],
    max: [5, 6, 7],
  });
  root.children[0].bounds.min[0] = 99;
  assert.equal(root.children[1].bounds.min[0], -2);
});

test("ACT bounds reject wrong sizes, truncation, nonfinite values and reversed axes", () => {
  for (const n of [0, 20, 28]) {
    assert.throws(
      () =>
        parseAct(
          file(
            actor(5, "box"),
            chunk(0x32, Buffer.alloc(n)),
            chunk(0x29),
            chunk(0),
          ),
        ),
      /24 bytes/,
    );
  }
  for (const value of [NaN, Infinity, -Infinity]) {
    for (let i = 0; i < 6; i++) {
      const values = [-2, -3, -4, 5, 6, 7];
      values[i] = value;
      assert.throws(
        () =>
          parseAct(
            file(
              actor(5, "box"),
              chunk(0x32, floats(...values)),
              chunk(0x29),
              chunk(0),
            ),
          ),
        /non-finite/,
      );
    }
  }
  for (let axis = 0; axis < 3; axis++) {
    const values = [-2, -3, -4, 5, 6, 7];
    values[axis] = values[axis + 3] + 1;
    assert.throws(
      () =>
        parseAct(
          file(
            actor(5, "box"),
            chunk(0x32, floats(...values)),
            chunk(0x29),
            chunk(0),
          ),
        ),
      /reversed bounds/,
    );
  }
  const valid = attached();
  assert.throws(
    () => parseAct(valid.subarray(0, valid.length - 17)),
    /truncated/,
  );
  assert.throws(
    () =>
      parseAct(file(actor(5, "box"), bounds(), chunk(0x29, u32(0)), chunk(0))),
    /marker must be empty/,
  );
});

test("ACT bounds enforce pending native resource order across properties and hierarchy", () => {
  assert.throws(
    () => parseAct(file(bounds(), chunk(0x29))),
    /property precedes actor/,
  );
  assert.throws(
    () => parseAct(file(actor(5, "box"), chunk(0x29), chunk(0))),
    /marker without bounds/,
  );
  assert.throws(() => parseAct(file(actor(5, "box"), bounds())), /incomplete/);
  const blocked = [
    actor(5, "child"),
    chunk(0x24, Buffer.from("model\0")),
    chunk(0x26, Buffer.from("material\0")),
    chunk(0x2a),
    chunk(0),
    bounds(),
    chunk(0x31),
    chunk(0x25),
    chunk(0x33),
  ];
  for (const next of blocked) {
    assert.throws(
      () => parseAct(file(actor(5, "box"), bounds(), next, chunk(0x29))),
      /unconsumed bounds/,
    );
  }
  assert.throws(
    () => parseAct(file(actor(5, "box"), chunk(0x31), bounds(), chunk(0x29))),
    /unconsumed transform/,
  );
  // Unknown extensions do not mutate the native actor/resource stack.
  const [node] = parseAct(
    file(
      actor(5, "box"),
      bounds(),
      chunk(0xfeed, u32(42)),
      chunk(0x29),
      chunk(0),
    ),
  );
  assert.deepEqual(node.bounds.min, [-2, -3, -4]);
});

for (const directory of ["data", "adv_data"]) {
  for (const [track, count] of [
    ["newcity1", 211],
    ["Airport1", 162],
    ["Carrier1", 35],
  ]) {
    test(`original ${directory}/${track} preserves every authored BOUNDS actor`, async (t) => {
      const root = process.env.CARMA2_ROOT ?? "carma2_orig";
      try {
        await access(root);
      } catch {
        t.skip("original installation absent");
        return;
      }
      const store = await createAssetStore(root);
      const path = `${directory}/RACES/${track}/${track}.act`;
      const entry = store.manifest.find(
        (entry) => entry.path.toLowerCase() === path.toLowerCase(),
      );
      if (!entry) {
        t.skip("original track absent");
        return;
      }
      const bytes = Buffer.from(await store.read(entry.path));
      const raw = authoredBounds(bytes);
      const nodes = flatten(parseAct(bytes)).filter((node) => node.bounds);
      assert.equal(raw.length, count);
      assert.equal(nodes.length, count);
      assert.ok(nodes.every((node) => node.type === 5));
      // Hierarchy traversal can differ from serial actor creation; compare exact multisets.
      assert.deepEqual(
        nodes
          .map((node) =>
            JSON.stringify([...node.bounds.min, ...node.bounds.max]),
          )
          .sort(),
        raw.map((values) => JSON.stringify(values)).sort(),
      );
    });
  }
}
