import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Quaternion, Vector3 } from "three";
import { NativeHierarchyQuiet } from "../src/physics/hierarchy-quiet.ts";

const bounds = () => new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
function body() {
  return {
    state: {
      position: new Vector3(),
      orientation: new Quaternion(),
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
    },
    properties: {
      mass: 1,
      inertia: new Vector3(2, 3, 4),
      centerOfMass: new Vector3(),
      worldFriction: 1,
    },
  };
}
function eligible(runtime, b, input = {}) {
  b.state.velocity.set(0, -0.04, 0);
  runtime.prepare(b, new Vector3(0, -0.04, 0));
  b.state.velocity.set(0, 0, 0);
  return runtime.finish(b, { collisionFlags: 1, singleton: true, ...input });
}
function close(actual, expected, tolerance = 1e-8) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) =>
    assert.ok(
      Math.abs(value - expected[i]) < tolerance,
      `${value} != ${expected[i]}`,
    ),
  );
}

test("gravity-response eligible leaf folds before complete sleep and never uses a timer", () => {
  const b = body(),
    runtime = new NativeHierarchyQuiet();
  const state = runtime.retain(b, bounds());
  assert.equal(eligible(runtime, b).quietEligible, true);
  assert.equal(state.ownState, 1);
  assert.equal(state.quietState, 1);
  assert.equal(state.doNothing, false);
  assert.equal(state.eligibleLeaves, 1);
  runtime.fold([b], []);
  assert.equal(state.quietState, 3);
  assert.equal(runtime.sleep([b], [b], []), true);
  assert.equal(state.doNothing, true);
  assert.equal(state.quietState, 0);
  assert.equal(state.sleepTransitions, 1);
  assert.equal(b.properties.immovable, true);
  assert.equal("timer" in state, false);
});

test("native planar part bounds accept zero extent and retain signed zero", () => {
  const b = body(),
    runtime = new NativeHierarchyQuiet();
  const state = runtime.retain(
    b,
    new Box3(new Vector3(-1, -0, -1), new Vector3(1, 0, 1)),
  );
  assert.equal(Object.is(state.bounds.min[1], -0), true);
  assert.equal(eligible(runtime, b).quietEligible, true);
  runtime.fold([b], []);
  assert.equal(runtime.sleep([b], [b], []), true);
  assert.throws(
    () =>
      runtime.retain(
        body(),
        new Box3(new Vector3(1, 0, 0), new Vector3(0, 1, 1)),
      ),
    /bounds/,
  );
});

test("world-joint upright gate uses OLD pose despite accepted candidate rotation", () => {
  const b = body(),
    runtime = new NativeHierarchyQuiet();
  runtime.retain(b, bounds());
  b.state.orientation.setFromAxisAngle(new Vector3(1, 0, 0), 0.1);
  b.state.velocity.set(0, -0.04, 0);
  runtime.prepare(b, new Vector3(0, -0.04, 0));
  b.state.orientation.identity();
  b.state.velocity.set(0, 0, 0);
  const result = runtime.finish(b, {
    collisionFlags: 0,
    singleton: true,
    hasJointInfo: true,
  });
  assert.equal(result.gate, "joint-without-contact");
  const c = body();
  runtime.retain(c, bounds());
  c.state.velocity.set(0, -0.04, 0);
  runtime.prepare(c, new Vector3(0, -0.04, 0));
  c.state.orientation.setFromAxisAngle(new Vector3(1, 0, 0), 1);
  c.state.velocity.set(0, 0, 0);
  assert.equal(
    runtime.finish(c, {
      collisionFlags: 0,
      singleton: true,
      hasJointInfo: true,
    }).quietEligible,
    true,
  );
});

test("ordinary child joint alone does not invent an upright gate", () => {
  const b = body(),
    runtime = new NativeHierarchyQuiet();
  runtime.retain(b, bounds());
  b.state.orientation.setFromAxisAngle(new Vector3(1, 0, 0), 0.1);
  assert.equal(eligible(runtime, b, { collisionFlags: 0 }).quietEligible, true);
});

test("postcommit local caches use the captured OLD orientation", () => {
  const b = body(),
    runtime = new NativeHierarchyQuiet();
  b.properties.inertia.set(1, 1, 1);
  b.state.orientation.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
  b.state.angularVelocity.set(0.001, 0.002, 0.003);
  const state = runtime.retain(b, bounds());
  runtime.prepare(b, new Vector3());
  close(state.beforeLocalOmega.toArray(), [0.002, -0.001, 0.003]);
  b.state.orientation.identity();
  b.state.velocity.set(0.01, 0, 0);
  const result = runtime.finish(b, { collisionFlags: 1, singleton: true });
  assert.equal(result.quietEligible, true);
  assert.ok(Math.abs(result.angularEnergy - 0.000056) < 1e-10);
  close(state.localVelocity.toArray(), [0, -0.01, 0]);
  close(b.state.angularVelocity.toArray(), [0, 0, 0]);
  close(b.state.velocity.toArray(), [0, 0, 0]);
});

test("retained quiet solver inertia is scaled once and restored before the test", () => {
  const b = body(),
    runtime = new NativeHierarchyQuiet();
  const state = runtime.retain(b, bounds());
  state.quietState = 3;
  runtime.prepare(b, new Vector3());
  assert.deepEqual(b.properties.inertia.toArray(), [100, 150, 200]);
  assert.throws(() => runtime.prepare(b, new Vector3()), /twice/);
  const result = runtime.finish(b, { collisionFlags: 0, singleton: false });
  assert.equal(result.quietEligible, true);
  assert.deepEqual(b.properties.inertia.toArray(), [2, 3, 4]);
  assert.equal(state.inertiaScale, 1);
});

test("a moving child blocks complete hierarchy sleep while eligible leaves may zero themselves", () => {
  const parent = body(),
    quietChild = body(),
    movingChild = body();
  const runtime = new NativeHierarchyQuiet();
  const roster = [parent, quietChild, movingChild];
  for (const b of roster) runtime.retain(b, bounds());
  eligible(runtime, parent);
  eligible(runtime, quietChild);
  movingChild.state.angularVelocity.set(20, 0, 0);
  runtime.prepare(movingChild, new Vector3());
  assert.equal(
    runtime.finish(movingChild, { collisionFlags: 1, singleton: true }).gate,
    "angular-energy",
  );
  const joints = [
    { parent, child: quietChild },
    { parent, child: movingChild },
  ];
  const folded = runtime.fold(roster, joints);
  assert.equal(folded.get(parent), 1);
  assert.equal(folded.get(quietChild), 3);
  assert.equal(runtime.sleep([parent], roster, joints), false);
  assert.ok(roster.every((b) => !runtime.get(b).doNothing));
  assert.equal(movingChild.state.angularVelocity.x, 20);
});

test("hierarchy sleep clears descendants and waking a child ascends the whole physical tree", () => {
  const parent = body(),
    child = body(),
    sibling = body();
  const roster = [parent, child, sibling],
    joints = [
      { parent, child },
      { parent, child: sibling },
    ];
  const invalidations = [];
  const runtime = new NativeHierarchyQuiet({
    onWake: (b) => invalidations.push(b),
  });
  for (const b of roster) {
    runtime.retain(b, bounds());
    eligible(runtime, b);
  }
  runtime.fold(roster, joints);
  assert.equal(runtime.sleep([child], roster, joints), true);
  for (const b of roster) {
    b.state.velocity.set(1, 2, 3);
    b.state.angularVelocity.set(4, 5, 6);
  }
  assert.deepEqual(runtime.wake(child, roster, joints), roster);
  assert.deepEqual(invalidations, roster);
  for (const b of roster) {
    assert.equal(runtime.get(b).doNothing, false);
    assert.equal(runtime.get(b).wakeTransitions, 1);
    assert.deepEqual(b.state.velocity.toArray(), [1, 2, 3]);
    assert.deepEqual(b.state.angularVelocity.toArray(), [4, 5, 6]);
  }
});

test("parent ec propagation precedes child preparation, and skipped quiet nodes have own state zero", () => {
  const parent = body(),
    child = body(),
    runtime = new NativeHierarchyQuiet();
  runtime.retain(parent, bounds(), true);
  const state = runtime.retain(child, bounds());
  state.quietState = 3;
  runtime.prepareHierarchy(
    [child, parent],
    [{ parent, child }],
    () => new Vector3(),
  );
  assert.equal(state.doNothing, true);
  assert.equal(state.inertiaScale, 1);
  const result = runtime.finish(child, { collisionFlags: 0, singleton: false });
  assert.equal(result.gate, "already-do-nothing");
  assert.equal(state.ownState, 0);
  assert.equal(state.quietState, 0);
  runtime.finish(parent, { collisionFlags: 0, singleton: false });
  runtime.fold([parent, child], [{ parent, child }]);
  assert.equal(runtime.get(parent).quietState, 0);
});

test("mixed external leaf owners interoperate, unknown participants block sleep atomically", () => {
  const car = body(),
    prop = body(),
    ped = body(),
    unknown = body();
  const external = new Map([
    [prop, { quietState: 3, doNothing: false }],
    [ped, { quietState: 3, doNothing: false }],
  ]);
  const transitions = [];
  const runtime = new NativeHierarchyQuiet({
    readExternalState: (b) => external.get(b) ?? null,
    setExternalDoNothing: (b, value) => {
      transitions.push([b, value]);
      external.get(b).doNothing = value;
    },
  });
  runtime.retain(car, bounds());
  eligible(runtime, car);
  runtime.fold([car, prop, ped, unknown], []);
  assert.equal(
    runtime.sleep([car, prop, ped, unknown], [car, prop, ped, unknown], []),
    false,
  );
  assert.equal(runtime.get(car).doNothing, false);
  assert.deepEqual(transitions, []);
  assert.equal(runtime.sleep([car, prop, ped], [car, prop, ped], []), true);
  assert.deepEqual(transitions, [
    [prop, true],
    [ped, true],
  ]);
  assert.equal(external.get(prop).quietState, 0);
  assert.equal(external.get(ped).quietState, 0);
});

test("contact wake preserves quiet byte while explicit force wake clears it", () => {
  const b = body(),
    runtime = new NativeHierarchyQuiet();
  const state = runtime.retain(b, bounds(), true);
  state.quietState = 3;
  state.ownState = 1;
  runtime.wake(b, [b], []);
  assert.equal(state.quietState, 3);
  runtime.wake(b, [b], [], { clearQuiet: true });
  assert.equal(state.quietState, 0);
  assert.equal(state.ownState, 0);
});

test("unknown child eligibility blocks sleep but never prevents waking its known parent", () => {
  const parent = body(),
    child = body(),
    grandchild = body();
  const events = [];
  const runtime = new NativeHierarchyQuiet({ onWake: (b) => events.push(b) });
  const state = runtime.retain(parent, bounds(), true);
  child.properties.immovable = grandchild.properties.immovable = true;
  child.quietState = 77;
  grandchild.quietState = 99;
  child.state.velocity.set(1, 2, 3);
  grandchild.state.angularVelocity.set(4, 5, 6);
  const roster = [parent, child, grandchild];
  const joints = [
    { parent, child },
    { parent: child, child: grandchild },
  ];
  assert.deepEqual(
    runtime.wake(parent, roster, joints, { clearQuiet: true }),
    roster,
  );
  assert.equal(state.doNothing, false);
  assert.ok(roster.every((b) => !b.properties.immovable));
  assert.deepEqual(events, roster);
  assert.equal(child.quietState, 77);
  assert.equal(grandchild.quietState, 99);
  assert.deepEqual(child.state.velocity.toArray(), [1, 2, 3]);
  assert.deepEqual(grandchild.state.angularVelocity.toArray(), [4, 5, 6]);
});

test("new hierarchy preparation preserves parent snapshots and does not scale moments twice", () => {
  const parent = body(),
    child = body(),
    sibling = body(),
    runtime = new NativeHierarchyQuiet();
  const parentState = runtime.retain(parent, bounds());
  parentState.quietState = 3;
  parent.state.velocity.set(1, 2, 3);
  runtime.prepare(parent, new Vector3(0, -0.04, 0));
  const oldQ = parentState.oldOrientation.toArray();
  parent.state.orientation.setFromAxisAngle(new Vector3(1, 0, 0), 0.5);
  parent.state.velocity.set(7, 8, 9);
  const childState = runtime.retain(child, bounds());
  const siblingState = runtime.retain(sibling, bounds());
  parentState.doNothing = true; // Current native ec after a response transition.
  const reads = [];
  runtime.prepareNewHierarchy(
    [child, sibling, parent],
    [
      { parent, child },
      { parent, child: sibling },
    ],
    (b) => {
      reads.push(b);
      return new Vector3();
    },
  );
  assert.deepEqual(reads, [child, sibling]);
  assert.deepEqual(parentState.beforeWorldV.toArray(), [1, 2, 3]);
  assert.deepEqual(parentState.oldOrientation.toArray(), oldQ);
  assert.deepEqual(parent.properties.inertia.toArray(), [100, 150, 200]);
  assert.equal(parentState.inertiaScale, 50);
  assert.equal(childState.doNothing, true);
  assert.equal(siblingState.doNothing, true);
  assert.equal(childState.prepared, true);
  assert.equal(siblingState.prepared, true);
  runtime.prepareNewHierarchy(
    [parent, child, sibling],
    [
      { parent, child },
      { parent, child: sibling },
    ],
    () => {
      throw new Error("already prepared nodes must not read force providers");
    },
  );
  runtime.clear();
  assert.deepEqual(parent.properties.inertia.toArray(), [2, 3, 4]);
});

test("cyclic hierarchy fails before mutation and disposing a prepared owner restores moments", () => {
  const a = body(),
    b = body(),
    runtime = new NativeHierarchyQuiet();
  runtime.retain(a, bounds());
  runtime.retain(b, bounds());
  assert.throws(
    () =>
      runtime.fold(
        [a, b],
        [
          { parent: a, child: b },
          { parent: b, child: a },
        ],
      ),
    /Cyclic/,
  );
  const state = runtime.get(a);
  state.quietState = 3;
  runtime.prepare(a, new Vector3());
  runtime.clear();
  assert.deepEqual(a.properties.inertia.toArray(), [2, 3, 4]);
  assert.equal(runtime.stateMap.size, 0);
});
