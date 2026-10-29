import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { PedestrianSystem } from "../src/pedestrians.ts";

async function fixture(t) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-10, 0, -10, 0, 0, 10, 10, 0, -10], 3),
  );
  const material = new THREE.MeshBasicMaterial();
  material.name = "sidewalk";
  const prototype = new THREE.Group();
  prototype.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.28, 0.06),
      new THREE.MeshBasicMaterial(),
    ),
  );
  let draws = 0;
  const peds = await PedestrianSystem.create(
    {
      manifest: [{ path: "data/PEDS/PEEPS/Alice/Alice.act", size: 1000 }],
      async text(path) {
        if (/settings/i.test(path))
          return "12\n9\n25\n.5\n4\n// MOVEMENT STUFF\n1\n2\n30\n180\n.7\n1.7\n// Group #0\n1\nAlice\n";
        throw new Error("Fixture has no motion packages");
      },
      async scene() {
        return { group: prototype.clone(true) };
      },
    },
    new THREE.Mesh(geometry, material),
    "// Ped specs\n1\nsidewalk\n0\n0\n-1\n0\n0\n",
    () => 0,
    {
      spawn: new THREE.Vector3(),
      random: () => {
        draws++;
        return 0.25;
      },
      combatRandom: () => {
        draws++;
        return 0.25;
      },
    },
  );
  t.after(() => peds.dispose());
  return {
    peds,
    actor: peds.group.children[0],
    draws: () => draws,
  };
}

function frontFrustum() {
  const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
  camera.updateMatrixWorld(true);
  return new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    ),
  );
}

test("distant presentation retains inactive pose without RNG, collision or combat admission", async (t) => {
  const f = await fixture(t);
  f.actor.position.set(0, 0, -40);
  const origin = new THREE.Vector3();
  const car = {
    position: f.actor.position.clone(),
    yaw: 0,
    speed: 5,
    velocity: new THREE.Vector3(0, 0, 5),
  };
  f.peds.update(0.1, car, {
    cameraPosition: origin,
    gameTimeMs: 1000,
    electricRayDistanceSquared: 10000,
  });
  assert.equal(f.peds.states[0].active, false);
  assert.equal(
    f.actor.visible,
    false,
    "unopted callers keep native visibility",
  );
  const before = f.peds.states;
  const draws = f.draws();
  const localPoses = [];
  f.actor.traverse((node) =>
    localPoses.push([node.position.toArray(), node.quaternion.toArray()]),
  );
  for (let i = 0; i < 3; i++)
    f.peds.updatePresentation(origin, 64, frontFrustum());
  assert.equal(f.actor.visible, true);
  assert.ok(f.peds.dormantRenderActors.has(f.actor));
  assert.deepEqual(f.peds.states, before);
  assert.equal(f.draws(), draws);
  const afterPoses = [];
  f.actor.traverse((node) =>
    afterPoses.push([node.position.toArray(), node.quaternion.toArray()]),
  );
  assert.deepEqual(afterPoses, localPoses);
  assert.equal(
    f.peds.useCombatPowerup(
      37,
      [100],
      { position: origin, velocity: origin, owner: {} },
      80,
      1010,
    ),
    false,
    "visible inactive actors are still excluded from native combat targets",
  );
  assert.equal(f.peds.hits, 0);
  assert.equal(f.peds.alive, 1);
  assert.equal(f.draws(), draws);
});

test("presentation has independent spherical range and conservative frustum admission", async (t) => {
  const { peds, actor } = await fixture(t);
  const camera = new THREE.Vector3();
  actor.position.set(0, 0, -42);
  peds.updatePresentation(camera, 40, frontFrustum());
  assert.equal(actor.visible, true, "radius-two boundary remains visible");
  actor.position.z = -42.01;
  peds.updatePresentation(camera, 40, frontFrustum());
  assert.equal(actor.visible, false);
  assert.equal(peds.dormantRenderActors.size, 0);
  actor.position.set(0, 0, 30);
  peds.updatePresentation(camera, 64, frontFrustum());
  assert.equal(actor.visible, false, "inactive actor behind camera is culled");
  peds.updatePresentation(camera, 64);
  assert.equal(actor.visible, true, "frustum admission is optional");
  actor.position.set(40, 0, 40);
  peds.updatePresentation(camera, 50);
  assert.equal(actor.visible, false, "range is spherical, not an axis box");
  assert.equal(peds.states[0].active, false);
});

test("presentation admission promotes retained actors while preserving active visibility", async (t) => {
  const { peds, actor } = await fixture(t);
  const target = actor.position.clone();
  const car = { position: new THREE.Vector3(100, 0, 100), yaw: 0, speed: 0 };
  peds.update(0.1, car, { cameraPosition: target });
  assert.equal(peds.states[0].active, true);
  peds.updatePresentation(new THREE.Vector3(0, 0, -100), 0, frontFrustum());
  assert.equal(actor.visible, true, "active actors retain native visibility");
  assert.equal(peds.dormantRenderActors.size, 0);
  peds.update(0.1, car, {
    cameraPosition: target.clone().add(new THREE.Vector3(20, 0, 0)),
  });
  peds.updatePresentation(target, 64);
  assert.equal(peds.states[0].active, false);
  assert.equal(actor.visible, true);
  peds.update(0.1, car, { cameraPosition: target });
  peds.updatePresentation(target, 64);
  assert.equal(
    peds.states[0].active,
    true,
    "retained presentation admission resumes processing",
  );
  assert.equal(actor.visible, true);
  assert.equal(peds.dormantRenderActors.has(actor), false);
  peds.resetCar(car.position);
  peds.update(0.1, car, { cameraPosition: target });
  peds.updatePresentation(target, 64);
  assert.equal(peds.states[0].active, true);
  assert.equal(peds.dormantRenderActors.size, 0);
});

test("popup hysteresis remains inactive when presentation is not opted in", async (t) => {
  const { peds, actor } = await fixture(t);
  const target = actor.position.clone();
  const car = { position: new THREE.Vector3(100, 0, 100), yaw: 0, speed: 0 };
  peds.update(0.1, car, { cameraPosition: target });
  assert.equal(peds.states[0].active, true);
  peds.update(0.1, car, {
    cameraPosition: target.clone().add(new THREE.Vector3(20, 0, 0)),
  });
  assert.equal(peds.states[0].active, false);
  peds.update(0.1, car, { cameraPosition: target });
  assert.equal(peds.states[0].active, false);
  assert.equal(actor.visible, false);
  assert.equal(peds.dormantRenderActors.size, 0);
});

test("visible dormant actor remains eligible for a same-update vehicle hit", async (t) => {
  const { peds, actor } = await fixture(t);
  const farCamera = new THREE.Vector3(100, 0, 100);
  actor.position.set(0, 0, 0);
  const car = { position: new THREE.Vector3(0, 0, 2), yaw: 0, speed: 0 };

  // Consume the initial near-reset, then leave this actor unprocessed while
  // keeping it in presentation range and inside the native popup volume.
  peds.update(0.1, car, { cameraPosition: farCamera });
  peds.updatePresentation(new THREE.Vector3(), 64, frontFrustum());
  assert.equal(peds.states[0].active, false);
  assert.equal(actor.visible, true);
  assert.ok(peds.dormantRenderActors.has(actor));

  car.position.z = -2;
  car.speed = 2;
  peds.update(0.1, car, {
    cameraPosition: new THREE.Vector3(),
    gameTimeMs: 200,
  });
  assert.equal(
    peds.hits,
    1,
    "the sweep counts the visible pedestrian hit once",
  );
  assert.equal(peds.states[0].alive, false);
  assert.equal(peds.dormantRenderActors.has(actor), false);
  assert.equal(peds.dormantRenderActors.size, 0);
});

test("camera reset detection is strict at twenty units and takes effect next update", async (t) => {
  const { peds, actor } = await fixture(t);
  actor.position.set(0, 0, 0);
  const camera = new THREE.Vector3(100, 0, 100);
  const car = { position: camera.clone(), yaw: 0, speed: 0 };
  peds.noteCameraPosition(camera);
  peds.update(0.1, car, { cameraPosition: camera }); // consume initial reset

  peds.noteCameraPosition(camera.clone().add(new THREE.Vector3(20, 0, 0)));
  peds.update(0.1, car, { cameraPosition: new THREE.Vector3() });
  assert.equal(
    peds.states[0].active,
    false,
    "exactly twenty units does not reset",
  );

  peds.noteCameraPosition(camera.clone().add(new THREE.Vector3(40.01, 0, 0)));
  peds.update(0.1, car, { cameraPosition: new THREE.Vector3() });
  assert.equal(
    peds.states[0].active,
    true,
    "more than twenty units resets the next pass",
  );

  peds.reset();
  peds.noteCameraPosition(new THREE.Vector3(500, 0, 500));
  peds.update(0.1, car, { cameraPosition: new THREE.Vector3() });
  assert.equal(
    peds.states[0].active,
    true,
    "reset clears camera history and preserves reset activation",
  );
});

test("an unseen actor inside popup remains inactive and native process bounds stay strict", async (t) => {
  const { peds, actor } = await fixture(t);
  const camera = new THREE.Vector3();
  const farCamera = new THREE.Vector3(100, 0, 100);
  const car = { position: new THREE.Vector3(100, 0, 100), yaw: 0, speed: 0 };
  peds.update(0.1, car, { cameraPosition: farCamera }); // consume initial reset
  actor.position.set(8, 0, 0); // inside popup, but outside visual range below
  peds.updatePresentation(camera, 0);
  assert.equal(actor.visible, false);
  peds.update(0.1, car, { cameraPosition: camera });
  assert.equal(peds.states[0].active, false);

  actor.position.set(11.99, 0, 0);
  peds.update(0.1, car, { cameraPosition: camera });
  assert.equal(peds.states[0].active, true);
  actor.position.set(12, 0, 0);
  peds.update(0.1, car, { cameraPosition: camera });
  assert.equal(
    peds.states[0].active,
    false,
    "horizontal process extent is strict",
  );
  actor.position.set(0, 7.2, 0);
  peds.update(0.1, car, { cameraPosition: camera });
  assert.equal(
    peds.states[0].active,
    false,
    "vertical process extent is strict",
  );
});

test("vanished inactive burning actors remain absent after presentation", async (t) => {
  const { peds, actor } = await fixture(t);
  actor.position.set(30, 0, 0);
  // Seed the state established by a napalm hit, then exercise native inactive
  // burn scoring/extinguishing rather than constructing a presentation flag.
  peds.peds[0].burningUntilMs = 1000;
  peds.update(
    0.1,
    { position: new THREE.Vector3(), yaw: 0, speed: 0 },
    { gameTimeMs: 100, cameraPosition: new THREE.Vector3() },
  );
  peds.updatePresentation(new THREE.Vector3(), 64);
  assert.equal(actor.visible, false);
  assert.equal(peds.dormantRenderActors.size, 0);
  assert.equal(peds.states[0].active, false);
  assert.equal(peds.states[0].alive, false);
  assert.equal(
    peds.hits,
    0,
    "inactive burn does not alter native population count",
  );
});

test("native transported owners retain visibility and invalidate dormant certification", async (t) => {
  const { peds, actor } = await fixture(t);
  peds.updatePresentation(new THREE.Vector3(), 64);
  assert.ok(peds.dormantRenderActors.has(actor));
  const revision = peds.presentationRevision;
  peds.bindNativeCountingOwner({}, actor, { flags: 0 });
  assert.equal(peds.presentationRevision, revision + 1);
  assert.equal(peds.dormantRenderActors.size, 0);
  const transport = new THREE.Group();
  transport.add(actor);
  actor.visible = false;
  peds.updatePresentation(actor.position, 64);
  assert.equal(actor.visible, false);
  actor.visible = true;
  peds.updatePresentation(new THREE.Vector3(10000, 0, 0), 0, frontFrustum());
  assert.equal(actor.visible, true);
  assert.equal(peds.dormantRenderActors.size, 0);
});

test("reset and disposal invalidate retained presentation generations", async (t) => {
  const { peds, actor } = await fixture(t);
  actor.position.set(30, 0, 0);
  peds.updatePresentation(new THREE.Vector3(), 64);
  assert.ok(peds.dormantRenderActors.has(actor));
  const revision = peds.presentationRevision;
  peds.reset();
  assert.equal(peds.presentationRevision, revision + 1);
  assert.equal(peds.dormantRenderActors.size, 0);
  peds.updatePresentation(new THREE.Vector3(), 64);
  assert.ok(peds.dormantRenderActors.has(actor));
  peds.dispose();
  assert.equal(peds.presentationRevision, revision + 2);
  assert.equal(peds.dormantRenderActors.size, 0);
  assert.equal(peds.renderActors.size, 0);
});
