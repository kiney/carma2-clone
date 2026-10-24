import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";
import { parsePix } from "../src/formats.ts";
import { SelectionPreviews } from "../src/selection-previews.ts";

const installation = process.env.CARMA2_ROOT || "carma2_orig";

test("native Eagle3 car preview composes six authored fragments", async (t) => {
  try {
    await access(installation);
  } catch {
    t.skip("Original Carmageddon 2 installation is unavailable");
    return;
  }

  let store;
  try {
    store = await createAssetStore(installation);
  } catch (error) {
    t.skip(`Original asset store is unavailable: ${error.message}`);
    return;
  }

  const paths = [
    "data/INTRFACE/CarImage/Eagle3CI/PIXIES.P16",
    "adv_data/INTRFACE/CarImage/Eagle3CI/PIXIES.P16",
    "data/INTRFACE/changecar.txt",
    "adv_data/INTRFACE/changecar.txt",
  ];
  const missing = paths.filter(
    (path) =>
      !store.manifest.some(
        (entry) => entry.path.toLowerCase() === path.toLowerCase(),
      ),
  );
  if (missing.length) {
    t.skip(`Native car preview resources unavailable: ${missing.join(", ")}`);
    return;
  }

  const assets = new Assets();
  assets.manifest = store.manifest;
  for (const entry of store.manifest)
    assets.lookup.set(entry.path.toLowerCase(), entry.path);
  assets.bytes = async (path) => {
    const bytes = await store.read(path);
    if (!bytes) throw new Error(`Asset missing: ${path}`);
    return new Uint8Array(bytes);
  };
  assets.text = async (path) =>
    new TextDecoder().decode(await assets.bytes(path));

  const writes = [];
  let canvasCount = 0;
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement(name) {
      assert.equal(name, "canvas");
      canvasCount++;
      const canvas = { width: 0, height: 0 };
      canvas.getContext = (kind) => {
        assert.equal(kind, "2d");
        return {
          createImageData(width, height) {
            return {
              width,
              height,
              data: new Uint8ClampedArray(width * height * 4),
            };
          },
          putImageData(image, x, y) {
            writes.push({ image, x, y, canvas });
          },
        };
      };
      canvas.toDataURL = (type) => {
        assert.equal(type, "image/png");
        return `data:image/png;mock,${canvas.width}x${canvas.height}`;
      };
      return canvas;
    },
  };

  const previews = new SelectionPreviews(assets);
  try {
    for (const source of ["data", "adv_data"]) {
      writes.length = 0;
      const file = `${source}/INTRFACE/CarImage/Eagle3CI/PIXIES.P16`;
      const nativeMaps = parsePix(await assets.bytes(file));
      const layoutPath = `${source}/INTRFACE/changecar.txt`;
      const layout = (await assets.text(layoutPath)).split(/\r?\n/);
      const authored = "ABCDEF".split("").map((letter) => {
        const marker = layout.findIndex((line) =>
          new RegExp(`//\\s*Car${letter}\\s*$`, "i").test(line),
        );
        assert.notEqual(marker, -1, `${source} layout has Car${letter}`);
        const fields = layout
          .slice(marker + 1)
          .map((line) => line.split("//")[0].trim())
          .filter(Boolean);
        const [x, y] = fields[0].split(/\s*,\s*/).map(Number);
        const [width, height] = fields[1].split(/\s*,\s*/).map(Number);
        assert.deepEqual([width, height], [64, 64]);
        const map = nativeMaps.find(
          (candidate) =>
            candidate.name.replace(/\.pix$/i, "").toLowerCase() ===
            `eagle3${letter.toLowerCase()}`,
        );
        assert.ok(map, `${source} native archive contains Eagle3${letter}`);
        return { letter, x, y, map };
      });
      const minX = Math.min(...authored.map((tile) => tile.x));
      const minY = Math.min(...authored.map((tile) => tile.y));
      const expectedBounds = [
        Math.max(...authored.map((tile) => tile.x + tile.map.width)) - minX,
        Math.max(...authored.map((tile) => tile.y + tile.map.height)) - minY,
      ];
      assert.deepEqual(
        expectedBounds,
        [192, 128],
        `${source} native composite bounds`,
      );

      const path = `${source}/cars/eagle3.txt`;
      const startCanvasCount = canvasCount;
      const initialTextures = assets.textures.size;
      const [first, cached] = await Promise.all([
        previews.car(path),
        previews.car(path.toUpperCase()),
      ]);
      assert.equal(first, "data:image/png;mock,192x128");
      assert.equal(
        cached,
        first,
        "same car path shares the cached image result",
      );
      assert.equal(
        canvasCount - startCanvasCount,
        1,
        "car preview creates one canvas",
      );
      assert.equal(writes.length, 6, "exactly six fragments are placed");
      assert.equal(
        assets.textures.size,
        initialTextures,
        "preview does not add game textures",
      );

      for (let index = 0; index < authored.length; index++) {
        const tile = authored[index];
        const write = writes[index];
        assert.equal(
          write.x,
          tile.x - minX,
          `${source} fragment ${tile.letter} x placement`,
        );
        assert.equal(
          write.y,
          tile.y - minY,
          `${source} fragment ${tile.letter} y placement`,
        );
        assert.deepEqual([write.image.width, write.image.height], [64, 64]);
        // Compare the center and corner pixels to the named native fragment. This
        // catches swapped, repeated, or offset fragments without duplicating the
        // compositor's image-copy implementation in the test.
        for (const [px, py] of [
          [0, 0],
          [32, 32],
          [63, 63],
        ]) {
          const at = (py * 64 + px) * 4;
          assert.deepEqual(
            [...write.image.data.slice(at, at + 4)],
            [...tile.map.rgba.slice(at, at + 4)],
            `${source} Eagle3${tile.letter} sample (${px},${py})`,
          );
        }
      }
    }

    await assert.rejects(
      previews.car("data/cars/no-such-car.txt"),
      /Original car picture missing/,
      "a missing optional preview rejects cleanly for the caller to handle",
    );
  } finally {
    previews.dispose();
    assets.releaseRaceResources();
    globalThis.document = originalDocument;
  }
});
