import test from "node:test";
import assert from "node:assert/strict";
import { Group, Object3D, Quaternion, Vector3 } from "three";
import {
  createNativePedBody,
  activateNativePedBody,
  nativePedRootPose,
  pedBodyPairExcluded,
  prepareNativePedBody,
  finishNativePedBodyInitialization,
} from "../src/physics/ped-body.ts";
import {
  VehicleSimulation,
  createSimulatedCar,
} from "../src/physics/simulation.ts";
import { guardBodyTrajectories } from "../src/physics/pair-guard.ts";
import { resolveContacts } from "../src/physics/contact.ts";
import {
  nativePedBoxInertia,
  parsePedForm,
  parsePedRemap,
  parsePedPersonalitySimpleBody,
} from "../src/ped-form.ts";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { DamageSystem } from "../src/damage.ts";
import { originalCar } from "./support/original-car.mjs";
import { resolvePedContactDamage } from "../src/physics/ped-contact.ts";

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function profile(mass = Math.fround(0.068)) {
  const bounds = { min: [-0.02, -0.05, -0.02], max: [0.02, 0.05, 0.02] };
  return {
    mass,
    bounds,
    centreOfMass: [0, 0, 0],
    inertia: nativePedBoxInertia(mass, bounds),
    rootName: "root",
    formName: "safe-fixture",
    defaultMovesName: "safe-fixture",
    rootRemap: null,
    modelsByBone: new Map(),
    movement: new Map(),
  };
}
function body(position = [0, 0, 0], mass) {
  return createNativePedBody({
    actor: new Object3D(),
    profile: profile(mass),
    rootPose: [...identity.slice(0, 9), ...position],
    levelOut: 0,
  });
}
function world(surfaces = []) {
  return {
    raycast() {
      return null;
    },
    querySurfaces() {
      return surfaces;
    },
  };
}
function simulation(surfaces) {
  return new VehicleSimulation(world(surfaces), new Group());
}
const plane = {
  a: new Vector3(-10, 0, -10),
  b: new Vector3(-10, 0, 10),
  c: new Vector3(10, 0, -10),
  normal: new Vector3(0, 1, 0),
  material: "0",
  enabled: true,
  modifier: { tyreFriction: 1, wallFriction: 1, bumpiness: 0 },
};
function near(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
}

test("native root initialization, explicit activation and authored inertia exchange momentum", () => {
  const ped = body();
  assert.equal(ped.hitPoints, 100);
  assert.equal(ped.headerState, 1);
  assert.equal(ped.pedestrianFlags, 0);
  assert.equal(ped.rigidFlags, 0x78);
  ped.rigidFlags |= 0x80000000;
  const characterV = new Vector3(0.3, 0.1, -0.2);
  activateNativePedBody(ped, characterV);
  assert.deepEqual(
    ped.state.velocity.toArray(),
    characterV.toArray().map(Math.fround),
  );
  assert.deepEqual(ped.state.angularVelocity.toArray(), [0, 0, 0]);
  assert.equal(ped.suppressWorldFaces, false);
  assert.equal(ped.rigidFlags, 0x80000000);
  const other = body([0, 0, 0], 1);
  activateNativePedBody(other, new Vector3(1, 0, 0));
  ped.state.velocity.set(0, 0, 0);
  const totalBefore = other.properties.mass;
  resolveContacts([
    {
      a: ped,
      b: other,
      point: new Vector3(),
      normal: new Vector3(1, 0, 0),
      sourceType: 5,
    },
  ]);
  near(
    ped.state.velocity.x * ped.properties.mass + other.state.velocity.x,
    totalBefore,
  );
  assert.ok(ped.state.velocity.x > 0);
  assert.deepEqual(
    nativePedRootPose(ped).slice(9),
    new Float32Array([0, 0, 0]),
  );
});

test("shared FORM simple slot retains its object, BOX and policy until successful registration", () => {
  const ped = body(),
    box = ped.hulls[0],
    vertices = [...box.vertices],
    faces = [...box.faces],
    state = ped.state,
    inertia = ped.properties.inertia,
    com = ped.properties.centerOfMass,
    actor = new Object3D(),
    nextProfile = profile();
  nextProfile.bounds = { min: [-0.03, -0.04, -0.01], max: [0.03, 0.07, 0.01] };
  nextProfile.centreOfMass = [0, 0.02, 0];
  nextProfile.inertia = nativePedBoxInertia(
    nextProfile.mass,
    nextProfile.bounds,
  );
  ped.rigidFlags = 0x80000001;
  ped.properties.objectFriction = Math.fround(0.7);
  ped.filterA = 0x20000;
  ped.filterB = 0x40000;
  ped.state.velocity.set(5, 6, 7);
  ped.state.angularVelocity.set(2, 3, 4);
  prepareNativePedBody(ped, {
    actor,
    profile: nextProfile,
    rootPose: [...identity.slice(0, 9), 4, 5, 6],
    levelOut: 0.3,
  });
  assert.equal(ped.actor, actor);
  assert.equal(ped.hulls[0], box);
  assert.deepEqual(box.vertices, vertices);
  assert.deepEqual(box.faces, faces);
  vertices.forEach((v, i) => assert.equal(box.vertices[i], v));
  faces.forEach((v, i) => assert.equal(box.faces[i], v));
  assert.equal(ped.state, state);
  assert.equal(ped.properties.inertia, inertia);
  assert.equal(ped.properties.centerOfMass, com);
  assert.deepEqual(com.toArray(), nextProfile.centreOfMass);
  assert.deepEqual(inertia.toArray(), nextProfile.inertia);
  assert.deepEqual(ped.state.position.toArray(), [4, 5, 6]);
  assert.equal(ped.state.velocity.length(), 0);
  assert.equal(ped.state.angularVelocity.length(), 0);
  assert.equal(ped.rigidFlags, 0x80000001);
  assert.equal(ped.properties.objectFriction, Math.fround(0.7));
  assert.equal(ped.headerState, 0);
  assert.equal(
    ped.filterA,
    0x20000,
    "type2 fill is downstream of registration",
  );
  assert.throws(() => finishNativePedBodyInitialization(ped), /registration/);
  assert.equal(activateNativePedBody(ped, new Vector3()), false);
  ped.headerState = 1; // Actual host PHIL success boundary.
  finishNativePedBodyInitialization(ped);
  assert.equal(ped.rigidFlags, 0x80000079);
  assert.equal(ped.filterA, 0x10000);
  assert.equal(ped.filterB, 0x50000);
  assert.equal(ped.suppressWorldFaces, true);
  assert.equal(ped.collisionFlags, 0);
  assert.throws(
    () =>
      prepareNativePedBody(ped, {
        actor,
        profile: { ...nextProfile, formName: "another-FORM" },
        rootPose: identity,
        levelOut: 0,
      }),
    /across FORMs/,
  );
});

test("active PHIL body has exact40ms gravity, no header0 air drag, passive pose stays fixed", () => {
  const sim = simulation(),
    ped = body([0, 3, 0]),
    passive = body([1, 3, 0]);
  sim.addPedBody(ped);
  sim.addPedBody(passive);
  activateNativePedBody(ped, new Vector3(0.4, 0, 0));
  sim.step();
  near(ped.state.velocity.x, Math.fround(0.4), 1e-8);
  near(ped.gravityIncrement.y, Math.fround(-0.05681159420289855), 1e-9);
  near(ped.beforeWorldVelocity.y, ped.gravityIncrement.y, 1e-9);
  near(ped.state.position.y, 3 + ped.gravityIncrement.y * 0.04, 1e-8);
  assert.equal(passive.state.position.y, 3);
  assert.equal(passive.doNothing, true);
  sim.removePedBody(passive);
  assert.ok(!sim.pedBodies.includes(passive));
});

test("active world contacts populate source flags and quiet zeros before commit, halt once per outer frame", () => {
  const sim = simulation([plane]),
    ped = body([-0.1, 0.051, -0.1]);
  sim.addPedBody(ped);
  activateNativePedBody(ped, new Vector3());
  const seen = [];
  sim.update(0.04);
  assert.ok(sim.lastImpacts.some((i) => i.a === ped && i.solverAccepted));
  assert.ok(ped.collisionFlags & 1);
  ped.onHalt = (b, ms) => {
    seen.push([
      ms,
      b.state.velocity.length(),
      b.state.angularVelocity.length(),
      b.auxiliaryLocalOmega.length(),
      b.state.position.y,
    ]);
    return false;
  };
  const window = sim.updateFrame(40, 120);
  assert.equal(window.steps, 3);
  assert.equal(
    ped.collisionFlags,
    0,
    "final sleeping substep clears earlier world flags",
  );
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].slice(1, 4), [0, 0, 0]);
  assert.equal(ped.headerState, 2);
  assert.equal(ped.doNothing, false);
  // Accepted sleep restores passive registration and masks after physical pose.
  ped.onHalt = () => true;
  sim.update(0.04);
  assert.equal(ped.headerState, 1);
  assert.equal(ped.doNothing, true);
  assert.equal(ped.filterA, 0x10000);
  assert.equal(ped.suppressWorldFaces, true);
  assert.equal(ped.rigidFlags, 0x78);
});

test("exclusion masks reject shape contacts and both pair commit/refinement guards", () => {
  const sim = simulation(),
    a = body([-0.04, 2, 0]),
    b = body([0.04, 2, 0]);
  sim.gravityMultiplier = 0;
  activateNativePedBody(a, new Vector3(2, 0, 0));
  activateNativePedBody(b, new Vector3(-2, 0, 0));
  sim.addPedBody(a);
  sim.addPedBody(b);
  sim.step();
  assert.equal(sim.lastImpacts.length, 0);
  near(a.state.position.x, 0.04);
  near(b.state.position.x, -0.04);
  const paths = new Map([
    [
      a,
      (t) => ({
        position: new Vector3(-0.1 + 0.2 * t, 0, 0),
        orientation: new Quaternion(),
      }),
    ],
    [
      b,
      (t) => ({
        position: new Vector3(0.1 - 0.2 * t, 0, 0),
        orientation: new Quaternion(),
      }),
    ],
  ]);
  const fractions = guardBodyTrajectories(
    [a, b],
    paths,
    (x, y) => !pedBodyPairExcluded(x, y),
  );
  assert.equal(fractions.get(a), 1);
  assert.equal(fractions.get(b), 1);
});

async function originalProfile(t, name) {
  let store;
  try {
    store = await createAssetStore(
      new URL("../carma2_orig/", import.meta.url).pathname,
    );
  } catch (e) {
    if (e.code === "ENOENT") {
      t.skip("Original installation unavailable");
      return;
    }
    throw e;
  }
  const text = async (p) => decodeText(await store.read(p));
  const personality = await text(`data/PEDS/PEEPS/${name}/${name}.TXT`);
  const formName = personality
    .split(/\r?\n/)
    .map((l) => l.split("//")[0].trim())
    .find(Boolean);
  const form = parsePedForm(await text(`data/PEDS/FORMS/${formName}.TXT`));
  const remap = form.remapFilename
    ? parsePedRemap(await text(`data/PEDS/REMAPS/${form.remapFilename}`))
    : undefined;
  return parsePedPersonalitySimpleBody(personality, form, remap);
}
test("original human and dog authored mass and moments drive centered plane impulse", async (t) => {
  for (const [name, mass] of [
    ["blokebl", 0.06800000369548798],
    ["twolf", 0.04699999839067459],
  ]) {
    const p = await originalProfile(t, name);
    if (!p) return;
    const ped = createNativePedBody({
      actor: new Object3D(),
      profile: p,
      rootPose: identity,
      levelOut: 0,
    });
    assert.equal(ped.properties.mass, mass);
    assert.deepEqual(ped.properties.inertia.toArray(), p.inertia);
    activateNativePedBody(ped, new Vector3(0, -0.2, 0));
    const point = new Vector3(...p.centreOfMass);
    const [impact] = resolveContacts([
      { a: ped, point, normal: new Vector3(0, 1, 0), sourceType: 1 },
    ]);
    near(impact.normalImpulse, mass * (Math.fround(0.2) * 1.001 + 0.01), 1e-8);
    assert.deepEqual(ped.state.angularVelocity.toArray(), [0, 0, 0]);
  }
});

test("actual Eagle hull contact activates flag40-clear passive body BEFORE solver", async (t) => {
  let original;
  try {
    original = await originalCar("EAGLE3");
  } catch (e) {
    if (e.code === "ENOENT") {
      t.skip("Original installation unavailable");
      return;
    }
    throw e;
  }
  const damage = new DamageSystem(
    original.assets,
    original.group,
    original.text,
  );
  await damage.init();
  const sim = simulation();
  const car = createSimulatedCar(
    original.group,
    original.text,
    damage,
    new Vector3(0, 2, 0),
    0,
    true,
  );
  sim.add(car);
  t.after(() => sim.dispose());
  car.state.velocity.set(0, 0, -2);
  const ped = body([0, 2.13, -0.43]);
  ped.characterVelocity.set(0, 0, 0.1);
  const phases = [];
  ped.contactProvider = (b) => ({
    settings: {
      severDamage: 40,
      severChance: 0,
      maxSurvivableInitialImpact: 10,
      damagePerForce: 0,
    },
    form: {
      personalityMass: b.properties.mass,
      simpleBodyMass: b.properties.mass,
      boneCount: 1,
      nonHumanoid: false,
    },
    state: {
      hitPoints: b.hitPoints,
      flags: b.pedestrianFlags,
      immortal: false,
      exploding: false,
      brittle: false,
      goreLevel: 0,
      removedBoneMask: 0,
      headMissing: false,
    },
  });
  const damagePhases = [];
  ped.onContactDamage = (b, result, phase) =>
    damagePhases.push([phase, result]);
  ped.onActivated = (b) =>
    phases.push([
      b.headerState,
      b.pedestrianFlags,
      b.state.velocity.toArray(),
      b.state.angularVelocity.toArray(),
    ]);
  sim.addPedBody(ped);
  sim.step();
  assert.equal(phases.length, 1);
  assert.deepEqual(phases[0], [2, 0, [0, 0, Math.fround(0.1)], [0, 0, 0]]);
  assert.equal(ped.hitPoints, 100);
  assert.deepEqual(damagePhases[0], [
    "passive",
    { eligible: false, reason: "ped-flag40-clear" },
  ]);
  assert.ok(
    sim.lastImpacts.some(
      (i) =>
        (i.a === ped || i.b === ped) && i.solverAccepted && i.normalImpulse > 0,
    ),
  );
  assert.ok(ped.state.velocity.z < 0);
});

test("whole emitted pair ring sleeps together before movement; unknown external members block partial sleep", () => {
  const sim = simulation(),
    a = body([-0.019, 2, 0]),
    b = body([0.019, 2, 0]);
  sim.gravityMultiplier = 0;
  for (const ped of [a, b]) {
    activateNativePedBody(ped, new Vector3(ped === a ? 0.001 : -0.001, 0, 0));
    ped.filterA = 0x20000;
    ped.filterB = 0x40000;
    ped.properties.rotationLocked = true; // Isolate ring decision from angular response.
    sim.addPedBody(ped);
  }
  sim.step();
  assert.ok(sim.lastImpacts.some((row) => row.a === a && row.b === b));
  assert.equal(a.doNothing, true);
  assert.equal(b.doNothing, true);
  assert.equal(a.quietState, 0);
  assert.equal(b.quietState, 0);
  assert.equal(a.state.velocity.length(), 0);
  assert.equal(b.state.velocity.length(), 0);
  assert.equal(a.state.position.x, -0.019);
  assert.equal(b.state.position.x, 0.019);

  // The source ring joins emitted geometry even if lambda0 is not in the flag
  // queue. An external member without +1df cannot authorize partial ring sleep.
  activateNativePedBody(a, new Vector3());
  a.headerState = 2;
  a.doNothing = false;
  a.properties.immovable = false;
  sim.preparePedPhysics();
  const external = {
    state: {
      position: new Vector3(),
      orientation: new Quaternion(),
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
    },
    properties: {
      mass: 1,
      inertia: new Vector3(1, 1, 1),
      centerOfMass: new Vector3(),
      worldFriction: 1,
    },
  };
  sim.preparePedContacts([
    {
      a,
      b: external,
      point: new Vector3(),
      normal: new Vector3(1, 0, 0),
      sourceType: 5,
    },
  ]);
  sim.lastImpacts = [];
  sim.finishPedQuiet();
  assert.equal(a.doNothing, false);
  assert.ok(a.diagnostics.has("mixed-contact-ring-quiet-provider-unavailable"));
});

test("live simulation dispatches owner sever/HP tail before impulses and preserves passive caller continuation", () => {
  const sim = simulation(),
    ped = body(),
    other = body([0, 0, 0], 1),
    log = [];
  // Use the native car type for a deterministic contact packet, avoiding a
  // render sweep or arbitrary car-shaped trigger volume.
  other.rigidType = 1;
  other.kind = "fixture-car";
  activateNativePedBody(other, new Vector3(Math.sqrt(0.41), 0, 0));
  ped.pedestrianFlags = 0x40;
  ped.contactProvider = (b) => ({
    settings: {
      severDamage: 40,
      severChance: 10,
      maxSurvivableInitialImpact: 1,
      damagePerForce: 1000,
    },
    form: {
      personalityMass: b.properties.mass,
      simpleBodyMass: b.properties.mass,
      boneCount: 10,
      nonHumanoid: false,
    },
    state: {
      hitPoints: b.hitPoints,
      flags: b.pedestrianFlags,
      immortal: false,
      exploding: false,
      brittle: false,
      goreLevel: 2,
      removedBoneMask: 0,
      headMissing: false,
    },
    damageTail: (q) => {
      log.push(["tail", q.damage, q.aliveMove, q.deadMove]);
      assert.equal(ped.headerState, 2);
      assert.equal(ped.state.velocity.length(), 0);
      assert.equal(other.state.velocity.x, Math.fround(Math.sqrt(0.41)));
      // The owner has removed the actual head before the common HP tail.
      return {
        health: resolvePedContactDamage(
          q.damage,
          q.form,
          { ...q.state, removedBoneMask: 2, headMissing: true },
          q.aliveMove,
          q.deadMove,
        ),
        unresolved: [],
      };
    },
  });
  ped.onContactDamage = (b, result, phase) => {
    log.push([phase, result.hitPoints, result.reactionMoveId]);
    assert.equal(b.hitPoints, 0);
  };
  const rows = sim.preparePedContacts([
    {
      a: ped,
      b: other,
      point: new Vector3(),
      normal: new Vector3(1, 0, 0),
      sourceType: 5,
    },
  ]);
  assert.deepEqual(log, [
    ["tail", 40, 90, 91],
    ["passive", 0, 94],
  ]);
  assert.equal(ped.impactCount, 1);
  assert.equal(ped.filterA, 0x20000);
  assert.equal(ped.filterB, 0x40000);
  assert.equal(ped.diagnostics.size, 0);
  const momentum = other.properties.mass * other.state.velocity.x;
  resolveContacts(rows);
  near(
    ped.properties.mass * ped.state.velocity.x +
      other.properties.mass * other.state.velocity.x,
    momentum,
  );
  assert.ok(ped.state.velocity.x > 0);
  assert.equal(log.length, 2, "solver application must not replay the HP tail");
});
