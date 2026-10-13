import {
  WorldTransformState,
  ordinaryTransformMethods,
  worldLocalValue,
  sameWorldLocalValues,
  type WorldTransformDiagnostics,
} from "./world-transform-state";
import {
  captureColliderMesh,
  sameColliderMesh,
  type ColliderMeshState,
} from "./world-collider-state";
import {
  OrderedWorldFaceIndex,
  type FaceIndexDiagnostics,
} from "./world-face-index";
import * as THREE from "three";
import { DEFAULT_SURFACE, surfaceIndex } from "./physics/surfaces";
import type { SurfaceModifier } from "./physics/surfaces";
import { pointVelocity, type RigidBody } from "./physics/contact";
import { intersectWheelFace } from "./physics/wheel-ray";
import type { WorldSourceSnapshot, WorldSourceTriangle } from "./world-source";
import {
  createNativeFindFacesProviders,
  findNativeFacesInBox,
} from "./native-find-faces";
import {
  enumerateNativeActorChildren,
  knownNativeActorValue as known,
} from "./native-actor-order";
import type { NativeOrderedActor } from "./native-actor-order";
import type { NativeModelPickFace } from "./native-model-pick";
import {
  nativeWorldMatrix,
  pullNativeWorldActor,
  type NativeWorldScene,
} from "./native-world-scene";
import {
  invalidateNativeTrackResource,
  manageNativeTrackBounds,
  type NativeModelBoundsOptions,
  prepareNativeTrackResource,
  type NativeTrackModelResource,
} from "./native-track-resources";
import type { MatMaterial } from "./formats";
import type { NativeWorldFaceQuery } from "./physics/world-face-cache";
import { cameraTriangleInBox } from "./camera/triangle-box";
import { cameraShapeRay } from "./camera/own-shape";
import type { CollisionHull } from "./physics/geometry";

export interface WorldFaceCollectorCallbacks {
  /** Runs on the emitted immutable row before its MODEL stop notification. */
  onFace?: (surface: Surface) => void;
  pullActorFromWorld?: (actor: THREE.Object3D) => object | null;
  stopGroovidelic?: (actor: THREE.Object3D) => void;
}

export interface Surface {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  normal: THREE.Vector3;
  minY: number;
  maxY: number;
  material: string;
  modifier: SurfaceModifier;
  twoSided: boolean;
  materialFlags: number;
  pixelmapType?: number;
  faceFlags: number;
  owner?: RigidBody;
  actor?: THREE.Mesh;
  faceIndex?: number;
  enabled?: boolean;
  collisionMode?: "solid" | "passthrough" | "edges";
  /** Pre-batch ACT/DAT identity; prepared native group order is separate. */
  source?: WorldSourceTriangle;
  native?: NativeModelPickFace;
  constant?: number;
}
export interface WorldSyncDiagnostics {
  staticRebuilds?: number;
  staticOwnerRebuilds?: number;
  staticTriangleBuilds?: number;
  staticOrderRebuilds?: number;
  dynamicChecks: number;
  dynamicUnchanged: number;
  dynamicChanged: number;
  hierarchyChecks: number;
  triangleBuilds: number;
  nativeActorChecks: number;
  nativeActorWrites: number;
  nativeGeometryChecks: number;
  nativeGeometryWrites: number;
  transform: WorldTransformDiagnostics;
}
export interface WorldFaceDiagnostics extends FaceIndexDiagnostics {
  queryCalls?: number;
  localQueries?: number;
  cellVisits?: number;
  legacyReferences?: number;
  guardSweepFaces?: number;
  guardEnvelopeFallbacks?: number;
  ordinaryRayFaceTests?: number;
}
interface DynamicNodeState {
  object: THREE.Object3D;
  parent: THREE.Object3D | null;
  children: THREE.Object3D[];
  localValues: number[];
  auto: boolean;
  worldAuto: boolean;
  worldValues?: number[];
  disabled: unknown;
  skip: unknown;
  mesh?: ColliderMeshState;
}
interface NativeSyncState {
  revision: number;
  hostParent: THREE.Object3D | null;
  parent: NativeOrderedActor | null;
  parentMatrix: THREE.Matrix4;
  force: boolean;
}
interface StaticColliderState {
  surfaces: Surface[];
  cells: Set<string>;
  indexed: number;
  order: number;
  parents: THREE.Object3D[];
}
/** A fixed broad phase over transformed original triangles. Geometry stays in C2 world units. */
export class WorldCollision {
  /** Cumulative, opt-in bounded work counters; no capture retained in gameplay. */
  syncDiagnostics?: WorldSyncDiagnostics;
  /** Opt-in work counters; no physics/visibility policy changes. */
  faceDiagnostics?: WorldFaceDiagnostics;
  private faceIndex = new OrderedWorldFaceIndex();
  private transforms = new WorldTransformState();
  private nativeSync = new WeakMap<NativeOrderedActor, NativeSyncState>();
  private nativeLocalWritten = new WeakMap<
    NativeOrderedActor,
    readonly number[]
  >();
  private cells = new Map<string, Surface[]>();
  private staticOwners = new Map<THREE.Mesh, StaticColliderState>();
  private staticMembership = new Map<THREE.Object3D, Set<THREE.Mesh>>();
  private staticChildren = new Map<THREE.Object3D, readonly THREE.Object3D[]>();
  private nativeActorsByMesh = new Map<THREE.Mesh, NativeOrderedActor[]>();
  private nativeMeshesByActor = new WeakMap<NativeOrderedActor, THREE.Mesh>();
  private cellSize = 4;
  private staticGuardRevision: object = {};
  private staticGuardFriction: number[] = [];
  private staticGuardDefaultFriction = NaN;
  private dynamicGuardOwners = new Set<RigidBody>();
  /** Certificate only for the pure static trajectory guard. Native collection
   * callbacks and moving-owner queries are deliberately not cached across passes.
   * Surface snapshots follow the explicit invalidateActors/rebuild contract. */
  getStaticGuardRevision(): object | undefined {
    if (
      this.dynamicGuardOwners.size ||
      this.modifier !== WorldCollision.prototype.modifier ||
      this.querySurfaces !== WorldCollision.prototype.querySurfaces ||
      this.queryLocalSurfaces !== WorldCollision.prototype.queryLocalSurfaces
    )
      return undefined;
    if (
      this.staticGuardFriction.length !== this.modifiers.length ||
      !Object.is(
        DEFAULT_SURFACE.wallFriction,
        this.staticGuardDefaultFriction,
      ) ||
      this.modifiers.some(
        (m, i) => !Object.is(m.wallFriction, this.staticGuardFriction[i]),
      )
    ) {
      this.staticGuardRevision = {};
      this.staticGuardFriction = this.modifiers.map((m) => m.wallFriction);
      this.staticGuardDefaultFriction = DEFAULT_SURFACE.wallFriction;
    }
    return this.staticGuardRevision;
  }
  triangles = 0;
  private readonly sourceMeshes: readonly THREE.Mesh[] | undefined;
  private readonly sourceTriangles = new Map<
    THREE.Mesh,
    Map<number, WorldSourceTriangle>
  >();
  private readonly nativePoses = new Map<
    NativeOrderedActor,
    { values: readonly number[]; parent: THREE.Object3D | null }
  >();
  private readonly sourceFaceLookup = new Map<
    THREE.Mesh,
    Map<number, WorldSourceTriangle>
  >();
  constructor(
    private sourceRoot: THREE.Object3D,
    private modifiers: readonly SurfaceModifier[] = [DEFAULT_SURFACE],
    readonly sourceSnapshot?: WorldSourceSnapshot,
    readonly nativeScene?: NativeWorldScene,
  ) {
    if (nativeScene?.meshes)
      for (const [actor, mesh] of nativeScene.meshes) {
        this.rememberNativeMesh(actor, mesh);
      }
    if (sourceSnapshot) {
      for (const triangle of sourceSnapshot.triangles) {
        let meshFaces = this.sourceTriangles.get(triangle.mesh);
        if (!meshFaces)
          this.sourceTriangles.set(triangle.mesh, (meshFaces = new Map()));
        meshFaces.set(triangle.renderTriangleIndex, triangle);
        if (triangle.sourceFaceIndex !== null) {
          let bySource = this.sourceFaceLookup.get(triangle.mesh);
          if (!bySource)
            this.sourceFaceLookup.set(triangle.mesh, (bySource = new Map()));
          bySource.set(triangle.sourceFaceIndex, triangle);
        }
      }
      this.sourceMeshes = [...this.sourceTriangles.keys()];
    }
    if (nativeScene?.initialPoses)
      for (const [actor, pose] of nativeScene.initialPoses)
        this.nativePoses.set(actor, pose);
    if (nativeScene?.initialGeometries)
      for (const [actor, geo] of nativeScene.initialGeometries) {
        const mesh = nativeScene.meshes.get(actor);
        if (mesh && mesh.geometry === geo)
          this.nativeGeometryRevisions.set(actor, captureColliderMesh(mesh));
      }
    this.transforms.beginPhase();
    if (nativeScene)
      for (const [actor, object] of nativeScene.actorObjects) {
        const old = this.nativePoses.get(actor),
          p = object.position,
          q = object.quaternion,
          z = object.scale;
        const current = [p.x, p.y, p.z, q.x, q.y, q.z, q.w, z.x, z.y, z.z];
        const resolved = this.transforms.resolve(object);
        this.nativeSync.set(actor, {
          revision: resolved.revision,
          hostParent: object.parent,
          parent: actor.parent,
          parentMatrix: this.nativeParentWorldMatrix(actor.parent).clone(),
          force:
            !old ||
            old.parent !== object.parent ||
            current.some((v, i) => !Object.is(v, old.values[i])),
        });
      }
    this.rebuildStatic();
  }
  rebuildStatic() {
    this.staticGuardRevision = {};
    if (this.syncDiagnostics)
      this.syncDiagnostics.staticRebuilds =
        (this.syncDiagnostics.staticRebuilds ?? 0) + 1;
    this.cells.clear();
    this.staticOwners.clear();
    this.staticMembership.clear();
    this.staticChildren.clear();
    this.triangles = 0;
    this.syncNativeGeometry();
    // Render batches discard ACT hierarchy and reorder material groups. Keep
    // the original mesh references, including actors moved to the render root.
    const additional: THREE.Mesh[] = [];
    if (this.sourceMeshes)
      this.sourceRoot.traverse((object) => {
        if (
          object instanceof THREE.Mesh &&
          !object.userData.worldRenderBatch &&
          !this.sourceTriangles.has(object)
        )
          additional.push(object);
      });
    const surfaces = this.sourceMeshes
      ? [...this.sourceMeshes, ...additional].flatMap((mesh) =>
          this.makeSurfaces(mesh, undefined, true),
        )
      : this.makeSurfaces(this.sourceRoot);
    const meshes: THREE.Mesh[] = [];
    if (this.sourceMeshes) meshes.push(...this.sourceMeshes, ...additional);
    else
      this.sourceRoot.traverse((object) => {
        if (object instanceof THREE.Mesh) meshes.push(object);
      });
    for (const [order, mesh] of meshes.entries())
      this.staticOwners.set(mesh, {
        order,
        surfaces: [],
        cells: new Set(),
        indexed: 0,
        parents: [],
      });
    for (const surface of surfaces) {
      const entry = this.staticOwners.get(surface.actor!)!;
      entry.surfaces.push(surface);
      this.indexSurface(surface, entry);
    }
    for (const [mesh, entry] of this.staticOwners)
      this.rememberStaticOwner(mesh, entry);
  }
  private rememberStaticOwner(mesh: THREE.Mesh, entry: StaticColliderState) {
    for (const parent of entry.parents) {
      const members = this.staticMembership.get(parent);
      members?.delete(mesh);
      if (!members?.size) this.staticMembership.delete(parent);
    }
    entry.parents = [];
    for (let node: THREE.Object3D | null = mesh; node; node = node.parent) {
      entry.parents.push(node);
      let members = this.staticMembership.get(node);
      if (!members) this.staticMembership.set(node, (members = new Set()));
      members.add(mesh);
      this.staticChildren.set(node, [...node.children]);
    }
  }
  private rememberNativeMesh(actor: NativeOrderedActor, mesh: THREE.Mesh) {
    const old = this.nativeMeshesByActor.get(actor);
    if (old === mesh) return;
    if (old) {
      const remaining = this.nativeActorsByMesh
        .get(old)!
        .filter((a) => a !== actor);
      if (remaining.length) this.nativeActorsByMesh.set(old, remaining);
      else this.nativeActorsByMesh.delete(old);
    }
    const actors = this.nativeActorsByMesh.get(mesh);
    if (actors) actors.push(actor);
    else this.nativeActorsByMesh.set(mesh, [actor]);
    this.nativeMeshesByActor.set(actor, mesh);
  }
  /** Explicit mutation outlet. Retain unrelated triangle snapshots, native
   * MODEL resources and dynamic owners; native face-ring policy stays separate. */
  invalidateActors(actors: readonly THREE.Object3D[]): void {
    if (!actors.length) return;
    this.staticGuardRevision = {};
    const affected = new Set<THREE.Mesh>();
    const dynamic = new Set<RigidBody>();
    let orderChanged = false;
    for (const actor of actors) {
      for (const mesh of this.staticMembership.get(actor) ?? [])
        affected.add(mesh);
      actor.traverse((node) => {
        const children = this.staticChildren.get(node);
        if (
          !children ||
          children.length !== node.children.length ||
          node.children.some((child, i) => child !== children[i])
        )
          orderChanged = true;
        if (node instanceof THREE.Mesh && !node.userData.worldRenderBatch)
          affected.add(node);
        const body = this.dynamicOwners.get(node);
        if (body) dynamic.add(body);
      });
      for (let node: THREE.Object3D | null = actor; node; node = node.parent) {
        const body = this.dynamicOwners.get(node);
        if (body) dynamic.add(body);
      }
    }
    for (const mesh of affected) {
      const entry = this.staticOwners.get(mesh);
      if (!entry) {
        orderChanged = true;
        this.staticOwners.set(mesh, {
          order: this.staticOwners.size,
          surfaces: [],
          cells: new Set(),
          indexed: 0,
          parents: [],
        });
      } else {
        for (const parent of entry.parents) {
          const body = this.dynamicOwners.get(parent);
          if (body) dynamic.add(body);
        }
        let node: THREE.Object3D | null = mesh;
        for (const parent of entry.parents) {
          if (node !== parent) orderChanged = true;
          node = node?.parent ?? null;
        }
        if (node) orderChanged = true;
      }
    }
    // New/relinked browser subtrees require the canonical mesh order. Ordinary
    // tile/material rewrites do not traverse the rest of the scene.
    if (orderChanged) {
      const meshes = this.sourceMeshes ? [...this.sourceMeshes] : [];
      this.sourceRoot.traverse((node) => {
        if (
          node instanceof THREE.Mesh &&
          (!this.sourceMeshes ||
            (!node.userData.worldRenderBatch &&
              !this.sourceTriangles.has(node)))
        )
          meshes.push(node);
      });
      for (const [order, mesh] of meshes.entries()) {
        const entry = this.staticOwners.get(mesh);
        if (entry) entry.order = order;
      }
      if (this.syncDiagnostics)
        this.syncDiagnostics.staticOrderRebuilds =
          (this.syncDiagnostics.staticOrderRebuilds ?? 0) + 1;
    }
    for (const mesh of affected) {
      const entry = this.staticOwners.get(mesh)!;
      for (const key of entry.cells) {
        const cell = this.cells.get(key);
        if (!cell) continue;
        const remaining = cell.filter((s) => s.actor !== mesh);
        if (remaining.length) this.cells.set(key, remaining);
        else this.cells.delete(key);
      }
      this.triangles -= entry.indexed;
      entry.cells.clear();
      entry.indexed = 0;
      let retained = this.sourceTriangles.has(mesh);
      for (let node: THREE.Object3D | null = mesh; node; node = node.parent)
        if (node === this.sourceRoot) retained = true;
      entry.surfaces = retained
        ? this.makeSurfaces(mesh, undefined, !!this.sourceMeshes, false, true)
        : [];
      for (const actor of this.nativeActorsByMesh.get(mesh) ?? [])
        this.syncNativeGeometry(actor, true);
      for (const surface of entry.surfaces)
        this.indexSurface(surface, entry, true);
      this.rememberStaticOwner(mesh, entry);
      if (this.syncDiagnostics) {
        this.syncDiagnostics.staticOwnerRebuilds =
          (this.syncDiagnostics.staticOwnerRebuilds ?? 0) + 1;
        this.syncDiagnostics.staticTriangleBuilds =
          (this.syncDiagnostics.staticTriangleBuilds ?? 0) +
          entry.surfaces.length;
      }
    }
    for (const body of dynamic) this.invalidateDynamic(body);
  }
  private dynamic = new Map<
    RigidBody,
    {
      actor: THREE.Object3D;
      drivable: boolean;
      surfaces: Surface[];
      bounds: THREE.Box3;
      nodes: DynamicNodeState[];
      parentRevision: number;
      ancestors: { object: THREE.Object3D; disabled: unknown }[];
      force: boolean;
      worldCollider: boolean;
    }
  >();
  private indexSurface(
    s: Surface,
    entry?: StaticColliderState,
    ordered = false,
  ) {
    const { a, b, c } = s;
    const minX = Math.floor(Math.min(a.x, b.x, c.x) / this.cellSize),
      maxX = Math.floor(Math.max(a.x, b.x, c.x) / this.cellSize);
    const minZ = Math.floor(Math.min(a.z, b.z, c.z) / this.cellSize),
      maxZ = Math.floor(Math.max(a.z, b.z, c.z) / this.cellSize);
    if ((maxX - minX + 1) * (maxZ - minZ + 1) > 25000) return;
    for (let x = minX; x <= maxX; x++)
      for (let z = minZ; z <= maxZ; z++) {
        const key = `${x},${z}`;
        let cell = this.cells.get(key);
        if (!cell) this.cells.set(key, (cell = []));
        this.faceIndex.invalidate(cell);
        if (ordered && entry) {
          let lo = 0,
            hi = cell.length;
          while (lo < hi) {
            const mid = (lo + hi) >>> 1,
              other = cell[mid],
              order = this.staticOwners.get(other.actor!)!.order;
            if (
              order < entry.order ||
              (order === entry.order && other.faceIndex! <= s.faceIndex!)
            )
              lo = mid + 1;
            else hi = mid;
          }
          cell.splice(lo, 0, s);
        } else cell.push(s);
        entry?.cells.add(key);
      }
    this.triangles++;
    if (entry) entry.indexed++;
  }
  private makeSurfaces(
    group: THREE.Object3D,
    owner?: RigidBody,
    singleMesh = false,
    alreadyCurrent = false,
    onlyMesh = singleMesh,
  ): Surface[] {
    const surfaces: Surface[] = [];
    if (!alreadyCurrent) group.updateWorldMatrix(true, true);
    const visit = (object: THREE.Object3D) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.userData.skipWorldCollision) return;
      for (let node: THREE.Object3D | null = object; node; node = node.parent)
        if (node.userData.worldSmashDisabled) return;
      if (!owner) {
        let node: THREE.Object3D | null = object;
        while (node) {
          if (node.userData.dynamicBody) return;
          node = node.parent;
        }
      }
      const geo = object.geometry as THREE.BufferGeometry;
      const pos = geo.getAttribute("position"),
        index = geo.index;
      if (!pos) return;
      const count = index ? index.count : pos.count;
      const mirrored = singleMesh && object.matrixWorld.determinant() < 0;
      for (let i = 0; i < count; i += 3) {
        if (geo.userData.worldSmashFaceModes?.[i / 3] === "passthrough")
          continue;
        const vertices = (mirrored ? [0, 2, 1] : [0, 1, 2]).map((j) =>
          new THREE.Vector3()
            .fromBufferAttribute(pos, index ? index.getX(i + j) : i + j)
            .applyMatrix4(object.matrixWorld),
        );
        const [a, b, c] = vertices;
        const normal = new THREE.Vector3()
          .subVectors(b, a)
          .cross(new THREE.Vector3().subVectors(c, a))
          .normalize();
        if (!normal.lengthSq()) continue;
        const materialGroup = geo.groups.find(
          (g) => i >= g.start && i < g.start + g.count,
        );
        const material = (
          Array.isArray(object.material)
            ? object.material[materialGroup?.materialIndex ?? 0]
            : object.material
        ) as THREE.Material | undefined;
        const rawFaceFlags =
          geo.userData.sourceFaceFlags?.[i / 3] ??
          geo.userData.sourceFaces?.[
            Math.floor((index ? index.getX(i) : i) / 3)
          ]?.flags ??
          0;
        const s: Surface = {
          // Tile clipping/model replacement reindexes faces into a different
          // geometry. Preserve ACT ownership but do not assign stale DAT IDs.
          source:
            this.sourceTriangles.get(object)?.get(i / 3)?.geometry === geo
              ? this.sourceTriangles.get(object)?.get(i / 3)
              : undefined,
          actor: object,
          faceIndex: i / 3,
          owner,
          collisionMode:
            geo.userData.worldSmashFaceModes?.[i / 3] ??
            (material?.name.startsWith("?") ? "edges" : "solid"),
          a,
          b,
          c,
          normal,
          minY: Math.min(a.y, b.y, c.y),
          maxY: Math.max(a.y, b.y, c.y),
          material: material?.name ?? "",
          faceFlags: mirrored
            ? (rawFaceFlags & ~5) |
              ((rawFaceFlags & 1) << 2) |
              ((rawFaceFlags & 4) >> 2)
            : rawFaceFlags,
          modifier:
            this.modifiers[surfaceIndex(material?.name ?? "")] ??
            DEFAULT_SURFACE,
          materialFlags:
            material?.userData.c2Flags ??
            (material?.side === THREE.DoubleSide ? 4096 : 0),
          pixelmapType: (material as THREE.MeshLambertMaterial | undefined)?.map
            ?.userData.c2PixelmapType,
          twoSided:
            !!((material?.userData.c2Flags ?? 0) & 0x1800) ||
            material?.side === THREE.DoubleSide,
        };
        surfaces.push(s);
      }
    };
    if (onlyMesh) visit(group);
    else group.traverse(visit);
    return surfaces;
  }
  private dynamicOwners = new Map<THREE.Object3D, RigidBody>();
  addDynamic(
    owner: RigidBody,
    actor: THREE.Object3D,
    drivable = true,
    worldCollider = false,
  ) {
    this.staticGuardRevision = {};
    const previous = this.dynamic.get(owner);
    if (previous) this.dynamicOwners.delete(previous.actor);
    this.dynamicOwners.set(actor, owner);
    this.dynamicGuardOwners.delete(owner);
    if (worldCollider) this.dynamicGuardOwners.add(owner);
    this.dynamic.set(owner, {
      actor,
      drivable,
      surfaces: [],
      bounds: new THREE.Box3(),
      nodes: [],
      parentRevision: -1,
      ancestors: [],
      force: true,
      worldCollider,
    });
    this.refreshDynamic(owner);
  }
  removeDynamic(owner: RigidBody) {
    this.staticGuardRevision = {};
    const entry = this.dynamic.get(owner);
    if (entry) this.dynamicOwners.delete(entry.actor);
    this.dynamic.delete(owner);
    this.dynamicGuardOwners.delete(owner);
  }
  invalidateDynamic(owner?: RigidBody) {
    for (const [body, entry] of this.dynamic)
      if (!owner || body === owner) entry.force = true;
    this.refreshDynamic(owner);
  }
  refreshDynamic(owner?: RigidBody) {
    this.transforms.beginPhase();
    for (const [body, entry] of this.dynamic) {
      if (owner && body !== owner) continue;
      const diagnostics = this.syncDiagnostics;
      if (diagnostics) diagnostics.dynamicChecks++;
      let changed = entry.force || !entry.nodes.length;
      let ancestor = entry.actor.parent;
      for (const old of entry.ancestors) {
        if (
          ancestor !== old.object ||
          ancestor?.userData.worldSmashDisabled !== old.disabled
        )
          changed = true;
        ancestor = ancestor?.parent ?? null;
      }
      if (ancestor) changed = true;
      let opaque = !this.transforms.isOrdinary(entry.actor);
      if (opaque) changed = true;
      const parentState =
        !opaque && entry.actor.parent
          ? this.transforms.resolve(entry.actor.parent, diagnostics?.transform)
          : null;
      const parentRevision = parentState?.revision ?? 0;
      if (entry.parentRevision !== parentRevision) changed = true;
      for (const old of entry.nodes) {
        if (diagnostics) diagnostics.hierarchyChecks++;
        const object = old.object;
        if (!ordinaryTransformMethods(object)) opaque = changed = true;
        if (
          opaque ||
          object.matrixAutoUpdate !== old.auto ||
          object.matrixWorldAutoUpdate !== old.worldAuto ||
          !sameWorldLocalValues(object, old.localValues) ||
          old.worldValues?.some(
            (v, i) => !Object.is(v, object.matrixWorld.elements[i]),
          ) ||
          object.parent !== old.parent ||
          object.children.length !== old.children.length ||
          object.children.some((child, i) => child !== old.children[i]) ||
          object.userData.worldSmashDisabled !== old.disabled ||
          object.userData.skipWorldCollision !== old.skip ||
          (object instanceof THREE.Mesh &&
            (!old.mesh || !sameColliderMesh(object, old.mesh)))
        )
          changed = true;
      }
      if (!changed) {
        if (diagnostics) diagnostics.dynamicUnchanged++;
        continue;
      }
      if (diagnostics) diagnostics.dynamicChanged++;
      // Custom subclasses retain the native update outlet; ordinary trees use
      // exact retained physical matrices, independent of renderer interpolation.
      const nodes: THREE.Object3D[] = [];
      entry.actor.traverse((object) => nodes.push(object));
      opaque ||= nodes.some((object) => !this.transforms.isOrdinary(object));
      if (opaque) {
        // Stateful custom update methods must run once, before generation, never
        // again while capturing cache metadata. They remain uncached next phase.
        if (diagnostics) diagnostics.transform.nativeUpdates++;
        entry.actor.updateWorldMatrix(true, true);
        this.transforms.invalidatePhase();
        // A custom updater may have changed topology during the native outlet.
        nodes.length = 0;
        entry.actor.traverse((object) => nodes.push(object));
      } else {
        for (const object of nodes)
          object.matrixWorld.copy(
            this.transforms.resolve(object, diagnostics?.transform).matrix,
          );
      }
      entry.surfaces = this.makeSurfaces(entry.actor, body, false, true);
      if (diagnostics) diagnostics.triangleBuilds += entry.surfaces.length;
      entry.bounds.makeEmpty();
      for (const surface of entry.surfaces)
        entry.bounds
          .expandByPoint(surface.a)
          .expandByPoint(surface.b)
          .expandByPoint(surface.c);
      entry.nodes = nodes.map((object, index) => {
        const prior = entry.nodes[index];
        const node: DynamicNodeState =
          prior?.object === object
            ? prior
            : {
                object,
                parent: object.parent,
                children: [],
                localValues: [],
                auto: object.matrixAutoUpdate,
                worldAuto: object.matrixWorldAutoUpdate,
                disabled: undefined,
                skip: undefined,
              };
        node.parent = object.parent;
        if (
          node.children.length !== object.children.length ||
          object.children.some((child, i) => child !== node.children[i])
        )
          node.children = [...object.children];
        node.localValues.length = object.matrixAutoUpdate ? 10 : 16;
        for (let i = 0; i < node.localValues.length; i++)
          node.localValues[i] = worldLocalValue(object, i);
        node.auto = object.matrixAutoUpdate;
        node.worldAuto = object.matrixWorldAutoUpdate;
        node.worldValues = object.matrixWorldAutoUpdate
          ? undefined
          : object.matrixWorld.toArray();
        node.disabled = object.userData.worldSmashDisabled;
        node.skip = object.userData.skipWorldCollision;
        if (
          object instanceof THREE.Mesh &&
          (entry.force || !node.mesh || !sameColliderMesh(object, node.mesh))
        )
          node.mesh = captureColliderMesh(object);
        return node;
      });
      entry.ancestors = [];
      for (let object = entry.actor.parent; object; object = object.parent)
        entry.ancestors.push({
          object,
          disabled: object.userData.worldSmashDisabled,
        });
      entry.parentRevision = parentRevision;
      // A later return to ordinary methods must replace the opaque snapshot.
      entry.force = opaque;
    }
  }
  private dynamicSurfaces(bounds: THREE.Box3): Surface[] {
    return (
      this.drivableOwners
        ? this.drivableOwners
            .map((owner) => this.dynamic.get(owner)!)
            .filter(Boolean)
        : [...this.dynamic.values()]
    )
      .filter(
        (entry) =>
          entry.drivable &&
          entry.actor.visible &&
          entry.bounds.intersectsBox(bounds),
      )
      .flatMap((entry) => entry.surfaces);
  }
  /** Source FindFacesInBox owns finite prefixes and interleaved callbacks. The
   * existing spatial hash remains useful for unrestricted rays and legacy tools. */
  collectFaces(
    query: NativeWorldFaceQuery,
    capacity: number,
    gatherModels = true,
    callbacks: WorldFaceCollectorCallbacks = {},
  ): Surface[] {
    if (!this.nativeScene) {
      if (!gatherModels || capacity === 0) return [];
      const bounds = query.bounds.clone().applyMatrix4(query.matrix),
        inverse = query.matrix.clone().invert(),
        result: Surface[] = [];
      for (const surface of this.querySurfaces(bounds.min, bounds.max, true)) {
        if (
          !cameraTriangleInBox(
            [surface.a, surface.b, surface.c].map((p) =>
              p.clone().applyMatrix4(inverse),
            ),
            query.bounds.min,
            query.bounds.max,
          )
        )
          continue;
        result.push(surface);
        callbacks.onFace?.(surface);
        if (result.length === capacity) break;
      }
      return result;
    }
    const scene = this.nativeScene;
    this.transforms.beginPhase();
    const base = createNativeFindFacesProviders(
      (identity) => {
        const resource = scene.resources.get(identity);
        return resource
          ? known(resource)
          : { resolved: false, requiredProvider: "native-world-current-MODEL" };
      },
      { writePlingFace: () => {} },
      this.nativeModelBoundsOptions,
    );
    const surfaces: Surface[] = [];
    const result = findNativeFacesInBox({
      bounds: {
        min: query.bounds.min.toArray() as [number, number, number],
        max: query.bounds.max.toArray() as [number, number, number],
      },
      matrix: nativeWorldMatrix(query.matrix),
      layout: scene.layout,
      columns: scene.columns,
      additionalActors: known(scene.additionalActors),
      blackMaterial: known(scene.blackMaterial),
      capacity,
      emitModels: gatherModels,
      worldCallbacks: known({
        pullActorFromWorld: (actor: NativeOrderedActor) => {
          const object = scene.actorObjects.get(actor);
          const pulled = object
            ? (callbacks.pullActorFromWorld?.(object) ?? null)
            : null;
          if (pulled !== null) pullNativeWorldActor(scene, actor);
          this.transforms.invalidatePhase();
          return known(pulled);
        },
        stopGroovidelic: (actor: NativeOrderedActor) => {
          const object = scene.actorObjects.get(actor);
          if (object) {
            if (callbacks.stopGroovidelic) {
              callbacks.stopGroovidelic(object);
              this.transforms.invalidatePhase();
            }
            this.updateNativeActorMatrix(actor);
          }
        },
      }),
      prepareActors: (roots) => {
        // All selected locals precede callbacks. Lazy rebasing during emission
        // would erase borrowed parent motion after StopGroovidelic, particularly
        // when the renderer retained a child under a different Three parent.
        const visited = new Set<NativeOrderedActor>();
        const prepare = (actor: NativeOrderedActor) => {
          if (visited.has(actor)) return;
          visited.add(actor);
          this.syncNativeActor(actor);
          if (actor.renderStyle === 1) return;
          this.syncNativeGeometry(actor);
          enumerateNativeActorChildren(actor, (child) => {
            prepare(child);
            return 0;
          });
        };
        for (const root of roots) prepare(root);
      },
      providers: {
        modelBounds: base.modelBounds,
        emitModel: (input) => {
          const emitted = base.emitModel(input);
          if (!emitted.resolved) return emitted;
          for (const row of emitted.rows) {
            const surface = this.nativeSurface(row);
            surfaces.push(surface);
            callbacks.onFace?.(surface);
            if (callbacks.onFace) this.transforms.invalidatePhase();
          }
          return emitted;
        },
      },
    });
    if (!result.resolved)
      throw new Error(
        `Native world face collector requires ${result.requiredProvider}`,
      );
    return surfaces;
  }
  /** Renderer retention can attach an ACT to a different Three parent. Keep
   * its native local transform relative to the original mutable ACT links. */
  /** Optional bounded diagnostics; absent in normal gameplay. */
  nativeModelBoundsOptions?: NativeModelBoundsOptions;
  private nativeGeometryRevisions = new Map<
    NativeOrderedActor,
    ColliderMeshState
  >();
  private nativeRuntimeFaceIndices = new WeakMap<
    NativeTrackModelResource,
    Map<number, number>
  >();
  private nativeGeometryOwners = new Map<
    NativeOrderedActor,
    NativeTrackModelResource
  >();
  private nativeReplacementSourceFaces = new Map<
    NativeOrderedActor,
    Map<number, number>
  >();
  /** Geometry mutation outlets already own current topology and source IDs. Rebuild
   * their MODEL tables before collector use, with actual retained MAT bindings. */
  private syncNativeGeometry(
    selected?: NativeOrderedActor,
    deepMetadata = !selected,
  ): void {
    const scene = this.nativeScene;
    if (!scene?.meshes) return;
    const selectedMesh = selected ? scene.meshes.get(selected) : undefined;
    const entries: Iterable<readonly [NativeOrderedActor, THREE.Mesh]> =
      selected
        ? selectedMesh
          ? [[selected, selectedMesh]]
          : []
        : scene.meshes;
    for (const [actor, mesh] of entries) {
      this.rememberNativeMesh(actor, mesh);
      if (this.syncDiagnostics) this.syncDiagnostics.nativeGeometryChecks++;
      const geo = mesh.geometry,
        position = geo.getAttribute("position"),
        old = this.nativeGeometryRevisions.get(actor);
      if (!position || (old && sameColliderMesh(mesh, old, deepMetadata)))
        continue;
      if (!actor.localModel.resolved || !actor.localModel.value) continue;
      if (this.syncDiagnostics) this.syncDiagnostics.nativeGeometryWrites++;
      const resource = scene.resources.get(actor.localModel.value);
      if (!resource)
        throw new Error(
          "Native geometry mutation requires the current MODEL owner",
        );
      const previousOwner = this.nativeGeometryOwners.get(actor);
      const ownership =
        previousOwner?.source === resource.source ? previousOwner : resource;
      this.nativeGeometryOwners.set(actor, ownership);
      const replacement =
        scene.findModelResource?.(mesh.name) ??
        [...scene.resources.values()].find(
          (candidate) =>
            candidate.source?.name === mesh.name &&
            candidate.source !== resource.source,
        );
      if (
        replacement &&
        replacement.source !== resource.source &&
        this.matchesNativeSourceGeometry(geo, replacement)
      ) {
        actor.localModel = known(replacement);
        this.nativeGeometryOwners.set(actor, replacement);
        const mapping = new Map<number, number>();
        const sourceMapping = new Map<number, number>();
        for (
          let triangle = 0;
          triangle < (geo.index?.count ?? position.count) / 3;
          triangle++
        ) {
          const sourceIndex = Math.floor(
            (geo.index?.getX(triangle * 3) ?? triangle * 3) / 3,
          );
          const nativeIndex = replacement.current.faces.findIndex(
            (face) => face.sourceFaceIndex === sourceIndex,
          );
          if (nativeIndex >= 0) mapping.set(nativeIndex, triangle);
          sourceMapping.set(triangle, sourceIndex);
        }
        this.nativeRuntimeFaceIndices.set(replacement, mapping);
        this.nativeReplacementSourceFaces.set(actor, sourceMapping);
        this.nativeGeometryRevisions.set(actor, captureColliderMesh(mesh));
        continue;
      }
      const allowed = new Map(
          ownership.current.faces.map((face) => [face.sourceFaceIndex, face]),
        ),
        nativeFaces: NativeTrackModelResource["current"]["faces"][number][] =
          [],
        vertices: NativeTrackModelResource["current"]["vertices"][number][] =
          [],
        mapping = new Map<number, number>(),
        index = geo.index,
        uv = geo.getAttribute("uv"),
        count = index?.count ?? position.count;
      const sourceFaces = this.sourceTriangles.get(mesh);
      for (let triangle = 0; triangle < count / 3; triangle++) {
        const originalRenderIndex =
          geo.userData.worldSmashSourceFaces?.[triangle] ?? triangle;
        const oldCrosswalk = sourceFaces?.get(originalRenderIndex),
          crosswalk =
            oldCrosswalk?.modelName === resource.source?.name
              ? oldCrosswalk
              : undefined,
          sourceIndex =
            crosswalk?.sourceFaceIndex ??
            this.nativeReplacementSourceFaces
              .get(actor)
              ?.get(originalRenderIndex) ??
            (geo.userData.sourceFaces
              ? Math.floor(
                  (index ? index.getX(triangle * 3) : triangle * 3) / 3,
                )
              : originalRenderIndex);
        if (sourceIndex === null || sourceIndex === undefined)
          throw new Error("Native mutation face provenance is missing");
        const original = allowed.get(sourceIndex);
        if (!original) continue; // Remaining and migrated raw MODELs own distinct faces.
        const rawBinding = geo.userData.c2RawFaceMaterials?.[triangle];
        const slot =
          geo.groups.find(
            (group) =>
              triangle * 3 >= group.start &&
              triangle * 3 < group.start + group.count,
          )?.materialIndex ?? 0;
        const renderMaterial = Array.isArray(mesh.material)
          ? mesh.material[slot]
          : mesh.material;
        const material: MatMaterial | null =
          rawBinding === null
            ? null
            : (rawBinding ??
              scene.resolveRenderedMaterial?.(renderMaterial) ??
              original.material);
        const ids = [0, 1, 2].map((corner) => {
          const vertex = index
              ? index.getX(triangle * 3 + corner)
              : triangle * 3 + corner,
            id = vertices.length;
          vertices.push({
            position: [
              Math.fround(position.getX(vertex)),
              Math.fround(position.getY(vertex)),
              Math.fround(position.getZ(vertex)),
            ] as [number, number, number],
            uv: [
              Math.fround(uv?.getX(vertex) ?? 0),
              Math.fround(uv?.getY(vertex) ?? 0),
            ] as [number, number],
            payload: null,
          });
          return id;
        }) as [number, number, number];
        mapping.set(nativeFaces.length, triangle);
        nativeFaces.push({
          ...original,
          indices: ids,
          material,
          payload: {
            ...original.payload,
            indices: ids,
            flags:
              geo.userData.sourceFaceFlags?.[triangle] ??
              original.payload.flags,
          },
        });
      }
      // Actor-private browser smash geometry gets a separate real mutable MODEL
      // identity; immutable DAT and other ACT instances keep their resources.
      const current: NativeTrackModelResource = {
        source: resource.source,
        revision: resource.revision,
        prepared: null,
        current: { ...resource.current, vertices, faces: nativeFaces },
      };
      current.current.identity = current;
      manageNativeTrackBounds(current);
      invalidateNativeTrackResource(current);
      const prepared = prepareNativeTrackResource(
        current,
        scene.arena.materialOrder(current.current.faces),
      );
      if (!prepared.resolved)
        throw new Error(prepared.requiredProviders.join("; "));
      scene.resources.set(current, current);
      actor.localModel = known(current);
      this.nativeRuntimeFaceIndices.set(current, mapping);
      this.nativeGeometryRevisions.set(actor, captureColliderMesh(mesh));
    }
  }
  /** createModelGeometry copies canonical tables. Verify their data against the
   * exact registry object; copied arrays cannot establish identity by reference. */
  private matchesNativeSourceGeometry(
    geo: THREE.BufferGeometry,
    resource: NativeTrackModelResource,
  ): boolean {
    const source = resource.source,
      positions = geo.userData.sourcePositions as Float32Array | undefined,
      faces = geo.userData.sourceFaces as
        | { indices: readonly number[]; material: number }[]
        | undefined;
    return (
      !!source &&
      positions instanceof Float32Array &&
      positions.length === source.positions.length &&
      positions.every((value, index) => value === source.positions[index]) &&
      faces?.length === source.faces.length &&
      faces.every(
        (face, index) =>
          face.material === source.faces[index].material &&
          face.indices.length === 3 &&
          face.indices.every(
            (value, corner) => value === source.faces[index].indices[corner],
          ),
      )
    );
  }
  private nativeParentWorldMatrix(
    actor: NativeOrderedActor | null,
  ): THREE.Matrix4 {
    if (!actor) return new THREE.Matrix4();
    const object = this.nativeScene!.actorObjects.get(actor);
    if (object)
      return this.transforms.resolve(object, this.syncDiagnostics?.transform)
        .matrix;
    const m = actor.matrix,
      local = new THREE.Matrix4().set(
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
    return this.nativeParentWorldMatrix(actor.parent).clone().multiply(local);
  }
  private nativeParentForObject(
    object: THREE.Object3D,
    actor: NativeOrderedActor | null,
  ): THREE.Matrix4 {
    const mapped = actor && this.nativeScene!.actorObjects.get(actor);
    if (mapped && !this.transforms.isOrdinary(object)) {
      for (let parent = object.parent; parent; parent = parent.parent)
        if (parent === mapped) return mapped.matrixWorld;
    }
    return this.nativeParentWorldMatrix(actor);
  }
  private syncNativeActor(actor: NativeOrderedActor): void {
    const object = this.nativeScene!.actorObjects.get(actor);
    if (!object) return;
    if (this.syncDiagnostics) this.syncDiagnostics.nativeActorChecks++;
    const state = this.transforms.resolve(
        object,
        this.syncDiagnostics?.transform,
      ),
      revision = state.revision,
      worldMatrix = state.ordinary ? state.matrix : state.matrix.clone(),
      old = this.nativeSync.get(actor),
      parentMatrix = this.nativeParentForObject(object, actor.parent);
    // Native remove/add intentionally leaves the borrowed local matrix intact.
    const parentChanged =
      old?.parent === actor.parent &&
      parentMatrix.elements.some(
        (v, i) => !Object.is(v, old.parentMatrix.elements[i]),
      );
    if (
      !old ||
      old.force ||
      !state.ordinary ||
      old.revision !== state.revision ||
      old.hostParent !== object.parent ||
      parentChanged
    ) {
      this.writeNativeActorMatrix(actor, worldMatrix, parentMatrix);
      this.nativeSync.set(actor, {
        revision,
        hostParent: object.parent,
        parent: actor.parent,
        parentMatrix: parentMatrix.clone(),
        force: !state.ordinary,
      });
    } else if (old.parent !== actor.parent) {
      // Pull keeps the old local now, but the next Stop must rebase it against
      // the new native parent. A prior write belongs to the old attachment.
      this.nativeLocalWritten.delete(actor);
      old.parent = actor.parent;
      old.parentMatrix.copy(parentMatrix);
    }
    actor.renderStyle = object.userData.worldSmashDisabled
      ? 1
      : (object.userData.c2ActorRenderStyle ?? actor.renderStyle);
  }
  private updateNativeActorMatrix(actor: NativeOrderedActor): void {
    const object = this.nativeScene!.actorObjects.get(actor);
    if (!object) return;
    const state = this.transforms.resolve(
        object,
        this.syncDiagnostics?.transform,
      ),
      revision = state.revision,
      worldMatrix = state.ordinary ? state.matrix : state.matrix.clone(),
      parentMatrix = this.nativeParentForObject(object, actor.parent);
    const old = this.nativeSync.get(actor);
    // The first stop retains the historical affine/Float32 rewrite. Subsequent
    // unchanged notifications may reuse that same borrowed local storage.
    const written = this.nativeLocalWritten.get(actor);
    if (
      written &&
      written.every((v, i) => Object.is(v, actor.matrix[i])) &&
      old &&
      !old.force &&
      state.ordinary &&
      old.revision === revision &&
      old.hostParent === object.parent &&
      old.parent === actor.parent &&
      parentMatrix.elements.every((v, i) =>
        Object.is(v, old.parentMatrix.elements[i]),
      )
    )
      return;
    this.writeNativeActorMatrix(actor, worldMatrix, parentMatrix);
    this.nativeSync.set(actor, {
      revision,
      hostParent: object.parent,
      parent: actor.parent,
      parentMatrix: parentMatrix.clone(),
      force: !state.ordinary,
    });
  }
  private writeNativeActorMatrix(
    actor: NativeOrderedActor,
    world: THREE.Matrix4,
    parent: THREE.Matrix4,
  ): void {
    const matrix = parent.clone().invert().multiply(world),
      values = nativeWorldMatrix(matrix),
      storage = actor.matrix as number[];
    for (let i = 0; i < 12; i++) storage[i] = values[i];
    this.nativeLocalWritten.set(actor, values);
    if (this.syncDiagnostics) this.syncDiagnostics.nativeActorWrites++;
  }
  private nativeSurface(row: NativeModelPickFace): Surface {
    const scene = this.nativeScene!,
      object =
        scene.faceActors.get(row.actor) ?? scene.actorObjects.get(row.actor);
    const sourceResource = scene.resources.get(row.sourceModel),
      sourceModel = sourceResource?.source ?? row.model.source;
    let mesh = scene.meshes?.get(row.actor),
      source: WorldSourceTriangle | undefined,
      faceIndex: number | undefined;
    const candidates: THREE.Mesh[] = [];
    if (mesh) candidates.push(mesh);
    else
      object?.traverse((candidate) => {
        if (candidate instanceof THREE.Mesh) candidates.push(candidate);
      });
    let fallback: THREE.Mesh | undefined;
    for (const candidate of candidates) {
      const faces = this.sourceTriangles.get(candidate),
        match =
          faces &&
          this.sourceFaceLookup.get(candidate)?.get(row.sourceFaceIndex);
      if (match && match.modelName === sourceModel?.name) {
        mesh = candidate;
        source = match;
        faceIndex = match.renderTriangleIndex;
        break;
      }
      if (candidate.name === sourceModel?.name) fallback = candidate;
    }
    mesh ??= fallback;
    const currentFace = this.nativeRuntimeFaceIndices
      .get(row.model)
      ?.get(row.nativeFaceIndex);
    if (currentFace !== undefined) faceIndex = currentFace;
    if (!mesh) mesh = scene.meshes?.get(row.actor);
    let owner: RigidBody | undefined;
    for (
      let node: THREE.Object3D | null = object ?? null;
      node;
      node = node.parent
    ) {
      owner = this.dynamicOwners.get(node);
      if (owner) break;
    }
    const a = new THREE.Vector3(...row.a),
      b = new THREE.Vector3(...row.b),
      c = new THREE.Vector3(...row.c),
      material = row.materialIdentifier ?? "";
    return {
      a,
      b,
      c,
      normal: new THREE.Vector3(...row.normal),
      constant: row.constant,
      minY: Math.min(a.y, b.y, c.y),
      maxY: Math.max(a.y, b.y, c.y),
      material,
      modifier: this.modifiers[surfaceIndex(material)] ?? DEFAULT_SURFACE,
      twoSided:
        row.materialPresence === "null" ||
        !!((row.materialFlags ?? 0) & 0x1800),
      materialFlags: row.materialFlags ?? 0,
      faceFlags: row.rawFlags,
      owner,
      actor: mesh,
      faceIndex,
      source,
      native: row,
      pixelmapType: (Array.isArray(mesh?.material)
        ? mesh?.material[0]
        : (mesh?.material as THREE.MeshLambertMaterial | undefined)
      )?.userData.c2PixelmapType,
      collisionMode:
        mesh?.geometry.userData.worldSmashFaceModes?.[faceIndex ?? -1] ??
        (material.startsWith("?") ? "edges" : "solid"),
    };
  }
  /** Installed MechanicsStep4158b0 snapshots first50 drivable owners in PHIL
   * linked order. Wheel owner rays run after world-face cache rays418c93. */
  setDrivableOwnerOrder(owners: readonly RigidBody[]): void {
    this.drivableOwners = owners
      .filter((owner) => {
        const entry = this.dynamic.get(owner);
        return (
          entry?.drivable &&
          !entry.worldCollider &&
          !("kind" in owner && owner.kind === "moving-world")
        );
      })
      .slice(0, 50);
  }
  private drivableOwners: readonly RigidBody[] | undefined;
  /** Bounds-confined original triangle candidates, shared by body and wheel queries. */
  querySurfaces(
    min: THREE.Vector3,
    max: THREE.Vector3,
    includeNonSolid = false,
  ): Surface[] {
    return this.queryFaceCandidates(min, max, includeNonSolid);
  }
  /** Static face locality is opt-in: callers must bound their actual accepted
   * feature paths. Cell ranges/Y gates and moving-owner snapshots stay legacy.
   * Explicit envelopes cover inverse-frame sweeps; ordinary boxes include F32
   * clipping coordinates. Native wheels/uncertified consumers stay broad. */
  queryLocalSurfaces(
    min: THREE.Vector3,
    max: THREE.Vector3,
    includeNonSolid = false,
    envelope?: THREE.Box3,
  ): Surface[] {
    const bounds =
      envelope?.clone() ?? new THREE.Box3(min.clone(), max.clone());
    for (let axis = 0; axis < 3; axis++) {
      bounds.min.setComponent(
        axis,
        Math.min(
          bounds.min.getComponent(axis),
          Math.fround(bounds.min.getComponent(axis)),
        ),
      );
      bounds.max.setComponent(
        axis,
        Math.max(
          bounds.max.getComponent(axis),
          Math.fround(bounds.max.getComponent(axis)),
        ),
      );
    }
    return this.queryFaceCandidates(min, max, includeNonSolid, bounds);
  }
  private queryFaceCandidates(
    min: THREE.Vector3,
    max: THREE.Vector3,
    includeNonSolid: boolean,
    local?: THREE.Box3,
  ): Surface[] {
    const diagnostics = this.faceDiagnostics;
    if (diagnostics) {
      diagnostics.queryCalls = (diagnostics.queryCalls ?? 0) + 1;
      if (local) diagnostics.localQueries = (diagnostics.localQueries ?? 0) + 1;
    }
    const result = new Set<Surface>();
    const x0 = Math.floor(min.x / this.cellSize),
      x1 = Math.floor(max.x / this.cellSize);
    const z0 = Math.floor(min.z / this.cellSize),
      z1 = Math.floor(max.z / this.cellSize);
    if (
      ![x0, x1, z0, z1].every(Number.isFinite) ||
      (x1 - x0 + 1) * (z1 - z0 + 1) > 25000
    )
      return [];
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const cell = this.cells.get(`${x},${z}`);
        if (!cell) continue;
        if (diagnostics) {
          diagnostics.cellVisits = (diagnostics.cellVisits ?? 0) + 1;
          diagnostics.legacyReferences =
            (diagnostics.legacyReferences ?? 0) + cell.length;
        }
        const rows = local
          ? this.faceIndex.query(cell, local.min, local.max, diagnostics)
          : cell;
        for (const s of rows)
          if (
            s.enabled !== false &&
            s.maxY >= min.y &&
            s.minY <= max.y &&
            (includeNonSolid || !/^[!>]/.test(s.material))
          )
            result.add(s);
      }
    const bounds = new THREE.Box3(min, max);
    for (const [body, entry] of this.dynamic) {
      if (!entry.worldCollider || !entry.actor.visible) continue;
      const oldBounds = entry.bounds
        .clone()
        .translate(
          body.state.position
            .clone()
            .sub(body.state.predictedPosition ?? body.state.position),
        );
      // Rotation can sweep farther than the endpoint boxes. Bound by the
      // authored triangle radius about the actor origin rather than filling
      // the concave actor with a convex collision shape.
      const radius =
        entry.bounds.getSize(new THREE.Vector3()).length() +
        entry.bounds
          .getCenter(new THREE.Vector3())
          .distanceTo(body.state.predictedPosition ?? body.state.position);
      oldBounds
        .union(entry.bounds)
        .union(
          new THREE.Box3().setFromCenterAndSize(
            body.state.position,
            new THREE.Vector3(2 * radius, 2 * radius, 2 * radius),
          ),
        );
      if (!oldBounds.intersectsBox(bounds)) continue;
      for (const surface of entry.surfaces)
        if (includeNonSolid || !/^[!>]/.test(surface.material))
          result.add(surface);
    }
    return [...result];
  }
  /** Material modifier indices are authored by the selected track. Volume
   * overrides are per body, never a mutation of shared triangle state. */
  modifier(index: number): SurfaceModifier {
    return this.modifiers[index] ?? DEFAULT_SURFACE;
  }
  /** Installed FindYBelow's nearest downward triangle traversal. Height below
   * -100 is rejected by every fallen-world consumer, so bound the finite query
   * there instead of traversing to FLT_MAX. This query uses source material
   * facing flags rather than THREE material visibility/collision-mode flags.
   */
  nativeYBelow(origin: THREE.Vector3): {
    y: number;
    materialName: string | null;
  } {
    const miss: { y: number; materialName: string | null } = {
      y: -3.4028234663852886e38,
      materialName: null,
    };
    if (origin.y < -100) return miss;
    const bottom = new THREE.Vector3(origin.x, -100, origin.z);
    const bounds = new THREE.Box3()
      .setFromPoints([origin, bottom])
      .expandByScalar(0.005);
    const ray = new THREE.Ray(origin, new THREE.Vector3(0, -1, 0));
    const point = new THREE.Vector3();
    let best = miss;
    for (const face of [
      ...this.queryLocalSurfaces(bounds.min, bounds.max, true),
      ...this.dynamicSurfaces(bounds),
    ]) {
      if (face.enabled === false || /^[!>]/.test(face.material)) continue;
      const facing = -face.normal.y;
      if (
        Math.abs(facing) < 2 ** -22 ||
        (!(face.materialFlags & 0x1800) && facing > 0)
      )
        continue;
      if (!ray.intersectTriangle(face.a, face.b, face.c, false, point))
        continue;
      if (point.y >= -100 && point.y > best.y)
        best = { y: Math.fround(point.y), materialName: face.material };
    }
    return best;
  }
  raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
    includeNonSolid = false,
    nativeWheel = false,
  ) {
    if (
      !Number.isFinite(maxDistance) ||
      maxDistance <= 0 ||
      direction.lengthSq() < 1e-12
    )
      return null;
    const ray = new THREE.Ray(origin, direction.clone().normalize()),
      end = ray.at(maxDistance, new THREE.Vector3());
    const bounds = new THREE.Box3().setFromPoints([origin, end]);
    if (nativeWheel)
      bounds.expandByPoint(
        origin.clone().addScaledVector(ray.direction, -0.5 / 6.9),
      );
    bounds.expandByScalar(0.005);
    let best: {
      distance: number;
      normal: THREE.Vector3;
      friction: number;
      rollingResistance: number;
      downforce: number;
      bumpiness: number;
      surface: Surface;
      point: THREE.Vector3;
      body?: RigidBody;
      velocity?: THREE.Vector3;
    } | null = null;
    const point = new THREE.Vector3();
    for (const surface of [
      ...(nativeWheel
        ? this.querySurfaces(bounds.min, bounds.max, includeNonSolid)
        : this.queryLocalSurfaces(bounds.min, bounds.max, includeNonSolid)),
      ...this.dynamicSurfaces(bounds),
    ]) {
      if (!nativeWheel && this.faceDiagnostics)
        this.faceDiagnostics.ordinaryRayFaceTests =
          (this.faceDiagnostics.ordinaryRayFaceTests ?? 0) + 1;
      if (
        !includeNonSolid &&
        (surface.collisionMode === "edges" || surface.material.startsWith("?"))
      )
        continue;
      if (
        surface.enabled === false ||
        (!includeNonSolid && /^[!>]/.test(surface.material))
      )
        continue;
      const wheelHit = nativeWheel
        ? intersectWheelFace(origin, end.clone().sub(origin), surface)
        : undefined;
      if (
        nativeWheel
          ? !wheelHit
          : !ray.intersectTriangle(
              surface.a,
              surface.b,
              surface.c,
              !surface.twoSided,
              point,
            )
      )
        continue;
      if (wheelHit) point.copy(wheelHit.point);
      const distance = wheelHit
        ? wheelHit.fraction * maxDistance
        : point.distanceTo(origin);
      if (distance > maxDistance || (best && distance >= best.distance))
        continue;
      const normal = surface.normal.clone();
      if (normal.dot(direction) > 0) normal.negate();
      best = {
        distance,
        normal,
        point: point.clone(),
        body: surface.owner,
        velocity: surface.owner
          ? pointVelocity(surface.owner.state, surface.owner.properties, point)
          : undefined,
        friction: surface.modifier.tyreFriction,
        rollingResistance: 0,
        downforce: surface.modifier.downforce,
        bumpiness: surface.modifier.bumpiness,
        surface,
      };
    }
    return best;
  }
  /** WheelForces' signed finite-face query; other rays retain forward semantics. */
  wheelRaycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
  ) {
    return this.raycast(origin, direction, maxDistance, false, true);
  }
  /** Installed418c93–418e59 visits the first50 PHIL drivable objects and all
   * their shape links. This pass has no access to unrestricted world triangles:
   * world faces, including grooved actors, already ran through the finite cache.
   * ShapeRayCast's normal is inward; WheelForces negates it before rotation. */
  drivableWheelRaycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
  ) {
    if (
      !Number.isFinite(maxDistance) ||
      maxDistance <= 0 ||
      direction.lengthSq() < 1e-12
    )
      return null;
    const end = origin
      .clone()
      .addScaledVector(direction.clone().normalize(), maxDistance);
    let best: {
      distance: number;
      normal: THREE.Vector3;
      friction: number;
      rollingResistance: number;
      downforce: number;
      bumpiness: number;
      point: THREE.Vector3;
      body: RigidBody;
      velocity: THREE.Vector3;
    } | null = null;
    for (const owner of this.drivableOwners ?? []) {
      const entry = this.dynamic.get(owner);
      if (
        !entry?.drivable ||
        entry.worldCollider ||
        ("kind" in owner && owner.kind === "moving-world") ||
        !("hulls" in owner)
      )
        continue;
      const inverse = owner.state.orientation.clone().invert(),
        from = origin
          .clone()
          .sub(owner.state.position)
          .applyQuaternion(inverse),
        to = end.clone().sub(owner.state.position).applyQuaternion(inverse);
      for (const hull of owner.hulls as readonly CollisionHull[]) {
        const hit = cameraShapeRay(from, to, [hull]);
        // Installed ShapeRayCast sets fraction2 for start-inside/no boundary.
        // WheelForces reads that fraction, rather than the function return code.
        if (hit?.inside !== false || !hit.localNormal) continue;
        const distance = Math.fround(hit.fraction!) * maxDistance;
        // Installed418d9d..418dad is strict less: first equal owner/shape wins.
        if (distance > maxDistance || (best && distance >= best.distance))
          continue;
        const point = hit
            .point!.clone()
            .applyQuaternion(owner.state.orientation)
            .add(owner.state.position),
          modifier = this.modifiers[0] ?? DEFAULT_SURFACE;
        best = {
          distance,
          normal: hit.localNormal
            .clone()
            .negate()
            .applyQuaternion(owner.state.orientation),
          point,
          body: owner,
          velocity: pointVelocity(owner.state, owner.properties, point),
          friction: modifier.tyreFriction,
          rollingResistance: 0,
          downforce: modifier.downforce,
          bumpiness: modifier.bumpiness,
        };
      }
    }
    return best;
  }
  height(x: number, z: number, nearY: number) {
    let best: number | null = null;
    const cell = this.cells.get(`${Math.floor(x / 4)},${Math.floor(z / 4)}`);
    if (!cell) return null;
    for (const s of cell) {
      if (/^[!>?]/.test(s.material) || s.collisionMode === "edges") continue;
      if (s.normal.y < 0.45) continue;
      const { a, b, c } = s;
      const denom = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(denom) < 1e-10) continue;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denom,
        v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denom;
      if (u < -1e-6 || v < -1e-6 || u + v > 1.000001) continue;
      const y = u * a.y + v * b.y + (1 - u - v) * c.y;
      if (y <= nearY + 0.12 && (best === null || y > best)) best = y;
    }
    return best;
  }
  sweep(from: THREE.Vector3, to: THREE.Vector3, radius: number) {
    let fraction = 1,
      normal: THREE.Vector3 | null = null;
    const seen = new Set<Surface>();
    const minX = Math.floor((Math.min(from.x, to.x) - radius) / 4),
      maxX = Math.floor((Math.max(from.x, to.x) + radius) / 4),
      minZ = Math.floor((Math.min(from.z, to.z) - radius) / 4),
      maxZ = Math.floor((Math.max(from.z, to.z) + radius) / 4);
    const delta = to.clone().sub(from),
      sample = new THREE.Vector3(),
      closest = new THREE.Vector3();
    for (let x = minX; x <= maxX; x++)
      for (let z = minZ; z <= maxZ; z++)
        for (const s of this.cells.get(`${x},${z}`) ?? []) {
          if (seen.has(s)) continue;
          seen.add(s);
          if (
            Math.abs(s.normal.y) > 0.65 ||
            s.maxY < Math.min(from.y, to.y) + 0.03 ||
            s.minY > Math.max(from.y, to.y) + 0.35
          )
            continue;
          const n = s.normal.clone();
          n.y = 0;
          n.normalize();
          const d0 = n.dot(from.clone().sub(s.a));
          if (d0 < 0) n.negate();
          const start = n.dot(from.clone().sub(s.a)),
            movement = n.dot(delta);
          if (movement >= -1e-8) continue;
          const t = Math.max(0, (radius - start) / movement);
          if (t > fraction || t > 1) continue;
          sample.copy(from).addScaledVector(delta, t);
          sample.y += 0.14;
          const tri = new THREE.Triangle(s.a, s.b, s.c);
          tri.closestPointToPoint(sample, closest);
          if (closest.distanceTo(sample) > radius + 1e-5) continue;
          fraction = t;
          normal = n;
        }
    return normal ? { fraction: Math.max(0, fraction - 0.001), normal } : null;
  }
}

/** Bake static actor transforms and batch their triangles by material once.
 * The original hierarchy remains available from ACT parsing; batching is only
 * used for the static track, never articulated cars or pedestrians. */
export function batchStaticWorld(
  source: THREE.Group,
  retained: readonly THREE.Object3D[] = [],
): THREE.Group {
  source.updateMatrixWorld(true);
  const result = new THREE.Group();
  result.name = source.name;
  // Retained actors keep original hierarchy, private motion and shared geometry.
  // They are removed before static batching and its temporary-geometry disposal.
  const unique = [...new Set(retained)];
  for (const actor of unique) {
    let retainedParent = false;
    for (let node = actor.parent; node; node = node.parent)
      if (unique.includes(node)) {
        retainedParent = true;
        break;
      }
    if (!retainedParent) result.attach(actor);
  }
  const batches = new Map<
    THREE.Material,
    {
      positions: number[];
      normals: number[];
      uvs: number[];
      faceFlags: number[];
    }
  >();
  const vertex = new THREE.Vector3(),
    normal = new THREE.Vector3(),
    normalMatrix = new THREE.Matrix3();
  source.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geometry = o.geometry as THREE.BufferGeometry,
      p = geometry.getAttribute("position"),
      n = geometry.getAttribute("normal"),
      uv = geometry.getAttribute("uv"),
      index = geometry.index;
    normalMatrix.getNormalMatrix(o.matrixWorld);
    const mirrored = o.matrixWorld.determinant() < 0;
    const groups = geometry.groups.length
      ? geometry.groups
      : [{ start: 0, count: index ? index.count : p.count, materialIndex: 0 }];
    for (const group of groups) {
      const mat = Array.isArray(o.material)
        ? o.material[group.materialIndex ?? 0]
        : o.material;
      if (!mat) continue;
      let b = batches.get(mat);
      if (!b) {
        b = { positions: [], normals: [], uvs: [], faceFlags: [] };
        batches.set(mat, b);
      }
      for (let i = group.start; i < group.start + group.count; i++) {
        const relative = i - group.start;
        const sourceIndex = mirrored
          ? group.start + Math.floor(relative / 3) * 3 + [0, 2, 1][relative % 3]
          : i;
        const j = index ? index.getX(sourceIndex) : sourceIndex;
        if (relative % 3 === 0) {
          const flags =
            geometry.userData.sourceFaceFlags?.[Math.floor(sourceIndex / 3)] ??
            geometry.userData.sourceFaces?.[Math.floor(j / 3)]?.flags ??
            0;
          b.faceFlags.push(
            mirrored
              ? (flags & ~5) | ((flags & 1) << 2) | ((flags & 4) >> 2)
              : flags,
          );
        }
        vertex.fromBufferAttribute(p, j).applyMatrix4(o.matrixWorld);
        b.positions.push(vertex.x, vertex.y, vertex.z);
        if (n)
          normal
            .fromBufferAttribute(n, j)
            .applyMatrix3(normalMatrix)
            .normalize();
        else normal.set(0, 1, 0);
        b.normals.push(normal.x, normal.y, normal.z);
        b.uvs.push(uv ? uv.getX(j) : 0, uv ? uv.getY(j) : 0);
      }
    }
  });
  for (const [material, batch] of batches) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(batch.positions, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(batch.normals, 3),
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(batch.uvs, 2));
    geometry.userData.sourceFaceFlags = Uint8Array.from(batch.faceFlags);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = material.name;
    // GPU batches are presentation geometry. Native source collision retains
    // the original meshes and separately admits later-created live actors.
    mesh.userData.worldRenderBatch = true;
    result.add(mesh);
  }
  // Release temporary geometry while preserving materials used by the batches.
  const geometries = new Set<THREE.BufferGeometry>();
  source.traverse((o) => {
    if (o instanceof THREE.Mesh) geometries.add(o.geometry);
  });
  const retainedGeometries = new Set<THREE.BufferGeometry>();
  result.traverse((o) => {
    if (o instanceof THREE.Mesh) retainedGeometries.add(o.geometry);
  });
  for (const geo of geometries) if (!retainedGeometries.has(geo)) geo.dispose();
  return result;
}
