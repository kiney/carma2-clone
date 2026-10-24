import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CarAnimation } from "../src/animation.ts";
import { RenderWheelControls } from "../src/render-wheel-controls.ts";
import { parseCarMechanics } from "../src/mechanics.ts";
import { createMotionParameters } from "../src/physics/motion.ts";
import { originalCar } from "./support/original-car.mjs";

const near = (a, b, epsilon = 1e-10) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const matrixNear = (a, b) =>
  a.elements.forEach((value, i) => near(value, b.elements[i]));
const neutral = { speed: 2, steer: 0, brake: false, throttle: 0 };
const prefix =
  "2\n7\n8\n4,44\n3,-1\n6,-1\n5,-1\n-1,-1,2,1\n10,9,-1,-1\n0.14\n0.14\n";
const groove = (actor, path, reference = 7, kind = "rock", mode = "absolute") =>
  `${actor}\nnot a lollipop\nconstant\n${path === undefined ? "no path" : `straight\nabsolute\n0,0,0\n${path}\n0,1,0`}\n${kind}\n${mode}\n${reference}\n.2,.3,.4\n${kind === "rock" ? "y\n0" : "x"}`;
const config = (entries) =>
  `${prefix}START OF FUNK\nEND OF FUNK\nSTART OF GROOVE\n${entries.join("\nNEXT GROOVE\n")}\nEND OF GROOVE`;
function actorState(actor) {
  return {
    matrix: actor.matrix.toArray(),
    position: actor.position.toArray(),
    orientation: actor.quaternion.toArray(),
    scale: actor.scale.toArray(),
    autoUpdate: actor.matrixAutoUpdate,
  };
}
function animationState(animation) {
  return {
    elapsed: animation.elapsed,
    angles: animation.bindings.map((b) => b.angle),
    damageOffsets: [...animation.wheelDamageOffsets],
  };
}
function fixture() {
  const world = new THREE.Group(),
    root = new THREE.Group();
  world.position.set(7, -2, 3);
  world.rotation.set(0.2, -0.3, 0.1);
  root.position.set(2, 4, -6);
  root.rotation.set(-0.1, 0.4, 0.2);
  root.scale.set(1.2, 0.8, 1.1);
  world.add(root);
  const pivots = [0, 1, 2, 3, 4].map((i) => {
    const actor = new THREE.Group();
    actor.name = `pivot${i}`;
    actor.position.set(i * 0.2, 0.1, -0.3);
    actor.rotation.z = 0.17;
    root.add(actor);
    return actor;
  });
  const wheel = new THREE.Group();
  wheel.name = "wheel";
  wheel.position.set(0.4, 0.1, -0.2);
  pivots[0].add(wheel);
  const timed = new THREE.Group();
  timed.name = "timed";
  root.add(timed);
  const animation = new CarAnimation(
    root,
    config([
      ...[4, 3, 6, 5, 44].map((path, i) => groove(`pivot${i}`, path)),
      groove("wheel", undefined, 1, "spin", "controlled"),
      groove("timed", undefined, 2, "spin", "continuous"),
    ]),
  );
  assert.deepEqual(animation.warnings, []);
  const input = {
    ...neutral,
    wheelLengths: [0.1, 0.2, 0.3, 0.4],
    wheelRayHeights: [0.5, 0.6, 0.7, 0.8],
    steeringAngle: -0.2,
    componentDamage: Array.from({ length: 12 }, (_, i) => (i === 11 ? 40 : 0)),
  };
  animation.update(0.1, input);
  world.updateMatrixWorld(true);
  return { world, root, pivots, wheel, timed, animation, input };
}

test("temporary matrices use all four interpolated suspensions and sampled curvature under nested transforms", () => {
  const { world, root, pivots, animation, input } = fixture();
  const history = new RenderWheelControls();
  const body = {
    state: { wheelLengths: [...input.wheelLengths], curvature: -0.2 },
    poseEpoch: 0,
  };
  history.capture([body]);
  body.state.wheelLengths = [0.3, 0.5, 0.7, 0.9];
  body.state.curvature = 0.4;
  const wheelbase = 2.7;
  const gameplay = {
    ...input,
    wheelLengths: body.state.wheelLengths,
    steeringAngle: Math.atan(wheelbase * body.state.curvature),
  };
  animation.update(0.04, gameplay);
  const committed = animation.bindings.map((b) => actorState(b.object));
  const persistent = animationState(animation),
    physical = structuredClone(body);
  for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
    const pose = history.sample(body, alpha);
    const angle = Math.atan(wheelbase * (-0.2 + 0.6 * alpha));
    animation.applyPresentation({ ...input, ...pose, steeringAngle: angle });
    world.updateMatrixWorld(true);
    for (let i = 0; i < pivots.length; i++) {
      const actor = pivots[i],
        forceWheel = (i === 4 ? 0 : i) ^ 2;
      const sign = i === 4 ? -1 : 1;
      const old = [0.1, 0.2, 0.3, 0.4][forceWheel],
        current = [0.3, 0.5, 0.7, 0.9][forceWheel];
      const sampled = old + (current - old) * alpha;
      const base = animation.bindings[i].base;
      const expected = base
        .clone()
        .multiply(new THREE.Matrix4().makeTranslation(0.2, 0.3, 0.4))
        .multiply(new THREE.Matrix4().makeRotationY(angle))
        .multiply(new THREE.Matrix4().makeTranslation(-0.2, -0.3, -0.4));
      expected.elements[13] +=
        ((input.wheelRayHeights[forceWheel] - sampled) / 6.9) * sign;
      matrixNear(actor.matrix, expected);
      const expectedWorld = root.matrixWorld.clone().multiply(expected);
      matrixNear(actor.matrixWorld, expectedWorld);
    }
    assert.deepEqual(animationState(animation), persistent);
    assert.deepEqual(body, physical);
    animation.restorePresentation();
    world.updateMatrixWorld(true);
    assert.deepEqual(
      animation.bindings.map((b) => actorState(b.object)),
      committed,
    );
  }
});

test("extra render calls preserve spin, elapsed, timed actors and damage offsets; advancement still matches ordinary update", () => {
  const first = fixture(),
    second = fixture();
  const persistent = animationState(first.animation),
    timed = actorState(first.timed);
  assert.ok(persistent.damageOffsets[3] > 0);
  let savedPose;
  for (let i = 0; i < 10; i++) {
    first.animation.applyPresentation({
      ...first.input,
      steeringAngle: i * 0.03,
      wheelLengths: [0.8, 0.7, 0.6, 0.5],
    });
    assert.deepEqual(animationState(first.animation), persistent);
    assert.deepEqual(actorState(first.timed), timed);
    const snapshot = first.animation.presentationSnapshots.get(first.wheel);
    if (savedPose)
      assert.equal(
        snapshot,
        savedPose,
        "reuse saved matrix/PQS storage across RAFs",
      );
    savedPose = snapshot;
    first.animation.restorePresentation();
    assert.equal(first.animation.presented.size, 0);
  }
  first.animation.update(0.04, first.input);
  second.animation.update(0.04, second.input);
  assert.deepEqual(
    animationState(first.animation),
    animationState(second.animation),
  );
  assert.deepEqual(
    first.animation.bindings.map((b) => actorState(b.object)),
    second.animation.bindings.map((b) => actorState(b.object)),
  );
});

test("detached/reparented actors retain their new owner's pose, including detachment during a render", () => {
  const { world, wheel, animation, input } = fixture();
  const detached = new THREE.Group();
  world.add(detached);
  detached.attach(wheel);
  const before = actorState(wheel);
  animation.applyPresentation({ ...input, steeringAngle: 0.5 });
  assert.deepEqual(actorState(wheel), before);
  animation.restorePresentation();
  assert.deepEqual(actorState(wheel), before);
  const another = fixture();
  another.animation.applyPresentation({ ...another.input, steeringAngle: 0.8 });
  detached.attach(another.wheel);
  another.wheel.position.set(9, 8, 7);
  another.wheel.updateMatrix();
  const released = actorState(another.wheel);
  another.animation.restorePresentation();
  assert.deepEqual(actorState(another.wheel), released);
});

test("repeated application, reset and duplicate actor bindings restore the original committed matrix", () => {
  const f = fixture();
  const original = f.animation.bindings.map((b) => actorState(b.object));
  f.animation.applyPresentation({ ...f.input, steeringAngle: 0.4 });
  f.animation.applyPresentation({ ...f.input, steeringAngle: -0.6 });
  f.animation.restorePresentation();
  assert.deepEqual(
    f.animation.bindings.map((b) => actorState(b.object)),
    original,
  );
  f.animation.applyPresentation({ ...f.input, steeringAngle: 0.4 });
  f.animation.reset();
  assert.equal(f.animation.elapsed, 0);
  for (const b of f.animation.bindings)
    assert.deepEqual(b.object.matrix.elements, b.base.elements);
  const root = new THREE.Group(),
    actor = new THREE.Group();
  actor.name = "same";
  root.add(actor);
  const animation = new CarAnimation(
    root,
    config([groove("same", 4), groove("same", 3)]),
  );
  animation.update(0.1, f.input);
  const committed = actorState(actor);
  animation.applyPresentation({ ...f.input, steeringAngle: 0.7 });
  animation.restorePresentation();
  assert.deepEqual(actorState(actor), committed);
});

for (const name of ["EAGLE3", "buggy"])
  test(`${name} original GROOVEs present sampled controls with unchanged gameplay state and exact restoration`, async (t) => {
    let original;
    try {
      original = await originalCar(name);
    } catch (error) {
      if (error.code === "ENOENT") {
        t.skip("Local original car installation absent");
        return;
      }
      throw error;
    }
    const { group, text } = original;
    const motion = createMotionParameters(parseCarMechanics(text));
    const animation = new CarAnimation(group, text);
    assert.deepEqual(
      animation.warnings,
      name === "buggy"
        ? ["RL", "RR", "FL", "FR"].map(
            (side) =>
              `BBSUS${side}.DAT: Error: Unsupported object animation shear`,
          )
        : [],
      "existing unsupported shear links remain ANI-02 scope",
    );
    assert.equal(animation.wheelCount, 4);
    assert.equal(animation.steeringCount, 2);
    const parents = new THREE.Group();
    parents.position.set(3, -2, 8);
    parents.rotation.y = 0.6;
    parents.add(group);
    const wheelRayHeights = motion.wheelPositions.map((p) => p.y);
    const body = {
      state: {
        wheelLengths: wheelRayHeights.map((v) => v + 0.1),
        curvature: -motion.maxCurve * 0.4,
      },
      poseEpoch: 0,
      damage: { repairRevision: 0 },
    };
    const history = new RenderWheelControls();
    history.capture([body]);
    body.state.wheelLengths = wheelRayHeights.map((v, i) => v + 0.3 + i * 0.03);
    body.state.curvature = motion.maxCurve * 0.7;
    const wheelbase = motion.wheelPositions[0].z - motion.wheelPositions[2].z;
    const input = {
      ...neutral,
      wheelLengths: body.state.wheelLengths,
      wheelRayHeights,
      steeringAngle: Math.atan(wheelbase * body.state.curvature),
      componentDamage: Array(12).fill(0),
    };
    animation.update(0.04, input);
    const committed = animation.bindings.map((b) => actorState(b.object));
    const persistent = animationState(animation),
      physical = structuredClone(body);
    for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
      const sample = history.sample(body, alpha);
      animation.applyPresentation({
        ...input,
        ...sample,
        steeringAngle: Math.atan(wheelbase * sample.curvature),
      });
      parents.updateMatrixWorld(true);
      for (const binding of animation.bindings.filter(
        (b) => b.kind === "steering",
      )) {
        const angle = Math.atan(wheelbase * sample.curvature),
          pivot = binding.pivot;
        const expected = binding.base
          .clone()
          .multiply(
            new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z),
          )
          .multiply(new THREE.Matrix4().makeRotationY(angle))
          .multiply(
            new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z),
          );
        if (binding.suspension) {
          const wheel = binding.suspension.wheel ^ 2;
          const displacement =
            ((wheelRayHeights[wheel] - sample.wheelLengths[wheel]) / 6.9) *
            binding.suspension.sign;
          expected.elements[12] +=
            binding.groove.path.direction.x * displacement;
          expected.elements[13] +=
            binding.groove.path.direction.y * displacement;
          expected.elements[14] +=
            binding.groove.path.direction.z * displacement;
        }
        matrixNear(binding.object.matrix, expected);
      }
      assert.deepEqual(animationState(animation), persistent);
      assert.deepEqual(body, physical);
      animation.restorePresentation();
      assert.deepEqual(
        animation.bindings.map((b) => actorState(b.object)),
        committed,
      );
    }
    body.damage.repairRevision++;
    body.state.wheelLengths = [...wheelRayHeights];
    assert.deepEqual(history.sample(body, 0).wheelLengths, wheelRayHeights);
    animation.dispose();
  });
