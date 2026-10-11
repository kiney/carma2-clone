import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Group, Quaternion, Vector3 } from "three";
import {
  classifyNativePedOther,
  describeNativePedAttributionOther,
} from "../src/physics/ped-other.ts";
import {
  passivePedContact,
  activePedContact,
} from "../src/physics/ped-contact.ts";
import { attributeNativePedContact } from "../src/ped-contact-attribution.ts";
import {
  createBallJoint,
  createTranslationJoint,
} from "../src/physics/joint.ts";
import { createNativePedBody } from "../src/physics/ped-body.ts";
import { createNonCarBody } from "../src/physics/noncar-body.ts";
import { createMineBody } from "../src/physics/mine-body.ts";
import {
  MineRuntime,
  mineParameters,
  parseMineMass,
} from "../src/physics/mines.ts";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { WorldCollision } from "../src/world.ts";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText, parseAct, parseDat } from "../src/formats.ts";
import { parseNonCarMechanics } from "../src/noncars.ts";
import { originalCar } from "./support/original-car.mjs";

const f = Math.fround;
function body(extra = {}) {
  return {
    state: {
      position: new Vector3(),
      orientation: new Quaternion(),
      velocity: new Vector3(0.2, -0.3, 0.4),
      angularVelocity: new Vector3(),
    },
    properties: {
      mass: 2,
      inertia: new Vector3(1, 1, 1),
      centerOfMass: new Vector3(),
      worldFriction: 0,
    },
    ...extra,
  };
}
const contactPacket = (other) => ({
  settings: {
    severDamage: 40,
    severChance: 10,
    maxSurvivableInitialImpact: 8,
    damagePerForce: 250,
  },
  form: {
    personalityMass: 0.068,
    simpleBodyMass: 0.068,
    boneCount: 10,
    nonHumanoid: false,
  },
  state: {
    hitPoints: 100,
    flags: 0x40,
    immortal: false,
    exploding: false,
    brittle: false,
    goreLevel: 0,
    removedBoneMask: 0,
    headMissing: false,
  },
  other,
  characterVelocity: new Vector3(),
  pedRigidType: 2,
  impactCount: 0,
});

test("cars, independent parts and pulled noncars share type1 and retain wrapper identity", () => {
  const car = body({ damage: {}, group: new Group() }),
    prop = body({ kind: "noncar", actor: new Group() }),
    free = body({ owner: car, part: 4 }),
    split = body({ owner: car, part: -1 });
  for (const other of [car, prop, free, split]) {
    const classified = classifyNativePedOther(other);
    assert.equal(classified.type, 1);
    assert.equal(classified.ownerPresent, true);
    assert.equal(classified.mass, 2);
    assert.deepEqual(classified.velocity, { x: f(0.2), y: f(-0.3), z: f(0.4) });
    const descriptor = describeNativePedAttributionOther(other, {});
    assert.equal(descriptor.typeByte, 1);
    assert.equal(descriptor.owner, other);
    assert.equal(descriptor.parentPresent, false);
    if (other !== car) assert.notEqual(descriptor.owner, car);
  }
});

test("only the actual detached child joint supplies parent presence; repair and world anchors do not", () => {
  const car = body({ damage: {} }),
    child = body({ owner: car, part: 4 });
  child.joint = createBallJoint(child, car, new Vector3(), new Vector3());
  assert.equal(
    describeNativePedAttributionOther(child, {}).parentPresent,
    true,
  );
  child.joint.child = body();
  assert.equal(
    describeNativePedAttributionOther(child, {}).parentPresent,
    false,
  );
  child.joint.child = child;
  child.joint.parent = child;
  assert.equal(
    describeNativePedAttributionOther(child, {}).parentPresent,
    false,
  );
  const prop = body({ kind: "noncar" });
  prop.joint = createTranslationJoint(
    prop,
    body(),
    new Vector3(),
    new Vector3(),
    new Vector3(0, 1, 0),
    3,
  );
  assert.equal(
    describeNativePedAttributionOther(prop, {}).parentPresent,
    false,
  );
  delete child.joint;
  assert.equal(
    describeNativePedAttributionOther(child, {}).parentPresent,
    false,
  );
});

test("native simple body uses actual owner/cache links and clears ownership after release", () => {
  const ped = createNativePedBody({
    actor: new Group(),
    levelOut: 0.3,
    rootPose: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    profile: {
      formName: "test",
      mass: 0.068,
      bounds: { min: [-0.1, -0.1, -0.1], max: [0.1, 0.1, 0.1] },
      centreOfMass: [0, 0, 0],
      inertia: [0.001, 0.001, 0.001],
    },
  });
  assert.equal(classifyNativePedOther(ped).type, 2);
  assert.equal(classifyNativePedOther(ped).ownerPresent, false);
  const owner = {},
    killer = {},
    cache = { killer };
  ped.owner = owner;
  let reads = 0;
  const providers = {
    readCharacterCache: (pointer, actual) => {
      reads++;
      assert.equal(pointer, owner);
      assert.equal(actual, ped);
      return cache;
    },
  };
  assert.equal(classifyNativePedOther(ped).ownerPresent, true);
  assert.equal(
    describeNativePedAttributionOther(ped, providers).characterCache,
    cache,
  );
  const inherited = { killer: null, flags: 0x20 };
  attributeNativePedContact(
    inherited,
    describeNativePedAttributionOther(ped, providers),
    { readCarDriver: () => 8 },
  );
  assert.deepEqual(inherited, { killer, flags: 0x20 });
  assert.equal(
    describeNativePedAttributionOther(ped, {}).characterCache,
    undefined,
  );
  ped.owner = null;
  assert.equal(classifyNativePedOther(ped).ownerPresent, false);
  assert.equal(
    describeNativePedAttributionOther(ped, providers).characterCache,
    null,
  );
  assert.equal(reads, 2);
});

test("native bone5 does not inherit its character's cached killer", () => {
  const bone = body({ kind: "pedestrian-bone", rigidType: 5, owner: {} });
  const providers = {
    readCharacterCache: () =>
      assert.fail("bone is not a character inheritance type"),
  };
  assert.equal(classifyNativePedOther(bone).type, 5);
  assert.equal(classifyNativePedOther(bone).ownerPresent, true);
  const descriptor = describeNativePedAttributionOther(bone, providers),
    state = { killer: null, flags: 0 };
  attributeNativePedContact(state, descriptor, {
    readCarDriver: () => assert.fail("driver read"),
  });
  assert.deepEqual(state, { killer: null, flags: 0 });
  bone.owner = null;
  assert.equal(classifyNativePedOther(bone).ownerPresent, false);
});

test("mine40 resolves firing car through mine.owner.victim, independently of contact victim", () => {
  const firingCar = {},
    owner = { victim: firingCar, driver: 8, mass: 2, maxDamage: 0.5 };
  const bounds = new Box3(
    new Vector3(-0.1, -0.1, -0.1),
    new Vector3(0.1, 0.1, 0.1),
  );
  const mine = new MineRuntime().spawn(
    owner,
    {
      position: new Vector3(),
      orientation: new Quaternion(),
      velocity: new Vector3(),
      bounds,
    },
    mineParameters([5, 2, 10, 2, 2, 0.7, 0.5, 0.6]),
    0,
  );
  mine.victim = { victim: {}, driver: 6, mass: 1, maxDamage: 0.4 };
  const physical = createMineBody(mine, new Group(), bounds, 0.05);
  assert.equal(classifyNativePedOther(physical).type, 0x40);
  assert.equal(classifyNativePedOther(physical).ownerPresent, true);
  const descriptor = describeNativePedAttributionOther(physical, {});
  assert.equal(descriptor.owner, mine);
  assert.equal(descriptor.mineCar, firingCar);
  const state = { killer: null, flags: 0x8220 };
  attributeNativePedContact(state, descriptor, { readCarDriver: () => 8 });
  assert.deepEqual(state, { killer: firingCar, flags: 0x40 });
  delete mine.owner.victim;
  assert.equal(
    describeNativePedAttributionOther(physical, {}).mineCar,
    undefined,
  );
});

test("world NULL, controlled type0 fallback and unsupported tail/drone remain explicit", () => {
  assert.equal(classifyNativePedOther(undefined), null);
  assert.equal(describeNativePedAttributionOther(undefined, {}), undefined);
  for (const value of [body(), body({ kind: "moving-world", owner: {} })]) {
    assert.equal(classifyNativePedOther(value).type, 0);
    assert.equal(classifyNativePedOther(value).ownerPresent, false);
    assert.equal(describeNativePedAttributionOther(value, {}), undefined);
  }
  for (const rigidType of [0x10, 0x20]) {
    const value = body({ rigidType, owner: {} });
    assert.equal(classifyNativePedOther(value).type, rigidType);
    assert.equal(classifyNativePedOther(value).ownerPresent, true);
    assert.equal(describeNativePedAttributionOther(value, {}), undefined);
  }
});

test("explicit character types3/4 retain NULL versus unknown processing cache", () => {
  for (const rigidType of [3, 4]) {
    const value = body({ rigidType, owner: {} });
    assert.equal(classifyNativePedOther(value).type, rigidType);
    assert.equal(
      describeNativePedAttributionOther(value, {}).characterCache,
      undefined,
    );
    assert.equal(
      describeNativePedAttributionOther(value, {
        readCharacterCache: () => null,
      }).characterCache,
      null,
    );
  }
});

test("source F32 M/V snapshots are bounded and do not modify live body state", () => {
  const other = body({ damage: {} }),
    snapshot = classifyNativePedOther(other);
  other.state.velocity.x = 1;
  assert.equal(snapshot.velocity.x, f(0.2));
  for (const mass of [-1, NaN, Infinity, 1e100]) {
    other.properties.mass = mass;
    assert.throws(() => classifyNativePedOther(other), /mass/);
  }
  other.properties.mass = 2;
  other.state.velocity.y = NaN;
  assert.throws(() => classifyNativePedOther(other), /velocity Y/);
  for (const rigidType of [-1, 256, 1.5, NaN])
    assert.throws(
      () => classifyNativePedOther(body({ rigidType })),
      /type BYTE/,
    );
  assert.throws(
    () =>
      classifyNativePedOther(
        body({ kind: "pedestrian-bone", rigidType: 0, owner: null }),
      ),
    /Unprepared/,
  );
  assert.throws(
    () =>
      describeNativePedAttributionOther(body({ kind: "mine", mine: null }), {}),
    /mine owner/,
  );
});

test("type1 raw momentum has no mass cap and active contact stays eligible", () => {
  //4cda49..77 loads M three times, independently multiplying raw V. There
  // is no type-dependent min(M,limit): M=10 remains ten, not an assumed cap.
  for (const mass of [1, 2, 10]) {
    const car = body({ kind: "noncar" });
    car.properties.mass = mass;
    car.state.velocity.set(0.5, 0, 0);
    const packet = contactPacket(classifyNativePedOther(car));
    const passive = passivePedContact(packet),
      expected = (mass * 0.5) ** 2;
    assert.equal(passive.momentumSquared, expected);
    assert.equal(passive.rawDamage, Math.trunc(f((expected / 8) * 100)));
    const active = activePedContact({
      ...packet,
      pedOwnerPresent: true,
      replay: false,
      totalLambda: 0.1,
      firstRowLambda: 0.1,
      pedVelocityY: 0,
      worldForce: new Vector3(1, 0, 0),
      faceNormal: null,
    });
    assert.equal(active.eligible, true);
    assert.equal(active.rawDamage, Math.trunc(f(0.1) * f(250)));
  }
});

test("original Eagle parts, Carrier noncar and mine assets produce actual native descriptors", async (t) => {
  let original, store;
  try {
    original = await originalCar("EAGLE3");
    store = await createAssetStore(process.env.CARMA2_ROOT ?? "carma2_orig");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local original installation absent");
      return;
    }
    throw error;
  }
  const damage = new DamageSystem(
    original.assets,
    original.group,
    original.text,
  );
  await damage.init();
  const car = createSimulatedCar(
    original.group,
    original.text,
    damage,
    new Vector3(),
    0,
    true,
  );
  const scene = new Group(),
    simulation = new VehicleSimulation(new WorldCollision(scene), scene);
  simulation.add(car);
  assert.equal(describeNativePedAttributionOther(car, {}).owner, car);
  const free = damage.runtimeParts.find(
      (p) => p.state.type === 2 && p.mass > 0,
    ),
    semi = damage.runtimeParts.find((p) => p.state.type === 1 && p.mass > 0);
  assert.ok(free && semi, "original Eagle hood and jointed bumper");
  free.state.queuedAt = semi.state.queuedAt = 0;
  simulation.detachParts(car);
  const physicalFree = simulation.debris.find((p) => p.actor === free.actor),
    physicalSemi = simulation.debris.find((p) => p.actor === semi.actor);
  assert.ok(physicalFree && physicalSemi);
  for (const value of [physicalFree, physicalSemi]) {
    assert.equal(classifyNativePedOther(value).type, 1);
    assert.equal(describeNativePedAttributionOther(value, {}).owner, value);
    assert.notEqual(describeNativePedAttributionOther(value, {}).owner, car);
  }
  assert.equal(
    describeNativePedAttributionOther(physicalFree, {}).parentPresent,
    false,
  );
  assert.equal(
    describeNativePedAttributionOther(physicalSemi, {}).parentPresent,
    true,
  );
  assert.equal(simulation.pedestrianAttributionDriver(physicalFree), 2);
  assert.equal(simulation.pedestrianAttributionDriver(physicalSemi), 1);
  assert.equal(simulation.pedestrianAttributionCulprit(physicalFree), car);
  car.state.driver = 6;
  assert.equal(simulation.pedestrianAttributionDriver(car), 6);
  car.state.driver = 8;

  const mechanics = parseNonCarMechanics(
    decodeText(await store.read("data/NONCARS/50gun01_DEBRIS1.txt")),
  );
  const node = parseAct(
      await store.read("data/RACES/Carrier1/&50gun01_DEBRIS1.act"),
    )[0],
    actor = new Group();
  actor.name = node.name;
  const m = node.transform;
  actor.matrix.set(
    m[0],
    m[3],
    m[6],
    m[9],
    m[1],
    m[4],
    m[7],
    m[10],
    m[2],
    m[5],
    m[8],
    m[11],
    0,
    0,
    0,
    1,
  );
  actor.matrix.decompose(actor.position, actor.quaternion, actor.scale);
  const noncar = createNonCarBody(actor, mechanics);
  assert.equal(classifyNativePedOther(noncar).type, 1);
  assert.equal(classifyNativePedOther(noncar).mass, f(noncar.properties.mass));
  assert.equal(describeNativePedAttributionOther(noncar, {}).owner, noncar);
  assert.equal(simulation.pedestrianAttributionDriver(noncar), 4);
  assert.equal(simulation.pedestrianAttributionCulprit(noncar), null);
  // DamageCar's source first-owner rule can retain a low-driver wrapper.
  //4cdc60 follows exactly ONE culprit link; it must not chase that part's car.
  simulation.recordCrashOwners(noncar, physicalFree);
  simulation.recordCrashOwners(noncar, car);
  assert.equal(simulation.pedestrianAttributionCulprit(noncar), physicalFree);
  const attributed = { killer: null, flags: 0x20 };
  attributeNativePedContact(
    attributed,
    describeNativePedAttributionOther(noncar, {}),
    {
      readCarDriver: (owner) => simulation.pedestrianAttributionDriver(owner),
      readCarCulprit: (owner) => simulation.pedestrianAttributionCulprit(owner),
    },
  );
  assert.equal(attributed.killer, physicalFree);
  assert.equal(attributed.flags, 0x21);
  assert.equal(simulation.pedestrianAttributionDriver(attributed.killer), 2);

  const models = parseDat(await store.read("data/MINE/ShitMine.dat")),
    bounds = new Box3();
  assert.ok(models.length);
  for (let i = 0; i < models[0].positions.length; i += 3)
    bounds.expandByPoint(new Vector3(...models[0].positions.slice(i, i + 3)));
  const mass = parseMineMass(decodeText(await store.read("data/GENERAL.TXT")));
  assert.ok(mass > 0);
  const mine = new MineRuntime().spawn(
    {
      victim: car,
      driver: car.state.driver,
      mass: car.properties.mass,
      maxDamage: 0.5,
    },
    {
      position: car.state.position,
      orientation: car.state.orientation,
      velocity: car.state.velocity,
      bounds,
    },
    mineParameters([5, 2, 10, 2, 2, 0.7, 0.5, 0.6]),
    0,
  );
  const physicalMine = createMineBody(mine, new Group(), bounds, mass);
  assert.equal(classifyNativePedOther(physicalMine).type, 0x40);
  assert.equal(
    describeNativePedAttributionOther(physicalMine, {}).mineCar,
    car,
  );
  simulation.dispose();
});
