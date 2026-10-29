import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Group, Quaternion, Vector3 } from "three";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { captureNativePedAwardGeometry } from "../src/ped-award-geometry.ts";

function fixture() {
  const sim = new VehicleSimulation(
    { raycast: () => null, querySurfaces: () => [] },
    new Group(),
  );
  const body = {
    damage: {},
    human: true,
    state: {
      position: new Vector3(1, 2, 3),
      orientation: new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        Math.PI / 2,
      ),
      velocity: new Vector3(5, 0, 0),
      angularVelocity: new Vector3(1, 2, 3),
    },
    properties: {
      mass: 1,
      inertia: new Vector3(1, 2, 3),
      centerOfMass: new Vector3(0.1, 0.2, 0.3),
      worldFriction: 0,
    },
    hulls: [],
  };
  return { sim, body };
}
test("native award reads retained preparation/solver-local velocity, never a later world-V rotation", () => {
  const { sim, body } = fixture();
  assert.equal(sim.pedestrianAwardLocalVelocity(body), null);
  sim.hierarchyQuiet.retain(
    body,
    new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
  );
  assert.equal(
    sim.pedestrianAwardLocalVelocity(body),
    null,
    "unprepared slot is not a source value",
  );
  sim.hierarchyQuiet.prepare(body, new Vector3());
  const expected = new Vector3(5, 0, 0).applyQuaternion(
    body.state.orientation.clone().invert(),
  );
  body.state.velocity.set(99, 88, 77);
  assert.ok(
    sim.pedestrianAwardLocalVelocity(body).distanceTo(expected) < 1e-12,
  );
  const spill = new Vector3(7, 8, 9);
  sim.quietSolverLocalV = new Map([[body.state, spill]]);
  const inputs = captureNativePedAwardGeometry(
    body,
    new Vector3(4, 5, 6),
    8,
    sim.pedestrianAwardLocalVelocity(body),
  );
  assert.deepEqual(inputs.killerLocalVelocity.toArray(), [7, 8, 9]);
  spill.set(0, 0, 0);
  assert.deepEqual(
    inputs.killerLocalVelocity.toArray(),
    [7, 8, 9],
    "event retains the source snapshot",
  );
  const address = sim.nativeObjectAddress(body),
    view = sim.nativeObjectRecords.readView(body);
  assert.ok(address > 0 && address % 16 === 0);
  assert.equal(view.getFloat32(0x68, true), 99);
  assert.equal(
    view.getFloat32(0x1a8, true),
    0,
    "mirror uses the actual current solver spill",
  );
});
test("human presentation cannot fabricate source driver8 or missing retained solver input", () => {
  const { sim, body } = fixture();
  assert.equal(sim.pedestrianAttributionDriver(body), undefined);
  const inputs = captureNativePedAwardGeometry(
    body,
    new Vector3(4, 5, 6),
    undefined,
    null,
  );
  assert.equal(inputs.killerDriver, undefined);
  assert.equal(inputs.killerLocalVelocity, undefined);
  body.state.driver = 6;
  assert.equal(sim.pedestrianAttributionDriver(body), 6);
  body.state.driver = 8;
  assert.equal(sim.pedestrianAttributionDriver(body), 8);
  const centre = body.properties.centerOfMass
    .clone()
    .applyQuaternion(body.state.orientation)
    .add(body.state.position);
  const originInputs = captureNativePedAwardGeometry(
    body,
    centre,
    8,
    new Vector3(),
  );
  assert.ok(originInputs.localPedPosition.length() < 1e-12);
});

test("normal PHIL removal releases its effects record before repeated body admission", () => {
  const { sim, body } = fixture();
  assert.equal(sim.phil.registerImmediate(body), 0);
  sim.nativeObjectAddress(body);
  assert.equal(sim.nativeObjectRecords.stats.count, 1);
  sim.phil.remove(body);
  assert.equal(sim.nativeObjectRecords.stats.count, 0);
  sim.dispose();
});
