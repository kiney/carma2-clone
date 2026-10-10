import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { selectInitialCameraZoom } from "../src/camera/startup-zoom.ts";

const settings = {
  hitherGeneral: 0.06,
  hitherCockpit: 0.02,
  far: 35,
  fovDegrees: 55.55,
  fovAngle16: 10112,
  runtimeFovDegrees: (10112 * 360) / 65536,
};
const hull = (min, max) =>
  buildBoxHull(new Vector3(...min), new Vector3(...max));
function bounds(min, max) {
  return new Box3(new Vector3(...min), new Vector3(...max));
}

test("startup framing preserves native zoom 0.2 when all corners fit", () => {
  const shape = hull([-0.3, -0.2, -0.1], [0.3, 0.2, 0.1]);
  const result = selectInitialCameraZoom(
    bounds([-0.3, -0.2, -0.1], [0.3, 0.2, 0.1]),
    new Vector3(0, 0.1, 0),
    [shape],
    settings,
    16 / 9,
  );
  assert.deepEqual(result, { zoom: 0.2, framed: true });
});

test("zoom search raises startup framing for a large synthetic body", () => {
  const min = [-0.5, -0.5, -0.2];
  const max = [0.5, 0.5, 0.2];
  const result = selectInitialCameraZoom(
    bounds(min, max),
    new Vector3(0, 0, 0),
    [hull(min, max)],
    settings,
    1,
  );
  assert.equal(result.framed, true);
  assert.ok(result.zoom > 0.2 && result.zoom <= 2, `${result.zoom}`);
});

test("portrait aspect can require more zoom than landscape for the same bounds", () => {
  const min = [-0.5, -0.2, -0.2];
  const max = [0.5, 0.2, 0.2];
  const body = [hull(min, max)];
  const args = [bounds(min, max), new Vector3(), body, settings];
  const landscape = selectInitialCameraZoom(...args, 16 / 9);
  const portrait = selectInitialCameraZoom(...args, 0.65);
  assert.equal(landscape.framed, true);
  assert.equal(portrait.framed, true);
  assert.ok(portrait.zoom >= landscape.zoom);
});

test("startup own-shape clearance uses the authored general hither setting", () => {
  const min = [-0.3, -0.2, -0.3];
  const max = [0.3, 0.2, 0.3];
  const args = [bounds(min, max), new Vector3(), [hull(min, max)]];
  const stockNear = selectInitialCameraZoom(...args, settings, 16 / 9);
  const wideNear = selectInitialCameraZoom(
    ...args,
    { ...settings, hitherGeneral: 0.3 },
    16 / 9,
  );
  assert.notEqual(wideNear.zoom, stockNear.zoom);
});

test("zoom search is bounded at two when framing remains impossible", () => {
  const min = [-100, -100, -100];
  const max = [100, 100, 100];
  const result = selectInitialCameraZoom(
    bounds(min, max),
    new Vector3(),
    [hull(min, max)],
    settings,
    1,
  );
  assert.deepEqual(result, { zoom: 2, framed: false });
});

test("malformed bounds, aspect, and view settings are rejected", () => {
  const body = [hull([-1, -1, -1], [1, 1, 1])];
  assert.throws(() =>
    selectInitialCameraZoom(
      bounds([1, 0, 0], [-1, 1, 1]),
      new Vector3(),
      body,
      settings,
      1,
    ),
  );
  for (const aspect of [0, -1, NaN, Infinity])
    assert.throws(() =>
      selectInitialCameraZoom(
        bounds([-1, -1, -1], [1, 1, 1]),
        new Vector3(),
        body,
        settings,
        aspect,
      ),
    );
  assert.throws(() =>
    selectInitialCameraZoom(
      bounds([-1, -1, -1], [1, 1, 1]),
      new Vector3(),
      body,
      { ...settings, runtimeFovDegrees: NaN },
      1,
    ),
  );
});

test("installed Eagle remains at 0.2 and Bigdump can request legal zoom when available", async (t) => {
  const { originalCar } = await import("./support/original-car.mjs");
  const { DamageSystem } = await import("../src/damage.ts");
  const { createSimulatedCar } = await import("../src/physics/simulation.ts");
  for (const name of ["EAGLE3", "bigdump"]) {
    let data;
    try {
      data = await originalCar(name);
    } catch (error) {
      if (error.code === "ENOENT") {
        t.skip("Original car data is absent");
        return;
      }
      throw error;
    }
    const damage = new DamageSystem(data.assets, data.group, data.text);
    const localBounds = new Box3().setFromObject(data.group);
    await damage.init();
    const car = createSimulatedCar(
      data.group,
      data.text,
      damage,
      new Vector3(),
      0,
      true,
    );
    const result = selectInitialCameraZoom(
      localBounds,
      car.properties.centerOfMass,
      car.hulls,
      settings,
      16 / 9,
    );
    if (name === "EAGLE3") assert.equal(result.zoom, 0.2);
    else {
      assert.ok(result.zoom > 0.2 && result.zoom <= 2);
      assert.equal(result.framed, true);
    }
  }
});
