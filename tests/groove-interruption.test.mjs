import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import * as THREE from "three";
import { WorldGrooveRuntime, parseWorldGrooves } from "../src/world-groove.ts";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";

const block = ({
  actor = "&PLAT.ACT",
  delta = "4,0,0",
  centre = "0,0,0",
  object = false,
  path = true,
  mode = "linear",
} = {}) => `${actor}
not a lollipop
constant
${path ? `straight\n${mode}\n${centre}\n1\n${delta}` : "no path"}
${object ? "rock\nlinear\n1\n0,0,0\nz\n90" : "no object animation"}`;
function fixture(options = {}) {
  const root = new THREE.Group(),
    actor = new THREE.Group();
  actor.name = "&PLAT.ACT";
  root.add(actor);
  const runtime = new WorldGrooveRuntime(
    root,
    `START OF GROOVE\n${block(options)}\nEND OF GROOVE`,
  );
  return { root, actor, runtime, state: runtime.grooves[0] };
}
function frame(runtime, time, options) {
  runtime.beginFrame();
  runtime.finishFrame(time, options);
}
const close = (actual, expected, tolerance = 1e-7) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} != ${expected}`,
  );

test("collision rollback uses the older frame and equality cannot release less-than state", () => {
  const { actor, runtime, state } = fixture();
  frame(runtime, 250);
  frame(runtime, 375);
  close(actor.position.x, 2);
  runtime.beginFrame();
  assert.equal(runtime.stopActor(actor), true);
  assert.deepEqual(runtime.previousTimes, [375, 250]);
  close(actor.position.x, 0);
  assert.equal(state.pathInterrupt, 1);
  runtime.finishFrame(500);
  close(actor.position.x, 0);
  frame(runtime, 750);
  assert.equal(state.pathInterrupt, 1);
  frame(runtime, 751);
  assert.equal(state.pathInterrupt, 0);
  close(actor.position.x, Math.fround(-0.016));
});

test("greater-than state also uses strict crossing and interrupted callbacks retain first state", () => {
  const { actor, runtime, state } = fixture();
  frame(runtime, 750);
  frame(runtime, 875);
  runtime.beginFrame();
  runtime.stopActor(actor);
  assert.equal(state.pathInterrupt, 2);
  assert.equal(runtime.stopActor(actor), false);
  frame(runtime, 250);
  assert.equal(state.pathInterrupt, 2);
  frame(runtime, 251);
  assert.equal(state.pathInterrupt, 0);
  close(actor.position.x, Math.fround(0.016));
});

test("exact actor identity, first matching groove and both status guards", () => {
  const { root, actor } = fixture();
  const runtime = new WorldGrooveRuntime(
    root,
    `START OF GROOVE\n${block()}\nNEXT GROOVE\n${block({ object: true })}\nEND OF GROOVE`,
  );
  const impostor = new THREE.Group();
  impostor.name = actor.name;
  assert.equal(runtime.stopActor(impostor), false);
  runtime.grooves[0].objectInterrupt = 1;
  assert.equal(runtime.stopActor(actor), false);
  runtime.grooves[0].objectInterrupt = 0;
  assert.equal(runtime.stopActor(actor), true);
  assert.equal(runtime.grooves[0].doneThisFrame, true);
  assert.equal(runtime.grooves[1].doneThisFrame, false);
});

test("multi-axis native centre writes and shared resumption state follow X then Y then Z", () => {
  const { actor, runtime, state } = fixture({
    centre: "1,2,3",
    delta: "4,8,12",
  });
  frame(runtime, 250);
  frame(runtime, 375);
  assert.deepEqual(actor.position.toArray(), [1, 2, 9]);
  runtime.beginFrame();
  runtime.stopActor(actor);
  assert.deepEqual(actor.position.toArray(), [1, 2, 3]);
  assert.equal(state.pathResumption, 3);
  // X's accepted centre copy has already erased the former Z=9 before
  // Z compares its candidate, so the final status is greater-than.
  assert.equal(state.pathInterrupt, 2);
  frame(runtime, 250);
  assert.deepEqual(actor.position.toArray(), [1, 2, 3]);
  frame(runtime, 251);
  assert.deepEqual(actor.position.toArray(), [1, 2, Math.fround(3.048)]);
  assert.equal(state.pathInterrupt, 0);
});

test("rock retains its scalar, equality holds and replay cannot automatically release it", () => {
  const { actor, runtime, state } = fixture({ path: false, object: true });
  frame(runtime, 250);
  frame(runtime, 375);
  close(state.currentAngle, 45);
  runtime.beginFrame();
  runtime.stopActor(actor);
  assert.equal(state.objectInterrupt, 1);
  close(state.currentAngle, 0);
  frame(runtime, 750);
  assert.equal(state.objectInterrupt, 1);
  frame(runtime, 875, { actionReplay: true });
  close(state.currentAngle, 0);
  assert.equal(state.objectInterrupt, 1);
  frame(runtime, 875);
  close(state.currentAngle, -45);
  assert.equal(state.objectInterrupt, 0);
});

test("independent block bits retain the blocked path or object and enabling restores evaluation", () => {
  const { actor, runtime, state } = fixture({ object: true });
  frame(runtime, 250);
  runtime.disableActor(actor, 1);
  frame(runtime, 375);
  close(actor.position.x, 0);
  close(state.currentAngle, 45);
  runtime.disableActor(actor, 2);
  runtime.enableActor(actor, 1);
  frame(runtime, 500);
  close(actor.position.x, 4);
  close(state.currentAngle, 45);
  runtime.enableActor(actor, 2);
  frame(runtime, 750);
  close(state.currentAngle, 0);
});

test("visibility rejection marks the frame done before returning; paused replay preserves pose", () => {
  const { actor, runtime, state } = fixture();
  frame(runtime, 375);
  runtime.beginFrame();
  runtime.stopActor(actor, { isVisible: () => false });
  assert.equal(state.doneThisFrame, true);
  assert.equal(state.pathInterrupt, 0);
  runtime.finishFrame(500);
  close(actor.position.x, 2);
  frame(runtime, 500, { actionReplay: true, replayPaused: true });
  close(actor.position.x, 2);
});

test("raw unsigned history keeps low timestamp bits and wraps without a Float32 clock", () => {
  const { runtime } = fixture();
  frame(runtime, 0x01000001);
  frame(runtime, 0x100000003);
  assert.deepEqual(runtime.previousTimes, [3, 0x01000001]);
  runtime.update(123);
  assert.deepEqual(runtime.previousTimes, [3, 0x01000001]);
});

test("harmonic translation uses the native 16-bit angle rather than a smooth phase", () => {
  const { actor, runtime } = fixture({ mode: "harmonic" });
  runtime.update(1);
  const angle = Math.trunc((1 / 1000) * 65536) & 65535;
  const expected = Math.fround(4 * Math.sin((angle * Math.PI) / 32768));
  close(actor.position.x, expected);
  assert.ok(
    Math.abs(actor.position.x - 4 * Math.sin((2 * Math.PI) / 1000)) > 1e-5,
  );
});

test("object rotation offsets its pivot without rotating the authored straight-path displacement", () => {
  const { root, actor } = fixture();
  const text = `START OF GROOVE\n${block({ object: true }).replace("1\n0,0,0\nz\n90", "1\n1,0,0\nz\n90")}\nEND OF GROOVE`;
  const runtime = new WorldGrooveRuntime(root, text);
  runtime.update(375);
  close(actor.position.x, 3 - Math.SQRT1_2);
  close(actor.position.y, -Math.SQRT1_2);
});

test("spin rolls back and skips the frame without acquiring a permanent interrupt", () => {
  const { root, actor } = fixture();
  const text = `START OF GROOVE\n${block({ path: false, object: true }).replace("rock\nlinear", "spin\ncontinuous")}\nEND OF GROOVE`;
  const runtime = new WorldGrooveRuntime(root, text);
  frame(runtime, 250);
  frame(runtime, 500);
  runtime.beginFrame();
  runtime.stopActor(actor);
  runtime.finishFrame(750);
  const state = runtime.grooves[0];
  assert.equal(state.objectInterrupt, 0);
  close(actor.quaternion.z, Math.SQRT1_2);
  frame(runtime, 0);
  close(actor.quaternion.z, 0);
});

test("pose revision keeps culled stop callbacks native and publishes the later visible rollback", () => {
  const { actor, runtime, state } = fixture();
  frame(runtime, 250);
  frame(runtime, 375);
  const before = runtime.poseRevision;
  runtime.beginFrame();
  assert.equal(runtime.stopActor(actor, { isVisible: () => false }), true);
  assert.equal(runtime.stopActor(actor, { isVisible: () => false }), true);
  assert.equal(state.doneThisFrame, true);
  assert.equal(state.pathInterrupt, 0);
  assert.equal(runtime.poseRevision, before);
  assert.equal(runtime.stopActor(actor, { isVisible: () => true }), true);
  assert.equal(runtime.poseRevision, before + 1);
  close(actor.position.x, 0);
});

test("pose revision suppresses repeated same-clock spin publications without suppressing evaluation", () => {
  const { root, actor } = fixture();
  const runtime = new WorldGrooveRuntime(
    root,
    `START OF GROOVE\n${block({ path: false, object: true }).replace("rock\nlinear", "spin\ncontinuous")}\nEND OF GROOVE`,
  );
  frame(runtime, 250);
  frame(runtime, 500);
  const before = runtime.poseRevision;
  runtime.beginFrame();
  assert.equal(runtime.stopActor(actor), true);
  const rollback = runtime.poseRevision;
  assert.equal(rollback, before + 1);
  runtime.grooves[0].doneThisFrame = false;
  assert.equal(runtime.stopActor(actor), true);
  assert.equal(runtime.grooves[0].doneThisFrame, true);
  assert.equal(runtime.grooves[0].objectInterrupt, 0);
  assert.equal(runtime.poseRevision, rollback);
  runtime.finishFrame(750);
  assert.equal(runtime.poseRevision, rollback);
  frame(runtime, 1000);
  assert.equal(runtime.poseRevision, rollback + 1);
});

test("pose revision detects changed world pose from the source parent at the same clock", () => {
  const { root, actor, runtime } = fixture({ path: false });
  runtime.update(250);
  const before = runtime.poseRevision;
  root.position.set(10, 2, -3);
  runtime.update(250);
  assert.equal(runtime.poseRevision, before + 1);
  assert.deepEqual(
    actor.getWorldPosition(new THREE.Vector3()).toArray(),
    [10, 2, -3],
  );
  runtime.update(250);
  assert.equal(runtime.poseRevision, before + 1);
});

test("pose revision publishes an external actor move rolled back to the last GROOVE pose", () => {
  const { root, actor } = fixture();
  const runtime = new WorldGrooveRuntime(
    root,
    `START OF GROOVE\n${block({ path: false, object: true }).replace("rock\nlinear", "spin\ncontinuous")}\nEND OF GROOVE`,
  );
  frame(runtime, 250);
  frame(runtime, 500);
  runtime.beginFrame();
  assert.equal(runtime.stopActor(actor), true);
  actor.updateWorldMatrix(true, false);
  const groovePose = actor.matrixWorld.clone();
  const before = runtime.poseRevision;
  // A tracked external writer and collector may publish a different pose
  // between stops. Returning to the historical GROOVE pose still changes the
  // matrix observed by that immediately preceding collection.
  actor.position.set(7, 2, -3);
  actor.updateWorldMatrix(true, false);
  assert.notDeepEqual(actor.matrixWorld.elements, groovePose.elements);
  assert.equal(runtime.stopActor(actor), true);
  actor.updateWorldMatrix(true, false);
  assert.deepEqual(actor.matrixWorld.elements, groovePose.elements);
  assert.equal(runtime.poseRevision, before + 1);
  assert.equal(runtime.stopActor(actor), true);
  assert.equal(runtime.poseRevision, before + 1);
});

test("pose revision retains paused replay no-ops and conservatively publishes custom update outlets", () => {
  const { actor, runtime } = fixture();
  runtime.update(375);
  const before = runtime.poseRevision;
  runtime.update(500, { actionReplay: true, replayPaused: true });
  assert.equal(runtime.poseRevision, before);
  const updateMatrix = actor.updateMatrix;
  let updates = 0;
  actor.updateMatrix = function () {
    updates++;
    return updateMatrix.call(this);
  };
  runtime.update(500, { actionReplay: true, replayPaused: true });
  assert.ok(updates > 0);
  assert.equal(runtime.poseRevision, before + 1);
});

test("rollback retains source-parent scale and transforms after batching reparent", () => {
  const source = new THREE.Group(),
    parent = new THREE.Group(),
    actor = new THREE.Group();
  parent.position.set(10, 2, 3);
  parent.scale.setScalar(2);
  actor.name = "&PLAT.ACT";
  actor.position.x = 1;
  source.add(parent);
  parent.add(actor);
  const runtime = new WorldGrooveRuntime(
    source,
    `START OF GROOVE\n${block()}\nEND OF GROOVE`,
  );
  const batch = new THREE.Group();
  batch.attach(actor);
  frame(runtime, 250);
  frame(runtime, 375);
  runtime.beginFrame();
  runtime.stopActor(actor);
  close(actor.getWorldPosition(new THREE.Vector3()).x, 12);
  assert.deepEqual(
    actor.getWorldScale(new THREE.Vector3()).toArray(),
    [2, 2, 2],
  );
});

let originalAvailable = true;
try {
  await access(new URL("../carma2_orig/carma2_HW.exe", import.meta.url));
} catch {
  originalAvailable = false;
}
test(
  "installed Stock/Advanced authored rock/path records enter the same interruption state",
  { skip: !originalAvailable },
  async () => {
    const assets = await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
    for (const [path, pathActor, rockActor, angle] of [
      [
        "data/RACES/desert_mission/desert_mission.txt",
        "&bac0463.ACT",
        "&arm0463.ACT",
        20,
      ],
      [
        "adv_data/RACES/AcidReign/AcidReign.txt",
        "&CAR0032.ACT",
        "&CBO0032.ACT",
        90,
      ],
    ]) {
      const text = decodeText(await assets.read(path));
      const parsed = parseWorldGrooves(text);
      const rock = parsed.grooves.find((g) => g.actor === rockActor);
      const straight = parsed.grooves.find((g) => g.actor === pathActor);
      assert.equal(rock.object.type, "rock");
      assert.equal(rock.object.maxAngle, angle);
      assert.equal(straight.path.mode, "linear");
      assert.ok(straight.path.periodMs > 0);
      const root = new THREE.Group();
      for (const g of parsed.grooves) {
        const actor = new THREE.Group();
        actor.name = g.actor;
        root.add(actor);
      }
      const runtime = new WorldGrooveRuntime(root, text);
      frame(runtime, 1000);
      frame(runtime, 2000);
      runtime.beginFrame();
      const binding = runtime.grooves.find(
        (g) => g.definition.actor === straight.actor,
      );
      assert.equal(runtime.stopActor(binding.actor), true);
      const axis = ["x", "y", "z"].find(
        (axis) => straight.path.delta[axis] !== 0,
      );
      const expected = Math.fround(
        straight.path.centre[axis] +
          straight.path.delta[axis] * ((4 * 1000) / straight.path.periodMs - 1),
      );
      close(binding.actor.position[axis], expected);
      assert.equal(binding.pathInterrupt, 1);
    }
  },
);
