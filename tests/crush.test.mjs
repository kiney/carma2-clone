import test from "node:test";
import assert from "node:assert/strict";
import {
  ORIGINAL_CRUSH_SETTINGS,
  prepareCrushLimits,
  classifyCrushVertex,
  queuedCrushForce,
  crushContactDistanceSquared,
  dominantCrushAxis,
  crushModel,
  crushBentModel,
  constrainCrushVertex,
  crushSmashMagnitude,
} from "../src/physics/crush.ts";

const close = (actual, expected, tolerance = 1e-10) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} differs from ${expected}`,
  );
const authored = [0, 1, 2].map(() => ({ min: [0.1], max: [-0.1] }));
const bounds = { min: [-0.4, -0.4, -0.4], max: [0.4, 0.4, 0.4] };
const limits = prepareCrushLimits(authored, bounds);
const regions = (positions, planes = limits) =>
  Uint16Array.from(
    Array.from(
      { length: positions.length / 3 },
      (_, i) =>
        classifyCrushVertex(
          Array.from(positions.slice(i * 3, i * 3 + 3)),
          planes,
        ).packed,
    ),
  );

test("C2 GENERAL crush settings and queue thresholds preserve original units", () => {
  assert.deepEqual(ORIGINAL_CRUSH_SETTINGS, {
    minForce: 0.06,
    maxForce: 0.5,
    maxDistanceSquared: 0.01,
    forceToMovement: 1.5,
    distortionFactor: 0.0135,
  });
  assert.equal(queuedCrushForce([0.06, 0, 0]), 0);
  close(queuedCrushForce([0.03, 0.04, 0], 2), 0.1);
  assert.equal(queuedCrushForce([0, 20, 0]), 10);
});

test("shape contraction projects inside old accepted hull and restores a point rejected by packed limits", () => {
  const planes = [
    { normal: [1, 0, 0], constant: 0.3 },
    { normal: [-1, 0, 0], constant: 0.3 },
    { normal: [0, 1, 0], constant: 0.3 },
    { normal: [0, -1, 0], constant: 0.3 },
    { normal: [0, 0, 1], constant: 0.3 },
    { normal: [0, 0, -1], constant: 0.3 },
  ];
  const loose = [0, 1, 2].map(() => ({ min: [-0.4], max: [0.4] }));
  constrainCrushVertex([0.8, 0.6, 0], [0.1, 0, 0], planes, 0, loose).forEach(
    (value, index) => close(value, [0.3, 0.3, 0][index]),
  );
  const tight = [0, 1, 2].map(() => ({ min: [-0.2], max: [0.2] }));
  assert.deepEqual(
    constrainCrushVertex([0.8, 0.6, 0], [0.1, 0, 0], planes, 0, tight),
    [0.1, 0, 0],
  );
});

test("already-bent kernel stops at the nearest inner box plane without force-to-movement scaling", () => {
  const positions = new Float64Array([0, 0, -0.2, 0, 0, 0]);
  const result = crushBentModel({
    positions,
    contacts: [
      [0, 0, -0.2],
      [0, 0, 0],
    ],
    movement: [0, 0, 0.15],
    stopBounds: { min: [-0.1, -0.1, -0.1], max: [0.1, 0.1, 0.1] },
  });
  close(positions[2], -0.1);
  close(positions[5], 0);
  assert.equal(result.movedVertices, 1);
  const falloff = new Float64Array([0, 0, -0.2]);
  crushBentModel({
    positions: falloff,
    contacts: [[0, 0, -0.25]],
    movement: [0, 0, 0.1],
    stopBounds: { min: [-0.1, -0.1, -0.1], max: [0.1, 0.1, 0.1] },
  });
  close(falloff[2], -0.15);
});

test("packed regions classify original vertices with strict plane tests and min low bits", () => {
  assert.deepEqual(limits[0], {
    min: [0.1, -0.42898551],
    max: [-0.1, 0.42898551],
  });
  assert.equal(
    classifyCrushVertex([-0.2, 0.2, -0.1], limits).packed,
    1 | (4 << 4) | (5 << 8),
  );
  assert.equal(classifyCrushVertex([0.1, 0.1, 0.1], limits).packed, 0x555);
  const noInnerPlanes = prepareCrushLimits(
    [0, 1, 2].map(() => ({ min: [], max: [] })),
    bounds,
  );
  assert.deepEqual(classifyCrushVertex([0, 0, 0], noInnerPlanes), {
    packed: 0,
    invalid: true,
  });
  assert.deepEqual(authored[0], { min: [0.1], max: [-0.1] });
});

test("contact distance includes segment and triangle interiors and C2 rectangle basis", () => {
  close(
    crushContactDistanceSquared(
      [0.5, 0.2, 0],
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
    ),
    0.04,
  );
  close(
    crushContactDistanceSquared(
      [0.2, 0.2, 0.1],
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
    ),
    0.01,
  );
  close(
    crushContactDistanceSquared(
      [1, 1, 0],
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
    ),
    0.5,
  );
  close(
    crushContactDistanceSquared(
      [0.5, 0.5, 0.2],
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [9, 9, 9],
      ],
    ),
    0.04,
  );
  assert.equal(dominantCrushAxis([0.6, 0.7, Math.sqrt(0.15)]), 2);
  assert.equal(dominantCrushAxis([0.707107, 0.707107, 0]), 2);
  assert.equal(dominantCrushAxis([0.8, 0.6, 0]), 0);
});

test("visual deformation has linear distance falloff and one directional plane cap", () => {
  const positions = new Float64Array([0, 0, -0.2, 0.05, 0, -0.2, 0.1, 0, -0.2]);
  const result = crushModel({
    positions,
    vertexRegions: regions(positions),
    limits,
    contacts: [[0, 0, -0.2]],
    direction: [0, 0, 1],
    force: 0.08,
    softness: 1,
  });
  close(positions[2], -0.1); // .12 movement capped at the front region's -.1 stop.
  close(positions[5], -0.14); // .5 influence, rather than squared .25.
  close(positions[8], -0.2); // Radius exactly .1 has zero influence.
  assert.equal(result.maxInfluence, 1);
  assert.equal(result.strongestVertex, 0);
  close(result.strongestDisplacement, 0.1);
  assert.equal(result.movedVertices, 2);
});

test("deformation recomputes distances from current vertices and retains original regions", () => {
  const positions = new Float64Array([0, 0, -0.2]);
  const vertexRegions = regions(positions);
  const input = {
    positions,
    vertexRegions,
    limits,
    contacts: [[0, 0, -0.2]],
    direction: [0, 0, 1],
    force: 0.07,
    softness: 0.05,
  };
  crushModel(input);
  close(positions[2], -0.2 + 0.00525);
  crushModel(input);
  close(positions[2], -0.2 + 0.00525 + 0.00525 * (1 - 0.00525 / 0.1));
  assert.equal(vertexRegions[0], regions(new Float64Array([0, 0, -0.2]))[0]);
});

test("ineligible and uncrushable vertices still report pre-eligibility influence", () => {
  const positions = new Float64Array([0, 0, -0.01]);
  const input = {
    positions,
    vertexRegions: regions(positions),
    limits,
    contacts: [[0, 0, -0.105]],
    direction: [0, 0, 1],
    force: 0.5,
    softness: 1,
  };
  const result = crushModel(input);
  close(result.maxInfluence, 0.05);
  assert.equal(result.movedVertices, 0);
  assert.equal(positions[2], -0.01);
  const uncrushable = crushModel({
    ...input,
    contacts: [[0, 0, -0.01]],
    softness: 0,
  });
  assert.equal(uncrushable.maxInfluence, 1);
  assert.equal(uncrushable.movedVertices, 0);
});

test("force cap and contact divisor apply before WAM softness; texture damage is per event", () => {
  const plainLimits = prepareCrushLimits(
    [0, 1, 2].map(() => ({ min: [], max: [] })),
    bounds,
  );
  const positions = new Float64Array([0, 0, 0]);
  crushModel({
    positions,
    vertexRegions: regions(positions, plainLimits),
    limits: plainLimits,
    contacts: [
      [0, 0, 0],
      [0, 0, 0],
    ],
    direction: [0, 0, 1],
    force: 8,
    softness: 0.5,
  });
  close(positions[2], 0.1875); // .5 / 2 * .5 * 1.5; no arbitrary .12 dent cap.
  close(
    crushSmashMagnitude(8, 0.5, 2, [0, 0, 0], [0, 0, 0]),
    ((0.5 / 2) * 0.5 * 0.0135) / Math.sqrt(0.0014492754),
  );
});
