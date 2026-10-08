import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parseNonCarMechanics, parseTrackNonCarFiles } from "../src/noncars.ts";

// Authored test data, not extracts of supplied game files.
function modern({
  version = 101,
  shapes = "1\nbox\n-1,0,-2\n1,2,2",
  keywords = "",
} = {}) {
  return `${version}\n7\n0,1,0\n0,0,0\n${shapes}\n2,5\n2,3,4\n15\n9\n1\nTEST.MAT\n${version === 101 ? `${keywords}\nEND` : ""}`;
}

test("noncar mechanics preserves source masses, centers, fracture and inertia inputs", () => {
  const parsed = parseNonCarMechanics(modern());
  assert.equal(parsed.version, 101);
  assert.equal(parsed.index, 7);
  assert.deepEqual(parsed.centerOfMass, [0, 1, 0]);
  assert.deepEqual(parsed.attachedCenterOfMass, [0, 0, 0]);
  assert.equal(parsed.freeMass, 2);
  assert.equal(parsed.attachedMass, 5);
  assert.deepEqual(parsed.inertiaDimensions, [2, 3, 4]);
  assert.deepEqual(parsed.inertiaPerMass, [25 / 12, 20 / 12, 13 / 12]);
  assert.equal(parsed.snapAngleDegrees, 15);
  assert.equal(parsed.minimumTorque, 9);
  assert.deepEqual(parsed.shrapnelMaterials, ["TEST.MAT"]);
  assert.equal(parsed.objectFriction, 0.4);
  assert.deepEqual(parsed.shapes, [
    { kind: "box", bounds: { min: [-1, 0, -2], max: [1, 2, 2] } },
  ]);
  assert.equal(parseNonCarMechanics(modern({ version: 100 })).version, 100);
});

test("legacy noncars read bounds and discarded extra points without a version or keywords", () => {
  const parsed = parseNonCarMechanics(
    `3\n0,0.5,0\n0,0,0\n-1,0,-1\n1,1,1\n2\n1,2,3\n4,5,6\n1,4\n2,1,2\n0\n0`,
  );
  assert.equal(parsed.version, null);
  assert.equal(parsed.index, 3);
  assert.deepEqual(parsed.extraPoints, [
    [1, 2, 3],
    [4, 5, 6],
  ]);
  assert.deepEqual(parsed.shapes[0].bounds, {
    min: [-1, 0, -1],
    max: [1, 1, 1],
  });
  assert.deepEqual(parsed.shrapnelMaterials, []);
  assert.equal(parsed.attachedMass, 4);
});

test("noncars read source sphere, wire frame and polyhedron shapes", () => {
  const data = `3\nsphere\n2\n0,1,0\nwire frame\n2\n0,0,0\n0,2,0\n1\n0,1\npolyhedron\n4\n0,0,0\n1,0,0\n0,1,0\n0,0,1`;
  const parsed = parseNonCarMechanics(modern({ shapes: data }));
  assert.deepEqual(parsed.shapes[0], {
    kind: "sphere",
    radius: 2,
    center: [0, 1, 0],
  });
  assert.deepEqual(parsed.shapes[1], {
    kind: "wire",
    vertices: [
      [0, 0, 0],
      [0, 2, 0],
    ],
    edges: [[0, 1]],
  });
  assert.equal(parsed.shapes[2].vertices.length, 4);
});

test("translation joints retain authored directions, g accelerations, resistance and pause", () => {
  const parsed = parseNonCarMechanics(
    modern({
      keywords: `WORLD_TRANSLATION_JOINT\n0,0,0\n0,-1,0\n3\n4\n2\n1.5\n0.5\n900\nRISE_WHEN_HIT\nRISE_WHEN_DRIVEN_ON\nNUMBER_OF_PUSHES\n8\nDRIVABLE_ON\nINFINITE_I\nIGNORE_WORLD_COLLISIONS\nBLOCK_CAMERA\nSPARKY\nWORLD_FRICTION\n1.3\nOBJECT_FRICTION\n1.7\nTUMBLE\n2\n0.1`,
    }),
  );
  assert.deepEqual(parsed.worldJoint, {
    kind: "translation",
    position: [0, 0, 0],
    axis: [0, -1, 0],
    travel: 3,
    forwardAcceleration: 4,
    reverseAcceleration: 2,
    forwardResistance: 1.5,
    reverseResistance: 0.5,
    pauseAtTop: 900,
  });
  assert.equal(parsed.numberOfPushes, 8);
  for (const flag of [
    "riseWhenHit",
    "riseWhenDrivenOn",
    "drivableOn",
    "infiniteInertia",
    "ignoreWorldCollisions",
    "blockCamera",
    "sparky",
  ])
    assert.equal(parsed[flag], true, flag);
  assert.equal(parsed.worldFrictionSource, 1.3);
  assert.equal(parsed.worldFriction, 1.3 - 1);
  assert.equal(parsed.objectFriction, 1.7 - 1);
  assert.deepEqual(parsed.tumble, { factor: 2, threshold: 0.1 });
});

test("explicit ball and hinge joints preserve all source fields and the last joint wins", () => {
  const keywords = `WORLD_BALL_JOINT\n1,2,3\n0.2\n2`;
  const ball = parseNonCarMechanics(modern({ keywords }));
  assert.deepEqual(ball.worldJoint, {
    kind: "ball",
    position: [1, 2, 3],
    friction: 0.2,
    limitCount: 2,
  });
  const hinge = parseNonCarMechanics(
    modern({
      keywords: `${keywords}\nWORLD_HINGE_JOINT\n4,5,6\n0,0,1\n0.3\n0`,
    }),
  );
  assert.deepEqual(hinge.worldJoint, {
    kind: "hinge",
    position: [4, 5, 6],
    axis: [0, 0, 1],
    friction: 0.3,
    limitCount: 0,
  });
});

test("noncar malformed inputs fail with source and line context", () => {
  const invalid = [
    [
      modern({ keywords: "UNKNOWN_COMMAND" }),
      /unknown keyword UNKNOWN_COMMAND/,
    ],
    [
      modern().replace("2,5", "NaN,5"),
      /numeric values for free and attached mass/,
    ],
    [modern().replace("2,5", "0,5"), /masses must be positive/],
    [modern().replace("2,3,4", "-1,3,4"), /negative inertia/],
    [modern().replace("101", "102"), /version or legacy index/],
    [modern().replace("END", ""), /incomplete keyword/],
    [modern() + "\nextra", /trailing data/],
    [modern({ version: 100, keywords: "" }) + "\nEND", /trailing data/],
    [modern({ shapes: "129" }), /shape count/],
    [modern({ shapes: "1\npolyhedron\n33" }), /polyhedron vertex count/],
    [modern({ shapes: "1\nbox\n2,0,0\n1,1,1" }), /inverted box/],
    [modern({ shapes: "1\nsphere\n-1\n0,0,0" }), /sphere radius/],
    [modern({ shapes: "1\nwire\n1\n0,0,0\n1\n0,1" }), /wire edge references/],
    [
      modern({ keywords: "WORLD_TRANSLATION_JOINT\n0,0,0\n0,0,0" }),
      /zero translation axis/,
    ],
    ["1".repeat(1_000_001), /size limit/],
    [modern().replace("0,1,0", "1e999,1,0"), /unbounded/],
  ];
  for (const [text, expected] of invalid) {
    assert.throws(
      () => parseNonCarMechanics(text, "test-definition"),
      (error) => {
        assert.match(error.message, /Noncar test-definition:.*line \d+/);
        assert.match(error.message, expected);
        return true;
      },
    );
  }
});

test("track noncar list ignores comments and bounds count and filenames", () => {
  assert.deepEqual(
    parseTrackNonCarFiles(
      `unrelated\n// Non CarObjects\n2\n07prop.txt // type\n//disabled.txt\n08lift.TXT\n3 // subsequent section`,
    ),
    ["07prop.txt", "08lift.TXT"],
  );
  assert.deepEqual(
    parseTrackNonCarFiles("0 // Non-Car Objects\nnext section"),
    [],
  );
  assert.deepEqual(parseTrackNonCarFiles("no marker here"), []);
  assert.throws(
    () => parseTrackNonCarFiles("// Non CarObjects\n41"),
    /type count/,
  );
  assert.throws(
    () => parseTrackNonCarFiles("// Non CarObjects\n1\n../prop.txt"),
    /filename/,
  );
  assert.throws(
    () => parseTrackNonCarFiles("// Non CarObjects\n1"),
    /incomplete/,
  );
});

let originalAssetsAvailable = true;
try {
  await access(new URL("../carma2_orig", import.meta.url));
} catch {
  originalAssetsAvailable = false;
}

test(
  "audits every available stock noncar definition and track type list read-only",
  { skip: !originalAssetsAvailable },
  async () => {
    const assets = await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
    const definitions = assets.manifest.filter((entry) =>
      /^data\/NONCARS\/[^/]+\.txt$/i.test(entry.path),
    );
    if (!definitions.length) return; // Installation may contain only alternative assets.
    const failures = [];
    let translations = 0,
      wires = 0;
    for (const entry of definitions) {
      const bytes = await assets.read(entry.path);
      assert.ok(bytes, entry.path);
      try {
        const parsed = parseNonCarMechanics(decodeText(bytes), entry.path);
        assert.ok(parsed.freeMass > 0, entry.path);
        if (parsed.worldJoint?.kind === "translation") translations++;
        if (parsed.shapes.some((shape) => shape.kind === "wire")) wires++;
      } catch (error) {
        // These supplied variants really exceed the original executable's 32-point
        // limit. Rejecting them is deliberate; don't silently truncate geometry.
        assert.match(entry.path, /\/79OILDRUM_0[123]\.txt$/i);
        assert.match(error.message, /polyhedron vertex count/);
        failures.push(entry.path);
      }
    }
    assert.ok(translations > 0, "stock translation joints were exercised");
    assert.ok(wires > 0, "stock wire frame spelling was exercised");
    assert.ok(failures.length <= 3);
    for (const entry of assets.manifest.filter((entry) =>
      /^data\/RACES\/[^/]+\/[^/]+\.txt$/i.test(entry.path),
    )) {
      const names = parseTrackNonCarFiles(
        decodeText(await assets.read(entry.path)),
        entry.path,
      );
      for (const name of names)
        assert.ok(
          await assets.read(`data/NONCARS/${name}`),
          `${entry.path}: ${name}`,
        );
    }
  },
);
