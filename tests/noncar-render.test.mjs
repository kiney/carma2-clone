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

function sharedFixture(count = 3) {
  const scene = new THREE.Group(),
    outer = new THREE.Group(),
    parent = new THREE.Group(),
    geometry = new THREE.BoxGeometry(),
    material = new THREE.MeshBasicMaterial(),
    props = [],
    meshes = [];
  scene.add(outer);
  outer.add(parent);
  for (let index = 0; index < count; index++) {
    const actor = new THREE.Group(),
      mesh = new THREE.Mesh(geometry, material);
    actor.position.x = index * 3;
    actor.add(mesh);
    parent.add(actor);
    props.push(body(actor));
    meshes.push(mesh);
  }
  return {
    scene,
    outer,
    parent,
    geometry,
    material,
    props,
    meshes,
    batch: new NonCarRenderBatch(props, scene),
  };
}

test("shared ancestor and geometry certificates run once per update without sibling scans", () => {
  const fixture = sharedFixture(12),
    { batch, parent, outer, props } = fixture;
  const children = parent.children;
  let siblingReads = 0;
  Object.defineProperty(parent, "children", {
    configurable: true,
    get() {
      siblingReads++;
      return children;
    },
  });
  batch.update();
  assert.equal(siblingReads, 0);
  assert.equal(batch.diagnostics.uniqueAncestorChecks, 2);
  assert.equal(batch.diagnostics.uniqueGeometryChecks, 1);
  assert.equal(batch.diagnostics.validatedBodies, 12);
  assert.equal(batch.diagnostics.nodeChecks, 24);
  assert.equal(batch.diagnostics.populationBodies, 12);
  assert.equal(batch.diagnostics.totalSlots, 12);
  assert.equal(batch.diagnostics.instanceGroups, 1);
  assert.equal(batch.diagnostics.batchedBodies, 12);
  assert.ok(props.every((prop) => batch.isBatched(prop)));
  assert.deepEqual(
    [...batch.matrixSkipRoots],
    props.map((prop) => prop.actor),
  );
  assert.deepEqual([...batch.matrixSkipAncestors], [parent, outer]);
  Object.defineProperty(parent, "children", {
    configurable: true,
    writable: true,
    value: children,
  });
  batch.dispose();
  assert.equal(batch.matrixSkipRoots.size, 0);
  assert.equal(batch.matrixSkipAncestors.size, 0);
  assert.ok(props.every((prop) => !batch.isBatched(prop)));
});

test("adding, removing and reordering unrelated ancestor siblings preserves dormant drawings", () => {
  const { batch, parent, props, meshes } = sharedFixture();
  const unrelated = new THREE.Group();
  parent.add(unrelated);
  parent.children.reverse();
  batch.update();
  assert.ok(props.every((prop) => batch.isBatched(prop)));
  assert.ok(meshes.every((mesh) => !mesh.visible));
  parent.remove(unrelated);
  batch.update();
  assert.ok(props.every((prop) => batch.isBatched(prop)));
  batch.dispose();
});

test("shared parent pose, visibility and path changes invalidate all affected roots", () => {
  for (const change of [
    ({ parent }) => (parent.position.x += 1),
    ({ parent }) => (parent.visible = false),
    ({ scene, parent }) => scene.attach(parent),
    ({ outer }) => outer.removeFromParent(),
    ({ parent }) => (parent.matrixWorld.elements[12] += 1),
  ]) {
    const fixture = sharedFixture();
    change(fixture);
    fixture.batch.update();
    assert.ok(fixture.props.every((prop) => !fixture.batch.isBatched(prop)));
    assert.ok(fixture.meshes.every((mesh) => mesh.visible));
    assert.equal(fixture.batch.matrixSkipRoots.size, 0);
    assert.equal(fixture.batch.matrixSkipAncestors.size, 0);
    assert.ok(fixture.batch.diagnostics.uniqueAncestorChecks <= 2);
    fixture.batch.dispose();
  }
});

test("one body reparent or removal preserves unchanged sibling batch certificates", () => {
  for (const remove of [false, true]) {
    const { batch, scene, props, meshes } = sharedFixture();
    if (remove) props[0].actor.removeFromParent();
    else scene.attach(props[0].actor);
    batch.update();
    assert.equal(batch.isBatched(props[0]), false);
    assert.equal(meshes[0].visible, true);
    assert.ok(props.slice(1).every((prop) => batch.isBatched(prop)));
    assert.equal(batch.matrixSkipRoots.size, 2);
    batch.dispose();
  }
});

test("scene pose or source mesh world-matrix changes revoke frame-local skip certificates", () => {
  for (const change of [
    ({ scene }) => (scene.position.x += 1),
    ({ scene }) =>
      scene.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.2),
    ({ scene }) => (scene.scale.x *= 2),
    ({ scene }) => (scene.matrixAutoUpdate = false),
    ({ scene }) => (scene.matrixWorldAutoUpdate = false),
    ({ parent }) => (parent.matrixWorldAutoUpdate = false),
    ({ props }) => (props[0].actor.matrixWorldAutoUpdate = false),
    ({ meshes }) => (meshes[0].matrixWorldAutoUpdate = false),
    ({ scene }) => (scene.matrixWorld.elements[12] += 1),
    ({ meshes }) => (meshes[0].matrixWorld.elements[12] += 1),
  ]) {
    const fixture = sharedFixture(1);
    change(fixture);
    fixture.batch.update();
    assert.equal(fixture.batch.isBatched(fixture.props[0]), false);
    assert.equal(fixture.meshes[0].visible, true);
    assert.equal(fixture.batch.matrixSkipRoots.size, 0);
    fixture.batch.dispose();
  }
});

test("manual scene matrix changes before world refresh revoke dormant certificates", () => {
  const scene = new THREE.Group(),
    actor = new THREE.Group(),
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
    );
  scene.matrixAutoUpdate = false;
  actor.add(mesh);
  scene.add(actor);
  const prop = body(actor),
    batch = new NonCarRenderBatch([prop], scene);
  assert.equal(batch.isBatched(prop), true);
  scene.matrix.elements[12] = 7;
  batch.update();
  assert.equal(batch.isBatched(prop), false);
  assert.equal(batch.matrixSkipRoots.size, 0);
  assert.equal(mesh.visible, true);
  batch.dispose();
});

test("custom matrix-update methods fall back to ordinary source drawing", () => {
  for (const method of [
    "updateMatrix",
    "updateMatrixWorld",
    "updateWorldMatrix",
  ])
    for (const target of ["mesh", "ancestor"]) {
      const fixture = sharedFixture(1),
        object = target === "mesh" ? fixture.meshes[0] : fixture.parent,
        original = object[method];
      object[method] = function (...args) {
        return original.apply(this, args);
      };
      fixture.batch.update();
      assert.equal(fixture.batch.isBatched(fixture.props[0]), false);
      assert.equal(fixture.meshes[0].visible, true);
      assert.equal(fixture.batch.matrixSkipRoots.size, 0);
      fixture.batch.dispose();
    }
});

test("geometry attribute, buffer, draw range and material group changes restore shared meshes", () => {
  for (const change of [
    ({ geometry }) => (geometry.attributes.position.needsUpdate = true),
    ({ geometry }) => (geometry.attributes.uv.needsUpdate = true),
    ({ geometry }) => (geometry.index.needsUpdate = true),
    ({ geometry }) =>
      geometry.setAttribute("position", geometry.attributes.position.clone()),
    ({ geometry }) =>
      (geometry.attributes.position.array =
        geometry.attributes.position.array.slice()),
    ({ geometry }) => geometry.deleteAttribute("normal"),
    ({ geometry }) =>
      geometry.setAttribute("color", geometry.attributes.position.clone()),
    ({ geometry }) => (geometry.attributes = { ...geometry.attributes }),
    ({ geometry }) => (geometry.drawRange.start = 3),
    ({ geometry }) => (geometry.drawRange.count = 3),
    ({ geometry }) => (geometry.drawRange = { ...geometry.drawRange }),
    ({ geometry }) => (geometry.groups[0].start = 3),
    ({ geometry }) => (geometry.groups[0].materialIndex = 1),
    ({ geometry }) => (geometry.groups = [...geometry.groups]),
    ({ geometry }) => (geometry.groups[0] = { ...geometry.groups[0] }),
  ]) {
    const fixture = sharedFixture();
    change(fixture);
    fixture.batch.update();
    assert.ok(fixture.props.every((prop) => !fixture.batch.isBatched(prop)));
    assert.ok(fixture.meshes.every((mesh) => mesh.visible));
    assert.equal(fixture.batch.diagnostics.uniqueGeometryChecks, 1);
    assert.equal(fixture.batch.matrixSkipRoots.size, 0);
    fixture.batch.dispose();
  }
});

test("in-place material-array replacement and explicit mesh visibility restore source drawing", () => {
  for (const change of [
    (mesh) => (mesh.material[0] = new THREE.MeshBasicMaterial()),
    (mesh) => (mesh.visible = true),
  ]) {
    const scene = new THREE.Group(),
      actor = new THREE.Group(),
      mesh = new THREE.Mesh(new THREE.BoxGeometry(), [
        new THREE.MeshBasicMaterial(),
      ]);
    actor.add(mesh);
    scene.add(actor);
    const prop = body(actor),
      batch = new NonCarRenderBatch([prop], scene);
    change(mesh);
    batch.update();
    assert.equal(batch.isBatched(prop), false);
    assert.equal(mesh.visible, true);
    assert.equal(batch.matrixSkipRoots.size, 0);
    batch.dispose();
  }
});

test("replacement-model eviction preserves explicitly smash-disabled direct mesh siblings", () => {
  for (const replacement of [true, false]) {
    const scene = new THREE.Group(),
      actor = new THREE.Group(),
      material = new THREE.MeshBasicMaterial(),
      primary = new THREE.Mesh(new THREE.BoxGeometry(), material),
      disabledSibling = new THREE.Mesh(new THREE.BoxGeometry(), material);
    actor.add(primary, disabledSibling);
    scene.add(actor);
    const prop = body(actor),
      batch = new NonCarRenderBatch([prop], scene);
    assert.equal(batch.isBatched(prop), true);
    assert.equal(primary.visible, false);
    assert.equal(disabledSibling.visible, false);
    // The production replacemodel handler keeps the selected mesh and marks
    // its direct sibling ACTs as style NONE before render-batch validation.
    if (replacement) primary.geometry = new THREE.SphereGeometry();
    disabledSibling.userData.worldSmashDisabled = true;
    disabledSibling.visible = false;
    batch.update();
    assert.equal(batch.isBatched(prop), false);
    assert.equal(primary.visible, true);
    assert.equal(disabledSibling.visible, false);
    assert.equal(batch.matrixSkipRoots.size, 0);
    assert.ok(
      batch.group.children.every((instance) => {
        const matrix = new THREE.Matrix4();
        for (let slot = 0; slot < instance.count; slot++) {
          instance.getMatrixAt(slot, matrix);
          if (matrix.elements[0] || matrix.elements[5] || matrix.elements[10])
            return false;
        }
        return true;
      }),
    );
    batch.dispose();
    assert.equal(primary.visible, true);
    assert.equal(disabledSibling.visible, false);
    assert.equal(disabledSibling.userData.worldSmashDisabled, true);
  }
});
