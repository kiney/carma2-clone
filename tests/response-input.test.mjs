import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { CorrectionWorkingSet } from "../src/physics/correction-working-set.ts";
import { sealCollisionHulls } from "../src/physics/immutable-hulls.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const hulls = () => [buildBoxHull(v(-1, -1, -1), v(1, 1, 1))];
function body(certified = true) {
  return {
    kind: "noncar",
    hulls: certified ? sealCollisionHulls(hulls()) : hulls(),
    state: {
      position: v(),
      orientation: new Quaternion(),
      velocity: v(),
      angularVelocity: v(),
      predictedPosition: v(1),
      predictedOrientation: new Quaternion(),
    },
    properties: {
      mass: 2,
      inertia: v(2, 3, 4),
      centerOfMass: v(),
      worldFriction: 0.4,
      objectFriction: 0.4,
      immovable: true,
      rotationLocked: false,
    },
    mechanics: { ignoreWorldCollisions: false },
    filterA: 0,
    filterB: null,
    overlapRecovery: false,
    worldRecovery: false,
    suppressWorldFaces: false,
    suppressSelfSentinel: false,
    suppressJointConstraints: false,
  };
}
function watchedJoint(child) {
  const parent = body(),
    velocity = parent.state.velocity;
  let reads = 0;
  Object.defineProperty(parent.state, "velocity", {
    get() {
      reads++;
      return velocity;
    },
  });
  child.joint = {
    type: "ball",
    child,
    parent,
    childAnchor: v(),
    parentAnchor: v(),
    planeLimits: [],
  };
  return { parent, velocity, reads: () => reads };
}

test("certified fixed noncar hot certificates skip ignored joint ancestry until wake", () => {
  const b = body(),
    watched = watchedJoint(b),
    set = new CorrectionWorkingSet(),
    first = set.responseInput(b),
    initialReads = watched.reads();
  assert.ok(
    initialReads > 0,
    "first shortcut admission rebuilds the full certificate",
  );
  watched.velocity.x = 5;
  b.joint.parentAnchor.z = 3;
  b.joint.planeLimits.push({ childDirection: v(1), parentNormal: v(0, 1) });
  assert.equal(set.responseInput(b), first);
  assert.equal(set.responseInput(b), first);
  assert.equal(
    watched.reads(),
    initialReads,
    "hot checks do not walk ancestry",
  );
  // Derived collection output is not an input to physical response prediction.
  b.state.predictedPosition.set(2, 3, 4);
  b.state.predictedOrientation.set(0, 1, 0, 0);
  b.overlapDetected = b.worldOverlapDetected = true;
  assert.equal(set.responseInput(b), first);
  b.properties.immovable = false;
  const awake = set.responseInput(b);
  assert.notEqual(awake, first);
  assert.ok(watched.reads() > initialReads);
  watched.parent.state.angularVelocity.y = 2;
  const ancestorChange = set.responseInput(b);
  assert.notEqual(ancestorChange, awake);
  b.joint.planeLimits[0].childDirection.x = 0.5;
  assert.notEqual(set.responseInput(b), ancestorChange);
});

test("every certified fixed physical input invalidates and then stabilizes its token", () => {
  const cases = [];
  for (const field of ["position", "velocity", "angularVelocity"])
    for (const axis of ["x", "y", "z"])
      cases.push([`${field}.${axis}`, (b) => (b.state[field][axis] = 0.125)]);
  for (const axis of ["x", "y", "z", "w"])
    cases.push([
      `orientation.${axis}`,
      (b) => (b.state.orientation[axis] = 0.25),
    ]);
  for (const field of ["centerOfMass", "inertia"])
    for (const axis of ["x", "y", "z"])
      cases.push([
        `${field}.${axis}`,
        (b) => (b.properties[field][axis] += 0.25),
      ]);
  for (const field of ["velocity", "angularVelocity"])
    cases.push([
      `${field} identity`,
      (b) => (b.state[field] = b.state[field].clone()),
    ]);
  for (const field of ["centerOfMass", "inertia"])
    cases.push([
      `${field} identity`,
      (b) => (b.properties[field] = b.properties[field].clone()),
    ]);
  cases.push(
    ["state identity", (b) => (b.state = { ...b.state })],
    ["properties identity", (b) => (b.properties = { ...b.properties })],
    [
      "hull producer replacement",
      (b) => (b.hulls = sealCollisionHulls(hulls())),
    ],
    ["mass", (b) => (b.properties.mass = 3)],
    ["world friction", (b) => (b.properties.worldFriction = 0.2)],
    ["object friction", (b) => (b.properties.objectFriction = undefined)],
    ["rotation lock", (b) => (b.properties.rotationLocked = true)],
    ["filter A", (b) => (b.filterA = 1)],
    ["filter B", (b) => (b.filterB = 0)],
    ["prior overlap", (b) => (b.overlapRecovery = true)],
    ["prior world overlap", (b) => (b.worldRecovery = true)],
    ["world suppression", (b) => (b.suppressWorldFaces = true)],
    ["sentinel suppression", (b) => (b.suppressSelfSentinel = true)],
    ["joint suppression", (b) => (b.suppressJointConstraints = true)],
    ["mechanics identity", (b) => (b.mechanics = { ...b.mechanics })],
    ["world-ignore input", (b) => (b.mechanics.ignoreWorldCollisions = true)],
    ["kind", (b) => (b.kind = "custom")],
    ["wake", (b) => (b.properties.immovable = false)],
  );
  for (const [name, mutate] of cases) {
    const b = body(),
      set = new CorrectionWorkingSet(),
      first = set.responseInput(b);
    assert.equal(set.responseInput(b), first, name);
    mutate(b);
    const next = set.responseInput(b);
    assert.notEqual(next, first, name);
    assert.equal(set.responseInput(b), next, name);
  }
});

test("fixed response comparison preserves signed zero and stable NaN", () => {
  const b = body(),
    set = new CorrectionWorkingSet();
  let token = set.responseInput(b);
  b.state.velocity.x = -0;
  let next = set.responseInput(b);
  assert.notEqual(next, token);
  assert.equal(set.responseInput(b), next);
  token = next;
  b.state.position.y = -0;
  next = set.responseInput(b);
  assert.notEqual(next, token);
  token = next;
  b.properties.worldFriction = NaN;
  next = set.responseInput(b);
  assert.notEqual(next, token);
  assert.equal(set.responseInput(b), next);
  b.state.angularVelocity.z = NaN;
  const omegaNaN = set.responseInput(b);
  assert.notEqual(omegaNaN, next);
  assert.equal(set.responseInput(b), omegaNaN);
});

test("equal-valued P/Q replacement retains full-walker semantics across ticks", () => {
  const b = body(),
    set = new CorrectionWorkingSet(),
    first = set.responseInput(b);
  b.state.position = b.state.position.clone();
  b.state.orientation = b.state.orientation.clone();
  assert.equal(set.responseInput(b), first);
  assert.equal(set.createTick().responseInput(b), first);
});

test("mutable and merely frozen source arrays retain full geometry certification", () => {
  for (const frozen of [false, true]) {
    const b = body(false),
      set = new CorrectionWorkingSet();
    if (frozen) Object.freeze(b.hulls);
    const first = set.responseInput(b);
    b.hulls[0].vertices[0].x += 0.125;
    const edited = set.responseInput(b);
    assert.notEqual(edited, first);
    b.hulls[0].faces[0].constant += 0.125;
    assert.notEqual(set.responseInput(b), edited);
  }
});

test("analytic shape and custom bodies never use the fixed joint shortcut", () => {
  for (const mode of ["analytic", "custom", "mutable"]) {
    const b = body(mode !== "mutable");
    if (mode === "analytic") b.shape = { type: "BOX", center: [0, 0, 0] };
    if (mode === "custom") b.kind = "custom";
    const watched = watchedJoint(b),
      set = new CorrectionWorkingSet(),
      first = set.responseInput(b),
      reads = watched.reads();
    assert.equal(set.responseInput(b), first);
    assert.ok(watched.reads() > reads, mode);
    watched.velocity.z = 2;
    assert.notEqual(set.responseInput(b), first, mode);
  }
});

test("producer-to-mutable and analytic transitions revoke the fixed shortcut", () => {
  const b = body(),
    set = new CorrectionWorkingSet(),
    first = set.responseInput(b);
  b.hulls = hulls();
  const replaced = set.responseInput(b);
  assert.notEqual(replaced, first);
  b.hulls[0].vertices[0].z += 0.3;
  const edited = set.responseInput(b);
  assert.notEqual(edited, replaced);
  b.hulls = sealCollisionHulls(hulls());
  const resealed = set.responseInput(b);
  b.shape = { type: "BOX", center: [0, 0, 0] };
  const analytic = set.responseInput(b);
  assert.notEqual(analytic, resealed);
  b.shape.center[1] = 0.1;
  assert.notEqual(set.responseInput(b), analytic);
});

test("an explicitly supplied null shape retains its distinct full-certificate identity", () => {
  const b = body(),
    set = new CorrectionWorkingSet(),
    first = set.responseInput(b);
  b.shape = null;
  const explicitNull = set.responseInput(b);
  assert.notEqual(explicitNull, first);
  assert.equal(set.responseInput(b), explicitNull);
});
