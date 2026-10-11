import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseTwt } from "../server/assets.mjs";
import {
  initializeNativeFireVertices,
  parseCarFireVertices,
} from "../src/car-fire.ts";
import { originalCar } from "./support/original-car.mjs";

function fireText(marker = "//damage vertices fire points", values = []) {
  return `${marker}\n${values.map((value) => `${value}\t// authored point`).join("\n")}\n\n// next section\n`;
}

test("car fire parser accepts marker case/spacing variants and exactly twelve signed values", () => {
  const authored = Array.from({ length: 12 }, (_, index) => index - 6);
  assert.deepEqual(
    parseCarFireVertices(
      fireText("  // DaMaGe   VeRtIcEs FiRe PoInTs  ", authored),
    ),
    authored,
  );
  assert.equal(parseCarFireVertices("no fire table here"), undefined);
});

test("car fire parser rejects truncated, malformed, overlong, and unbounded configs", () => {
  assert.throws(
    () => parseCarFireVertices(fireText(undefined, [1, 2, 3])),
    /exactly twelve/,
  );
  assert.throws(
    () =>
      parseCarFireVertices(fireText(undefined, [...Array(11).fill(1), "1 2"])),
    /one signed integer/,
  );
  assert.deepEqual(
    parseCarFireVertices(
      fireText(undefined, [...Array(12).fill(1), "NEXT KEYWORD"]),
    ),
    Array(12).fill(1),
    "native fire parsing consumes twelve values before later config data",
  );
  assert.throws(
    () =>
      parseCarFireVertices(
        fireText(undefined, [...Array(11).fill(1), "2147483648"]),
      ),
    /signed 32-bit/,
  );
  assert.throws(
    () => parseCarFireVertices("x".repeat(1024 * 1024 + 1)),
    /parse limit/,
  );
});

test("native initialization wraps to uint16, clamps before matching, uses first duplicate, and preserves misses", () => {
  const prepared = [8, 4, 8, 2, 0, 4];
  let draws = 0;
  const wrapped = initializeNativeFireVertices(
    [4, 8, 2, 7, -1, 65536, 0, 0, 0, 0, 0, 0],
    prepared,
    () => {
      draws++;
      return 0.5;
    },
  );
  assert.deepEqual([...wrapped], [1, 4, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
  assert.equal(draws, 0);

  const missing = initializeNativeFireVertices(
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [9, 8, 7],
  );
  assert.equal(
    missing[0],
    1,
    "an authored ID with no source match stays clamped",
  );
});

test("all-zero detection precedes remapping and draws twelve flattened indices", () => {
  let draws = 0;
  const result = initializeNativeFireVertices(
    Array(12).fill(0),
    [0, 0, 0, 0],
    () =>
      [0, 0.25, 0.5, 0.75, 0.125, 0.375, 0.625, 0.875, 0.1, 0.3, 0.6, 0.99][
        draws++
      ],
  );
  assert.equal(draws, 12);
  assert.deepEqual([...result], [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
});

test("native initializer validates lengths, prepared bounds, IDs, and random samples", () => {
  assert.throws(
    () => initializeNativeFireVertices(undefined, [0]),
    /twelve authored/,
  );
  assert.throws(
    () => initializeNativeFireVertices(Array(11).fill(0), [0]),
    /twelve authored/,
  );
  assert.throws(
    () => initializeNativeFireVertices(Array(12).fill(1), []),
    /vertex count/,
  );
  assert.throws(
    () => initializeNativeFireVertices(Array(12).fill(1), { length: 65537 }),
    /vertex count/,
  );
  assert.throws(
    () => initializeNativeFireVertices(Array(12).fill(1), [-1]),
    /source vertex ID/,
  );
  assert.throws(
    () => initializeNativeFireVertices(Array(12).fill(0), [0], () => 1),
    /random sample/,
  );
});

test("original Eagle uses authored IDs without RNG; Buggy and Copcar draw twelve fallback IDs", async (t) => {
  const names = ["EAGLE3", "buggy", "copcar"];
  try {
    await Promise.all(
      names.map((name) => access(`carma2_orig/data/CARS/${name}.TWT`)),
    );
  } catch {
    t.skip("original C2 car archives are not installed");
    return;
  }

  const [eagle, buggy, copcar] = await Promise.all(names.map(originalCar));
  const eagleValues = parseCarFireVertices(eagle.text);
  const buggyValues = parseCarFireVertices(buggy.text);
  const copcarValues = parseCarFireVertices(copcar.text);
  assert.ok(eagleValues && buggyValues && copcarValues);
  assert.ok(eagleValues.some((value) => value !== 0));
  assert.ok(buggyValues.every((value) => value === 0));
  assert.ok(copcarValues.every((value) => value === 0));

  const sourceIds = [0, 1, 5, 4, 6, 2, 3, 7, 8, 9, 10, 11, 1, 5, 4, 6];
  let eagleDraws = 0;
  const eagleResult = initializeNativeFireVertices(
    eagleValues,
    sourceIds,
    () => {
      eagleDraws++;
      return 0;
    },
  );
  assert.equal(eagleDraws, 0);
  assert.deepEqual([...eagleResult.slice(0, 4)], [1, 1, 1, 2]);

  for (const authored of [buggyValues, copcarValues]) {
    let draws = 0;
    const result = initializeNativeFireVertices(authored, sourceIds, () => {
      draws++;
      return (draws - 1) / 12;
    });
    assert.equal(draws, 12);
    assert.deepEqual([...result], [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14]);
  }
});

test("stock and Advanced car text files use a bounded twelve-value fire table", async (t) => {
  const roots = ["carma2_orig/data/CARS", "carma2_orig/adv_data/CARS"];
  try {
    await Promise.all(roots.map((root) => access(root)));
  } catch {
    t.skip("original stock/Advanced C2 car archives are not installed");
    return;
  }

  let textFiles = 0;
  const filesByRoot = new Map(roots.map((root) => [root, 0]));
  const markerLines = new Set();
  async function visit(path, root) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const fullPath = join(path, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath, root);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".twt")) {
        const archive = await readFile(fullPath);
        for (const file of parseTwt(archive).entries) {
          if (!file.name.toLowerCase().endsWith(".txt")) continue;
          const text = archive
            .subarray(file.offset, file.offset + file.size)
            .toString("latin1");
          const marker = text
            .split(/\r?\n/)
            .find((line) => /damage\s+vertices\s+fire\s+points/i.test(line));
          if (!marker) continue;
          textFiles++;
          filesByRoot.set(root, filesByRoot.get(root) + 1);
          markerLines.add(marker);
          assert.equal(
            parseCarFireVertices(text)?.length,
            12,
            `${fullPath}:${file.name}`,
          );
        }
      }
    }
  }
  for (const root of roots) await visit(root, root);
  if (roots.some((root) => filesByRoot.get(root) === 0)) {
    t.skip(
      "the installation does not include both stock and Advanced car archives",
    );
    return;
  }
  assert.ok(textFiles > 0, "no original car fire tables were found");
  assert.deepEqual([...markerLines], ["//damage vertices fire points"]);
});
