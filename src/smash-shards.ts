import {
  Box3,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Material,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Texture,
  Vector2,
  Vector3,
} from "three";
import type { SmashInitialSpeed, SmashShrapnel } from "./world-smash";

/** Source positions and UVs are current model geometry, in BRender model units.
 * The transform maps them into scene world space. Velocity is the native raw
 * starting-step model velocity converted by the smash queue through double6.9.
 * Do not supply post-impact velocity or pre-divide by the world scale. */
export interface ShardSpawnSource {
  geometry: BufferGeometry;
  matrixWorld: Matrix4;
  materialSlots?: readonly number[];
  /** C2 car material names are scoped to their loaded asset context. */
  materials?: ReadonlyMap<string, Material>;
  /** Maximum unique linked source vertices and faces copied before refinement. */
  sourceVertexLimit?: number;
  sourceFaceLimit?: number;
  impacteeVelocity: Vector3;
  timeMs: number;
  groupId?: number;
}
export interface ShardRuntimeOptions {
  gravity?: number | (() => number);
  random?: () => number;
}
export interface ShardSpawnResult {
  created: number;
  triangles: number;
  sourceTruncated: boolean;
  reason?: "unsupported" | "missing-material" | "empty-geometry" | "pool-full";
}
interface Vertex {
  position: Vector3;
  uv: Vector2;
}
type Face = [number, number, number];
interface Fragment {
  mesh: Mesh<BufferGeometry, Material>;
  velocity: Vector3;
  spin: Vector3;
  startMs: number;
  visibleUntilMs: number;
  endMs: number;
  groupId: number;
  firstUpdate: boolean;
}
const CAPACITY = 200;
const EPSILON = 2 ** -22;
const ROTATION_EPSILON = 0.0001;

/** Independent reconstruction of HW 0x4ec0e0, 0x4eaef0 and 0x4efcb0.
 * Fragments are single textured triangles; their material and texture source
 * remain externally owned. There is no source ground contact or alpha fade. */
export class ShardRuntime {
  private readonly fragments: Fragment[] = [];
  private readonly ownedMaterials = new Map<Material, Material>();
  private readonly ownedTextures = new Set<Texture>();
  private readonly random: () => number;
  private previousTimeMs = 0;
  private nextGroupId = 1;
  private disposed = false;
  private totalCreated = 0;

  constructor(
    private readonly scene: Object3D,
    private readonly materials: ReadonlyMap<string, Material>,
    private readonly options: ShardRuntimeOptions = {},
  ) {
    this.random = options.random ?? Math.random;
  }

  private draw(): number {
    const n = this.random();
    if (!Number.isFinite(n) || n < 0 || n >= 1)
      throw new Error("Shard random must be in [0,1)");
    return Math.floor(n * 32768) / 32768;
  }
  private sample(min: number, max: number): number {
    return min + (max - min) * this.draw();
  }
  private signed(max: number): number {
    return this.sample(-max, max);
  }

  spawn(spec: SmashShrapnel, source: ShardSpawnSource): ShardSpawnResult {
    if (this.disposed) throw new Error("Shard runtime is disposed");
    const result: ShardSpawnResult = {
      created: 0,
      triangles: 0,
      sourceTruncated: false,
    };
    if (
      spec.kind !== "shards" ||
      !spec.shard ||
      !spec.speed ||
      !spec.lifetimeSeconds
    )
      return { ...result, reason: "unsupported" };
    const { scalar, integer, material: materialName } = spec.shard;
    for (const [name, value] of [
      ["sourceVertexLimit", source.sourceVertexLimit],
      ["sourceFaceLimit", source.sourceFaceLimit],
    ] as const) {
      if (
        value !== undefined &&
        (!Number.isInteger(value) || value < 1 || value > CAPACITY)
      )
        throw new Error(
          `Invalid shard ${name}; expected an integer from 1 to ${CAPACITY}`,
        );
    }
    if (
      ![
        scalar,
        integer,
        ...spec.lifetimeSeconds,
        ...spec.speed.towards,
        spec.speed.impacteeVelocityFactor,
        spec.speed.randomVelocityMax,
        spec.speed.randomUpVelocityMax,
        spec.speed.randomNormalVelocityMax,
        spec.speed.randomSpinRateMax,
        ...source.impacteeVelocity.toArray(),
        ...source.matrixWorld.elements,
        source.timeMs,
      ].every(Number.isFinite) ||
      scalar < 0 ||
      !Number.isInteger(integer) ||
      spec.lifetimeSeconds[0] < 0 ||
      spec.lifetimeSeconds[1] < spec.lifetimeSeconds[0]
    )
      throw new Error("Invalid shard specification or source");
    const material = this.material(materialName, source.materials);
    if (!material) return { ...result, reason: "missing-material" };
    const { vertices, faces, truncated } = this.sourceGeometry(source);
    result.sourceTruncated = truncated;
    if (!faces.length) return { ...result, reason: "empty-geometry" };
    this.subdivide(vertices, faces, scalar);
    for (const vertex of vertices)
      vertex.position.applyMatrix4(source.matrixWorld);
    const sharedCentre = new Vector3();
    if (integer & 1) {
      for (const vertex of vertices) sharedCentre.add(vertex.position);
      sharedCentre.multiplyScalar(1 / vertices.length);
    }
    const groupId = source.groupId ?? this.nextGroupId++;
    const minMs = Math.trunc(spec.lifetimeSeconds[0] * 1000);
    const maxMs = Math.trunc(spec.lifetimeSeconds[1] * 1000);
    result.triangles = faces.length;
    for (const face of faces) {
      // Native priority3 cannot replace another priority3 shard in the pool.
      if (this.fragments.length >= CAPACITY) {
        result.reason = "pool-full";
        break;
      }
      const points = face.map((index) => vertices[index]);
      const centre = points
        .reduce((sum, vertex) => sum.add(vertex.position), new Vector3())
        .multiplyScalar(1 / 3);
      const normal = new Vector3()
        .subVectors(points[1].position, points[0].position)
        .cross(
          new Vector3().subVectors(points[2].position, points[0].position),
        );
      if (normal.length() <= EPSILON) normal.set(1, 0, 0);
      else normal.normalize();
      const extent = new Box3()
        .setFromPoints(points.map((vertex) => vertex.position))
        .getSize(new Vector3());
      const size = extent.x + extent.y + extent.z;
      const factor = size < 0.1 ? (0.2 - size) * 5 : 0.5;
      const position = (integer & 1 ? sharedCentre : centre).clone();
      const jitter = integer & 1 ? 0.04 : 0.015;
      // Native position jitter precedes its initial-movement random draws.
      for (let i = 0; i < 3; i++)
        position.setComponent(
          i,
          position.getComponent(i) + this.signed(jitter),
        );
      const { velocity, spin } = this.movement(
        spec.speed,
        source.impacteeVelocity,
        normal,
        factor,
      );
      const visibleMs = minMs + Math.floor(this.draw() * (maxMs - minMs + 1));
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        "position",
        new Float32BufferAttribute(
          points.flatMap((vertex) =>
            vertex.position.clone().sub(centre).toArray(),
          ),
          3,
        ),
      );
      geometry.setAttribute(
        "uv",
        new Float32BufferAttribute(
          points.flatMap((vertex) => vertex.uv.toArray()),
          2,
        ),
      );
      geometry.computeVertexNormals();
      const mesh = new Mesh(geometry, material);
      mesh.name = "WAM shard";
      mesh.position.copy(position);
      mesh.visible = source.timeMs < source.timeMs + visibleMs;
      this.scene.add(mesh);
      this.fragments.push({
        mesh,
        velocity,
        spin,
        startMs: source.timeMs,
        visibleUntilMs: source.timeMs + visibleMs,
        endMs: source.timeMs + maxMs,
        groupId,
        firstUpdate: true,
      });
      result.created++;
      this.totalCreated++;
    }
    return result;
  }

  private material(
    name: string,
    scoped?: ReadonlyMap<string, Material>,
  ): Material | undefined {
    const key = name.toUpperCase();
    const find = (materials: ReadonlyMap<string, Material>) =>
      materials.get(name) ??
      materials.get(key) ??
      [...materials].find(
        ([candidate]) => candidate.toUpperCase() === key,
      )?.[1];
    const source = (scoped && find(scoped)) ?? find(this.materials);
    if (!source) return undefined;
    const existing = this.ownedMaterials.get(source);
    if (existing) return existing;
    const material = source.clone();
    material.side = DoubleSide;
    // ReadShrapnelSpec4ef108 resets the shard material's UV transform. Own
    // that texture state while sharing its image with the original asset.
    if ("map" in material && material.map instanceof Texture) {
      const texture = material.map.clone();
      texture.matrixAutoUpdate = false;
      texture.matrix.identity();
      texture.needsUpdate = true;
      material.map = texture;
      this.ownedTextures.add(texture);
    }
    this.ownedMaterials.set(source, material);
    return material;
  }

  private sourceGeometry(source: ShardSpawnSource): {
    vertices: Vertex[];
    faces: Face[];
    truncated: boolean;
  } {
    const geometry = source.geometry;
    const positions = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    const vertexLimit = source.sourceVertexLimit ?? CAPACITY;
    const faceLimit = source.sourceFaceLimit ?? CAPACITY;
    const vertices: Vertex[] = [];
    const faces: Face[] = [];
    let truncated = false;
    if (!positions) return { vertices, faces, truncated };
    const sourceIndices = geometry.userData.sourceVertexIndices as
      | ArrayLike<number>
      | undefined;
    if (sourceIndices !== undefined) {
      if (
        sourceIndices === null ||
        typeof sourceIndices !== "object" ||
        !Number.isInteger(sourceIndices.length) ||
        sourceIndices.length !== positions.count
      )
        throw new Error(
          "Invalid shard sourceVertexIndices mapping; expected one model index per render vertex",
        );
      for (let i = 0; i < sourceIndices.length; i++) {
        if (!Number.isSafeInteger(sourceIndices[i]) || sourceIndices[i] < 0)
          throw new Error(
            `Invalid shard sourceVertexIndices mapping at render vertex ${i}`,
          );
      }
    }
    const count = geometry.index?.count ?? positions.count;
    const slots = source.materialSlots
      ? new Set(source.materialSlots)
      : undefined;
    const map = new Map<number, number>();
    const start = Math.max(0, Math.ceil(geometry.drawRange.start / 3) * 3);
    const end = Math.min(
      count,
      geometry.drawRange.start + geometry.drawRange.count,
    );
    for (let offset = start; offset + 2 < end; offset += 3) {
      if (
        slots &&
        geometry.groups.length &&
        !geometry.groups.some(
          (group) =>
            offset >= group.start &&
            offset + 2 < group.start + group.count &&
            slots.has(group.materialIndex ?? 0),
        )
      )
        continue;
      if (slots && !geometry.groups.length && !slots.has(0)) continue;
      const indices = [0, 1, 2].map((i) =>
        geometry.index ? geometry.index.getX(offset + i) : offset + i,
      );
      if (
        !indices.every(
          (i) => Number.isInteger(i) && i >= 0 && i < positions.count,
        )
      )
        throw new Error("Invalid shard source vertex index");
      const keys = indices.map((index) => sourceIndices?.[index] ?? index);
      const additional = new Set(keys.filter((index) => !map.has(index))).size;
      if (
        faces.length >= faceLimit ||
        vertices.length + additional > vertexLimit
      ) {
        truncated = true;
        break;
      }
      const face = indices.map((index, corner) => {
        const key = keys[corner];
        let local = map.get(key);
        if (local === undefined) {
          const position = new Vector3().fromBufferAttribute(positions, index);
          const mapping =
            uv && index < uv.count
              ? new Vector2(uv.getX(index), uv.getY(index))
              : new Vector2();
          if (
            ![...position.toArray(), ...mapping.toArray()].every(
              Number.isFinite,
            )
          )
            throw new Error("Invalid shard source vertex");
          local = vertices.length;
          map.set(key, local);
          vertices.push({ position, uv: mapping });
        }
        return local;
      }) as Face;
      faces.push(face);
    }
    return { vertices, faces, truncated };
  }

  private subdivide(
    vertices: Vertex[],
    faces: Face[],
    threshold: number,
  ): void {
    for (
      let i = 0;
      i < faces.length && faces.length < 199 && vertices.length < 199;
      i++
    ) {
      for (
        let split = 0;
        split < 4 && faces.length < 199 && vertices.length < 199;
        split++
      ) {
        const face = faces[i];
        const [p0, p1, p2] = face.map((index) => vertices[index].position);
        const d01 = p0.distanceToSquared(p1),
          d02 = p0.distanceToSquared(p2),
          d12 = p1.distanceToSquared(p2);
        if (d01 < threshold && d02 < threshold && d12 < threshold) break;
        const anchor =
          d01 < d02 && d01 < d12 ? 2 : d12 < d02 && d12 < d01 ? 0 : 1;
        const others = [0, 1, 2].filter((index) => index !== anchor);
        if (Math.floor(this.draw() * 2)) others.reverse();
        const [a, b] = others;
        const originalA = face[a],
          originalB = face[b];
        const v0 = vertices[face[anchor]];
        const va = vertices[originalA],
          vb = vertices[originalB];
        const interpolate = (vertex: Vertex): Vertex => {
          const t = this.sample(0.2, 0.8);
          return {
            position: v0.position.clone().lerp(vertex.position, t),
            uv: v0.uv.clone().lerp(vertex.uv, t),
          };
        };
        const x = vertices.length,
          y = x + 1;
        vertices.push(interpolate(va), interpolate(vb));
        faces.push([originalA, x, y], [originalA, originalB, y]);
        face[a] = x;
        face[b] = y;
      }
    }
  }

  private movement(
    speed: SmashInitialSpeed,
    inherited: Vector3,
    normal: Vector3,
    factor: number,
  ): { velocity: Vector3; spin: Vector3 } {
    const velocity = inherited
      .clone()
      .multiplyScalar(speed.impacteeVelocityFactor);
    const spin = new Vector3();
    // Shards pass NULL towards endpoints, so authored towards fields are unused.
    for (let i = 0; i < 3; i++) {
      velocity.setComponent(
        i,
        (velocity.getComponent(i) + this.signed(speed.randomVelocityMax)) *
          factor,
      );
      spin.setComponent(i, this.sample(0, 1));
    }
    velocity.y += this.sample(0, speed.randomUpVelocityMax);
    for (let i = 0; i < 3; i++)
      velocity.setComponent(
        i,
        velocity.getComponent(i) +
          normal.getComponent(i) *
            this.sample(0, speed.randomNormalVelocityMax),
      );
    if (spin.length() <= EPSILON) spin.set(1, 0, 0);
    else spin.normalize();
    for (let i = 0; i < 3; i++)
      spin.setComponent(
        i,
        spin.getComponent(i) *
          this.signed(speed.randomSpinRateMax * 0.1 * factor),
      );
    return { velocity, spin };
  }

  update(timeMs: number): void {
    if (this.disposed) return;
    if (!Number.isFinite(timeMs)) throw new Error("Invalid shard update time");
    const now = timeMs >>> 0;
    // HW 4efed0 uses a zero sentinel, not a monotonic wall clock. The native
    // predicted game timestamp may regress after a long frame.
    if (this.previousTimeMs === 0) {
      this.previousTimeMs = now;
      return;
    }
    const elapsedMs = Math.fround(now - (this.previousTimeMs | 0));
    const dt = Math.fround(elapsedMs * Math.fround(0.001));
    const suppliedGravity =
      typeof this.options.gravity === "function"
        ? this.options.gravity()
        : (this.options.gravity ?? 1);
    if (!Number.isFinite(suppliedGravity))
      throw new Error("Invalid shard gravity");
    const gravity = Math.fround(suppliedGravity);
    this.previousTimeMs = now;
    const expiredGroups = new Set(
      this.fragments
        .filter((fragment) => now < fragment.startMs || now >= fragment.endMs)
        .map((fragment) => fragment.groupId),
    );
    for (let i = this.fragments.length - 1; i >= 0; i--) {
      const fragment = this.fragments[i];
      if (expiredGroups.has(fragment.groupId)) {
        this.remove(i);
        continue;
      }
      if (dt && !fragment.firstUpdate) {
        // Native x87 intermediates use the double negative reciprocal; each
        // actor translation and velocity component is stored as float32.
        const reciprocal = -1 / 6.9;
        fragment.mesh.position.x = Math.fround(
          fragment.mesh.position.x - fragment.velocity.x * dt * reciprocal,
        );
        fragment.mesh.position.y = Math.fround(
          fragment.mesh.position.y -
            (fragment.velocity.y * dt - gravity * dt * dt * 4.9) * reciprocal,
        );
        fragment.mesh.position.z = Math.fround(
          fragment.mesh.position.z - fragment.velocity.z * dt * reciprocal,
        );
        fragment.velocity.y = Math.fround(
          fragment.velocity.y - dt * gravity * 9.8,
        );
        const { x, y, z } = fragment.spin;
        const omega = Math.sqrt(y * y + z * z + x * x);
        if (Math.abs(omega * dt) >= ROTATION_EPSILON)
          fragment.mesh.quaternion.premultiply(
            new Quaternion().setFromAxisAngle(
              new Vector3(
                Math.fround(x / omega),
                Math.fround(y / omega),
                Math.fround(z / omega),
              ),
              (Math.trunc((omega * dt * 65536) / (2 * Math.PI)) * 2 * Math.PI) /
                65536,
            ),
          );
      }
      fragment.firstUpdate = false;
      fragment.mesh.visible = now < fragment.visibleUntilMs;
    }
  }

  snapshot() {
    return {
      capacity: CAPACITY,
      active: this.fragments.length,
      visible: this.fragments.filter((fragment) => fragment.mesh.visible)
        .length,
      totalCreated: this.totalCreated,
      fragments: this.fragments.map((fragment) => ({
        position: fragment.mesh.position.toArray(),
        quaternion: fragment.mesh.quaternion.toArray(),
        velocity: fragment.velocity.toArray(),
        spin: fragment.spin.toArray(),
        startMs: fragment.startMs,
        visibleUntilMs: fragment.visibleUntilMs,
        endMs: fragment.endMs,
        groupId: fragment.groupId,
      })),
    };
  }
  private remove(index: number): void {
    const [fragment] = this.fragments.splice(index, 1);
    fragment.mesh.removeFromParent();
    fragment.mesh.geometry.dispose();
  }
  clear(): void {
    for (let i = this.fragments.length - 1; i >= 0; i--) this.remove(i);
  }
  dispose(): void {
    this.clear();
    for (const material of this.ownedMaterials.values()) material.dispose();
    this.ownedMaterials.clear();
    for (const texture of this.ownedTextures) texture.dispose();
    this.ownedTextures.clear();
    this.disposed = true;
  }
}
