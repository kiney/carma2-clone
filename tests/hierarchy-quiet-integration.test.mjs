import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { originalCar } from "./support/original-car.mjs";
import { DamageSystem } from "../src/damage.ts";
import { createNonCarBody } from "../src/physics/noncar-body.ts";
import { parseNonCarMechanics } from "../src/noncars.ts";
import {
  createSimulatedCar,
  PHYSICS_STEP,
  VehicleSimulation,
} from "../src/physics/simulation.ts";

const emptyWorld = { raycast: () => null, querySurfaces: () => [] };
const near = (actual, expected, tolerance = 1e-7) =>
  assert.ok(
    actual.distanceTo(expected) < tolerance,
    `${actual.toArray()} != ${expected.toArray()}`,
  );

async function fixture(t, name, world = emptyWorld) {
  let source;
  try {
    source = await originalCar(name);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip("Local original car installation absent");
    return null;
  }
  const damage = new DamageSystem(source.assets, source.group, source.text);
  await damage.init();
  damage.damageContext.random = () => 0.5;
  const car = createSimulatedCar(
    source.group,
    source.text,
    damage,
    new Vector3(0, 20, 0),
    0,
    true,
    { immutableHulls: true },
  );
  const scene = new Group();
  scene.add(car.group);
  const sim = new VehicleSimulation(world, scene);
  sim.add(car);
  t.after(() => {
    sim.dispose();
    damage.repair();
    const geometry = new Set(),
      materials = new Set();
    scene.traverse((actor) => {
      if (!actor.isMesh) return;
      geometry.add(actor.geometry);
      for (const material of Array.isArray(actor.material)
        ? actor.material
        : [actor.material])
        materials.add(material);
    });
    for (const value of geometry) value.dispose();
    for (const value of materials) value.dispose();
  });
  return { sim, car, damage };
}

function sleepFixture(sim, bodies) {
  // Controlled ec fixture, not a claim that zero motion alone grants sleep.
  // Runtime retention supplies the original bounds, mass and COM providers.
  sim.retainHierarchyQuiet();
  for (const body of bodies) {
    body.state.velocity.set(0, 0, 0);
    body.state.angularVelocity.set(0, 0, 0);
    const state = sim.hierarchyQuiet.get(body);
    assert.ok(state);
    state.doNothing = true;
    state.quietState = 0;
    body.properties.immovable = true;
  }
}
function ordinaryPart(sim, car) {
  const runtime = car.damage.runtimeParts.find(
    (part) =>
      (part.state.type === 0 || part.state.type === 1) &&
      part.part.type === "detach" &&
      part.originalVertices.length >= 4,
  );
  assert.ok(runtime, "Original WAM requires an ordinary detachable part");
  // Controlled due reservation; actual production activation supplies geometry,
  // inherited motion and joint anchors without fabricating a preceding crash.
  runtime.state.queuedAt = sim.elapsed * 1000;
  sim.detachParts(car);
  const body = sim.debris.find((piece) => piece.actor === runtime.actor);
  assert.ok(body?.joint);
  return { body, runtime };
}

for (const name of ["EAGLE3", "cerby"]) {
  test(`${name} ec car without wheel support keeps pose but still evaluates controls; forced wake restores gravity`, async (t) => {
    const data = await fixture(t, name);
    if (!data) return;
    const { sim, car } = data;
    sim.step(); // Establish the ordinary WheelForces gravity packet.
    sleepFixture(sim, [car]);
    const position = car.state.position.clone();
    const hint = sim.hierarchyQuiet.get(car).gravityIncrement.clone();
    car.input.throttle = 1;
    sim.step();
    assert.ok(car.debug, "ec must not skip the car force/control callback");
    assert.equal(car.state.groundedWheelCount, 0);
    assert.equal(car.debug.gravityIncrement, undefined);
    assert.equal(sim.hierarchyQuiet.get(car).doNothing, true);
    assert.equal(car.properties.immovable, true);
    near(car.state.position, position);
    assert.equal(car.state.velocity.lengthSq(), 0);
    near(sim.hierarchyQuiet.get(car).gravityIncrement, hint);
    assert.ok(Number.isFinite(car.state.rpm));
    assert.equal(
      sim.isCarPhysicsActive(car),
      true,
      "PHIL participation must remain independent of ec",
    );
    sim.reset(car);
    sim.step();
    assert.equal(sim.hierarchyQuiet.get(car).doNothing, false);
    assert.ok(car.state.velocity.y < -0.05);
    assert.equal(
      car.debug.gravityIncrement.y,
      Math.fround((-10 * PHYSICS_STEP) / 6.9),
    );
  });

  test(`${name} actual wheel callback wakes a sleeping original part tree before gravity`, async (t) => {
    let support = false;
    const surface = {
      normal: new Vector3(0, 1, 0),
      material: "0",
      modifier: { tyreFriction: 1, wallFriction: 1, bumpiness: 0 },
    };
    // Isolate the installed wheel-support seam from world hull responses.
    const data = await fixture(t, name);
    if (!data) return;
    const { sim, car } = data;
    // Supply bounded hits at the wheel collector seam, preserving the real
    // WheelForces callbacks and avoiding invented original track geometry.
    sim.cachedWheelRaycast = (_car, origin, direction) =>
      support && direction.y < -0.5
        ? {
            point: origin.clone().addScaledVector(direction, 0.025),
            distance: 0.025,
            normal: surface.normal,
            friction: 1,
            surface,
          }
        : null;
    const { body, runtime } = ordinaryPart(sim, car);
    sim.step();
    sleepFixture(sim, [car, body]);
    support = true;
    sim.step();
    assert.ok(car.state.groundedWheelCount > 0);
    assert.ok(car.debug.gravityIncrement);
    for (const node of [car, body]) {
      assert.equal(sim.hierarchyQuiet.get(node).doNothing, false);
      assert.equal(node.properties.immovable, false);
      assert.equal(sim.hierarchyQuiet.get(node).inertiaScale, 1);
    }
    // The source release schedule may expire during the tick; repair ownership
    // remains original even if the physical joint has just been released.
    assert.equal(body.owner, car);
    if (body.joint)
      near(
        body.joint.childAnchor
          .clone()
          .applyQuaternion(body.state.orientation)
          .add(body.state.position),
        body.joint.parentAnchor
          .clone()
          .applyQuaternion(car.state.orientation)
          .add(car.state.position),
      );
    sim.repair(car);
    sim.step();
    assert.equal(runtime.state.phase, 0);
    assert.ok(!sim.debris.includes(body));
    assert.equal(sim.hierarchyQuiet.get(body), null);
  });

  test(`${name} released original part has independent ec lifetime and repair removes its owner`, async (t) => {
    const data = await fixture(t, name);
    if (!data) return;
    const { sim, car } = data;
    const { body, runtime } = ordinaryPart(sim, car);
    sim.step();
    sleepFixture(sim, [car, body]);
    // Native release result: ancestry ends; historical damage owner remains.
    runtime.state.phase = 2;
    body.joint = undefined;
    // Separate the freed piece from its old overlapping parent so this checks
    // ownership wake, rather than the independently tested geometry wake.
    body.state.position.x += 10;
    body.actor.position.copy(body.state.position);
    sim.reset(car);
    assert.equal(sim.hierarchyQuiet.get(car).doNothing, false);
    assert.equal(sim.hierarchyQuiet.get(body).doNothing, true);
    const old = body.state.position.clone();
    sim.step();
    near(body.state.position, old);
    sim.repair(car);
    sim.step();
    assert.equal(sim.hierarchyQuiet.get(body), null);
    assert.ok(!sim.debris.includes(body));
  });
}

test("original Eagle split and repair during retained-quiet preparation preserve physical moments", async (t) => {
  const data = await fixture(t, "EAGLE3");
  if (!data) return;
  const { sim, car, damage } = data;
  sim.retainHierarchyQuiet();
  const pristine = car.properties.inertia.clone();
  sim.hierarchyQuiet.get(car).quietState = 3;
  sim.hierarchyQuiet.prepare(car, new Vector3(0, -0.057971, 0));
  assert.equal(sim.hierarchyQuiet.get(car).inertiaScale, 50);
  const plane = damage.prepareSplitPlane(new Vector3(0, 0, 1), 0);
  assert.ok(plane);
  const child = sim.performSplit(car, plane);
  assert.ok(child && damage.splitRuntime);
  const physical = damage.splitRuntime.positive.inertia.clone();
  // Barrier retention/preparation is the same source-only seam used after a
  // response callback; no forces are applied twice to the new partition.
  sim.retainHierarchyQuiet();
  if (!sim.hierarchyQuiet.get(car).prepared)
    sim.hierarchyQuiet.prepare(car, new Vector3());
  sim.hierarchyQuiet.finish(car, { singleton: true, collisionFlags: 0 });
  near(car.properties.inertia, physical);
  assert.equal(sim.hierarchyQuiet.get(car).inertiaScale, 1);
  sim.hierarchyQuiet.get(car).quietState = 3;
  sim.hierarchyQuiet.prepare(car, new Vector3());
  sim.repair(car);
  sim.retainHierarchyQuiet();
  if (!sim.hierarchyQuiet.get(car).prepared)
    sim.hierarchyQuiet.prepare(car, new Vector3());
  sim.hierarchyQuiet.finish(car, { singleton: true, collisionFlags: 0 });
  near(car.properties.inertia, pristine);
  sim.step();
  assert.equal(sim.hierarchyQuiet.get(child), null);
  assert.ok(!sim.debris.includes(child));
});

test("grounded original car wakes an entire mixed generic/free-prop contact ring without a lambda", async (t) => {
  const world = {
    ...emptyWorld,
    setNonCarParticipation() {},
    addDynamic() {},
    removeDynamic() {},
  };
  const data = await fixture(t, "EAGLE3", world);
  if (!data) return;
  const { sim, car } = data;
  const { body } = ordinaryPart(sim, car);
  const actor = new Group();
  actor.name = "&07!0001.ACT";
  actor.position.set(10, 20, 0);
  actor.userData.noncarPulled = true;
  // Safe synthetic NONCARS mechanics supplies a separately owned free-prop
  // provider; the original WAM tree is the generic side of this mixed ring.
  const prop = createNonCarBody(
    actor,
    parseNonCarMechanics(
      "101\n7\n0,0,0\n0,0,0\n1\nbox\n-.1,-.1,-.1\n.1,.1,.1\n1,1\n.2,.2,.2\n0\n0\n0\nOBJECT_FRICTION\n0\nIGNORE_WORLD_COLLISIONS\nEND",
    ),
  );
  sim.addNonCar(prop);
  sim.step();
  const members = [car, body, prop];
  for (const member of members) {
    member.state.velocity.set(0, 0, 0);
    member.state.angularVelocity.set(0, 0, 0);
    const state =
      sim.hierarchyQuiet.get(member) ?? sim.nativeNonCarQuietState(member);
    assert.ok(state);
    state.quietState = 3;
  }
  assert.equal(sim.nativeQuietRingSleep(members), true);
  assert.equal(
    prop.motor.sleeping,
    false,
    "native ec must not become a motor pause",
  );
  // Supply an admitted geometry seam with no impulse calculation. Two ec1
  // endpoints join the ring without waking; wheel support then clears all ec.
  sim.preparePedContacts([
    {
      a: car,
      b: prop,
      point: car.state.position.clone(),
      normal: new Vector3(1, 0, 0),
      sourceType: 5,
    },
  ]);
  assert.equal(sim.hierarchyQuiet.get(car).doNothing, true);
  assert.equal(sim.nativeNonCarQuietState(prop).doNothing, true);
  assert.equal(sim.oilGround(car).awakeFromSupport(1), true);
  for (const member of members) {
    const state =
      sim.hierarchyQuiet.get(member) ?? sim.nativeNonCarQuietState(member);
    assert.equal(state.doNothing, false);
    assert.equal(state.quietState, 0);
    assert.equal(member.properties.immovable, false);
    assert.equal(
      member.state.velocity.lengthSq(),
      0,
      "geometry/support wake must not fabricate a lambda",
    );
    assert.equal(state.inertiaScale, 1);
  }
});

test("original WAM part introduced after force preparation inherits parent ec without another force pass", async (t) => {
  const data = await fixture(t, "cerby");
  if (!data) return;
  const { sim, car } = data;
  sleepFixture(sim, [car]);
  sim.hierarchyQuiet.prepareHierarchy(
    sim.allBodies(),
    sim.quietJoints(),
    () => new Vector3(0, -0.057971, 0),
  );
  const parentSnapshot = sim.hierarchyQuiet.get(car).beforeWorldV.clone();
  const { body } = ordinaryPart(sim, car);
  const inertia = body.properties.inertia.clone();
  sim.retainHierarchyQuiet();
  assert.equal(sim.hierarchyQuiet.get(body).prepared, false);
  sim.hierarchyQuiet.prepareNewHierarchy(
    sim.allBodies(),
    sim.quietJoints(),
    () => new Vector3(),
  );
  const childState = sim.hierarchyQuiet.get(body);
  assert.equal(childState.prepared, true);
  assert.equal(childState.doNothing, true);
  assert.equal(body.properties.immovable, true);
  near(childState.beforeWorldV, new Vector3());
  near(sim.hierarchyQuiet.get(car).beforeWorldV, parentSnapshot);
  near(body.properties.inertia, inertia);
  sim.finishHierarchyQuiet();
  const position = body.state.position.clone();
  sim.step();
  near(body.state.position, position);
  assert.equal(sim.hierarchyQuiet.get(body).inertiaScale, 1);
});

for (const name of ["porker2", "EAGLE3"])
  for (const initialVy of [0, -0.005])
    for (const kind of ["split", "ordinary part"])
      test(`${name} near-rest airborne ${kind === "split" ? "browser split startup correction" : "native ordinary-part initialization"} at vy=${initialVy} preserves motion and falls next tick`, async (t) => {
        const data = await fixture(t, name);
        if (!data) return;
        const { sim, car, damage } = data;
        const gravity = new Vector3(
          0,
          Math.fround((-10 * PHYSICS_STEP) / 6.9),
          0,
        );
        car.state.velocity.set(0, initialVy, 0);
        sim.retainHierarchyQuiet();
        sim.quietGravity.set(car, gravity);
        sim.hierarchyQuiet.prepareHierarchy(
          sim.allBodies(),
          sim.quietJoints(),
          () => gravity,
        );
        // Controlled creation during the response barrier, after this tick's
        // forces. The source helpers supply all original physical data; no
        // preceding crash/damage history or second gravity application is claimed.
        // Split G inheritance is an intentional browser correction, not native
        // conformance: fresh native pooled slots have G=0, and reused slots keep
        // old G. The browser bridges only this creation phase using the parent's
        // actual packet; native pooled-memory initialization is not reproduced.
        // Ordinary detached initialization433640 independently writes -.4/6.9.
        let child;
        if (kind === "split") {
          const plane = damage.prepareSplitPlane(new Vector3(0, 0, 1), 0);
          assert.ok(plane);
          child = sim.performSplit(car, plane);
          assert.ok(child && damage.splitRuntime);
        } else {
          child = ordinaryPart(sim, car).body;
        }
        const mass = child.properties.mass;
        const inertia = child.properties.inertia.clone();
        const com = child.properties.centerOfMass.clone();
        const oldPosition = child.state.position.clone();
        near(child.state.velocity, new Vector3(0, initialVy, 0));
        sim.retainHierarchyQuiet();
        sim.hierarchyQuiet.prepareNewHierarchy(
          sim.allBodies(),
          sim.quietJoints(),
          (body) =>
            sim.quietGravity.get(body) ??
            sim.hierarchyQuiet.get(body)?.gravityIncrement ??
            new Vector3(),
        );
        const state = sim.hierarchyQuiet.get(child);
        assert.ok(
          state.gravityIncrement.y < 0,
          kind === "split"
            ? "browser creation bridge must prevent repeated fresh-slot zero-G sleep"
            : "ordinary detached initializer must provide its native gravity packet",
        );
        assert.equal(state.gravityIncrement.x, 0);
        assert.equal(state.gravityIncrement.z, 0);
        if (kind === "ordinary part")
          assert.equal(state.gravityIncrement.y, Math.fround(-0.4 / 6.9));
        else near(state.gravityIncrement, gravity);
        near(child.state.velocity, new Vector3(0, initialVy, 0));
        sim.finishHierarchyQuiet();
        assert.equal(state.lastResult.quietEligible, false);
        assert.equal(state.lastResult.gate, "gravity-response");
        assert.equal(state.lastResult.gravityComparisonUnordered, false);
        assert.equal(state.doNothing, false);
        assert.equal(child.properties.immovable, false);
        assert.equal(child.properties.mass, mass);
        near(child.properties.inertia, inertia);
        near(child.properties.centerOfMass, com);
        near(child.state.velocity, new Vector3(0, initialVy, 0));
        sim.step();
        assert.equal(sim.hierarchyQuiet.get(child).doNothing, false);
        assert.ok(
          child.state.position.y < oldPosition.y - 0.0005,
          "airborne secondary/part must fall on its first ordinary force tick",
        );
        assert.ok(child.state.velocity.y < -0.03);
        // The first real free-force phase overwrites the creation bridge with
        // this body's own9.8 gravity packet, rather than retaining car gravity10.
        assert.equal(
          sim.hierarchyQuiet.get(child).gravityIncrement.y,
          Math.fround((-9.8 / 6.9) * PHYSICS_STEP),
        );
        assert.equal(child.properties.mass, mass);
        near(child.properties.inertia, inertia);
        near(child.properties.centerOfMass, com);
        assert.equal(sim.hierarchyQuiet.get(child).inertiaScale, 1);
      });
