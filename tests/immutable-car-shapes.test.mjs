import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { DamageSystem } from "../src/damage.ts";
import { hasImmutableCollisionHulls } from "../src/physics/immutable-hulls.ts";
import { StationaryBoundsCache } from "../src/physics/stationary-bounds-cache.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { originalCar } from "./support/original-car.mjs";

const emptyWorld = {
  raycast() {
    return null;
  },
  querySurfaces() {
    return [];
  },
};

async function makeCar(t, immutableHulls) {
  let data;
  try {
    data = await originalCar("EAGLE3");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local original car archives are absent");
      return undefined;
    }
    throw error;
  }
  const damage = new DamageSystem(data.assets, data.group, data.text);
  await damage.init();
  damage.damageContext.random = () => 0.5;
  return createSimulatedCar(
    data.group,
    data.text,
    damage,
    new Vector3(),
    0,
    true,
    { immutableHulls },
  );
}

function hullNumbers(hulls) {
  return hulls.map((hull) => ({
    nativeType: hull.nativeType,
    vertices: hull.vertices.map((point) => point.toArray()),
    vertexOrder: hull.vertexOrder?.slice(),
    faces: hull.faces.map((face) => ({
      normal: face.normal.toArray(),
      constant: face.constant,
      indices: face.indices.slice(),
    })),
    edges: hull.edges.map((edge) => edge.slice()),
  }));
}

function shapeNumbers(shapes) {
  return shapes.map((shape) => shape.map((point) => point.toArray()));
}

test("original CAR opt-in seals published hull generations without freezing crush state", async (t) => {
  const sealed = await makeCar(t, true);
  if (!sealed) return;
  const mutable = await makeCar(t, false);
  if (!mutable) return;
  assert.equal(hasImmutableCollisionHulls(sealed.hulls), true);
  assert.equal(hasImmutableCollisionHulls(mutable.hulls), false);
  assert.deepEqual(hullNumbers(sealed.hulls), hullNumbers(mutable.hulls));

  const simSealed = new VehicleSimulation(emptyWorld, new Group());
  const simMutable = new VehicleSimulation(emptyWorld, new Group());
  t.after(() => {
    simSealed.dispose();
    simMutable.dispose();
  });
  simSealed.add(sealed);
  simMutable.add(mutable);

  const firstSealedHulls = sealed.hulls;
  const firstSealedNumbers = hullNumbers(firstSealedHulls);
  const oldPoint = firstSealedHulls[0].vertices[0];
  const beforeDamage = shapeNumbers(sealed.shapeVertices);
  assert.ok(beforeDamage.some((shape) => shape.length > 0));

  for (const car of [sealed, mutable])
    car.damage.applyImpact(
      [new Vector3(-0.16, 0.06, -0.38)],
      new Vector3(0, 0, 0.5),
      false,
      true,
      40,
      new Vector3(0, 0, 0.5),
    );
  assert.deepEqual(
    shapeNumbers(sealed.shapeVertices),
    shapeNumbers(mutable.shapeVertices),
  );
  assert.notDeepEqual(shapeNumbers(sealed.shapeVertices), beforeDamage);
  assert.deepEqual(oldPoint.toArray(), firstSealedNumbers[0].vertices[0]);
  assert.deepEqual(hullNumbers(firstSealedHulls), firstSealedNumbers);

  simSealed.step();
  simMutable.step();
  assert.notEqual(
    sealed.hulls,
    firstSealedHulls,
    "accepted crush swaps publish a new hull generation",
  );
  assert.equal(hasImmutableCollisionHulls(sealed.hulls), true);
  assert.equal(hasImmutableCollisionHulls(mutable.hulls), false);
  assert.deepEqual(hullNumbers(sealed.hulls), hullNumbers(mutable.hulls));
  assert.deepEqual(
    sealed.damage.componentLevels,
    mutable.damage.componentLevels,
  );
  assert.deepEqual(
    sealed.state.position.toArray(),
    mutable.state.position.toArray(),
  );
  assert.deepEqual(
    sealed.state.velocity.toArray(),
    mutable.state.velocity.toArray(),
  );

  const changedHulls = sealed.hulls;
  simSealed.repair(sealed);
  simMutable.repair(mutable);
  assert.notEqual(sealed.hulls, changedHulls);
  assert.equal(hasImmutableCollisionHulls(sealed.hulls), true);
  assert.deepEqual(hullNumbers(sealed.hulls), hullNumbers(mutable.hulls));

  const detachableSealed = sealed.damage.runtimeParts.find(
    (part) => part.state.type === 2,
  );
  const detachableMutable = mutable.damage.runtimeParts.find(
    (part) => part.state.type === 2,
  );
  assert.ok(detachableSealed && detachableMutable);
  detachableSealed.state.queuedAt = detachableMutable.state.queuedAt = 0;
  simSealed.step();
  simMutable.step();
  const partSealed = simSealed.debris.find(
    (body) => body.actor === detachableSealed.actor,
  );
  const partMutable = simMutable.debris.find(
    (body) => body.actor === detachableMutable.actor,
  );
  assert.ok(partSealed && partMutable);
  assert.equal(hasImmutableCollisionHulls(partSealed.hulls), true);
  assert.equal(hasImmutableCollisionHulls(partMutable.hulls), false);
  assert.deepEqual(
    hullNumbers(partSealed.hulls),
    hullNumbers(partMutable.hulls),
  );

  const planeSealed = sealed.damage.prepareSplitPlane(new Vector3(0, 0, 1), 0);
  const planeMutable = mutable.damage.prepareSplitPlane(
    new Vector3(0, 0, 1),
    0,
  );
  assert.ok(planeSealed && planeMutable);
  simSealed.performSplit(sealed, planeSealed);
  simMutable.performSplit(mutable, planeMutable);
  const splitSealed = simSealed.debris.find((body) => body.part === -1);
  const splitMutable = simMutable.debris.find((body) => body.part === -1);
  assert.ok(splitSealed && splitMutable);
  assert.equal(hasImmutableCollisionHulls(splitSealed.hulls), true);
  assert.equal(hasImmutableCollisionHulls(splitMutable.hulls), false);
  assert.deepEqual(
    hullNumbers(splitSealed.hulls),
    hullNumbers(splitMutable.hulls),
  );

  const replaced = [
    {
      ...sealed.hulls[0],
      vertices: sealed.hulls[0].vertices.map((point) => point.clone()),
      vertexOrder: sealed.hulls[0].vertexOrder?.slice(),
      faces: sealed.hulls[0].faces.map((face) => ({
        ...face,
        normal: face.normal.clone(),
        indices: face.indices.slice(),
      })),
      edges: sealed.hulls[0].edges.map((edge) => edge.slice()),
    },
  ];
  sealed.state.predictedPosition = sealed.state.position.clone();
  sealed.state.predictedOrientation = sealed.state.orientation.clone();
  const diagnostics = {};
  const cache = new StationaryBoundsCache(diagnostics);
  const sealedBounds = cache.get(sealed);
  sealed.hulls = replaced;
  assert.equal(hasImmutableCollisionHulls(sealed.hulls), false);
  assert.notEqual(cache.get(sealed), sealedBounds);
  assert.ok(diagnostics.boundsVertexTests > 0);
});
