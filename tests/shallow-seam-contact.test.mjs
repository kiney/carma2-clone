import test from "node:test";
import assert from "node:assert/strict";
import {
  admitSampledWorldContacts,
  conflictingWorldEncounter,
  mergeWorldContacts,
} from "../src/physics/world-contact-admission.ts";
import {
  collectShallowSeamRows,
  makeShallowSeamFixture,
  solveShallowSeamRows,
  v,
} from "./support/shallow-seam-fixture.mjs";

function nearSeamPair({ angle = 1.33, types = [0, 1] } = {}) {
  const actor = {},
    body = {},
    radians = (angle * Math.PI) / 180;
  const surface = (a, b, c, normal) => ({
    a: v(...a),
    b: v(...b),
    c: v(...c),
    normal: v(...normal),
    actor,
  });
  const x = surface([-1, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0]);
  const y = surface(
    [-1, 0, 0],
    [1, 0, 0],
    [0, Math.tan(radians), -1],
    [0, Math.cos(radians), Math.sin(radians)],
  );
  return [
    {
      a: body,
      point: v(0, 0, 0),
      normal: v(0, 1, 0),
      sourceSurface: x,
      sourceType: types[0],
      worldFeature: { hullIndex: 0, fraction: 0.1, trajectory: "angular" },
    },
    {
      a: body,
      point: v(0.03, 0, 0),
      normal: v(0, -1, 0),
      sourceSurface: y,
      sourceType: types[1],
      worldFeature: { hullIndex: 0, fraction: 0.8, trajectory: "angular" },
    },
  ];
}

for (const types of [
  [0, 1],
  [0, 0],
]) {
  test(`smooth adjacent seam rejects a later opposed ${types.join("/")} encounter without vertex metadata`, () => {
    const [early, late] = nearSeamPair({ types });
    assert.equal(conflictingWorldEncounter(early, late), true);
    assert.deepEqual(admitSampledWorldContacts([late, early]), [early]);
  });
}

test("smooth seam merge replaces the conflicting chord with the sampled encounter", () => {
  const [sampled, chord] = nearSeamPair();
  chord.worldFeature = { ...chord.worldFeature, trajectory: "chord" };
  // Chord and sampled fractions are deliberately incomparable; sampled local
  // encounter precedence must not depend on sorting the two time domains.
  chord.worldFeature.fraction = 0.001;
  assert.deepEqual(mergeWorldContacts([chord], [sampled]), [sampled]);
});

const independentCases = [
  [
    "perpendicular corner",
    ([, row]) => {
      Object.assign(row.sourceSurface, { c: v(0, 1, 0), normal: v(0, 0, 1) });
    },
  ],
  [
    "parallel narrow gap",
    ([, row]) => {
      Object.assign(row.sourceSurface, {
        a: v(-1, 0.001, 0),
        b: v(1, 0.001, 0),
        c: v(0, 0.001, -1),
        normal: v(0, 1, 0),
      });
    },
  ],
  [
    "distant OLD levers",
    ([, row]) => {
      row.point.set(0.1, 0, 0);
    },
  ],
  [
    "different actors",
    ([, row]) => {
      row.sourceSurface.actor = {};
    },
  ],
  [
    "one shared vertex",
    ([, row]) => {
      row.sourceSurface.b.set(2, 0, 0);
    },
  ],
  [
    "overlapping triangle interiors",
    ([, row]) => {
      row.sourceSurface.c.z = 1;
    },
  ],
  [
    "dynamic owner",
    ([, row]) => {
      row.sourceSurface.owner = {};
    },
  ],
  [
    "crease beyond five degrees",
    ([, row]) => {
      const radians = (6 * Math.PI) / 180;
      row.sourceSurface.c.y = Math.tan(radians);
      row.sourceSurface.normal.set(0, Math.cos(radians), Math.sin(radians));
    },
  ],
  [
    "nonopposed responses",
    ([, row]) => {
      row.normal.set(0, 1, 0);
    },
  ],
];
for (const [name, mutate] of independentCases) {
  test(`${name} retains independent contact constraints`, () => {
    const rows = nearSeamPair();
    mutate(rows);
    assert.equal(conflictingWorldEncounter(...rows), false);
    assert.deepEqual(admitSampledWorldContacts(rows), rows);
    assert.deepEqual(mergeWorldContacts([rows[1]], [rows[0]]), [
      rows[1],
      rows[0],
    ]);
  });
}

// These are fixed geometric phases, not captured state. The first needs sampled
// admission; the remaining cases also expose reintroduction during chord merge.
const phases = [
  { name: "sampled encounter", rotation: -0.04, y: 0 },
  { name: "chord merge below seam", rotation: 0, y: -0.002 },
  { name: "chord merge with tilt", rotation: 0.02, y: -0.002 },
  { name: "chord merge above seam", rotation: 0.04, y: 0 },
];
for (const { name, ...phase } of phases) {
  test(`emitted 1.33-degree seam has bounded normal energy and impulse: ${name}`, () => {
    const fixture = makeShallowSeamFixture(phase);
    try {
      const { native, sampled, encounters } = collectShallowSeamRows(fixture);
      assert.ok(
        native.length > 0 && sampled.length > 0,
        "both real emitters must remain live",
      );
      const control = solveShallowSeamRows(fixture.body, native);
      assert.ok(
        control.largestImpulse > 1e-4,
        "native-only control must respond",
      );
      assert.ok(
        control.energyRatio <= 1.05,
        `native bias control: ${control.energyRatio}`,
      );
      const merged = mergeWorldContacts(native, sampled, encounters ?? sampled);
      assert.ok(merged.length > 0, "terrain response must not disappear");
      const result = solveShallowSeamRows(fixture.body, merged);
      assert.ok(
        result.impacts.every(
          (row) => Number.isFinite(row.normalImpulse) && row.normalImpulse >= 0,
        ),
        "normal multipliers must be finite and unilateral",
      );
      assert.ok(
        result.largestImpulse > 1e-4,
        "merged collision must still respond",
      );
      // The unchanged native .01 bias permits small positive work. This envelope
      // rejects the procedural 22–58x amplification without pinning solver pivots.
      assert.ok(
        result.energyRatio <= 1.05,
        `normal energy ratio ${result.energyRatio}; native ${control.energyRatio}`,
      );
      assert.ok(
        result.largestImpulse <= 10 * control.largestImpulse,
        `normal impulse ${result.largestImpulse}; native ${control.largestImpulse}`,
      );
    } finally {
      fixture.dispose();
    }
  });
}
