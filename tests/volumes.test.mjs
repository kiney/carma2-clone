import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { Box3, Quaternion, Vector3 } from "three";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import {
  parseTrackSpecialVolumes,
  parseDefaultWaterVolume,
  containsSpecialVolume,
  findSpecialVolume,
  projectWaterDepth,
  selectSpecialVolume,
  volumeMotionFactors,
  detectWaterPlane,
  NO_WATER_DISTANCE,
} from "../src/physics/volumes.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const parameters = (gravity = 1, viscosity = 1, material = 0) =>
  `${gravity}\n${viscosity}\n0.01\n0.002\n-1\n-1\nNONE\n5100\n5101\n2\n${material}`;
const rows = "2,0,0\n0,1,0\n0,0,3\n10,4,20";
function water() {
  return parseDefaultWaterVolume(
    `// Default underwater special volume parameters\n${parameters(0.2, 50, 10)}`,
  );
}
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test("volume parser consumes sound specs and preserves DEFAULT/NEW cursor differences", () => {
  const source = `// DEFAULT ENGINE NOISE\n3\n// SPECIAL EFFECTS VOLUMES\n4 // # special effects volumes\nDEFAULT WATER\n${parameters(0.2, 50, 10)}\nNEW IMPROVED!\n${rows}\n${parameters()}\nBOX\n${rows}\n${parameters()}\nSCATTERED\nRANDOM\n0.01,2\n15\n2\n5000\n5001\nPLANE\n0,1,0,7\n${parameters(-2, 4, 8)}\nSATURATED\nNONE\n99 // next unrelated track section`;
  const parsed = parseTrackSpecialVolumes(source);
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.defaultEngineNoiseIndex, 3);
  assert.equal(parsed.volumes.length, 4);
  assert.equal(parsed.defaultWater, parsed.volumes[0]);
  assert.equal(parsed.volumes[1].boundary.kind, "box");
  assert.equal(parsed.volumes[1].sound, undefined);
  assert.deepEqual(parsed.volumes[2].sound.periodMs, [10, 2000]);
  assert.deepEqual(parsed.volumes[2].sound.alternatives, [5000, 5001]);
  assert.equal(parsed.volumes[3].gravityMultiplier, 1);
  assert.equal(
    parseTrackSpecialVolumes(source, { allowNegativeGravity: true }).volumes[3]
      .gravityMultiplier,
    -2,
  );
});
test("comment-free volume block and explicit cursor consume DEFAULT without sound", () => {
  const text = `8\n2\nDEFAULT\n${parameters(0.5, 20)}\nNEW\n${rows}\n${parameters()}`;
  assert.equal(parseTrackSpecialVolumes(text).volumes.length, 2);
  assert.equal(
    parseTrackSpecialVolumes(text, { startLine: 1 }).defaultEngineNoiseIndex,
    8,
  );
  assert.equal(
    parseTrackSpecialVolumes("// SPECIAL EFFECTS VOLUMES\n0").volumes.length,
    0,
  );
});
test("malformed volumes report errors without manufacturing the missing volume", () => {
  const parsed = parseTrackSpecialVolumes(
    "// SPECIAL EFFECTS VOLUMES\n1\nBOX\n1,2,3",
  );
  assert.equal(parsed.volumes.length, 0);
  assert.match(parsed.diagnostics[0], /end/);
  assert.equal(parseDefaultWaterVolume("no general data"), null);
  assert.equal(
    parseDefaultWaterVolume(
      "// Default underwater special volume parameters\n0.2",
    ),
    null,
  );
});
test("oriented affine boxes and strict half spaces select first containing authored volume", () => {
  const parsed = parseTrackSpecialVolumes(
    `// SPECIAL EFFECTS VOLUMES\n3\nDEFAULT\n${parameters(0.2, 50)}\nNEW\n0,0,-2\n0,1,0\n3,0,0\n10,4,20\n${parameters()}\nPLANE\n0,1,0,8\n${parameters(0.4)}\nNONE`,
  );
  const box = parsed.volumes[1],
    plane = parsed.volumes[2];
  assert.equal(containsSpecialVolume(box, v(12.9, 4, 18.1)), true);
  assert.equal(containsSpecialVolume(box, v(13, 4, 20)), false);
  assert.equal(containsSpecialVolume(box, v(10, 5, 20)), false);
  assert.equal(containsSpecialVolume(plane, v(100, 7, 100)), true);
  assert.equal(containsSpecialVolume(plane, v(100, 8, 100)), false);
  assert.equal(findSpecialVolume(parsed.volumes, v(10, 4, 20)), box);
  assert.equal(findSpecialVolume(parsed.volumes, v(100, 7, 100)), plane);
});
test("water depth uses projected rotated body extent and native near-top tolerance", () => {
  const bounds = new Box3(v(-1, -0.5, -3), v(1, 0.5, 3));
  const plane = { normal: v(0, 1, 0), distance: 4 };
  assert.deepEqual(
    projectWaterDepth(bounds, v(0, 4, 0), new Quaternion(), plane),
    { minimum: 3.5, maximum: 4.5, depth: 0.5, submerged: true },
  );
  const rotate = new Quaternion().setFromAxisAngle(v(1, 0, 0), Math.PI / 2);
  const rotated = projectWaterDepth(bounds, v(0, 4, 0), rotate, plane);
  near(rotated.minimum, 1);
  near(rotated.maximum, 7);
  near(rotated.depth, 0.5);
  assert.equal(
    projectWaterDepth(bounds, v(0, 4.5, 0), new Quaternion(), plane).submerged,
    false,
  );
  assert.equal(
    projectWaterDepth(bounds, v(0, 3.5005, 0), new Quaternion(), plane).depth,
    1,
  );
});
test("automatic water precedence preserves native fully submerged exit sentinel", () => {
  const automatic = water(),
    neutral = { ...water(), gravityMultiplier: 1 };
  assert.equal(
    selectSpecialVolume(neutral, automatic, 0, 0.5).volume,
    automatic,
  );
  assert.equal(
    selectSpecialVolume(neutral, automatic, NO_WATER_DISTANCE, 0.5).automatic,
    null,
  );
  assert.equal(
    selectSpecialVolume(neutral, automatic, NO_WATER_DISTANCE, 1).volume,
    automatic,
  );
  const authored = { ...water(), gravityMultiplier: 0.5 };
  assert.equal(
    selectSpecialVolume(authored, automatic, 0, 0.5).volume,
    authored,
  );
});
test("native car gravity and drag depend differently on depth and underwater ability", () => {
  near(volumeMotionFactors(water(), 0.5).gravity, 0.6);
  near(volumeMotionFactors(water(), 0.5).drag, 25);
  near(volumeMotionFactors(water(), 0.5, true).gravity, 0.76);
  near(volumeMotionFactors(water(), 0.5, true).drag, 15);
  assert.equal(volumeMotionFactors(water()).materialModifierIndex, 10);
  assert.deepEqual(volumeMotionFactors(null), {
    gravity: 1,
    drag: 1,
    materialModifierIndex: 0,
  });
});
test("water detection consumes last pling face before slope check and points normal up", () => {
  const horizontal = { a: v(2, 4, 5), normal: v(0, -1, 0), material: "!pond" };
  const surface = detectWaterPlane([
    { ...horizontal, material: "#bridge" },
    horizontal,
  ]);
  assert.equal(surface.normal.y, 1);
  assert.equal(surface.distance, 4);
  assert.equal(detectWaterPlane([{ ...horizontal, material: "road" }]), null);
  assert.equal(
    detectWaterPlane([horizontal, { ...horizontal, normal: v(1, 0, 0) }]),
    null,
  );
});

test("all local stock and Advanced track volume blocks parse completely", async (t) => {
  const originalRoot = new URL("../carma2_orig/", import.meta.url);
  if (!existsSync(originalRoot)) {
    t.skip("Local original track archives are absent");
    return;
  }
  const assets = await createAssetStore(originalRoot.pathname);
  let stockCount = 0,
    advancedCount = 0;
  for (const { path } of assets.manifest) {
    if (!/^(?:data|adv_data)\/races\/.*\.txt$/i.test(path)) continue;
    const text = decodeText(await assets.read(path));
    if (!/special\s+effects\s+volumes/i.test(text)) continue;
    const parsed = parseTrackSpecialVolumes(text);
    assert.deepEqual(parsed.diagnostics, [], path);
    const count = text.match(
      /^\s*(\d+)\s*\/\/\s*#\s*special\s+effects\s+volumes/im,
    );
    assert.ok(count, `${path}: expected an authored volume count`);
    assert.equal(parsed.volumes.length, Number(count[1]), path);
    for (const volume of parsed.volumes) {
      assert.ok(Number.isFinite(volume.gravityMultiplier), path);
      assert.ok(Number.isFinite(volume.viscosityMultiplier), path);
    }
    if (/^data\//i.test(path)) stockCount++;
    else advancedCount++;
  }
  assert.equal(stockCount, 51);
  t.diagnostic(
    `Read-only original data: ${stockCount} stock and ${advancedCount} Advanced tracks`,
  );
  const general = parseDefaultWaterVolume(
    decodeText(await assets.read("data/general.txt")),
  );
  assert.equal(general.gravityMultiplier, 0.2);
  assert.equal(general.viscosityMultiplier, 50);
  assert.equal(general.carDamagePerMs, 0);
  assert.equal(general.pedDamagePerMs, 0.002);
});
