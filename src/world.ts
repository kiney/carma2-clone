import * as THREE from "three";
import { DEFAULT_SURFACE, surfaceIndex } from "./physics/surfaces";
import type { SurfaceModifier } from "./physics/surfaces";
import { pointVelocity, type RigidBody } from "./physics/contact";
import { intersectWheelFace } from "./physics/wheel-ray";
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
}
/** A fixed broad phase over transformed original triangles. Geometry stays in C2 world units. */
export class WorldCollision {
  private cells = new Map<string, Surface[]>();
  private cellSize = 4;
  triangles = 0;
  constructor(
    private sourceRoot: THREE.Object3D,
    private modifiers: readonly SurfaceModifier[] = [DEFAULT_SURFACE],
  ) {
    this.rebuildStatic();
  }
  rebuildStatic() {
    this.cells.clear();
    this.triangles = 0;
    for (const surface of this.makeSurfaces(this.sourceRoot))
      this.indexSurface(surface);
  }
  private dynamic = new Map<
    RigidBody,
    {
      actor: THREE.Object3D;
      drivable: boolean;
      surfaces: Surface[];
      bounds: THREE.Box3;
      pose: string;
      worldCollider: boolean;
    }
  >();
  private indexSurface(s: Surface) {
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
        cell.push(s);
      }
    this.triangles++;
  }
  private makeSurfaces(group: THREE.Object3D, owner?: RigidBody): Surface[] {
    const surfaces: Surface[] = [];
    group.updateMatrixWorld(true);
    group.traverse((object) => {
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
      for (let i = 0; i < count; i += 3) {
        if (geo.userData.worldSmashFaceModes?.[i / 3] === "passthrough")
          continue;
        const vertices = [0, 1, 2].map((j) =>
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
        const s: Surface = {
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
          faceFlags:
            geo.userData.sourceFaceFlags?.[i / 3] ??
            geo.userData.sourceFaces?.[
              Math.floor((index ? index.getX(i) : i) / 3)
            ]?.flags ??
            0,
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
    });
    return surfaces;
  }
  addDynamic(
    owner: RigidBody,
    actor: THREE.Object3D,
    drivable = true,
    worldCollider = false,
  ) {
    this.dynamic.set(owner, {
      actor,
      drivable,
      surfaces: [],
      bounds: new THREE.Box3(),
      pose: "",
      worldCollider,
    });
    this.refreshDynamic(owner);
  }
  removeDynamic(owner: RigidBody) {
    this.dynamic.delete(owner);
  }
  invalidateDynamic(owner?: RigidBody) {
    for (const [body, entry] of this.dynamic)
      if (!owner || body === owner) entry.pose = "";
    this.refreshDynamic(owner);
  }
  refreshDynamic(owner?: RigidBody) {
    for (const [body, entry] of this.dynamic) {
      if (owner && body !== owner) continue;
      entry.actor.updateWorldMatrix(true, true);
      const pose = [...entry.actor.matrixWorld.elements].join(",");
      if (entry.pose === pose) continue;
      entry.pose = pose;
      entry.surfaces = this.makeSurfaces(entry.actor, body);
      entry.bounds.setFromPoints(
        entry.surfaces.flatMap((s) => [s.a, s.b, s.c]),
      );
    }
  }
  private dynamicSurfaces(bounds: THREE.Box3): Surface[] {
    return [...this.dynamic.values()]
      .filter(
        (entry) =>
          entry.drivable &&
          entry.actor.visible &&
          entry.bounds.intersectsBox(bounds),
      )
      .flatMap((entry) => entry.surfaces);
  }
  /** Bounds-confined original triangle candidates, shared by body and wheel queries. */
  querySurfaces(
    min: THREE.Vector3,
    max: THREE.Vector3,
    includeNonSolid = false,
  ): Surface[] {
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
      for (let z = z0; z <= z1; z++)
        for (const s of this.cells.get(`${x},${z}`) ?? [])
          if (
            s.enabled !== false &&
            s.maxY >= min.y &&
            s.minY <= max.y &&
            (includeNonSolid || !/^[!>]/.test(s.material))
          )
            result.add(s);
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
      ...this.querySurfaces(bounds.min, bounds.max, true),
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
      ...this.querySurfaces(bounds.min, bounds.max, includeNonSolid),
      ...this.dynamicSurfaces(bounds),
    ]) {
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
