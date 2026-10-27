import test from "node:test";
import assert from "node:assert/strict";
import {
  Matrix4,
  Mesh,
  BufferGeometry,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { dispatchSmashDebris } from "../src/smash-debris-dispatch.ts";

function fixture() {
  const abstract = { kind: "abstract", materials: ["A"] };
  const shards = { kind: "shards" };
  const ghost = { kind: "ghostparts", actors: ["GHOST.ACT"] };
  const noncar = { kind: "noncars", actorFile: "DEBRIS.ACT" };
  const geometry = new BufferGeometry();
  const material = new MeshBasicMaterial();
  const templates = {
    templates: [
      {
        name: "GHOST",
        matrix: new Matrix4(),
        model: new Mesh(geometry, material),
      },
    ],
    boundsDX: 0,
    boundsDY: 0,
  };
  const noncarTemplates = { templates: [{ originalName: "PANEL" }] };
  const point = new Vector3(1, 2, 3);
  const startVelocity = new Vector3(4, 5, 6);
  const matrix = new Matrix4().makeTranslation(7, 8, 9);
  const contact = {
    actor: {},
    point,
    ghostQuad: null,
    smashStartingVelocity: startVelocity,
    timeMs: 765,
    shrapnelSeed: 0x12345678,
    effectForce: new Vector3(10, 0, 0),
  };
  return {
    abstract,
    shards,
    ghost,
    noncar,
    templates,
    noncarTemplates,
    point,
    startVelocity,
    matrix,
    contact,
  };
}

test("visible dispatch preserves authored order and source context for every producer", () => {
  const f = fixture();
  const order = [];
  let ghostCall, noncarCall;
  dispatchSmashDebris(
    [f.abstract, f.shards, f.ghost, f.noncar],
    f.contact,
    {
      ghosts: new Map([[f.ghost, f.templates]]),
      nonCars: new Map([[f.noncar, f.noncarTemplates]]),
    },
    {
      abstract: (spec) => {
        assert.equal(spec, f.abstract);
        order.push("abstract");
      },
      shards: (spec) => {
        assert.equal(spec, f.shards);
        order.push("shards");
      },
      fragments: {
        spawnGhosts: (spec, source) => {
          order.push("ghost");
          ghostCall = { spec, source };
        },
      },
      nonCars: {
        spawn: (spec, templates, source) => {
          order.push("noncar");
          noncarCall = { spec, templates, source };
        },
      },
      isVisible: () => true,
      readActorMatrix: () => f.matrix.clone(),
      timeMs: 100,
      diagnose: assert.fail,
    },
  );
  assert.deepEqual(order, ["abstract", "shards", "ghost", "noncar"]);
  assert.equal(ghostCall.spec, f.ghost);
  assert.deepEqual(ghostCall.source.point.toArray(), [1, 2, 3]);
  assert.deepEqual(ghostCall.source.impacteeVelocity.toArray(), [4, 5, 6]);
  assert.equal(ghostCall.source.seed, 0x12345678);
  assert.equal(ghostCall.source.timeMs, 765);
  assert.equal(ghostCall.source.visible, true);
  assert.deepEqual(ghostCall.source.frame.elements, f.matrix.elements);
  assert.equal(noncarCall.spec, f.noncar);
  assert.equal(noncarCall.templates, f.noncarTemplates);
  assert.deepEqual(noncarCall.source.point.toArray(), [1, 2, 3]);
  assert.deepEqual(noncarCall.source.impacteeVelocity.toArray(), [4, 5, 6]);
});

test("invisible point suppresses visual producers but keeps physical noncar debris", () => {
  const f = fixture();
  const calls = [];
  let visibilityChecks = 0;
  dispatchSmashDebris(
    [f.abstract, f.shards, f.ghost, f.noncar],
    f.contact,
    {
      ghosts: new Map([[f.ghost, f.templates]]),
      nonCars: new Map([[f.noncar, f.noncarTemplates]]),
    },
    {
      abstract: () => calls.push("abstract"),
      shards: () => calls.push("shards"),
      fragments: { spawnGhosts: () => calls.push("ghost") },
      nonCars: { spawn: () => calls.push("noncar") },
      isVisible: () => {
        visibilityChecks++;
        return false;
      },
      readActorMatrix: () => f.matrix.clone(),
      timeMs: 0,
      diagnose: assert.fail,
    },
  );
  assert.equal(visibilityChecks, 3);
  assert.deepEqual(calls, ["noncar"]);
});

test("missing points diagnose every source and exact spec identity controls lookup", () => {
  const f = fixture();
  const similarGhost = { ...f.ghost };
  const diagnostics = [];
  let calls = 0;
  dispatchSmashDebris(
    [f.ghost, f.noncar],
    { ...f.contact, point: undefined },
    {
      ghosts: new Map([[similarGhost, f.templates]]),
      nonCars: new Map([[f.noncar, f.noncarTemplates]]),
    },
    {
      abstract: () => calls++,
      isVisible: () => {
        calls++;
        return true;
      },
      readActorMatrix: () => f.matrix.clone(),
      timeMs: 0,
      diagnose: (message) => diagnostics.push(message),
    },
  );
  assert.equal(calls, 0);
  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.every((message) => message.includes("smash point")));

  calls = 0;
  dispatchSmashDebris(
    [f.ghost],
    f.contact,
    { ghosts: new Map([[similarGhost, f.templates]]), nonCars: new Map() },
    {
      abstract: () => calls++,
      isVisible: () => true,
      readActorMatrix: () => f.matrix.clone(),
      timeMs: 0,
      diagnose: assert.fail,
    },
  );
  assert.equal(calls, 0);
});
