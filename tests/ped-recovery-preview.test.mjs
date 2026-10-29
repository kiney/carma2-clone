import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Group, Matrix4, Vector3 } from "three";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { NativePedOrdinarySupportError } from "../src/ped-ordinary-support.ts";

function fixture() {
  const actor = new Group(),
    surface = {
      a: new Vector3(0, 0, 0),
      b: new Vector3(1, 0, 0),
      c: new Vector3(0, 0, 1),
      material: "fixture",
      actor,
    },
    calls = [];
  const world = {
    collectFaces(query, capacity, gatherModels, callbacks) {
      calls.push({ query, capacity, gatherModels, callbacks });
      callbacks.onFace?.(surface);
      return [surface];
    },
  };
  const simulation = new VehicleSimulation(world, new Group()),
    query = {
      bounds: new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
      matrix: new Matrix4(),
    };
  return { actor, calls, query, simulation, surface, world };
}

test("pedestrian recovery preview matches finite collector output without callback mutations", () => {
  const h = fixture(),
    before = {
      position: h.actor.position.toArray(),
      quaternion: h.actor.quaternion.toArray(),
      children: [...h.actor.children],
      admissions: h.simulation.nonCarAdmissionFailures.missingMechanics,
      phil: h.simulation.phil.count,
    };
  const normal = h.simulation.collectPedestrianFaces(h.query, 1),
    preview = h.simulation.previewPedestrianFaces(h.query, 1);
  assert.equal(normal.length, 1);
  assert.equal(preview.length, 1);
  assert.equal(preview[0], normal[0]);
  assert.equal(h.calls[0].capacity, 1);
  assert.equal(h.calls[1].capacity, 1);
  assert.equal(h.calls[1].callbacks.onFaceReadOnly, true);
  assert.equal(h.calls[1].callbacks.mutationsTracked, true);
  assert.deepEqual(h.actor.position.toArray(), before.position);
  assert.deepEqual(h.actor.quaternion.toArray(), before.quaternion);
  assert.deepEqual(h.actor.children, before.children);
  assert.equal(
    h.simulation.nonCarAdmissionFailures.missingMechanics,
    before.admissions,
  );
  assert.equal(h.simulation.phil.count, before.phil);
});

test("preview rejects ACT pulls inside a physics query when actor mechanics are missing or inactive", () => {
  for (const mode of ["missing", "inactive"]) {
    const h = fixture(),
      body = { actor: h.actor };
    if (mode === "inactive") h.simulation.noncarsByActor.set(h.actor, body);
    h.world.collectFaces = (_query, _capacity, _gatherModels, callbacks) => {
      callbacks.pullActorFromWorld(h.actor);
      return [];
    };
    h.simulation.physicsQueryDepth++;
    try {
      assert.throws(
        () => h.simulation.previewPedestrianFaces(h.query, 1),
        (error) =>
          error instanceof NativePedOrdinarySupportError &&
          error.requiredProviders.includes(
            "source-recovery-preview-ACT-pull-required",
          ),
        mode,
      );
    } finally {
      h.simulation.physicsQueryDepth--;
    }
    assert.equal(h.simulation.nonCarAdmissionFailures.missingMechanics, 0);
    assert.equal(h.simulation.phil.count, 0);
  }
});

test("preview rejects stopping an active GROOVE actor without changing its frame state", () => {
  const h = fixture(),
    grooveState = {
      actors: new Set([h.actor]),
      previousTimes: [250, 125],
      poseRevision: 7,
    };
  h.simulation.grooves = grooveState;
  h.simulation.worldGrooveFrameActive = true;
  h.world.collectFaces = (_query, _capacity, _gatherModels, callbacks) => {
    callbacks.stopGroovidelic(h.actor);
    return [];
  };
  assert.throws(
    () => h.simulation.previewPedestrianFaces(h.query, 1),
    (error) =>
      error instanceof NativePedOrdinarySupportError &&
      error.requiredProviders.includes(
        "source-recovery-preview-GROOVE-stop-required",
      ),
  );
  assert.deepEqual(grooveState.previousTimes, [250, 125]);
  assert.equal(grooveState.poseRevision, 7);
  assert.equal(h.actor.position.y, 0);
});
