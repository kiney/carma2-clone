import * as THREE from "three";
import type { NonCarBody } from "./physics/noncar-body";

type MaterialSet = THREE.Material | THREE.Material[];
type GeometryAttribute =
  | THREE.BufferAttribute
  | THREE.InterleavedBufferAttribute;
interface AttributeRecord {
  attribute: GeometryAttribute;
  array: GeometryAttribute["array"];
  buffer: THREE.BufferAttribute | THREE.InterleavedBuffer;
  version: number;
  itemSize: number;
  count: number;
  normalized: boolean;
  offset?: number;
  stride?: number;
}
interface GeometryRecord {
  geometry: THREE.BufferGeometry;
  attributes: THREE.BufferGeometry["attributes"];
  entries: Array<{ name: string; record: AttributeRecord }>;
  index: AttributeRecord | null;
  drawRange: THREE.BufferGeometry["drawRange"];
  drawStart: number;
  drawCount: number;
  groups: THREE.BufferGeometry["groups"];
  groupEntries: Array<{
    group: THREE.BufferGeometry["groups"][number];
    start: number;
    count: number;
    materialIndex?: number;
  }>;
}
interface MeshRecord {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  material: MaterialSet;
  materialSnapshot: MaterialSet;
  geometryRecord: GeometryRecord;
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
  matrixWorldAutoUpdate: boolean;
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
  batched: boolean;
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
  for (let i = 0; i < 16; i++)
    if (!(Math.abs(a.elements[i] - b.elements[i]) <= epsilon)) return false;
  return true;
}
function sameObjectSnapshot(
  node: ObjectRecord,
  checkVisibility = true,
  checkChildren = true,
): boolean {
  const object = node.object;
  if (
    !ordinaryMatrixUpdates(object) ||
    object.parent !== node.parent ||
    (checkChildren && object.children.length !== node.children.length) ||
    (checkVisibility && object.visible !== node.visible)
  )
    return false;
  if (checkChildren)
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
    object.matrixWorldAutoUpdate === node.matrixWorldAutoUpdate &&
    (object.matrixAutoUpdate || sameMatrix(object.matrix, node.matrix)) &&
    sameMatrix(object.matrixWorld, node.matrixWorld)
  );
}

function ordinaryMatrixUpdates(object: THREE.Object3D): boolean {
  return (
    object.updateMatrix === THREE.Object3D.prototype.updateMatrix &&
    object.updateMatrixWorld === THREE.Object3D.prototype.updateMatrixWorld &&
    object.updateWorldMatrix === THREE.Object3D.prototype.updateWorldMatrix
  );
}

function captureObject(object: THREE.Object3D, children = true): ObjectRecord {
  return {
    object,
    parent: object.parent,
    children: children ? [...object.children] : [],
    visible: object.visible,
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone(),
    matrix: object.matrix.clone(),
    matrixWorld: object.matrixWorld.clone(),
    matrixAutoUpdate: object.matrixAutoUpdate,
    matrixWorldAutoUpdate: object.matrixWorldAutoUpdate,
  };
}

function captureAttribute(attribute: GeometryAttribute): AttributeRecord {
  const interleaved = attribute instanceof THREE.InterleavedBufferAttribute,
    buffer = interleaved ? attribute.data : attribute;
  return {
    attribute,
    array: attribute.array,
    buffer,
    version: buffer.version,
    itemSize: attribute.itemSize,
    count: attribute.count,
    normalized: attribute.normalized,
    offset: interleaved ? attribute.offset : undefined,
    stride: interleaved ? attribute.data.stride : undefined,
  };
}

function sameAttribute(
  attribute: GeometryAttribute | null,
  record: AttributeRecord | null,
): boolean {
  if (!attribute || !record) return attribute === null && record === null;
  if (attribute !== record.attribute) return false;
  const interleaved = attribute instanceof THREE.InterleavedBufferAttribute,
    buffer = interleaved ? attribute.data : attribute;
  return (
    attribute.array === record.array &&
    buffer === record.buffer &&
    buffer.version === record.version &&
    attribute.itemSize === record.itemSize &&
    attribute.count === record.count &&
    attribute.normalized === record.normalized &&
    (!interleaved ||
      (attribute.offset === record.offset &&
        attribute.data.stride === record.stride))
  );
}

function sameGeometry(record: GeometryRecord): boolean {
  const geometry = record.geometry;
  if (
    geometry.attributes !== record.attributes ||
    geometry.drawRange !== record.drawRange ||
    geometry.drawRange.start !== record.drawStart ||
    geometry.drawRange.count !== record.drawCount ||
    geometry.groups !== record.groups ||
    geometry.groups.length !== record.groupEntries.length ||
    !sameAttribute(geometry.index, record.index)
  )
    return false;
  let attributeCount = 0;
  for (const name in geometry.attributes) attributeCount++;
  if (attributeCount !== record.entries.length) return false;
  for (const entry of record.entries)
    if (!sameAttribute(geometry.attributes[entry.name] ?? null, entry.record))
      return false;
  for (let i = 0; i < record.groupEntries.length; i++) {
    const entry = record.groupEntries[i],
      group = geometry.groups[i];
    if (
      group !== entry.group ||
      group.start !== entry.start ||
      group.count !== entry.count ||
      group.materialIndex !== entry.materialIndex
    )
      return false;
  }
  return true;
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
  private readonly sceneSnapshot: ObjectRecord;
  private readonly ancestorSnapshots = new Map<THREE.Object3D, ObjectRecord>();
  private readonly ancestorResults = new Map<ObjectRecord, boolean>();
  private readonly geometrySnapshots = new Map<
    THREE.BufferGeometry,
    GeometryRecord
  >();
  private readonly geometryResults = new Map<GeometryRecord, boolean>();
  /** Frame-local certificates for presentation matrix preparation only.
   * Explicit physics/animation matrix APIs retain their ordinary traversal. */
  readonly matrixSkipRoots = new Set<THREE.Object3D>();
  readonly matrixSkipAncestors = new Set<THREE.Object3D>();
  readonly diagnostics = {
    populationBodies: 0,
    instanceGroups: 0,
    totalSlots: 0,
    batchedBodies: 0,
    validatedBodies: 0,
    uniqueAncestorChecks: 0,
    nodeChecks: 0,
    uniqueGeometryChecks: 0,
  };
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
    this.sceneSnapshot = captureObject(scene, false);
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
    this.diagnostics.populationBodies = this.bodies.size;
    this.diagnostics.instanceGroups = this.instances.length;
    this.diagnostics.totalSlots = this.instances.reduce(
      (total, instance) => total + instance.records.length,
      0,
    );
  }

  /** Last validated drawing ownership; callers query after update(), before
   * applying temporary render poses. Wake/changes permanently restore meshes. */
  isBatched(body: NonCarBody): boolean {
    return !this.disposed && this.bodies.get(body)?.batched === true;
  }

  private captureGeometry(geometry: THREE.BufferGeometry): GeometryRecord {
    let record = this.geometrySnapshots.get(geometry);
    if (!record) {
      record = {
        geometry,
        attributes: geometry.attributes,
        entries: Object.entries(geometry.attributes).map(
          ([name, attribute]) => ({
            name,
            record: captureAttribute(attribute),
          }),
        ),
        index: geometry.index ? captureAttribute(geometry.index) : null,
        drawRange: geometry.drawRange,
        drawStart: geometry.drawRange.start,
        drawCount: geometry.drawRange.count,
        groups: geometry.groups,
        groupEntries: geometry.groups.map((group) => ({
          group,
          start: group.start,
          count: group.count,
          materialIndex: group.materialIndex,
        })),
      };
      this.geometrySnapshots.set(geometry, record);
    }
    return record;
  }

  private capture(body: NonCarBody): BodyRecord {
    const actor = body.actor;
    actor.updateWorldMatrix(true, true);
    this.scene.updateWorldMatrix(true, false);
    this.sceneInverse.copy(this.scene.matrixWorld).invert();
    const ancestors: ObjectRecord[] = [];
    for (
      let current = actor.parent;
      current && current !== this.scene;
      current = current.parent
    ) {
      let ancestor = this.ancestorSnapshots.get(current);
      if (!ancestor) {
        ancestor = captureObject(current, false);
        this.ancestorSnapshots.set(current, ancestor);
      }
      ancestors.push(ancestor);
    }
    const nodes: BodyRecord["nodes"] = [],
      meshes: MeshRecord[] = [];
    actor.traverse((object) => {
      const node = captureObject(object);
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
        materialSnapshot: Array.isArray(object.material)
          ? [...object.material]
          : object.material,
        geometryRecord: this.captureGeometry(object.geometry),
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
      batched: false,
    };
    return record;
  }

  private stillMatches(record: BodyRecord): boolean {
    this.diagnostics.validatedBodies++;
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
      let matches = this.ancestorResults.get(node);
      if (matches === undefined) {
        this.diagnostics.uniqueAncestorChecks++;
        // Parent links certify this body's path. Unrelated siblings do not
        // change its drawing pose and must not evict the whole population.
        matches = sameObjectSnapshot(node, true, false) && node.object.visible;
        this.ancestorResults.set(node, matches);
      }
      if (!matches) return false;
    }
    for (const node of record.nodes) {
      this.diagnostics.nodeChecks++;
      // Mesh visibility is changed by this batch itself; all parent visibility
      // and every local transform remain checked without world-matrix rebuilds.
      if (!(node.object instanceof THREE.Mesh) && !sameObjectSnapshot(node))
        return false;
      if (node.object instanceof THREE.Mesh) {
        const source = node.meshRecord;
        if (
          !source ||
          !ordinaryMatrixUpdates(node.object) ||
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
          node.object.matrixWorldAutoUpdate !== node.matrixWorldAutoUpdate ||
          (!node.object.matrixAutoUpdate &&
            !sameMatrix(node.object.matrix, node.matrix)) ||
          !sameMatrix(node.object.matrixWorld, node.matrixWorld)
        )
          return false;
        if (
          node.object.geometry !== source.geometry ||
          !sameMaterial(node.object.material, source.materialSnapshot) ||
          node.object.userData.worldSmashDisabled ||
          (source.uploaded && node.object.visible)
        )
          return false;
        let geometryMatches = this.geometryResults.get(source.geometryRecord);
        if (geometryMatches === undefined) {
          this.diagnostics.uniqueGeometryChecks++;
          geometryMatches = sameGeometry(source.geometryRecord);
          this.geometryResults.set(source.geometryRecord, geometryMatches);
        }
        if (!geometryMatches) return false;
      }
    }
    return true;
  }

  private pull(record: BodyRecord): void {
    if (record.pulled) return;
    record.pulled = true;
    record.batched = false;
    for (const source of record.meshes) {
      if (source.batch && source.slot !== undefined) {
        source.batch.mesh.setMatrixAt(source.slot, HIDDEN);
        source.batch.mesh.instanceMatrix.needsUpdate = true;
        source.batch.dirty = false;
      }
    }
    // SmashObject's explicit ACT-style NONE marker owns this visibility,
    // including direct mesh siblings disabled by replacement models.
    for (const source of record.meshes)
      source.mesh.visible = source.mesh.userData.worldSmashDisabled
        ? false
        : source.visible;
  }

  update(): void {
    if (this.disposed) return;
    this.ancestorResults.clear();
    this.geometryResults.clear();
    this.matrixSkipRoots.clear();
    this.matrixSkipAncestors.clear();
    this.diagnostics.batchedBodies = 0;
    this.diagnostics.validatedBodies = 0;
    this.diagnostics.uniqueAncestorChecks = 0;
    this.diagnostics.nodeChecks = 0;
    this.diagnostics.uniqueGeometryChecks = 0;
    this.group.visible = true;
    const sceneMatches = sameObjectSnapshot(this.sceneSnapshot, true, false);
    for (const record of this.bodies.values()) {
      if (record.pulled) continue;
      if (!sceneMatches || !this.stillMatches(record)) {
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
        record.batched = true;
      }
      if (record.batched) {
        this.diagnostics.batchedBodies++;
        this.matrixSkipRoots.add(record.body.actor);
        for (const node of record.ancestors)
          this.matrixSkipAncestors.add(node.object);
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
    this.ancestorSnapshots.clear();
    this.ancestorResults.clear();
    this.geometrySnapshots.clear();
    this.geometryResults.clear();
    this.matrixSkipRoots.clear();
    this.matrixSkipAncestors.clear();
    this.diagnostics.batchedBodies = 0;
  }
}
