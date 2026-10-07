import test from "node:test";
import assert from "node:assert/strict";
import { Vector3, Group, Quaternion } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { transformHull, sweepHulls } from "../src/physics/geometry.ts";
import { originalCar } from "./support/original-car.mjs";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
test("analytic box retains zero-thickness plate with exact six planes", () => {
  const min = new Vector3(-0.03, 0.06, -0.36),
    max = new Vector3(0.03, 0.1, -0.36),
    hull = buildBoxHull(min, max);
  assert.equal(hull.faces.length, 6);
  assert.equal(hull.edges.length, 12);
  assert.ok(hull.vertices.every((v) => v.z === -0.36));
  for (const v of hull.vertices)
    assert.ok(hull.faces.every((f) => f.normal.dot(v) - f.constant <= 1e-12));
  assert.throws(
    () => buildBoxHull(new Vector3(1, 0, 0), new Vector3(0, 1, 1)),
    /bounds/,
  );
});
test("original Ford pickup planar plate detaches as authored without fatal hull construction", async (t) => {
  let original;
  try {
    original = await originalCar("fordpick");
  } catch (e) {
    if (e.code === "ENOENT") {
      t.skip("Original assets absent");
      return;
    }
    throw e;
  }
  const damage = new DamageSystem(
    original.assets,
    original.group,
    original.text,
  );
  await damage.init();
  const car = createSimulatedCar(
      original.group,
      original.text,
      damage,
      new Vector3(0, 2, 0),
      0,
      true,
    ),
    sim = new VehicleSimulation(
      { raycast: () => null, querySurfaces: () => [] },
      new Group(),
    );
  sim.scene.add(car.group);
  sim.add(car);
  const index = damage.runtimeParts.findIndex(
    (p) => p.actor.name === "PUPLATF.DAT",
  );
  assert.ok(index >= 0);
  const part = damage.runtimeParts[index];
  assert.equal(part.bounds.max.z - part.bounds.min.z, 0);
  part.state.queuedAt = 0;
  sim.step();
  const child = sim.debris.find((b) => b.part === index);
  assert.ok(child);
  assert.ok(child.hulls[0].vertices.every((v) => v.z === part.bounds.min.z));
  assert.ok(
    [
      ...child.state.velocity.toArray(),
      ...child.state.angularVelocity.toArray(),
    ].every(Number.isFinite),
  );
  sim.dispose();
});

test("planar analytic box produces a finite swept contact against a volumetric body", () => {
  const q = new Quaternion(),
    plate = buildBoxHull(
      new Vector3(-0.03, -0.02, 0),
      new Vector3(0.03, 0.02, 0),
    ),
    box = buildBoxHull(
      new Vector3(-0.5, -0.5, -0.05),
      new Vector3(0.5, 0.5, 0.05),
    );
  const fixed = transformHull(box, new Vector3(), q),
    hit = sweepHulls(
      transformHull(plate, new Vector3(0, 0, 0.1), q),
      transformHull(plate, new Vector3(0, 0, -0.1), q),
      fixed,
      fixed,
    );
  assert.ok(hit);
  assert.ok(hit.normal.toArray().every(Number.isFinite));
  assert.ok(hit.points.every((v) => v.toArray().every(Number.isFinite)));
});
