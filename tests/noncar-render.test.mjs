import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { NonCarRenderBatch } from "../src/noncar-render.ts";

function body(actor) {
  const position = new THREE.Vector3(),
    orientation = new THREE.Quaternion();
  return {
    kind: "noncar",
    actor,
    motor: { sleeping: true },
    state: {
      position,
      orientation,
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
    },
  };
}

test("sleeping meshes instance by shared geometry/material while source hierarchy stays collision-readable", () => {
  const scene = new THREE.Group();
  scene.position.set(10, 2, -4);
  const geo = new THREE.BoxGeometry(1, 2, 3),
    mat = new THREE.MeshBasicMaterial();
  const a = new THREE.Group(),
    b = new THREE.Group();
  a.position.x = 1;
  b.position.x = 3;
  const am = new THREE.Mesh(geo, mat),
    bm = new THREE.Mesh(geo, mat);
  a.add(am);
  b.add(bm);
  scene.add(a, b);
  const batch = new NonCarRenderBatch([body(a), body(b)], scene);
  assert.equal(batch.group.parent, scene);
  assert.equal(batch.group.visible, true);
  assert.equal(batch.group.children.length, 1);
  const instances = batch.group.children[0];
  assert.equal(instances.count, 2);
  assert.equal(am.visible, false);
  assert.equal(bm.visible, false);
  assert.equal(am.geometry, geo);
  assert.equal(a.children.includes(am), true);
  const first = new THREE.Matrix4();
  instances.getMatrixAt(0, first);
  assert.ok(Math.abs(first.elements[12] - 1) < 1e-6);
  assert.ok(Math.abs(first.elements[13]) < 1e-6);
  batch.dispose();
  assert.equal(am.visible, true);
  assert.equal(bm.visible, true);
  assert.equal(a.parent, scene);
  assert.equal(geo.attributes.position.count > 0, true);
});

test("awake bodies are restored immediately and permanently leave the batch", () => {
  const scene = new THREE.Group(),
    actor = new THREE.Group();
  scene.add(actor);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial(),
  );
  actor.add(mesh);
  const prop = body(actor),
    batch = new NonCarRenderBatch([prop], scene);
  assert.equal(mesh.visible, false);
  const instance = batch.group.children[0],
    initialVersion = instance.instanceMatrix.version;
  prop.motor.sleeping = false;
  batch.update();
  assert.equal(mesh.visible, true);
  assert.ok(
    instance.instanceMatrix.version > initialVersion,
    "wake uploads the zero-scale removal matrix",
  );
  prop.motor.sleeping = true;
  batch.update();
  assert.equal(mesh.visible, true);
  const matrix = new THREE.Matrix4();
  instance.getMatrixAt(0, matrix);
  assert.equal(matrix.elements[0], 0);
  assert.equal(matrix.elements[5], 0);
  assert.equal(matrix.elements[10], 0);
  batch.dispose();
});

test("moving retained parent restores the sleeping actor's original meshes", () => {
  const scene = new THREE.Group();
  const parent = new THREE.Group(),
    actor = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial(),
  );
  actor.add(mesh);
  parent.add(actor);
  scene.add(parent);
  scene.updateMatrixWorld(true);
  const batch = new NonCarRenderBatch([body(actor)], scene);
  const instance = batch.group.children[0];
  assert.equal(mesh.visible, false);
  assert.equal(batch.group.visible, true);

  parent.position.x = 4;
  scene.updateMatrixWorld(true);
  batch.update();

  assert.equal(mesh.visible, true);
  assert.equal(batch.group.visible, true);
  const matrix = new THREE.Matrix4();
  instance.getMatrixAt(0, matrix);
  assert.equal(matrix.elements[0], 0);
  assert.equal(matrix.elements[5], 0);
  assert.equal(matrix.elements[10], 0);
  batch.dispose();
});

test("pose, actor-disable, geometry and child-hierarchy changes restore source meshes", () => {
  for (const change of [
    (prop, actor, mesh) => (prop.state.position.x = 1),
    (prop, actor) => (actor.visible = false),
    (prop, actor, mesh) => (mesh.geometry = new THREE.SphereGeometry()),
    (prop, actor, mesh, child) => (child.visible = false),
    (prop, actor) => actor.removeFromParent(),
  ]) {
    const scene = new THREE.Group(),
      actor = new THREE.Group(),
      child = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    child.add(mesh);
    actor.add(child);
    scene.add(actor);
    const prop = body(actor),
      batch = new NonCarRenderBatch([prop], scene);
    change(prop, actor, mesh, child);
    batch.update();
    assert.equal(mesh.visible, true);
    if (change.name.includes("child")) assert.equal(child.visible, false);
    batch.dispose();
  }
});

test("multi-material meshes and distinct geometry sets retain shared source resources on dispose", () => {
  const scene = new THREE.Group(),
    actor = new THREE.Group();
  scene.add(actor);
  const geo = new THREE.BoxGeometry();
  geo.addGroup(0, 3, 0);
  geo.addGroup(3, 3, 1);
  const materials = [
    new THREE.MeshBasicMaterial(),
    new THREE.MeshBasicMaterial(),
  ];
  const mesh = new THREE.Mesh(geo, materials);
  actor.add(mesh);
  const batch = new NonCarRenderBatch([body(actor)], scene);
  assert.equal(batch.group.children.length, 1);
  assert.equal(batch.group.children[0].material, materials);
  batch.dispose();
  assert.ok(geo.attributes.position);
  assert.ok(materials.every((material) => !material.userData.disposed));
});
