import assert from "node:assert/strict";
import test from "node:test";
import { markNativePedSpawnMaterials } from "../src/ped-spawn-materials.ts";
const material = (name) => ({
  name,
  flags: 0x1800,
  texture: "original.PIX",
  uvTransform: [1, 0, 0, 1, 0, 0],
});

test("installed marker replaces last four bytes of short names, including extensionless CROSSING", () => {
  const crossing = material("CROSSING"),
    slabs = material("SLABS"),
    four = material("ABCD");
  const result = markNativePedSpawnMaterials([crossing, slabs, four]);
  assert.deepEqual(result.requiredProviders, []);
  assert.deepEqual(
    result.changes.map(({ previousIdentifier, identifier }) => [
      previousIdentifier,
      identifier,
    ]),
    [
      ["CROSSING", "CROSxxx?xxxx.MAT"],
      ["SLABS", "Sxxxxxx?x.MAT"],
      ["ABCD", "xxxxxxx?.MAT"],
    ],
  );
  assert.equal(result.changes[0].material, crossing);
  assert.equal(crossing.name, "CROSxxx?xxxx.MAT");
});

test("already long and original .MAT names retain length and source marker byte", () => {
  const long = material("ABCDEFGHIJKLMNO"),
    mat = material("CROSSING.MAT"),
    shortMat = material("FOO.MAT");
  const result = markNativePedSpawnMaterials([long, mat, shortMat]);
  assert.deepEqual(
    result.changes.map(({ identifier }) => identifier),
    ["ABCDEFG?IJKLMNO", "CROSSIN?.MAT", "FOOxxxx?xxx.MAT"],
  );
  assert.equal(long.name.length, 15);
  assert.equal(mat.name.length, 12);
  assert.ok(
    result.changes.every(
      ({ identifier }) => identifier.length - 4 > 7 && identifier[7] === "?",
    ),
  );
});

test("duplicate pointers retain sequential visits, distinct same-named pointers each mutate", () => {
  const first = material("CROSSING"),
    second = material("CROSSING");
  const result = markNativePedSpawnMaterials([
    first,
    null,
    first,
    second,
    first,
  ]);
  assert.equal(result.changes.length, 2);
  assert.equal(result.changes[0].material, first);
  assert.equal(result.changes[1].material, second);
  assert.deepEqual(markNativePedSpawnMaterials([first, second]), {
    changes: [],
    requiredProviders: [],
  });
});

test("a preexisting byte7 marker does not bypass the installed short-name padding", () => {
  const short = material("ABCDEFG?"),
    complete = material("ABCDEFG?IJKL");
  const result = markNativePedSpawnMaterials([short, complete]);
  assert.equal(short.name, "ABCDxxx?xxxx.MAT");
  assert.equal(complete.name, "ABCDEFG?IJKL");
  assert.equal(result.changes.length, 1);
});

test("malformed short or non-byte identifiers preflight atomically before live writes", () => {
  for (const bad of [
    "",
    "ABC",
    "ROAD\0.MAT",
    "Straße.MAT",
    "路面.MAT",
    undefined,
  ]) {
    const good = material("CROSSING"),
      broken = material(bad);
    const result = markNativePedSpawnMaterials([good, broken]);
    assert.ok(result.requiredProviders.length > 0);
    assert.deepEqual(result.changes, []);
    assert.equal(good.name, "CROSSING");
    assert.equal(broken.name, bad);
  }
});

test("marker changes only identifiers and never material properties or collection order", () => {
  const a = material("CROSSING"),
    b = material("SIDEWLK1");
  const flags = a.flags,
    texture = a.texture,
    uv = a.uvTransform;
  const inputs = Object.freeze([a, null, b]);
  const result = markNativePedSpawnMaterials(inputs);
  assert.equal(a.flags, flags);
  assert.equal(a.texture, texture);
  assert.equal(a.uvTransform, uv);
  assert.equal(inputs[0], a);
  assert.equal(inputs[2], b);
  assert.deepEqual(
    result.changes.map(({ material }) => material),
    [a, b],
  );
  assert.deepEqual(markNativePedSpawnMaterials([null]), {
    changes: [],
    requiredProviders: [],
  });
});
