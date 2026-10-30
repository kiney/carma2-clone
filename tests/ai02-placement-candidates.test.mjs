import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { buildWireHull } from "../src/physics/wire-hull.ts";
import {
  placementHullsOverlap,
  transformHull,
} from "../src/physics/geometry.ts";
import { DEFAULT_SURFACE } from "../src/physics/surfaces.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
function body(x = 0) {
  return {
    state: {
      position: v(x),
      orientation: new Quaternion(),
      velocity: v(),
      angularVelocity: v(),
    },
    properties: {
      mass: 1,
      inertia: v(1, 1, 1),
      centerOfMass: v(),
      worldFriction: 0,
    },
    hulls: [buildBoxHull(v(-0.1, -0.1, -0.1), v(0.1, 0.1, 0.1))],
  };
}
function fixture(t, collectFaces = () => []) {
  const world = { raycast: () => null, querySurfaces: () => [], collectFaces };
  const sim = new VehicleSimulation(world, new Group());
  t.after(() => {
    sim.debris.length = 0;
    sim.dispose();
  });
  return { sim, world, car: body() };
}
function register(sim, b) {
  assert.equal(sim.phil.registerImmediate(b), 0);
}
function face(x, material = "wall") {
  return {
    a: v(x, -2, -2),
    b: v(x, 2, -2),
    c: v(x, 0, 2),
    normal: v(-1),
    material,
    modifier: DEFAULT_SURFACE,
    enabled: true,
  };
}

test("placement uses the shared finite face ring including nonblocking material slots", (t) => {
  const capacities = [];
  const { sim, car } = fixture(t, (_query, maximum) => {
    capacities.push(maximum);
    return [face(0.05)];
  });
  assert.equal(sim.testCarPlacement(car), 0, "actual collector wall obstructs");
  assert.deepEqual(capacities, [300]);
  assert.equal(sim.worldFaceCache.count, 1);
  assert.equal(sim.testCarPlacement(car), 0);
  assert.deepEqual(
    capacities,
    [300],
    "same bounds reuse native retained faces",
  );
  sim.invalidateWorldFaceCache(car);
  assert.equal(sim.testCarPlacement(car), 0);
  assert.deepEqual(capacities, [300, 299]);
});

test("nonblocking faces consume the finite source budget before placement filtering", (t) => {
  const calls = [];
  const water = face(0.05, "!water");
  const wall = face(0.05);
  const { sim, car } = fixture(t, (_query, max) => {
    calls.push(max);
    return [...Array(300).fill(water), wall].slice(0, max);
  });
  assert.equal(
    sim.testCarPlacement(car),
    -1,
    "wall beyond the native300 prefix is not an unlimited query",
  );
  assert.deepEqual(
    calls,
    [300, 300],
    "exactly full ring repeats collection as original",
  );
  assert.equal(sim.worldFaceCache.count, 300);
});

test("placement tests passive registered noncar roots, masks and physics flag4", (t) => {
  const { sim, car } = fixture(t);
  const prop = body();
  register(sim, prop);
  assert.equal(sim.phil.getState(prop), 1);
  assert.equal(
    sim.testCarPlacement(car),
    0,
    "sleep/passive header is still occupied",
  );
  car.filterA = 1;
  prop.filterB = 1;
  assert.equal(sim.testCarPlacement(car), -1);
  car.filterA = 0;
  prop.filterB = 0;
  prop.rigidFlags = 4;
  assert.equal(sim.testCarPlacement(car), -1);
  prop.rigidFlags = 0;
  car.rigidFlags = 4;
  assert.equal(sim.testCarPlacement(car), -1);
  car.rigidFlags = 0;
  assert.equal(sim.testCarPlacement(car), 0);
  sim.phil.remove(prop);
  assert.equal(sim.testCarPlacement(car), -1);
});

test("placement acquires its current body roster after source world collection", (t) => {
  let calls = 0;
  let sim;
  const prop = body();
  const f = fixture(t, () => {
    calls++;
    register(sim, prop);
    return [];
  });
  sim = f.sim;
  assert.equal(
    sim.testCarPlacement(f.car),
    0,
    "body pulled during collection is checked in this attempt",
  );
  assert.equal(calls, 1);
});

test("parent exclusion and masked roots do not suppress eligible descendants", (t) => {
  const { sim, car } = fixture(t);
  const parent = body(5),
    child = body(),
    grandchild = body();
  register(sim, parent);
  child.joint = { parent };
  grandchild.joint = { parent: child };
  sim.debris.push(child, grandchild);
  car.joint = { parent };
  assert.equal(
    sim.testCarPlacement(car),
    0,
    "excluded direct parent still exposes descendants",
  );
  child.filterA = 1;
  car.filterB = 1;
  assert.equal(
    sim.testCarPlacement(car),
    0,
    "masked child does not prune grandchild",
  );
  grandchild.filterA = 1;
  assert.equal(sim.testCarPlacement(car), -1);
  car.filterB = 0;
  car.joint = { parent: child };
  sim.debris.splice(1, 1);
  assert.equal(
    sim.testCarPlacement(car),
    -1,
    "inverse direct parent is excluded",
  );
});

test("sensible place treats authored WIRE bounds as BOX without changing ordinary hulls", (t) => {
  const { sim, car } = fixture(t);
  const prop = body();
  const wire = buildWireHull([v(-0.2, -0.2, -0.2), v(0.2, 0.2, 0.2)], [[0, 1]]);
  prop.hulls = [wire];
  register(sim, prop);
  // A short diagonal never crosses this little box, but its source common bounds do.
  car.state.position.set(0.15, -0.15, 0.15);
  car.hulls = [buildBoxHull(v(-0.01, -0.01, -0.01), v(0.01, 0.01, 0.01))];
  assert.equal(sim.testCarPlacement(car), 0);
  assert.equal(prop.hulls[0], wire);
  assert.equal(wire.faces.length, 0);
});

test("sensible place uses native SPHERE common bounds rather than a sampled or analytic sphere", (t) => {
  const { sim, car } = fixture(t);
  const prop = body();
  prop.kind = "pedestrian-bone";
  prop.shape = {
    type: "SPHERE",
    bounds: { min: [-0.2, -0.2, -0.2], max: [0.2, 0.2, 0.2] },
    center: [0, 0, 0],
    radius: 0.2,
  };
  prop.hulls = [];
  register(sim, prop);
  car.state.position.set(0.18, 0.18, 0.18);
  car.hulls = [buildBoxHull(v(-0.01, -0.01, -0.01), v(0.01, 0.01, 0.01))];
  assert.ok(car.state.position.length() > 0.2);
  assert.equal(
    sim.testCarPlacement(car),
    0,
    "source box deliberately rejects the sphere corner gap",
  );
});

test("sensible query scope permits source scenery pulls and always unwinds after failure", (t) => {
  const { sim, car, world } = fixture(t);
  const actor = new Group();
  actor.name = "&01!0001";
  const prop = body();
  let admissions = 0;
  sim.noncarsByActor.set(actor, prop);
  sim.isNonCarPhysicsActive = () => false;
  sim.admitNonCar = () => {
    admissions++;
    return true;
  };
  world.collectFaces = (_q, _cap, _models, callbacks) => {
    callbacks.pullActorFromWorld(actor);
    throw new Error("controlled collector failure");
  };
  assert.throws(
    () => sim.testCarPlacement(car),
    /controlled collector failure/,
  );
  assert.equal(admissions, 1);
  assert.equal(
    sim.pullWorldActor(actor),
    null,
    "normal outside-physics query cannot acquire ownership after exception",
  );
  assert.equal(admissions, 1);
});

test("source car SPHERE and WIRE tags use common bounds even when moving hulls are polygons", (t) => {
  const { sim, car } = fixture(t);
  const prop = body();
  // A triangle-like wire has no relevant edge through the little query box.
  prop.hulls = [
    buildWireHull([v(-0.2, -0.2, -0.2), v(0.2, 0.2, 0.2)], [[0, 1]]),
  ];
  delete prop.hulls[0].nativeType; // Like the existing car mesh conversion.
  prop.mechanics = { shapes: [{ kind: "sphere" }] };
  register(sim, prop);
  car.state.position.set(0.15, -0.15, 0.15);
  car.hulls = [buildBoxHull(v(-0.01, -0.01, -0.01), v(0.01, 0.01, 0.01))];
  assert.equal(
    sim.testCarPlacement(car),
    0,
    "source sphere tag survives sampled polygon representation",
  );
  prop.mechanics.shapes[0].kind = "wire";
  assert.equal(sim.testCarPlacement(car), 0);
});

test("placement broadphase includes source stationary .0025 padding before local .005 tests", (t) => {
  const { sim, car } = fixture(t);
  const prop = body(0.201);
  register(sim, prop);
  assert.equal(
    sim.testCarPlacement(car),
    0,
    "one-millimetre native-unit gap is within source placement tolerance",
  );
  prop.state.position.x = 0.206;
  assert.equal(sim.testCarPlacement(car), -1, "gap outside .005 remains clear");
});

test("rotated target uses source physical AABB padding rather than local plane-expanded bounds", (t) => {
  const { sim, car } = fixture(t);
  const target = body();
  target.state.orientation.setFromAxisAngle(v(0, 1, 0), Math.PI / 4);
  register(sim, target);
  car.hulls = [
    buildBoxHull(v(-0.0001, -0.0001, -0.0001), v(0.0001, 0.0001, 0.0001)),
  ];
  car.state.position.set(Math.sqrt(2) * 0.1 + 0.006 + 0.0001, 0, 0);
  assert.equal(
    placementHullsOverlap(
      transformHull(car.hulls[0], car.state.position, car.state.orientation),
      transformHull(
        target.hulls[0],
        target.state.position,
        target.state.orientation,
      ),
    ),
    true,
    "local expanded planes alone include this rotated corner gap",
  );
  assert.equal(
    sim.testCarPlacement(car),
    -1,
    "native stationary physical bounds reject this candidate before local edge tests",
  );
});
