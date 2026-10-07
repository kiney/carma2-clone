import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  FLAP_QUARTER_TURN,
  createFlapState,
  flapAngleRadians,
  flapCheckVertices,
  orderFlapHinges,
  applyPlasticFlap,
  stepFlapAngle,
} from "../src/physics/flap.ts";

const v = (x, y, z) => new Vector3(x, y, z);
const hinges = [0, 1, 2];
const panel = () => [v(0, 0, 0), v(0.2, 0, 0), v(0.1, 0, 0.2), v(0.1, 0, 0.05)];

test("flap starts closed with source angle range and mass-scaled quantized torque", () => {
  const points = panel();
  const state = createFlapState(points[1], points[2]);
  assert.equal(state.angleUnits, 0);
  assert.equal(state.maxAngleUnits, 0x3ffc);
  assert.equal(
    stepFlapAngle(state, v(1, 0, 0), v(0, 0, 1), v(0, 1, 0), 1),
    false,
  );
  state.active = true;
  assert.equal(
    stepFlapAngle(state, v(1, 0, 0), v(0, 0, 1), v(0, 1, 0), 1),
    true,
  );
  assert.equal(
    state.angleUnits,
    Math.trunc((Math.atan2(0.02, 1) * 65536) / (2 * Math.PI)),
  );
  assert.ok(
    Math.abs(
      flapAngleRadians(state) - (state.angleUnits * 2 * Math.PI) / 65536,
    ) < 1e-12,
  );
  state.angleUnits = FLAP_QUARTER_TURN - 1;
  stepFlapAngle(state, v(1, 0, 0), v(0, 0, 1), v(0, 1, 0), 1);
  assert.equal(state.angleUnits, FLAP_QUARTER_TURN);
  state.angleUnits = 1;
  stepFlapAngle(state, v(1, 0, 0), v(0, 0, 1), v(0, -1, 0), 1);
  assert.equal(state.angleUnits, 0);
});

test("hinge order preserves the kev bit and check vertices use finite edge distance", () => {
  const points = panel();
  assert.deepEqual(orderFlapHinges(points, hinges, v(0, -1, 0)), [1, 0, 2]);
  assert.deepEqual(orderFlapHinges(points, hinges, v(0, -1, 0), 2), hinges);
  assert.deepEqual(
    Array.from(flapCheckVertices([...points, v(0.3, 0, 0)], hinges)),
    [0, 0, 1, 1, 1],
  );
});

test("plastic buckle deforms the inward panel, narrows angle range and activates before tear", () => {
  const points = panel();
  const state = createFlapState(points[1], points[2]);
  const result = applyPlasticFlap(state, {
    points,
    hinges,
    checkVertices: flapCheckVertices(points, hinges),
    direction: v(0, 0, -1),
    strongestVertex: 2,
    displacement: 0.01,
    parentReference: points[2].clone(),
    random: () => 0.5,
  });
  const offset = 0.5 * Math.sqrt(0.21 ** 2 - 0.2 ** 2);
  assert.equal(result.activated, true);
  assert.equal(state.active, true);
  assert.equal(state.buckled, true);
  assert.ok(Math.abs(state.plasticOffset - offset) < 1e-12);
  assert.ok(points[3].y < 0);
  assert.deepEqual(points[0], v(0, 0, 0));
  assert.deepEqual(points[1], v(0.2, 0, 0));
  assert.equal(
    points[2].y,
    0,
    "strongest boundary receives no additional buckle offset",
  );
  assert.ok(state.spanUnits < FLAP_QUARTER_TURN);
});

test("plastic flap eligibility uses .2 direction threshold and cumulative plastic capacity", () => {
  const points = panel();
  const state = createFlapState(points[1], points[2]);
  const input = {
    points,
    hinges,
    checkVertices: flapCheckVertices(points, hinges),
    direction: v(0, 0, -0.2),
    strongestVertex: 2,
    displacement: 0.01,
    parentReference: points[2].clone(),
    random: () => 0.5,
  };
  assert.equal(applyPlasticFlap(state, input).activated, false);
  state.plasticLimit = 0.001;
  input.direction = v(0, 0, -1);
  applyPlasticFlap(state, input);
  assert.equal(state.plastic, false);
  assert.equal(applyPlasticFlap(state, input).movedVertices, 0);
});
