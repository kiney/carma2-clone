import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import * as THREE from "three";
import { parseWorldGrooves, WorldGrooveRuntime } from "../src/world-groove.ts";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";

const authored = (
  pathMode = "harmonic",
  object = "rock",
  objectMode = "harmonic",
) => `START OF GROOVE
&PLAT.ACT
not a lollipop
constant
straight
${pathMode}
0,0,0
0.2
0,.75,0
${object}
${objectMode}
0.5
0,0,0
x
12
END OF GROOVE`;

test("source timed straight harmonic keeps the authored amplitude and period", () => {
  const parsed = parseWorldGrooves(authored());
  assert.equal(parsed.diagnostics.length, 0);
  assert.equal(parsed.grooves.length, 1);
  assert.equal(parsed.grooves[0].path.periodMs, 5000);
  const root = new THREE.Group(),
    actor = new THREE.Group();
  actor.name = "&PLAT.ACT";
  root.add(actor);
  const runtime = new WorldGrooveRuntime(root, authored());
  runtime.update(1250);
  assert.ok(Math.abs(actor.position.length() - 0.75) < 1e-6);
  runtime.update(3750);
  assert.ok(Math.abs(actor.position.length() - 0.75) < 1e-6);
});

test("native compacted ACT identifiers retain authored GROOVE binding", () => {
  const root = new THREE.Group(),
    actor = new THREE.Group();
  actor.name = "&07c0001.ACT";
  actor.userData.c2ActorName = "&PLAT.ACT";
  root.add(actor);
  const runtime = new WorldGrooveRuntime(root, authored());
  assert.equal(runtime.diagnostics.length, 0);
  assert.ok(runtime.actors.has(actor));
  runtime.update(1250);
  assert.ok(Math.abs(actor.position.length() - 0.75) < 1e-6);
});

test("continuous and linear waveforms follow MOVE_FUNK_PARAMETER endpoints", () => {
  const root = new THREE.Group(),
    actor = new THREE.Group();
  actor.name = "&PLAT.ACT";
  root.add(actor);
  let runtime = new WorldGrooveRuntime(
    root,
    authored("continuous", "spin", "continuous"),
  );
  runtime.update(1250);
  assert.ok(Math.abs(actor.position.length() - 0.1875) < 1e-6);
  actor.position.set(0, 0, 0);
  runtime = new WorldGrooveRuntime(root, authored("linear", "spin", "linear"));
  runtime.update(0);
  assert.ok(Math.abs(actor.position.y + 0.75) < 1e-6);
  runtime.update(2500);
  assert.ok(Math.abs(actor.position.y - 0.75) < 1e-6);
});

test("spin and rock rotate around their authored pivot while retaining actor hierarchy", () => {
  const root = new THREE.Group(),
    parent = new THREE.Group(),
    actor = new THREE.Group();
  actor.name = "&PLAT.ACT";
  actor.position.set(2, 0, 0);
  root.add(parent);
  parent.add(actor);
  const runtime = new WorldGrooveRuntime(
    root,
    authored("harmonic", "rock", "harmonic"),
  );
  assert.equal(runtime.actors.has(actor), true);
  runtime.update(500);
  assert.ok(Math.abs(actor.position.y) + Math.abs(actor.position.z) > 0.01);
  assert.equal(actor.parent, parent);
});

test("unknown enum values report only their block and do not discard other blocks", () => {
  const text = `START OF GROOVE\n${authored().split("START OF GROOVE\n")[1].split("END OF GROOVE")[0]}NEXT GROOVE\n&BAD.ACT\nnot a lollipop\nconstant\nstraight\nflash\nEND OF GROOVE`;
  const parsed = parseWorldGrooves(text);
  assert.equal(parsed.grooves.length, 1);
  assert.equal(parsed.diagnostics.length, 1);
  assert.match(parsed.diagnostics[0].message, /Unsupported timed mode/);
});

test("retained actors keep source-parent world pose and mesh names cannot shadow actor groups", () => {
  const source = new THREE.Group(),
    movingParent = new THREE.Group(),
    actor = new THREE.Group();
  movingParent.position.set(10, 2, -3);
  actor.name = "&PLAT.ACT";
  actor.position.set(1, 0, 0);
  source.add(movingParent);
  movingParent.add(actor);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial(),
  );
  mesh.name = "&PLAT.ACT";
  source.add(mesh);
  const pathOnly = `START OF GROOVE\n&PLAT.ACT\nnot a lollipop\nconstant\nstraight\nharmonic\n0,0,0\n0.2\n0,.75,0\nno object animation\nEND OF GROOVE`;
  const runtime = new WorldGrooveRuntime(source, pathOnly);
  const retainedRoot = new THREE.Group();
  retainedRoot.attach(actor);
  runtime.update(1250);
  const worldPose = actor.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(worldPose.x - 11) < 1e-6);
  assert.ok(Math.abs(worldPose.y - 2.75) < 1e-6);
  assert.equal(actor.parent, retainedRoot);
  assert.equal(runtime.grooves[0].actor, actor);
});

let stockAvailable = true;
try {
  await access(new URL("../carma2_orig", import.meta.url));
} catch {
  stockAvailable = false;
}
test(
  "all 51 stock track texts consume every GROOVE block with local diagnostics",
  { skip: !stockAvailable },
  async (t) => {
    const assets = await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
    const tracks = assets.manifest.filter((e) =>
      /^data\/RACES\/[^/]+\/[^/]+\.txt$/i.test(e.path),
    );
    assert.equal(tracks.length, 51);
    let blocks = 0,
      unsupported = 0;
    for (const entry of tracks) {
      const text = decodeText(await assets.read(entry.path));
      const parsed = parseWorldGrooves(text);
      const start = text.search(/^\s*START OF GROOVE\s*$/im);
      if (start < 0) continue;
      const section = text
        .slice(start)
        .replace(/^\s*START OF GROOVE\s*/i, "")
        .split(/^\s*END OF GROOVE\s*$/im)[0];
      const records = section
        .split(/\r?\n/)
        .map((line) => line.replace(/\/\/.*$/, "").trim())
        .filter((line) => line && line.toUpperCase() !== "NEXT GROOVE");
      const expected = records.length
        ? (section.match(/^\s*NEXT GROOVE\s*$/gim)?.length ?? 0) + 1
        : 0;
      assert.equal(
        parsed.grooves.length + parsed.diagnostics.length,
        expected,
        entry.path,
      );
      blocks += expected;
      unsupported += parsed.diagnostics.length;
    }
    assert.ok(blocks > 0);
    t.diagnostic(
      `Read-only stock tracks: ${blocks} GROOVE blocks; ${unsupported} unsupported blocks reported individually`,
    );
  },
);
