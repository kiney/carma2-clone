import test from "node:test";
import assert from "node:assert/strict";
import { NativePedPopulationPlan } from "../src/ped-native-population.ts";

const movement = {
  minTurnMs: 0,
  maxTurnMs: 0,
  maxTurnRadians: 0,
  minWalkPeriod: 10,
  maxWalkPeriod: 20,
};
const material = (name = "1234567?ABCD") => ({ name });
function fixture({ mat = material(), positions, sourceFaceIndex = 7 } = {}) {
  const model = {
    identity: {},
    flags: 0,
    actorRenderStyle: 0,
    vertices: (
      positions ?? [
        [0, 0, 0],
        [0, 0, 10],
        [10, 0, 0],
      ]
    ).map((position) => ({ position, uv: [0, 0], payload: null })),
    faces: [],
  };
  const face = {
    indices: [0, 1, 2],
    material: mat,
    payload: { source: "fixture" },
    sourceFaceIndex,
  };
  return {
    model,
    face,
    visit: {
      model,
      face,
      nativeFaces: [face],
      nativeFaceIndex: 0,
      remainingFaceCount: 1,
    },
  };
}
function plan({
  mat = material(),
  density = 5,
  groups = new Map([[3, ["Blokebl"]]]),
  random,
  ...rest
} = {}) {
  const spec = {
    material: "spawn.mat",
    movement: 0,
    group: 3,
    density,
    exclusions: [],
    exceptions: [],
  };
  return {
    spec,
    value: new NativePedPopulationPlan({
      specs: [{ spec, material: mat }],
      groups,
      movements: [movement],
      maxSlopeDegrees: 25,
      random: random ?? (() => 0.5),
      ...rest,
    }),
  };
}

test("face visit matches resolved MAT identity and preserves raw MODEL point/provenance", () => {
  const target = material(),
    sameName = material(),
    draws = [];
  const { spec, value } = plan({
    mat: target,
    density: 0.5,
    random: () => {
      draws.push(0.5);
      return 0.5;
    },
  });
  const wrong = fixture({ mat: sameName });
  assert.deepEqual(value.visit(wrong.visit), []);
  assert.equal(draws.length, 0);
  const source = fixture({ mat: target });
  source.model.actorTransform = [1000, 20, -900];
  const entries = value.visit(source.visit);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].personality, "Blokebl");
  assert.deepEqual(entries[0].position, [5, 0, 5]);
  assert.deepEqual(entries[0].direction, [1, 0, 0]);
  assert.equal(entries[0].sourceModel, source.model.identity);
  assert.equal(entries[0].sourceFaceIndex, 7);
  assert.equal(entries[0].group, 3);
  assert.equal(entries[0].movement, 0);
  assert.equal(entries[0].walkPeriod, 15);
  assert.equal(draws.length, 6); // group, X/Z, point alpha/beta, walk period
  source.model.vertices[0].position[0] = 777;
  assert.deepEqual(entries[0].position, [5, 0, 5]);
  assert.ok(Math.abs(value.carryFor(spec) - 0.19025) < 1e-12);
});

test("per-spec fractional carry crosses eligible faces and zero density leaves it alone", () => {
  const mat = material(),
    { spec, value } = plan({ mat, density: 10 });
  const small = fixture({
    mat,
    positions: [
      [0, 0, 0],
      [0, 0, 1],
      [1, 0, 0],
    ],
  });
  assert.equal(value.visit(small.visit).length, 0);
  assert.ok(Math.abs(value.carryFor(spec) - 0.23805) < 1e-7);
  const zeroSpec = { ...spec, density: 0 };
  const zeroPlan = new NativePedPopulationPlan({
    specs: [{ spec: zeroSpec, material: mat }],
    groups: new Map([[3, ["Blokebl"]]]),
    movements: [movement],
    maxSlopeDegrees: 25,
    random: () => 0.5,
  });
  zeroPlan.visit(small.visit);
  assert.equal(zeroPlan.carryFor(zeroSpec), 0);
  value.visit(small.visit);
  assert.ok(Math.abs(value.carryFor(spec) - 0.4761) < 1e-7);
  value.visit(small.visit);
  value.visit(small.visit);
  value.visit(small.visit);
  assert.equal(value.entries.length, 1);
});

test("animal exclusion consumes only group selection draws; direction precedes point and walk", () => {
  const sequence = [0, 0.75, 0.25, 0.75, 0.25, 0.25, 0.75, 0.5];
  let at = 0;
  const random = () => sequence[at++];
  const mat = material();
  const { value } = plan({
    mat,
    density: 10,
    groups: new Map([[3, ["Cow", "Blokebl"]]]),
    random,
    suppressAnimals: true,
    animal: (name) => name === "Cow",
  });
  const source = fixture({
    mat,
    positions: [
      [0, 0, 0],
      [0, 0, 1],
      [1, 0, 0],
    ],
  });
  // This face's density yields zero; scale it to produce two candidates.
  source.model.vertices[1].position[2] = 3;
  source.model.vertices[2].position[0] = 3;
  const entries = value.visit(source.visit);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].personality, "Blokebl");
  assert.ok(Math.abs(entries[0].direction[0] + Math.SQRT1_2) < 1e-7);
  assert.equal(entries[0].direction[1], 0);
  assert.ok(Math.abs(entries[0].direction[2] - Math.SQRT1_2) < 1e-7);
  assert.equal(at, 7); // excluded: group; accepted: group, X/Z, point pair, walk
});

test("capacity above native limit is rejected and exhaustion returns before carry write", () => {
  assert.throws(() => plan({ capacity: 2001 }), /0\.\.2000/);
  const mat = material(),
    { spec, value } = plan({ mat, density: 5, capacity: 1 });
  const source = fixture({ mat });
  value.visit(source.visit);
  assert.equal(value.entries.length, 1);
  assert.equal(value.carryFor(spec), 0);
});

test("face material/identifier, normal, and identity exclusions consume no random draws", () => {
  let draws = 0;
  const source = fixture({ mat: material("short?") });
  const { value } = plan({
    mat: source.face.material,
    random: () => (draws++, 0.5),
  });
  assert.deepEqual(value.visit(source.visit), []);
  source.face.material = null;
  assert.deepEqual(value.visit(source.visit), []);
  assert.equal(draws, 0);
  const steep = fixture({
    mat: material(),
    positions: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
  });
  const other = plan({
    mat: steep.face.material,
    random: () => (draws++, 0.5),
  }).value;
  assert.deepEqual(other.visit(steep.visit), []);
  assert.equal(draws, 0);
});

test("objective construction marks only configured groups or every group for all-peds missions", () => {
  const mat = material(),
    source = fixture({ mat }),
    registrations = [];
  const { value } = plan({
    mat,
    density: -1,
    objectiveGroups: [2, 3, 3],
    onObjective: (entry, index) => registrations.push([entry, index]),
  });
  const [entry] = value.visit(source.visit);
  assert.equal(entry.objective, true);
  assert.deepEqual(
    registrations,
    [[entry, 0]],
    "duplicate target groups register a constructed identity once",
  );
  assert.equal(
    plan({ mat, density: -1, objectiveGroups: [] }).value.visit(source.visit)[0]
      .objective,
    undefined,
  );
  assert.equal(
    plan({ mat, density: -1, allObjectives: true }).value.visit(source.visit)[0]
      .objective,
    true,
  );
});
