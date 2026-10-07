import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parseCarMechanics } from "../src/mechanics.ts";

let originalAssetsAvailable = true;
try {
  await access(new URL("../carma2_orig", import.meta.url));
} catch {
  originalAssetsAvailable = false;
}

function syntheticMechanics({
  shape = "box",
  bounds = "-1,-2,-3\n1,2,3",
} = {}) {
  const shapeData =
    shape === "box"
      ? `${shape}\n${bounds}`
      : `${shape}\n4\n-1,0,-2\n1,0,-2\n1,1,2\n-1,1,2`;
  return `START OF MECHANICS STUFF version 1
0.5
1
1
4
155
5
normal
none
CAR.ACT
none
0,0.1,0
2
2,1,4
50
4
0
Front left
FL.ACT
-0.5,0.1,-1
1
0
0.02
1
0.8
80,81
1.5
0.05
1
Front right
FR.ACT
0.5,0.1,-1
1
0
0.02
1
0.8
80,81
1.5
0.05
2
Rear left
RL.ACT
-0.5,0.1,1
0
1
0.02
1
0.8
79,80
1.5
0.05
3
Rear right
RR.ACT
0.5,0.1,1
0
1
0.02
1
0.8
79,80
1.5
0.05
1
${shapeData}
0
END OF MECHANICS STUFF`;
}

test("parses version 1 mechanics, wheel flags, inertia, and box bounds", () => {
  const parsed = parseCarMechanics(syntheticMechanics());
  assert.equal(parsed.mechanicsVersion, 1);
  assert.equal(parsed.root.mass, 2);
  assert.deepEqual(parsed.root.inertiaDimensions, [2, 1, 4]);
  assert.deepEqual(parsed.root.inertia, [17 / 6, 10 / 3, 5 / 6]);
  assert.equal(parsed.wheels.length, 4);
  assert.equal(parsed.wheels[0].steerable, true);
  assert.equal(parsed.wheels[0].driven, false);
  assert.equal(parsed.wheels[2].steerable, false);
  assert.equal(parsed.wheels[2].driven, true);
  assert.deepEqual(parsed.shapes, [
    { kind: "box", bounds: { min: [-1, -2, -3], max: [1, 2, 3] } },
  ]);
});

test("preserves actor-resolved wheel position and polyhedron vertices", () => {
  const source = syntheticMechanics({ shape: "polyhedron" }).replace(
    "-0.5,0.1,-1\n1\n0",
    "0,0,0\n1\n0",
  );
  const parsed = parseCarMechanics(source);
  assert.deepEqual(parsed.wheels[0].position, [0, 0, 0]);
  assert.equal(parsed.wheels[0].positionFromActor, true);
  assert.deepEqual(parsed.shapes[0], {
    kind: "polyhedron",
    vertices: [
      [-1, 0, -2],
      [1, 0, -2],
      [1, 1, 2],
      [-1, 1, 2],
    ],
  });
});

test("rejects malformed or unbounded collision geometry", () => {
  assert.throws(
    () => parseCarMechanics(syntheticMechanics({ bounds: "-1,-2\n1,2,3" })),
    /expected three values for box minimum/,
  );
  assert.throws(
    () =>
      parseCarMechanics(
        syntheticMechanics({ shape: "polyhedron" }).replace(
          "polyhedron\n4\n",
          "polyhedron\n33\n",
        ),
      ),
    /bounded integer polyhedron vertex count/,
  );
  assert.throws(
    () =>
      parseCarMechanics(syntheticMechanics().replace("1\nbox\n", "129\nbox\n")),
    /bounded integer bounding shape count/,
  );
});

test(
  "reads three stock car mechanics blocks with distinct mass and geometry",
  { skip: !originalAssetsAvailable },
  async () => {
    const assets = await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
    const paths = [
      "data/CARS/EAGLE3/EAGLE3.TXT",
      "data/CARS/delorean/delorean.txt",
      "adv_data/CARS/69mach1/69mach1.txt",
    ];
    const parsed = [];
    for (const path of paths) {
      const bytes = await assets.read(path);
      assert.ok(bytes, `${path} should be available through the asset store`);
      parsed.push(parseCarMechanics(decodeText(bytes)));
    }
    assert.ok(parsed.every((car) => car.wheels.length === 4));
    assert.ok(new Set(parsed.map((car) => car.root.mass)).size > 1);
    const extents = parsed.map((car) => {
      const shape = car.shapes.find((item) => item.kind === "polyhedron");
      assert.ok(shape, "stock car has a polyhedron collision shape");
      const axes = [0, 1, 2].map((axis) => {
        const values = shape.vertices.map((vertex) => vertex[axis]);
        return Math.max(...values) - Math.min(...values);
      });
      return axes;
    });
    assert.ok(new Set(extents.map((size) => size.join(","))).size > 1);
  },
);
