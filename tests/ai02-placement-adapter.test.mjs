import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import {
  NativeOpponentPlacement,
  nativeRematerializationSectionPose,
} from "../src/physics/opponent-placement.ts";
import { NativePathView } from "../src/ai/path-view.ts";

const section = (a = 0, b = 1) => ({
  nodeIndices: [a, b],
  width: 1,
  minSpeed: [0, 0],
  maxSpeed: [255, 255],
  type: 0,
  oneWay: false,
});
const pathView = (nodes, sections = [section()]) =>
  NativePathView.projected(nodes, sections, [{ section: 0, direction: 1 }]);

function fixture({
  place = () => 0,
  position = new Vector3(),
  orientation = new Quaternion(),
  nodes = [new Vector3(0, 0, 0), new Vector3(0, 0, 10)],
  onFallback = () => {},
  world = { raycast: () => null },
} = {}) {
  const events = [];
  let active = false;
  const damageMarker = { damaged: true };
  const car = {
    state: {
      position: position.clone(),
      orientation: orientation.clone(),
      velocity: new Vector3(3, 0, 0),
      angularVelocity: new Vector3(0, 2, 0),
      accForce: 17,
      brakeForce: 23,
      curvature: 4,
    },
    group: { visible: true },
    properties: { mass: 1200 },
    damageMarker,
  };
  const simulation = {
    isCarPhysicsActive: () => active,
    setCarPhysicsActive: (_car, value) => {
      active = value;
      events.push(["active", value]);
    },
    rematerializePose: (_car, p, q, v) => {
      car.state.position.copy(p);
      car.state.orientation.copy(q);
      car.state.velocity.copy(v);
      events.push(["reset", p.clone(), q.clone(), v.clone()]);
    },
    sync: () => {},
    testCarPlacement: () => {
      const result = place();
      events.push(["placement", result]);
      return result;
    },
    resetCarSpecialVolume: () => events.push(["volume"]),
  };
  return {
    car,
    events,
    nodes,
    damageMarker,
    active: () => active,
    placement: new NativeOpponentPlacement(
      simulation,
      world,
      nodes,
      [section()],
      onFallback,
    ),
  };
}

test("24 rejected attempts restore admitted pose and fall back once without volume reset", () => {
  let attempts = 0,
    fallbacks = 0;
  const savedPosition = new Vector3(2, 3, 4);
  const savedOrientation = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    0.7,
  );
  const f = fixture({
    place: () => {
      attempts++;
      return 0;
    },
    position: savedPosition,
    orientation: savedOrientation,
    onFallback: () => {
      fallbacks++;
      f.events.push(["fallback"]);
    },
  });
  const admitted = nativeRematerializationSectionPose(
    savedPosition,
    f.nodes[0],
    f.nodes[1],
  );
  const marker = f.car.damageMarker;
  assert.equal(f.placement.onSection(f.car, pathView(f.nodes), 0, 8), 1);
  assert.equal(attempts, 24);
  assert.equal(fallbacks, 1);
  assert.equal(
    f.events.filter(([kind]) => kind === "reset").length,
    24,
    "fallback restores ACT without repeating per-attempt cache reset",
  );
  assert.equal(f.events.filter(([kind]) => kind === "volume").length, 0);
  const firstReset = f.events.findIndex(([kind]) => kind === "reset");
  const activate = f.events.findIndex(
    ([kind, value]) => kind === "active" && value === true,
  );
  const deactivate = f.events.findIndex(
    ([kind, value]) => kind === "active" && value === false,
  );
  const fallback = f.events.findIndex(([kind]) => kind === "fallback");
  assert.ok(activate >= 0 && activate < firstReset);
  assert.ok(deactivate > firstReset && deactivate < fallback);
  assert.equal(f.events.at(-1)[0], "fallback");
  assert.deepEqual(f.car.state.position.toArray(), admitted.position.toArray());
  assert.ok(f.car.state.orientation.angleTo(admitted.orientation) < 1e-6);
  assert.equal(f.active(), false);
  assert.equal(f.car.group.visible, false);
  assert.equal(f.car.damageMarker, marker);
  assert.equal(f.car.damageMarker.damaged, true);
  assert.deepEqual([f.car.state.accForce, f.car.state.brakeForce], [0, 0]);
  assert.deepEqual(f.car.state.velocity.toArray(), [0, 0, 0]);
  assert.deepEqual(f.car.state.angularVelocity.toArray(), [0, 0, 0]);
});

test("success on attempt 24 resets special volume once and skips fallback", () => {
  let attempts = 0,
    fallbacks = 0;
  const f = fixture({
    place: () => (++attempts === 24 ? -1 : 0),
    onFallback: () => fallbacks++,
  });
  assert.equal(f.placement.onSection(f.car, pathView(f.nodes), 0, 8), 1);
  assert.equal(attempts, 24);
  assert.equal(f.events.filter(([kind]) => kind === "volume").length, 1);
  assert.equal(f.events.filter(([kind]) => kind === "fallback").length, 0);
  assert.equal(fallbacks, 0);
  assert.equal(f.active(), true);
  assert.equal(f.car.group.visible, true);
  assert.ok(
    f.events.findIndex(([kind, value]) => kind === "active" && value === true) <
      f.events.findIndex(([kind]) => kind === "reset"),
  );
  assert.equal(f.events.at(-1)[0], "volume");
});

test("zero-length onSection preserves incoming orientation before ground placement", () => {
  const zero = [new Vector3(4, 0, 2), new Vector3(4, 0, 2)];
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.4);
  let orientationAtFirstQuery;
  const world = {
    raycast: () => {
      orientationAtFirstQuery ??= f.car.state.orientation.clone();
      return null;
    },
  };
  const f = fixture({
    position: zero[0],
    orientation: q,
    nodes: zero,
    place: () => -1,
    world,
  });
  f.placement.onSection(f.car, pathView(zero), 0, 5);
  assert.ok(orientationAtFirstQuery.angleTo(q) < 1e-6);
});

test("nearest applies strict five-unit finish forces after exhausted fallback", () => {
  for (const [x, expectedBrake] of [
    [5, false],
    [5.01, true],
  ]) {
    let attempts = 0,
      fallback = 0;
    const nodes = [new Vector3(0, 0, 0), new Vector3(10, 0, 0)];
    const f = fixture({
      position: new Vector3(x, 0, 0),
      nodes,
      place: () => {
        attempts++;
        return 0;
      },
      onFallback: () => {
        fallback++;
        f.events.push(["fallback"]);
      },
    });
    for (const key of ["accForce", "brakeForce"]) {
      let value = f.car.state[key];
      Object.defineProperty(f.car.state, key, {
        configurable: true,
        get: () => value,
        set: (next) => {
          value = next;
          f.events.push(["force", key, next]);
        },
      });
    }
    assert.equal(f.placement.nearest(f.car, 4), 1);
    assert.equal(attempts, 24);
    assert.equal(fallback, 1);
    const fallbackIndex = f.events.findIndex(([kind]) => kind === "fallback");
    const nativeForceIndex = f.events.findIndex(
      ([kind, key, value]) =>
        kind === "force" &&
        ((key === "brakeForce" && value === 15 * f.car.properties.mass) ||
          (key === "accForce" && value === 0.5 * f.car.properties.mass)),
    );
    assert.ok(
      nativeForceIndex > fallbackIndex,
      "nearest wrapper applies its force after fallback",
    );
    assert.equal(
      f.car.state.brakeForce === 15 * f.car.properties.mass,
      expectedBrake,
    );
    assert.equal(
      f.car.state.accForce === 0.5 * f.car.properties.mass,
      !expectedBrake,
    );
  }
});
