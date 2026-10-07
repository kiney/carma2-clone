import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Vector3 } from "three";
import { DamageSystem } from "../src/damage.ts";
import { parseAct, parseDat } from "../src/formats.ts";
import { createSimulatedCar } from "../src/physics/simulation.ts";
import { parseTwt } from "../server/assets.mjs";
import { originalCar } from "./support/original-car.mjs";

const carsDirectory = fileURLToPath(
  new URL("../carma2_orig/data/CARS/", import.meta.url),
);
const carNames = existsSync(carsDirectory)
  ? readdirSync(carsDirectory)
      .filter((filename) => /\.twt$/i.test(filename))
      .map((filename) => filename.slice(0, -4))
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  : [];

async function assertForkliftUvFallback() {
  const bytes = await readFile(`${carsDirectory}/forklift.TWT`);
  const entries = parseTwt(bytes).entries;
  const entry = (filename) =>
    entries.find((item) => item.name.toLowerCase() === filename.toLowerCase());
  const contents = (item) =>
    new Uint8Array(bytes.buffer, bytes.byteOffset + item.offset, item.size);
  const actor = parseAct(contents(entry("forklift.act")));
  const modelNames = [];
  const visit = (node) => {
    if (node.model) modelNames.push(node.model.toLowerCase());
    node.children.forEach(visit);
  };
  actor.forEach(visit);
  for (const name of ["flforkl.dat", "flforkr.dat"])
    assert.ok(
      modelNames.includes(name),
      `${name} is referenced by forklift.act`,
    );

  const models = parseDat(contents(entry("forklift.dat")));
  for (const name of ["FLFORKL.DAT", "FLFORKR.DAT"]) {
    const model = models.find((candidate) => candidate.name === name);
    assert.ok(model, `${name} is present in forklift.dat`);
    assert.ok(
      model.warnings?.some((warning) =>
        /3 non-finite UV components replaced with zero/.test(warning),
      ),
    );
    assert.ok(
      model.positions.every(Number.isFinite),
      `${name} XYZ positions remain finite`,
    );
    assert.ok(
      model.uvs.every(Number.isFinite),
      `${name} UV fallback is finite`,
    );
  }
}

test("stock car archives create finite mechanics, hulls and four distinct wheel hubs", async (t) => {
  if (!carNames.length) {
    t.skip("Local original car archives are absent");
    return;
  }

  for (const name of carNames) {
    await t.test(name, async (subtest) => {
      let data;
      try {
        data = await originalCar(name);
      } catch (error) {
        if (error.code === "ENOENT") {
          subtest.skip("Archive disappeared during the test run");
          return;
        }
        throw error;
      }

      if (name.toLowerCase() === "forklift") await assertForkliftUvFallback();

      const damage = new DamageSystem(data.assets, data.group, data.text);
      await damage.init();
      const car = createSimulatedCar(
        data.group,
        data.text,
        damage,
        new Vector3(),
        0,
        true,
      );
      assert.ok(
        Number.isFinite(car.properties.mass) && car.properties.mass > 0,
      );
      assert.ok(car.properties.inertia.toArray().every(Number.isFinite));
      assert.ok(car.hulls.length > 0);
      for (const hull of car.hulls) {
        assert.ok(hull.vertices.length >= 4);
        assert.ok(
          hull.vertices.every((point) =>
            point.toArray().every(Number.isFinite),
          ),
        );
      }

      const wheelPositions = car.motion.wheelPositions;
      assert.equal(wheelPositions.length, 4);
      assert.ok(
        wheelPositions.every((point) => point.toArray().every(Number.isFinite)),
      );
      const distinctPositions = new Set(
        wheelPositions.map((point) =>
          point
            .toArray()
            .map((value) => value.toPrecision(8))
            .join(","),
        ),
      );
      assert.equal(
        distinctPositions.size,
        4,
        "wheel hubs must resolve to four distinct positions",
      );
    });
  }
});
