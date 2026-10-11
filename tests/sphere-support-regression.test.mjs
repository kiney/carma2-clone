import test from "node:test";
import assert from "node:assert/strict";
import { Group, Object3D, Quaternion, Vector3 } from "three";
import {
  createNativePedBoneBody,
  commitNativePedBoneBody,
} from "../src/physics/ped-bone-body.ts";
import { VehicleSimulation, PHYSICS_STEP } from "../src/physics/simulation.ts";
import { advanceRigidBody } from "../src/physics/integrate.ts";
import {
  nativeSphereBodyPose,
  nativeSphereFace,
  nativeSphereSurfaceContacts,
} from "../src/physics/sphere-body.ts";
import {
  recoverNativeSphereSupport,
  SPHERE_SUPPORT_RADIUS_FRACTION,
} from "../src/physics/sphere-support.ts";
import {
  nativeSphereCenters,
  nativeSphereWorldContacts,
} from "../src/physics/sphere-contact.ts";
import { transformPedPoint } from "../src/ped-form.ts";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const safeBounds = { min: [-0.02, -0.02, -0.02], max: [0.02, 0.02, 0.02] };
function center(body, predicted = false) {
  return new Vector3(...body.shape.center)
    .applyQuaternion(
      predicted ? body.state.predictedOrientation : body.state.orientation,
    )
    .add(predicted ? body.state.predictedPosition : body.state.position);
}
function nativeCenter(body, predicted = false) {
  const pose = nativeSphereBodyPose(body);
  return transformPedPoint(
    predicted ? pose.predictedPose : pose.oldPose,
    body.shape.center,
  );
}
function fixture(t, options = {}) {
  const {
    bounds = safeBounds,
    clearance = 0.004,
    velocity = [0, -0.1, 0],
    omega = [10, 0, 0],
    floorY = 0,
    orientation = new Quaternion(),
  } = options;
  const request = {
    index: 1,
    slot: 0,
    bone: {
      name: "HEAD",
      massKg: 4,
      mass: Math.fround(0.004),
      collisionType: "SPHERE",
    },
    snapshot: {
      actor: new Object3D(),
      model: { safeFixture: true },
      nativePose: [...identity, 0, 1, 0],
      bounds,
    },
    rigidType: 5,
    filterA: 0x40000,
    filterB: 0x50000,
    localOmega: omega,
    activation: {
      velocity,
      gravity: 1,
      clearProperties: [3, 4, 5],
      clearDoNothing: true,
      enableHalt: true,
    },
    clearParentJoint: true,
    clearChildren: true,
    clearLink188: true,
  };
  const floor = {
    a: new Vector3(-10, floorY, -10),
    b: new Vector3(0, floorY, 10),
    c: new Vector3(10, floorY, -10),
    normal: new Vector3(0, 1, 0),
    material: "safe-finite-road",
    materialFlags: 33,
    faceFlags: 7,
    enabled: true,
    modifier: { tyreFriction: 1, wallFriction: 1, bumpiness: 0 },
  };
  const sim = new VehicleSimulation(
    { raycast: () => null, querySurfaces: () => [floor] },
    new Group(),
  );
  t.after(() => sim.dispose());
  const body = createNativePedBoneBody({
    request,
    owner: {},
    levelOut: 0,
    retained: { rigidFlags: 0, objectFriction: 0 },
  });
  assert.deepEqual(sim.addPedBoneBody(body), { accepted: true, code: 0 });
  commitNativePedBoneBody(request, body, {
    unlink() {},
    activate: (b) => sim.phil.activate(b, { flag2: false }),
  });
  // A post-solver committed state: the guard runs after free forces/impulses,
  // so these supplied velocities must not receive gravity a second time.
  body.state.orientation.copy(orientation);
  body.state.angularVelocity.set(...omega);
  body.state.position
    .set(0, floorY + body.shape.radius + clearance, 0)
    .sub(new Vector3(...body.shape.center).applyQuaternion(orientation));
  body.state.velocity.set(...velocity);
  return { sim, body, floor };
}

test("final sphere guard follows the support envelope when a rotating material point rises", (t) => {
  const { sim, body, floor } = fixture(t, {
    clearance: 1e-6,
    velocity: [0, -0.0001, 0],
  });
  const old = center(body);
  advanceRigidBody(body, PHYSICS_STEP, true);
  const raw = nativeSphereSurfaceContacts(nativeSphereBodyPose(body), [floor]);
  assert.ok(raw.some((row) => row.contactTypes[0] === 3));
  assert.ok(center(body, true).y < body.shape.radius);
  const oldPoint = raw[0].points[0],
    local = oldPoint
      .clone()
      .sub(body.state.position)
      .applyQuaternion(body.state.orientation.clone().invert());
  const nextMaterial = local
    .applyQuaternion(body.state.predictedOrientation)
    .add(body.state.predictedPosition);
  assert.ok(
    nextMaterial.y > oldPoint.y,
    "OLD material point lifts despite downward center sweep",
  );
  assert.ok(center(body, true).y < old.y);
  const guard = sim.advanceWorldContacts(body, true);
  assert.ok(
    guard.contacts.length > 0,
    "inward envelope must retain the analytic source3 row",
  );
  assert.ok(guard.fraction < 1);
  assert.ok(center(body, true).y >= body.shape.radius - 1e-7);
});

test("sphere angular guard retains OLD values while candidate reuses mutable predicted pose objects", (t) => {
  const { sim, body, floor } = fixture(t);
  const samples = Math.ceil(
    (body.state.angularVelocity.length() * PHYSICS_STEP) / 0.05,
  );
  assert.ok(samples > 1);
  advanceRigidBody(body, PHYSICS_STEP / samples, true);
  const reusedPosition = body.state.predictedPosition,
    reusedOrientation = body.state.predictedOrientation;
  assert.equal(
    nativeSphereSurfaceContacts(nativeSphereBodyPose(body), [floor]).length,
    0,
    "first subinterval stays above native radius+.002; crossing is later",
  );
  advanceRigidBody(body, PHYSICS_STEP, true);
  assert.equal(body.state.predictedPosition, reusedPosition);
  assert.equal(body.state.predictedOrientation, reusedOrientation);
  assert.ok(
    nativeSphereSurfaceContacts(nativeSphereBodyPose(body), [floor]).length > 0,
  );
  assert.ok(center(body, true).y <= body.shape.radius);
  const guard = sim.advanceWorldContacts(body, true);
  assert.ok(
    guard.contacts.length > 0,
    "sample2+ must sweep from its saved OLD pose",
  );
  assert.ok(guard.fraction < 1);
  assert.ok(center(body, true).y >= body.shape.radius - 1e-7);
});

test("offset MODEL sphere center and COM rotation preserve the same finite support envelope", (t) => {
  const { sim, body } = fixture(t, {
    bounds: { min: [0.08, -0.01, -0.03], max: [0.12, 0.03, 0.01] },
    orientation: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.7),
  });
  assert.notDeepEqual(body.shape.center, [0, 0, 0]);
  assert.deepEqual(body.properties.centerOfMass.toArray(), [
    ...body.shape.center,
  ]);
  const before = center(body);
  advanceRigidBody(body, PHYSICS_STEP, true);
  assert.ok(
    Math.abs(
      center(body, true).y - before.y - body.state.velocity.y * PHYSICS_STEP,
    ) < 1e-12,
  );
  const guard = sim.advanceWorldContacts(body, true);
  assert.ok(guard.contacts.length > 0);
  assert.ok(guard.fraction < 1);
  assert.ok(center(body, true).y >= body.shape.radius - 1e-7);
});

test("sphere spin alone or outward envelope motion does not create a final inward guard", (t) => {
  for (const velocity of [
    [0, 0, 0],
    [0, 0.0001, 0],
  ]) {
    const { sim, body } = fixture(t, { clearance: 1e-6, velocity });
    const guard = sim.advanceWorldContacts(body, true);
    assert.equal(guard.contacts.length, 0);
    assert.equal(guard.fraction, 1);
  }
});

test("native strict OLD sphere overlap rejection remains unchanged despite a physical Float32 placement gap", (t) => {
  const { body, floor } = fixture(t, {
    floorY: Math.fround(-0.824754),
    clearance: 1e-9,
    velocity: [0, -0.01, 0],
    omega: [0, 0, 0],
  });
  assert.ok(center(body).y - floor.a.y > body.shape.radius);
  assert.ok(
    Math.fround(nativeCenter(body)[1] - floor.a.y) < body.shape.radius,
    "native root translation rounds physically supported center inside the source radius",
  );
  advanceRigidBody(body, PHYSICS_STEP, true);
  assert.deepEqual(
    nativeSphereSurfaceContacts(nativeSphereBodyPose(body), [floor]),
    [],
    "source45ed50 strict d0<radius must not be weakened to hide guard placement rounding",
  );
});

test("final sphere guard blocks a demonstrably shallow OLD Float32 support gap before further inward motion", (t) => {
  const { sim, body, floor } = fixture(t, {
    floorY: Math.fround(-0.824754),
    clearance: 1e-9,
    velocity: [0, -0.01, 0],
    omega: [0, 0, 0],
  });
  assert.ok(center(body).y - floor.a.y > body.shape.radius);
  advanceRigidBody(body, PHYSICS_STEP, true);
  const input = nativeSphereBodyPose(body),
    face = nativeSphereFace(floor),
    rows = recoverNativeSphereSupport(input, [face]);
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].fraction,
    0,
    "existing OLD shell overlap admits no further inward advance",
  );
  assert.equal(rows[0].contactTypes[0], 3);
  assert.equal(rows[0].sourceSurface, floor);
  assert.equal(rows[0].faceFriction, floor.modifier.wallFriction);
  assert.deepEqual(rows[0].normal.toArray(), [0, 1, 0]);
  const oldCenter = nativeSphereCenters(input).old;
  const expected = nativeSphereWorldContacts(input, [face], {
    placementStart: [
      oldCenter[0],
      Math.fround(floor.a.y + body.shape.radius + 1e-7),
      oldCenter[2],
    ],
  }).find((row) => row.contactTypes[0] === 3);
  assert.ok(expected);
  assert.deepEqual(
    rows[0].points[0].toArray(),
    expected.points[0].toArray(),
    "actual OLD torque point unchanged by query-only reprojection",
  );
  assert.ok(
    center(body, true).y - floor.a.y < body.shape.radius,
    "kernel does not push the actual predicted pose",
  );
  const guard = sim.advanceWorldContacts(body, true);
  assert.equal(guard.fraction, 0, "host refuses further inward motion");
  assert.ok(guard.contacts.some((contact) => contact.sourceType === 3));
  // Final commitment integrates the returned safe fraction, independently of
  // the scratch endpoint left by the trajectory query.
  advanceRigidBody(body, PHYSICS_STEP * guard.fraction, true);
  assert.ok(center(body, true).y - floor.a.y >= body.shape.radius);
});

test("shallow support recovery rejects deeper OLD overlap, resting/outward motion and nonpenetrating END", (t) => {
  for (const options of [
    { clearance: -1e-4, velocity: [0, -0.1, 0] },
    {
      clearance: -safeBounds.max[0] * SPHERE_SUPPORT_RADIUS_FRACTION * 2,
      velocity: [0, -0.1, 0],
    },
    { clearance: 1e-9, velocity: [0, 0, 0] },
    { clearance: 1e-9, velocity: [0, 0.01, 0] },
    { clearance: 0.001, velocity: [0, -0.01, 0] },
  ]) {
    const { body, floor } = fixture(t, {
      floorY: Math.fround(-0.824754),
      omega: [0, 0, 0],
      ...options,
    });
    advanceRigidBody(body, PHYSICS_STEP, true);
    assert.deepEqual(
      recoverNativeSphereSupport(nativeSphereBodyPose(body), [
        nativeSphereFace(floor),
      ]),
      [],
    );
  }
});

test("recovery retains original finite triangle, material-prefix and backface gates", (t) => {
  const { body, floor } = fixture(t, {
    floorY: Math.fround(-0.824754),
    clearance: 1e-9,
    velocity: [0, -0.01, 0],
    omega: [0, 0, 0],
  });
  advanceRigidBody(body, PHYSICS_STEP, true);
  const input = nativeSphereBodyPose(body),
    face = nativeSphereFace(floor);
  for (const materialIdentifier of ["!road", ">road", "?road"])
    assert.deepEqual(
      recoverNativeSphereSupport(input, [{ ...face, materialIdentifier }]),
      [],
    );
  assert.deepEqual(
    recoverNativeSphereSupport(input, [
      {
        ...face,
        a: [20, floor.a.y, 20],
        b: [20, floor.a.y, 30],
        c: [30, floor.a.y, 20],
      },
    ]),
    [],
  );
  const flipped = { ...face, normal: [0, -1, 0], constant: -face.constant };
  for (const materialFlags of [undefined, 0, 0x800])
    assert.deepEqual(
      recoverNativeSphereSupport(input, [{ ...flipped, materialFlags }]),
      [],
    );
  const rows = recoverNativeSphereSupport(input, [
    { ...flipped, materialFlags: 0x1000 },
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].normal.toArray(), [0, 1, 0]);
  assert.equal(rows[0].fraction, 0);
});

test("per-face OLD overlap recovery cannot hide a distinct new finite-wall crossing", (t) => {
  const { body, floor } = fixture(t, {
    floorY: Math.fround(-0.824754),
    clearance: 1e-9,
    velocity: [-1, -0.01, 0],
    omega: [0, 0, 0],
  });
  body.state.position.x = body.shape.radius + 0.02;
  advanceRigidBody(body, PHYSICS_STEP, true);
  const wall = {
      a: [0, -2, -10],
      b: [0, 2, -10],
      c: [0, 0, 10],
      normal: [1, 0, 0],
      constant: 0,
      materialFlags: 33,
      faceFlags: 7,
    },
    face = nativeSphereFace(floor),
    input = nativeSphereBodyPose(body),
    ordinary = nativeSphereWorldContacts(input, [face, wall]),
    recovered = recoverNativeSphereSupport(input, [face, wall]);
  assert.ok(ordinary.some((row) => row.normal.x === 1));
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].normal.y, 1);
  assert.ok([...ordinary, ...recovered].some((row) => row.normal.x === 1));
});

test("absolute world ULP size cannot expand support recovery beyond its small radius-relative cap", (t) => {
  const { body, floor } = fixture(t, {
    bounds: { min: [-0.0201, -0.0201, -0.0201], max: [0.0201, 0.0201, 0.0201] },
    floorY: -4096,
    clearance: 1e-9,
    velocity: [0, -0.01, 0],
    omega: [0, 0, 0],
  });
  const deficit =
    body.shape.radius - Math.fround(nativeCenter(body)[1] - floor.a.y);
  assert.ok(deficit > body.shape.radius * SPHERE_SUPPORT_RADIUS_FRACTION);
  assert.ok(
    deficit < 2 ** -11,
    "root storage ULP alone would otherwise admit this deficit",
  );
  advanceRigidBody(body, PHYSICS_STEP, true);
  assert.deepEqual(
    recoverNativeSphereSupport(nativeSphereBodyPose(body), [
      nativeSphereFace(floor),
    ]),
    [],
  );
});

test("oblique packed finite plane reprojects its shallow shell while preserving the frozen normal", (t) => {
  const { body } = fixture(t, {
    clearance: 1e-9,
    velocity: [0, -0.01, 0],
    omega: [0, 0, 0],
  });
  const normal = [Math.fround(0.6), Math.fround(0.8), 0],
    radius = body.shape.radius,
    old = [Math.fround(normal[0] * radius), Math.fround(normal[1] * radius), 0];
  const signed = Math.fround(normal[0] * old[0] + normal[1] * old[1]);
  // Five coordinate ULPs cross one plane-distance ULP with this packed normal.
  old[0] = Math.fround(old[0] - 5 * 2 ** -30);
  assert.ok(Math.fround(normal[0] * old[0] + normal[1] * old[1]) < radius);
  const input = {
      sphere: body.shape,
      oldPose: [...identity, ...old],
      predictedPose: [
        ...identity,
        old[0] - 0.001 * normal[0],
        old[1] - 0.001 * normal[1],
        0,
      ],
    },
    face = {
      a: [-8, 6, -10],
      b: [8, -6, -10],
      c: [0, 0, 10],
      normal,
      constant: 0,
      materialFlags: 33,
      faceFlags: 7,
    };
  const rows = recoverNativeSphereSupport(input, [face]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].normal.toArray(), normal);
  assert.equal(rows[0].fraction, 0);
  assert.ok(signed >= radius - 2 ** -28);
});

for (const dataRoot of ["data", "adv_data"]) {
  test(`original ${dataRoot} Blokebl offset HEAD retains later-sample finite support`, async (t) => {
    let template;
    try {
      const store = await createAssetStore(
          new URL("../carma2_orig/", import.meta.url).pathname,
        ),
        assets = new Assets();
      assets.manifest = store.manifest;
      assets.lookup = new Map(
        store.manifest.map((entry) => [entry.path.toLowerCase(), entry.path]),
      );
      assets.bytes = async (path) => {
        const value = await store.read(path);
        if (!value) throw new Error(`Asset missing: ${path}`);
        return new Uint8Array(value);
      };
      template = await loadNativePedAssets(
        assets,
        "PEDS/PEEPS/Blokebl",
        "Blokebl",
        dataRoot,
      );
    } catch (error) {
      if (
        error.code === "ENOENT" ||
        /Original installation/.test(String(error))
      ) {
        t.skip("Original installation unavailable");
        return;
      }
      throw error;
    }
    const index = template.form.headBone,
      definition = template.form.bones[index],
      variant = template.bones[index].variants[0],
      bounds = variant.modelBounds.get(variant.sourceModels[0]);
    assert.equal(definition.collisionType, "SPHERE");
    assert.equal(definition.massKg, 4);
    assert.ok(bounds);
    const { sim, body } = fixture(t, {
      bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
      orientation: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.7),
    });
    assert.notDeepEqual(body.shape.center, [0, 0, 0]);
    assert.deepEqual(body.properties.centerOfMass.toArray(), [
      ...body.shape.center,
    ]);
    const guard = sim.advanceWorldContacts(body, true);
    assert.ok(guard.contacts.length > 0);
    assert.ok(guard.fraction < 1);
    assert.ok(center(body, true).y >= body.shape.radius - 1e-7);
  });
}
