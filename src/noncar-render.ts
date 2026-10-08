import * as THREE from "three";
import type { NonCarBody } from "./physics/noncar-body";

type MaterialSet = THREE.Material | THREE.Material[];
interface MeshRecord {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  material: MaterialSet;
  visible: boolean;
  renderable: boolean;
  localToScene: THREE.Matrix4;
  uploaded: boolean;
  batch?: InstanceGroup;
  slot?: number;
}
interface ObjectRecord {
  object: THREE.Object3D;
  parent: THREE.Object3D | null;
  children: THREE.Object3D[];
  visible: boolean;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  matrix: THREE.Matrix4;
  matrixWorld: THREE.Matrix4;
  matrixAutoUpdate: boolean;
  meshRecord?: MeshRecord;
}
interface BodyRecord {
  body: NonCarBody;
  actorParent: THREE.Object3D | null;
  ancestors: ObjectRecord[];
  nodes: ObjectRecord[];
  meshes: MeshRecord[];
  position: THREE.Vector3;
  orientation: THREE.Quaternion;
  pulled: boolean;
}
interface InstanceGroup {
  mesh: THREE.InstancedMesh;
  records: MeshRecord[];
  dirty: boolean;
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
function sameMaterial(a: MaterialSet, b: MaterialSet): boolean {
  if (a === b) return true;
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((v, i) => v === b[i])
  );
}
function sameMatrix(
  a: THREE.Matrix4,
  b: THREE.Matrix4,
  epsilon = 1e-8,
): boolean {
  return a.elements.every((v, i) => Math.abs(v - b.elements[i]) <= epsilon);
}
function sameObjectSnapshot(
  node: ObjectRecord,
  checkVisibility = true,
): boolean {
  const object = node.object;
  if (
    object.parent !== node.parent ||
    object.children.length !== node.children.length ||
    (checkVisibility && object.visible !== node.visible)
  )
    return false;
  for (let i = 0; i < node.children.length; i++)
    if (object.children[i] !== node.children[i]) return false;
  if (
    !object.position.equals(node.position) ||
    !object.quaternion.equals(node.quaternion) ||
    !object.scale.equals(node.scale)
  )
    return false;
  return (
    object.matrixAutoUpdate === node.matrixAutoUpdate &&
    (object.matrixAutoUpdate || sameMatrix(object.matrix, node.matrix)) &&
    sameMatrix(object.matrixWorld, node.matrixWorld)
  );
}

/** Batches sleeping noncar meshes by their shared source geometry/material.
 * The source actor hierarchy remains attached and collision-readable; only
 * visible drawing is transferred to these disposable instances. */
export class NonCarRenderBatch {
  readonly group = new THREE.Group();
  private readonly bodies = new Map<NonCarBody, BodyRecord>();
  private readonly instances: InstanceGroup[] = [];
  private readonly sceneInverse = new THREE.Matrix4();
  private readonly poseScratch = new THREE.Matrix4();
  private disposed = false;

  constructor(
    bodies: readonly NonCarBody[],
    private readonly scene: THREE.Object3D,
  ) {
    this.group.name = "sleeping-noncar-instances";
    this.group.matrixAutoUpdate = false;
    this.group.matrix.identity();
    scene.add(this.group);
    scene.updateWorldMatrix(true, false);
    const geometryGroups = new Map<
      THREE.BufferGeometry,
      Array<{ material: MaterialSet; records: MeshRecord[] }>
    >();
    for (const body of new Set(bodies)) {
      const record = this.capture(body);
      this.bodies.set(body, record);
      for (const meshRecord of record.meshes) {
        let groups = geometryGroups.get(meshRecord.geometry);
        if (!groups) geometryGroups.set(meshRecord.geometry, (groups = []));
        let materialGroup = groups.find((candidate) =>
          sameMaterial(candidate.material, meshRecord.material),
        );
        if (!materialGroup)
          groups.push(
            (materialGroup = { material: meshRecord.material, records: [] }),
          );
        materialGroup.records.push(meshRecord);
      }
    }
    for (const [geometry, groups] of geometryGroups)
      for (const materialGroup of groups) {
        const instance = new THREE.InstancedMesh(
          geometry,
          materialGroup.material,
          materialGroup.records.length,
        );
        instance.name = "sleeping-noncar-instance-set";
        instance.frustumCulled = false;
        instance.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        materialGroup.records.forEach((_, index) =>
          instance.setMatrixAt(index, HIDDEN),
        );
        instance.instanceMatrix.needsUpdate = true;
        this.group.add(instance);
        const batch = {
          mesh: instance,
          records: materialGroup.records,
          dirty: false,
        };
        this.instances.push(batch);
        materialGroup.records.forEach((record, index) => {
          record.batch = batch;
          record.slot = index;
        });
      }
    this.update();
  }

  private capture(body: NonCarBody): BodyRecord {
    const actor = body.actor;
    actor.updateWorldMatrix(true, true);
    this.scene.updateWorldMatrix(true, false);
    this.sceneInverse.copy(this.scene.matrixWorld).invert();
    const snapshot = (object: THREE.Object3D): ObjectRecord => ({
      object,
      parent: object.parent,
      children: [...object.children],
      visible: object.visible,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
      matrix: object.matrix.clone(),
      matrixWorld: object.matrixWorld.clone(),
      matrixAutoUpdate: object.matrixAutoUpdate,
    });
    const ancestors: ObjectRecord[] = [];
    for (
      let current = actor.parent;
      current && current !== this.scene;
      current = current.parent
    )
      ancestors.push(snapshot(current));
    const nodes: BodyRecord["nodes"] = [],
      meshes: MeshRecord[] = [];
    actor.traverse((object) => {
      const node = snapshot(object);
      nodes.push(node);
      if (!(object instanceof THREE.Mesh)) return;
      const path: THREE.Object3D[] = [];
      for (
        let current: THREE.Object3D | null = object;
        current;
        current = current.parent
      ) {
        path.push(current);
        if (current === actor) break;
      }
      const record: MeshRecord = {
        mesh: object,
        geometry: object.geometry,
        material: object.material,
        visible: object.visible,
        renderable: object.visible && path.every((node) => node.visible),
        localToScene: this.poseScratch
          .multiplyMatrices(this.sceneInverse, object.matrixWorld)
          .clone(),
        uploaded: false,
      };
      node.meshRecord = record;
      meshes.push(record);
    });
    const record: BodyRecord = {
      body,
      actorParent: actor.parent,
      ancestors,
      nodes,
      meshes,
      position: body.state.position.clone(),
      orientation: body.state.orientation.clone(),
      pulled: false,
    };
    return record;
  }

  private stillMatches(record: BodyRecord): boolean {
    const { body } = record;
    if (
      body.motor.sleeping !== true ||
      body.actor.parent !== record.actorParent ||
      !body.actor.visible
    )
      return false;
    if (
      body.state.position.distanceToSquared(record.position) > 1e-12 ||
      1 - Math.abs(body.state.orientation.dot(record.orientation)) > 1e-10
    )
      return false;
    for (const node of record.ancestors) {
      if (!sameObjectSnapshot(node) || !node.object.visible) return false;
    }
    for (const node of record.nodes) {
      // Mesh visibility is changed by this batch itself; all parent visibility
      // and every local transform remain checked without world-matrix rebuilds.
      if (!(node.object instanceof THREE.Mesh) && !sameObjectSnapshot(node))
        return false;
      if (node.object instanceof THREE.Mesh) {
        const source = node.meshRecord;
        if (
          !source ||
          node.object.parent !== node.parent ||
          node.object.children.length !== node.children.length
        )
          return false;
        for (let i = 0; i < node.children.length; i++)
          if (node.object.children[i] !== node.children[i]) return false;
        if (
          !node.object.position.equals(node.position) ||
          !node.object.quaternion.equals(node.quaternion) ||
          !node.object.scale.equals(node.scale)
        )
          return false;
        if (
          node.object.matrixAutoUpdate !== node.matrixAutoUpdate ||
          (!node.object.matrixAutoUpdate &&
            !sameMatrix(node.object.matrix, node.matrix))
        )
          return false;
        if (
          node.object.geometry !== source.geometry ||
          !sameMaterial(node.object.material, source.material)
        )
          return false;
      }
    }
    return true;
  }

  private pull(record: BodyRecord): void {
    if (record.pulled) return;
    record.pulled = true;
    for (const source of record.meshes) {
      if (source.batch && source.slot !== undefined) {
        source.batch.mesh.setMatrixAt(source.slot, HIDDEN);
        source.batch.mesh.instanceMatrix.needsUpdate = true;
        source.batch.dirty = false;
      }
    }
    for (const source of record.meshes) source.mesh.visible = source.visible;
  }

  update(): void {
    if (this.disposed) return;
    this.group.visible = true;
    for (const record of this.bodies.values()) {
      if (record.pulled) continue;
      if (!this.stillMatches(record)) {
        this.pull(record);
        continue;
      }
      for (const source of record.meshes) {
        if (
          !source.renderable ||
          source.uploaded ||
          !source.batch ||
          source.slot === undefined
        )
          continue;
        source.batch.mesh.setMatrixAt(source.slot, source.localToScene);
        source.batch.dirty = true;
        source.uploaded = true;
        source.mesh.visible = false;
      }
    }
    for (const instance of this.instances)
      if (instance.dirty) {
        instance.mesh.instanceMatrix.needsUpdate = true;
        instance.dirty = false;
      }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const record of this.bodies.values()) this.pull(record);
    this.group.removeFromParent();
    for (const instance of this.instances) instance.mesh.dispose();
    this.instances.length = 0;
    this.bodies.clear();
  }
}
