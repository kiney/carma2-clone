import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import {
  clearCameraFromOwnShape,
  cameraShapeRay,
} from "../src/camera/own-shape.ts";

const box = (zMin = -0.4, zMax = 0.4) =>
  buildBoxHull(new Vector3(-0.4, -0.4, zMin), new Vector3(0.4, 0.4, zMax));

function shape(
  hulls,
  position = new Vector3(),
  orientation = new Quaternion(),
) {
  return { hulls, position, orientation };
}

test("camera inside own hull advances to boundary plus three near planes", () => {
  const hulls = [box()];
  const result = clearCameraFromOwnShape(
    new Vector3(0, 0, 0.1),
    new Vector3(),
    shape(hulls),
    0.06,
  );
  assert.equal(result.iterations, 3);
  assert.ok(Math.abs(result.position.z - 0.58) < 1e-12);
});

test("outside cameras remain unchanged and positive boundary rays report fraction", () => {
  const hulls = [box()];
  const outside = new Vector3(0, 0, 0.7);
  const result = clearCameraFromOwnShape(
    outside,
    new Vector3(),
    shape(hulls),
    0.06,
  );
  assert.equal(result.iterations, 0);
  assert.deepEqual(result.position.toArray(), outside.toArray());

  const hit = cameraShapeRay(
    new Vector3(0, 0, 0.7),
    new Vector3(0, 0, 0.1),
    hulls,
  );
  assert.equal(hit.inside, false);
  assert.ok(Math.abs(hit.fraction - 0.5) < 1e-12);
  assert.ok(Math.abs(hit.point.z - 0.4) < 1e-12);
});

test("native camera shape ray uses the supplied head, not successor hulls", () => {
  const lower = buildBoxHull(
    new Vector3(-0.4, -0.4, -0.2),
    new Vector3(0.4, 0.4, 0.2),
  );
  const upper = buildBoxHull(
    new Vector3(-0.4, -0.4, 0.4),
    new Vector3(0.4, 0.4, 0.6),
  );
  const hit = cameraShapeRay(new Vector3(0, 0, 1), new Vector3(0, 0, -1), [
    lower,
    upper,
  ]);
  assert.equal(hit.inside, false);
  assert.ok(Math.abs(hit.point.z - 0.2) < 1e-12);
  assert.deepEqual(
    cameraShapeRay(new Vector3(0, 0, 0), new Vector3(0, 0, -1), [lower, upper]),
    { inside: true },
  );
});

test("own-shape clearance respects actor translation and rotation", () => {
  const origin = new Vector3(5, 2, -3);
  const orientation = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    Math.PI / 2,
  );
  const com = origin.clone();
  const camera = new Vector3(0, 0, 0.1)
    .applyQuaternion(orientation)
    .add(origin);
  const result = clearCameraFromOwnShape(
    camera,
    com,
    shape([box()], origin, orientation),
    0.06,
  );
  assert.ok(Math.abs(result.position.x - 5.58) < 1e-12);
  assert.ok(Math.abs(result.position.y - 2) < 1e-12);
  assert.ok(Math.abs(result.position.z + 3) < 1e-12);
});

test("crushed hull bounds change the resulting camera clearance", () => {
  const camera = new Vector3(0, 0, 0.1);
  const com = new Vector3();
  const intact = clearCameraFromOwnShape(camera, com, shape([box()]), 0.06);
  const crushed = clearCameraFromOwnShape(
    camera,
    com,
    shape([
      buildBoxHull(new Vector3(-0.2, -0.2, -0.2), new Vector3(0.2, 0.2, 0.2)),
    ]),
    0.06,
  );
  assert.ok(crushed.position.z < intact.position.z);
  assert.ok(Math.abs(crushed.position.z - 0.38) < 1e-12);
});

test("own-shape camera clearance rejects invalid near planes and zero COM rays", () => {
  for (const near of [0, -0.1, NaN, Infinity])
    assert.throws(
      () =>
        clearCameraFromOwnShape(
          new Vector3(0, 0, 0.1),
          new Vector3(),
          shape([box()]),
          near,
        ),
      /near plane/,
    );
  assert.throws(
    () =>
      clearCameraFromOwnShape(
        new Vector3(),
        new Vector3(),
        shape([box()]),
        0.06,
      ),
    /centre of mass/,
  );
});

test("installed Eagle and Bigdump mechanics hulls support own-shape clearance", async (t) => {
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
    await damage.init();
    const car = createSimulatedCar(
      data.group,
      data.text,
      damage,
      new Vector3(10, 0, 4),
      0.3,
      true,
    );
    const worldCOM = car.state.position
      .clone()
      .add(
        car.properties.centerOfMass
          .clone()
          .applyQuaternion(car.state.orientation),
      );
    const camera = worldCOM
      .clone()
      .add(new Vector3(0, 0, 0.1).applyQuaternion(car.state.orientation));
    const result = clearCameraFromOwnShape(
      camera,
      worldCOM,
      shape(car.hulls, car.state.position, car.state.orientation),
      0.06,
    );
    assert.ok(
      result.iterations > 0,
      `${name} camera begins inside authored hull`,
    );
    assert.ok(
      result.position.distanceTo(camera) > 0.18,
      `${name} cleared hull`,
    );
  }
});

test("camera clearance rejects malformed transforms and nonfinite authored vertices", () => {
  const camera = new Vector3(0, 0, 0.1);
  const com = new Vector3();
  assert.throws(
    () => cameraShapeRay(new Vector3(NaN, 0, 0), camera, [box()]),
    /segment/,
  );
  assert.throws(
    () =>
      clearCameraFromOwnShape(
        camera,
        com,
        shape([box()], new Vector3(Infinity, 0, 0)),
        0.06,
      ),
    /transform/,
  );
  assert.throws(
    () =>
      clearCameraFromOwnShape(
        camera,
        com,
        shape([box()], new Vector3(), new Quaternion(0, 0, 0, 2)),
        0.06,
      ),
    /normalized/,
  );
  const malformed = box();
  malformed.vertices[0].x = NaN;
  assert.throws(
    () => clearCameraFromOwnShape(camera, com, shape([malformed]), 0.06),
    /vertex/,
  );
});
