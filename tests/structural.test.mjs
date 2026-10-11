import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { Box3, Vector3 } from "three";
import {
  createBendTransform,
  bendPoint,
  selectStructuralBend,
  selectStructuralBranch,
  createStructuralBend,
  stepBendRepair,
  bendSteeringCurvature,
  compressedBendReference,
  parseStructuralSettings,
} from "../src/physics/structural.ts";

const bounds = new Box3(new Vector3(-0.2, 0, -0.6), new Vector3(0.2, 0.3, 0.6));
const input = () => ({
  mean: new Vector3(0, 0.2, -0.6),
  direction: new Vector3(0, 0, 1),
  force: 6,
  bendability: 0.5,
  bendZMin: -0.2,
  bendZMax: 0.2,
  bounds,
  human: true,
  random: () => 0,
});

test("stock and Advanced GENERAL structural settings load authored native float fields", async (t) => {
  try {
    await access("carma2_orig");
  } catch {
    t.skip("Original installation absent");
    return;
  }
  const assets = await createAssetStore();
  for (const root of ["data", "adv_data"]) {
    const settings = parseStructuralSettings(
      decodeText(await assets.read(`${root}/general.txt`)),
    );
    assert.deepEqual(settings, {
      minimumForce: 2.5,
      bendingChance: 30,
      inverseBucklePercent: 0,
      battyGravity: Math.fround(1.44),
      damageMinimum: 10,
      damageMaximum: 40,
    });
  }
  assert.throws(() => parseStructuralSettings(""), /GENERAL/);
});

test("dominant Z bends seed the captured tick only in the deferred phase", () => {
  const calls = [];
  const context = {
    ...input(),
    physicsTickMs: 1234,
    seedRandom: (tick) => calls.push(["seed", tick]),
    random: () => {
      calls.push(["draw"]);
      return 0;
    },
  };
  selectStructuralBranch(context);
  assert.deepEqual(calls, [["draw"]]);
  createStructuralBend(context);
  assert.deepEqual(calls, [["draw"], ["seed", 1234], ["draw"]]);
  calls.length = 0;
  createStructuralBend({ ...context, direction: new Vector3(1, 0, 0) });
  assert.deepEqual(
    calls,
    [],
    "native X branch consumes neither seed nor pivot draw",
  );
});

test("transition repair references use source bounded compressed CAR coordinates", () => {
  const original = new Vector3(0, 0.1, -0.4);
  assert.deepEqual(
    compressedBendReference(original).toArray(),
    [0.000152587890625, 0.09994658827781677, -0.3999389708042145],
  );
  assert.deepEqual(original.toArray(), [0, 0.1, -0.4]);
  assert.deepEqual(
    compressedBendReference(new Vector3(-11, 10, 11)).toArray(),
    [-10, 10, 10],
  );
});

test("only the front bend adds source signed-yaw-degree steering curvature", () => {
  const front = createBendTransform(
    bounds,
    new Vector3(0, 0, -0.2),
    0.6,
    0,
    0xf1c8,
  );
  assert.equal(
    bendSteeringCurvature(front),
    (((0xf1c8 - 65536) * 360) / 65536) * 0.03,
  );
  const repaired = stepBendRepair(front, 40).next;
  assert.ok(
    Math.abs(bendSteeringCurvature(repaired)) <
      Math.abs(bendSteeringCurvature(front)),
  );
  const rear = createBendTransform(
    bounds,
    new Vector3(0, 0, 0.2),
    -0.6,
    0,
    0xf1c8,
  );
  assert.equal(bendSteeringCurvature(rear), 0);
});
test("structural routing uses strict bend force threshold and failed chance skips ordinary dent", () => {
  assert.equal(
    selectStructuralBend({ ...input(), force: 5 }).skipOrdinary,
    false,
  );
  const failed = selectStructuralBend({ ...input(), random: () => 0.9 });
  assert.equal(failed.skipOrdinary, true);
  assert.equal(failed.bend, undefined);
  assert.equal(
    selectStructuralBend({ ...input(), human: false, bendability: 0.1 })
      .skipOrdinary,
    true,
  );
  assert.equal(
    selectStructuralBend({ ...input(), human: true, bendability: 0.1 })
      .skipOrdinary,
    false,
  );
  assert.equal(
    selectStructuralBend({
      ...input(),
      human: false,
      raceIndex: 1,
      raceCount: 1,
    }).skipOrdinary,
    true,
  );
});
test("front and rear structural requests use authored bend plane, far end and source quantized angle", () => {
  const front = selectStructuralBend(input()).bend;
  assert.ok(front);
  assert.equal(front.pivot.z, -0.2);
  assert.equal(front.farZ, 0.6);
  assert.equal(front.pivot.y, 0.3);
  assert.equal(
    front.angleXUnits,
    14 * 0xe38,
    "unsigned source quantization retains its negative-angle asymmetry",
  );
  const rear = selectStructuralBend({
    ...input(),
    mean: new Vector3(0, 0.2, 0.6),
  }).bend;
  assert.ok(rear);
  assert.equal(rear.pivot.z, 0.2);
  assert.equal(rear.farZ, -0.6);
  assert.equal(rear.angleXUnits, 3 * 0xe38);
  assert.equal(
    selectStructuralBend({ ...input(), mean: new Vector3() }).bend,
    undefined,
  );
});

test("ordinary structural selection draws once even for an already bent car, without selecting a pivot", () => {
  let draws = 0;
  const random = () => {
    draws++;
    return 0;
  };
  assert.deepEqual(
    selectStructuralBranch({ ...input(), alreadyBent: true, random }),
    { skipOrdinary: true, markedForBend: true },
  );
  assert.equal(draws, 1, "43617d precedes DoBending's already-bent gate");
  assert.deepEqual(
    selectStructuralBend({ ...input(), alreadyBent: true, random }),
    { skipOrdinary: true, bend: undefined },
  );
  assert.equal(draws, 2);
  selectStructuralBranch({ ...input(), bendingChance: 0, random });
  assert.equal(draws, 2, "PercentageChance zero does not advance the stream");
});

test("marked bending uses live later bounds and an invalid middle contact consumes no pivot draw", () => {
  let draws = 0;
  const random = () => {
    draws++;
    return 0;
  };
  assert.equal(
    selectStructuralBranch({ ...input(), random }).markedForBend,
    true,
  );
  assert.equal(draws, 1);
  assert.equal(
    createStructuralBend({ ...input(), mean: new Vector3(), random }),
    undefined,
  );
  assert.equal(draws, 1);
  const changed = bounds.clone();
  changed.max.y = 0.25;
  const bend = createStructuralBend({ ...input(), bounds: changed, random });
  assert.equal(bend.pivot.y, 0.25);
  assert.equal(draws, 2, "pivot selection belongs to the later phase");
});
test("bend field fixes the far end, interpolates between planes and rotates the outer end", () => {
  const bend = createBendTransform(
    bounds,
    new Vector3(0, 0.3, -0.2),
    0.6,
    0x1000,
    0,
  );
  const far = new Vector3(0.1, 0.1, 0.6);
  assert.deepEqual(bendPoint(far, bend), far);
  const plane = new Vector3(0.1, 0.1, -0.2);
  const rotated = plane.clone().applyMatrix4(bend.rotation);
  assert.ok(bendPoint(plane, bend).distanceTo(rotated) < 1e-12);
  const midpoint = new Vector3(0.1, 0.1, 0.2);
  assert.ok(
    bendPoint(midpoint, bend).distanceTo(
      midpoint.clone().addScaledVector(rotated.clone().sub(plane), 0.5),
    ) < 1e-12,
  );
  const nose = new Vector3(0.1, 0.1, -0.6);
  assert.ok(
    bendPoint(nose, bend).distanceTo(nose.clone().applyMatrix4(bend.rotation)) <
      1e-12,
  );
  const outside = new Vector3(0.1, 0.1, 0.7);
  assert.deepEqual(bendPoint(outside, bend), outside);
});

test("structural repair removes eight angle units per millisecond with source R/D accounting", () => {
  const bend = createBendTransform(
    bounds,
    new Vector3(0, 0.3, -0.2),
    0.6,
    0x1000,
    0,
  );
  const result = stepBendRepair(bend, 40);
  assert.equal(result.next.angleXUnits, 0x1000 - 320);
  assert.equal(result.bodyworkRepair, 320 / 65536);
  assert.equal(result.totalDeflection, (2 * 0x1000) / 65536);
  assert.equal(result.complete, false);
  const full = stepBendRepair(bend, 1000);
  assert.equal(full.next.angleXUnits, 0);
  assert.equal(full.bodyworkRepair / full.totalDeflection, 0.5);
  assert.equal(full.complete, true);
  const negative = createBendTransform(
    bounds,
    new Vector3(0, 0.3, -0.2),
    0.6,
    0xf000,
    0,
  );
  assert.equal(stepBendRepair(negative, 40).next.angleXUnits, 0xf000 + 320);
});
