import test from "node:test";
import assert from "node:assert/strict";
import { Matrix4, Quaternion, Vector3 } from "three";
import {
  allocateNativeOrderedActor,
  createNativeActorOrder,
  enumerateNativeActorChildren,
  knownNativeActorValue as known,
  prependNativeActor,
} from "../src/native-actor-order.ts";
import {
  nativeWorldMatrix,
  returnNativeWorldActor,
} from "../src/native-world-scene.ts";

const I = () => new Matrix4();
function fixture() {
  const state = createNativeActorOrder([]);
  const actor = (name, matrix = I()) =>
    allocateNativeOrderedActor(state, {
      name,
      type: 0,
      renderStyle: 0,
      matrix: nativeWorldMatrix(matrix),
      localModel: known(null),
      localMaterial: known(null),
      bounds: known(null),
      provenance: "Synthetic native ACT lifecycle fixture",
    });
  const trackRoot = actor("track"),
    nonTrackActors = actor("non-track"),
    additionalActors = actor("additional");
  const columns = Array.from({ length: 3 }, (_, z) =>
    Array.from({ length: 2 }, (_, x) => {
      const column = actor(`column-${x}-${z}`);
      prependNativeActor(trackRoot, column);
      return column;
    }),
  );
  const scene = {
    layout: {
      countX: 2,
      countZ: 3,
      originX: 10,
      originZ: -20,
      columnSizeX: 3,
      columnSizeZ: 7,
    },
    trackRoot,
    nonTrackActors,
    additionalActors,
    columns,
    actors: state.actors,
    noncars: [],
    resources: new Map(),
    actorObjects: new Map(),
  };
  return { state, actor, scene };
}
function localMatrix(actor) {
  const m = actor.matrix;
  return new Matrix4().set(
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
}
function worldMatrix(actor) {
  const local = localMatrix(actor);
  return actor.parent ? worldMatrix(actor.parent).multiply(local) : local;
}
const closeMatrix = (a, b, tolerance = 2e-6) =>
  a.elements.forEach((value, i) =>
    assert.ok(
      Math.abs(value - b.elements[i]) <= tolerance,
      `World matrix component ${i}: ${value} vs ${b.elements[i]}`,
    ),
  );
const childNames = (actor) => {
  const names = [];
  enumerateNativeActorChildren(actor, (child) => {
    names.push(child.name);
    return 0;
  });
  return names;
};

test("return uses actual X/Z column dimensions and prepends without allocating ACTs", () => {
  const f = fixture(),
    old = f.actor("existing"),
    body = f.actor("returned", new Matrix4().makeTranslation(15, 2, -4));
  prependNativeActor(f.scene.columns[2][1], old);
  prependNativeActor(f.scene.nonTrackActors, body);
  const count = f.state.actors.length,
    resources = f.scene.resources,
    matrix = body.matrix,
    before = worldMatrix(body);
  const result = returnNativeWorldActor(f.scene, body, new Vector3(15, 2, -4));
  assert.equal(result.destination, "column");
  assert.deepEqual(result.column, [1, 2]);
  assert.equal(result.parent, f.scene.columns[2][1]);
  assert.deepEqual(childNames(result.parent), ["returned", "existing"]);
  assert.equal(body.previous, null);
  assert.equal(old.previous, body);
  assert.equal(f.scene.nonTrackActors.firstChild, null);
  assert.equal(f.state.actors.length, count);
  assert.equal(f.scene.resources, resources);
  assert.deepEqual(body.matrix, matrix);
  closeMatrix(worldMatrix(body), before);
});

test("return clamps outside track positions and keeps NULL columns as actual root fallback", () => {
  const f = fixture(),
    body = f.actor("returned");
  prependNativeActor(f.scene.nonTrackActors, body);
  let result = returnNativeWorldActor(f.scene, body, [-100, 0, 100]);
  assert.deepEqual(result.column, [0, 2]);
  assert.equal(result.parent, f.scene.columns[2][0]);
  f.scene.columns[0][0] = null;
  result = returnNativeWorldActor(f.scene, body, [10, 0, -20]);
  assert.equal(result.destination, "track-root");
  assert.equal(body.parent, f.scene.trackRoot);
  assert.equal(f.scene.trackRoot.firstChild, body);
});

test("additional return uses its actual group and stays unparented when native NULL", () => {
  const f = fixture(),
    body = f.actor("returned");
  prependNativeActor(f.scene.nonTrackActors, body);
  const before = worldMatrix(body);
  let result = returnNativeWorldActor(f.scene, body, [12, 0, -15], true);
  assert.equal(result.destination, "additional");
  assert.equal(body.parent, f.scene.additionalActors);
  f.scene.additionalActors = null;
  result = returnNativeWorldActor(f.scene, body, [12, 0, -15], true);
  assert.equal(result.destination, "unparented");
  assert.equal(result.parent, null);
  assert.equal(body.parent, null);
  assert.equal(body.next, null);
  assert.equal(body.previous, null);
  closeMatrix(worldMatrix(body), before);
});

test("native parent rebasing preserves rotation, translation and nonuniform affine scale", () => {
  const f = fixture();
  f.scene.nonTrackActors.matrix = nativeWorldMatrix(
    new Matrix4().compose(
      new Vector3(2, 3, 4),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4),
      new Vector3(2, 1, 0.5),
    ),
  );
  f.scene.trackRoot.matrix = nativeWorldMatrix(
    new Matrix4().compose(
      new Vector3(-3, 1, 2),
      new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.3),
      new Vector3(0.75, 1.5, 2),
    ),
  );
  const destination = f.scene.columns[2][1];
  destination.matrix = nativeWorldMatrix(
    new Matrix4().makeTranslation(1, 2, 3),
  );
  const body = f.actor(
    "returned",
    new Matrix4().compose(
      new Vector3(5, 2, -4),
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.7),
      new Vector3(1, 0.8, 1.2),
    ),
  );
  const child = f.actor("child", new Matrix4().makeTranslation(1, 0, 2));
  prependNativeActor(body, child);
  prependNativeActor(f.scene.nonTrackActors, body);
  const before = worldMatrix(body),
    childBefore = worldMatrix(child);
  returnNativeWorldActor(f.scene, body, [15, 0, -4]);
  assert.equal(body.parent, destination);
  closeMatrix(worldMatrix(body), before);
  closeMatrix(worldMatrix(child), childBefore);
  assert.equal(child.parent, body);
  assert.equal(child.depth, body.depth + 1);
});

test("saved-next enumeration returns every ACT without losing adjacent non-track siblings", () => {
  const f = fixture();
  for (const name of ["one", "two", "three"])
    prependNativeActor(f.scene.nonTrackActors, f.actor(name));
  const visited = [];
  enumerateNativeActorChildren(f.scene.nonTrackActors, (actor) => {
    visited.push(actor.name);
    returnNativeWorldActor(f.scene, actor, [15, 0, -4]);
    return 0;
  });
  assert.deepEqual(visited, ["three", "two", "one"]);
  assert.equal(f.scene.nonTrackActors.firstChild, null);
  assert.deepEqual(childNames(f.scene.columns[2][1]), ["one", "two", "three"]);
});

test("invalid destination inputs fail before changing ACT ownership", () => {
  const f = fixture(),
    body = f.actor("returned"),
    sibling = f.actor("sibling");
  prependNativeActor(f.scene.nonTrackActors, sibling);
  prependNativeActor(f.scene.nonTrackActors, body);
  const local = [...body.matrix];
  const intact = () => {
    assert.equal(body.parent, f.scene.nonTrackActors);
    assert.equal(body.next, sibling);
    assert.equal(sibling.previous, body);
    assert.deepEqual(body.matrix, local);
  };
  assert.throws(
    () => returnNativeWorldActor(f.scene, body, [NaN, 0, 0]),
    /finite/,
  );
  intact();
  f.scene.columns[2][1].matrix = nativeWorldMatrix(
    new Matrix4().makeScale(0, 1, 1),
  );
  assert.throws(
    () => returnNativeWorldActor(f.scene, body, [15, 0, -4]),
    /invertible/,
  );
  intact();
  f.scene.columns[0][0] = null;
  delete f.scene.trackRoot;
  assert.throws(
    () => returnNativeWorldActor(f.scene, body, [10, 0, -20]),
    /authoritative/,
  );
  intact();
  f.scene.additionalActors = body;
  assert.throws(
    () => returnNativeWorldActor(f.scene, body, [10, 0, -20], true),
    /cycle/,
  );
  intact();
});
