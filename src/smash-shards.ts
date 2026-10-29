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
import type { SmashShrapnel } from "./world-smash";
import { nativeShrapnelMovement } from "./shrapnel-movement";

/** Source positions and UVs are current model geometry, in BRender model units.
 * The transform maps them into scene world space. Velocity is the native raw
 * starting-step model velocity converted by the smash queue through double6.9.
 * Do not supply post-impact velocity or pre-divide by the world scale. */
export interface ShardSpawnSource {
  geometry: BufferGeometry;
  matrixWorld: Matrix4;
  materialSlots?: readonly number[];
  /** Fixed MODEL/material links captured during WAM setup. */
  sourceLink?: ShardSourceLink;
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
  /** Native srand; ghost production reseeds the SAME shared CRT stream. */
  seed?: (value: number) => void;
}
export interface GhostFragmentTemplate {
  geometry: BufferGeometry;
  material: Material | Material[];
  /** Selected ACT's authored local matrix, including its translation. */
  matrix: Matrix4;
  name: string;
}
export interface GhostSpawnSource {
  templates: readonly GhostFragmentTemplate[];
  /** Captured actor/face frame, including any native container face scaling. */
  frame: Matrix4;
  point: Vector3;
  impacteeVelocity: Vector3;
  timeMs: number;
  groupId?: number;
  seed: number;
  visible: boolean;
  /** Container scaling's tiny-face exit occurs after seed/count, WITHOUT restore. */
  tinyFace?: boolean;
}
export interface ShardSpawnResult {
  created: number;
  triangles: number;
  sourceTruncated: boolean;
  reason?:
    | "unsupported"
    | "missing-material"
    | "empty-geometry"
    | "pool-full"
    | "tiny-face"
    | "not-visible";
}
interface Vertex {
  position: Vector3;
  uv: Vector2;
}
type Face = [number, number, number];
interface Fragment {
  owner?: object;
  slot: number;
  priority: number;
  ownsGeometry: boolean;
  mesh: Mesh<BufferGeometry, Material | Material[]>;
  fullMatrix: boolean;
  velocity: Vector3;
  spin: Vector3;
  startMs: number;
  visibleUntilMs: number;
  endMs: number;
  groupId: number;
  firstUpdate: boolean;
}
/** Shared GetNextShrapnel admission. The producer runs only after a real slot
 * has been admitted, so pool contention consumes no placement/movement RNG. */
export interface SharedFragmentSource {
  mesh: Mesh<BufferGeometry, Material | Material[]>;
  velocity: Vector3;
  spin: Vector3;
  timeMs: number;
  visibleMs: number;
  maximumMs: number;
  groupId: number;
  owner?: object;
  fullMatrix?: boolean;
  ownsGeometry?: boolean;
}
const CAPACITY = 200;
const EPSILON = 2 ** -22;
const ROTATION_EPSILON = 0.0001;

/** Immutable source MODEL indices and compact triangle tuples. The retained
 * geometry supplies live deformed coordinates/UVs, independent of render groups,
 * material renames, LOD visibility and later draw-range changes. A browser
 * structural split replaces render geometry; the retained MODEL remains the
 * linked source and can therefore still contain its pre-split polygons. */
export interface ShardSourceLink {
  readonly geometry: BufferGeometry;
  readonly renderVertices: readonly number[];
  readonly faces: readonly (readonly [number, number, number])[];
  readonly truncated: boolean;
}

/** Native WAM LinkSmashies/MungeMaterial admits a bounded material-local MODEL
 * vertex list and face tuples once during setup. Render-corner duplicates are
 * collapsed through their original MODEL indices, retaining first occurrence. */
export function captureShardSourceLink(
  source: Pick<
    ShardSpawnSource,
    "geometry" | "materialSlots" | "sourceVertexLimit" | "sourceFaceLimit"
  >,
): ShardSourceLink {
  for (const limit of [source.sourceVertexLimit, source.sourceFaceLimit])
    if (
      limit !== undefined &&
      (!Number.isInteger(limit) || limit < 1 || limit > CAPACITY)
    )
      throw new Error("Invalid shard source link capacity");
  const geometry = source.geometry;
  const positions = geometry.getAttribute("position");
  const vertexLimit = source.sourceVertexLimit ?? CAPACITY;
  const faceLimit = source.sourceFaceLimit ?? CAPACITY;
  const renderVertices: number[] = [];
  const faces: Face[] = [];
  let truncated = false;
  if (!positions)
    return Object.freeze({
      geometry,
      renderVertices: Object.freeze(renderVertices),
      faces: Object.freeze(faces),
      truncated,
    });
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
      renderVertices.length + additional > vertexLimit
    ) {
      truncated = true;
      break;
    }
    const face = indices.map((index, corner) => {
      const key = keys[corner];
      let local = map.get(key);
      if (local === undefined) {
        local = renderVertices.length;
        map.set(key, local);
        renderVertices.push(index);
      }
      return local;
    }) as Face;
    faces.push(face);
  }
  return Object.freeze({
    geometry,
    renderVertices: Object.freeze(renderVertices),
    faces: Object.freeze(faces.map((face) => Object.freeze(face))),
    truncated,
  });
}

/** Independent reconstruction of HW 0x4ec0e0, 0x4eaef0 and 0x4efcb0.
 * Fragments are single textured triangles; their material and texture source
 * remain externally owned. There is no source ground contact or alpha fade. */
export class ShardRuntime {
  private readonly fragments: Fragment[] = [];
  private readonly slots: (Fragment | undefined)[] = Array(CAPACITY);
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
  createFragmentGroup(): number {
    if (this.disposed) throw new Error("Shard runtime is disposed");
    return this.nextGroupId++;
  }
  spawnFragment(
    priority: number,
    producer: () => SharedFragmentSource,
  ): boolean {
    if (this.disposed) throw new Error("Shard runtime is disposed");
    if (!Number.isInteger(priority) || priority < 0 || priority > 255)
      throw new Error("Invalid shared fragment priority");
    const slot = this.reserveSlot(priority);
    if (slot === undefined) return false;
    const source = producer();
    if (
      !source.mesh ||
      ![
        ...source.velocity.toArray(),
        ...source.spin.toArray(),
        source.timeMs,
        source.visibleMs,
        source.maximumMs,
        source.groupId,
      ].every(Number.isFinite) ||
      !Number.isInteger(source.timeMs) ||
      source.timeMs < 0 ||
      source.timeMs > 0xffffffff ||
      !Number.isInteger(source.visibleMs) ||
      source.visibleMs < 0 ||
      !Number.isInteger(source.maximumMs) ||
      source.maximumMs < source.visibleMs
    )
      throw new Error("Invalid shared fragment producer result");
    const { mesh } = source;
    mesh.visible = source.timeMs < (source.timeMs + source.visibleMs) >>> 0;
    this.scene.add(mesh);
    this.insert({
      slot,
      priority,
      owner: source.owner,
      ownsGeometry: source.ownsGeometry ?? false,
      fullMatrix: source.fullMatrix ?? true,
      mesh,
      velocity: source.velocity,
      spin: source.spin,
      startMs: source.timeMs,
      visibleUntilMs: (source.timeMs + source.visibleMs) >>> 0,
      endMs: (source.timeMs + source.maximumMs) >>> 0,
      groupId: source.groupId,
      firstUpdate: true,
    });
    this.totalCreated++;
    return true;
  }
  countOwner(owner: object): number {
    return this.fragments.filter((fragment) => fragment.owner === owner).length;
  }
  clearOwner(owner: object): void {
    for (const fragment of [...this.fragments])
      if (fragment.owner === owner) this.removeFragment(fragment);
  }
  get stats() {
    return {
      capacity: CAPACITY,
      active: this.fragments.length,
      visible: this.fragments.filter((fragment) => fragment.mesh.visible)
        .length,
      totalCreated: this.totalCreated,
    };
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
      const slot = this.reserveSlot(3);
      if (slot === undefined) {
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
      const { velocity, spin } = nativeShrapnelMovement({
        speed: spec.speed,
        impacteeVelocity: source.impacteeVelocity,
        normal,
        sizeFactor: factor,
        // Shard callers supply NULL towards endpoints in the original.
        random: this.random,
      });
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
      this.insert({
        slot,
        priority: 3,
        ownsGeometry: true,
        fullMatrix: false,
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

  /** Installed ghost branch4eb7ba. Placement frames/template order/visibility
   * are explicit source providers; never synthesize a radial particle cloud. */
  spawnGhosts(spec: SmashShrapnel, source: GhostSpawnSource): ShardSpawnResult {
    if (this.disposed) throw new Error("Shard runtime is disposed");
    const result: ShardSpawnResult = {
      created: 0,
      triangles: 0,
      sourceTruncated: false,
    };
    if (
      spec.kind !== "ghostparts" ||
      spec.position?.kind !== "actorbased" ||
      !spec.speed ||
      !spec.amount ||
      !spec.lifetimeSeconds
    )
      return { ...result, reason: "unsupported" };
    if (!source.visible) return { ...result, reason: "not-visible" };
    if (!this.options.seed)
      throw new Error("Ghost production requires shared native srand");
    const amount = spec.amount,
      lifetime = spec.lifetimeSeconds;
    if (
      !source.templates.length ||
      source.templates.length > 2048 ||
      !amount.every(Number.isInteger) ||
      (amount[0] >= 0 &&
        (amount.length !== 2 || amount[1] < amount[0] || amount[1] > 100000)) ||
      ![
        ...lifetime,
        ...source.frame.elements,
        ...source.point.toArray(),
        ...source.impacteeVelocity.toArray(),
        source.timeMs,
        source.seed,
      ].every(Number.isFinite) ||
      lifetime[0] < 0 ||
      lifetime[1] < lifetime[0] ||
      !Number.isInteger(source.timeMs) ||
      source.timeMs < 0 ||
      source.timeMs > 0xffffffff ||
      !Number.isInteger(source.seed) ||
      source.seed < 0 ||
      source.seed > 0xffffffff ||
      source.templates.some(
        (template) => !template.matrix.elements.every(Number.isFinite),
      )
    )
      throw new Error("Invalid native ghost specification or providers");
    const savedRand = Math.floor(this.draw() * 32768);
    this.options.seed(source.seed);
    const count =
      amount[0] < 0
        ? source.templates.length
        : amount[0] + Math.floor(this.draw() * (amount[1]! - amount[0] + 1));
    if (source.tinyFace) return { ...result, reason: "tiny-face" };
    const groupId = source.groupId ?? this.nextGroupId++;
    const minMs = Math.trunc(lifetime[0] * 1000),
      maxMs = Math.trunc(lifetime[1] * 1000);
    for (let piece = 0; piece < count; piece++) {
      const template =
        source.templates[
          amount[0] < 0
            ? piece
            : Math.floor(this.draw() * source.templates.length)
        ];
      const slot = this.reserveSlot(4);
      if (slot === undefined) {
        result.reason = "pool-full";
        break;
      }
      const mesh = new Mesh(template.geometry, template.material);
      mesh.name = `C2 ghost: ${template.name}`;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.multiplyMatrices(source.frame, template.matrix);
      mesh.matrix.elements.forEach(
        (value, index, elements) => (elements[index] = Math.fround(value)),
      );
      mesh.position.setFromMatrixPosition(mesh.matrix);
      const { velocity, spin } = nativeShrapnelMovement({
        speed: spec.speed,
        impacteeVelocity: source.impacteeVelocity,
        normal: new Vector3(),
        sizeFactor: 1,
        towardsPosition: source.point,
        piecePosition: mesh.position,
        random: this.random,
      });
      const visibleMs = minMs + Math.floor(this.draw() * (maxMs - minMs + 1));
      mesh.visible = source.timeMs < (source.timeMs + visibleMs) >>> 0;
      this.scene.add(mesh);
      this.insert({
        slot,
        priority: 4,
        ownsGeometry: false,
        fullMatrix: true,
        mesh,
        velocity,
        spin,
        startMs: source.timeMs,
        visibleUntilMs: (source.timeMs + visibleMs) >>> 0,
        endMs: (source.timeMs + maxMs) >>> 0,
        groupId,
        firstUpdate: true,
      });
      result.created++;
      this.totalCreated++;
    }
    // Native restores a rand OUTPUT, not the complete previous RNG state.
    this.options.seed(savedRand);
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
    const link = source.sourceLink ?? captureShardSourceLink(source);
    const positions = link.geometry.getAttribute("position");
    const uv = link.geometry.getAttribute("uv");
    const vertices = link.renderVertices.map((index) => {
      if (!positions || index >= positions.count)
        throw new Error("Linked shard source vertex is unavailable");
      const position = new Vector3().fromBufferAttribute(positions, index);
      const mapping =
        uv && index < uv.count
          ? new Vector2(uv.getX(index), uv.getY(index))
          : new Vector2();
      if (![...position.toArray(), ...mapping.toArray()].every(Number.isFinite))
        throw new Error("Invalid shard source vertex");
      return { position, uv: mapping };
    });
    return {
      vertices,
      faces: link.faces.map((face) => [...face] as Face),
      truncated: link.truncated,
    };
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
    // Installed 4efed0 visits physical records upward. Expiry removes a whole
    // group immediately, before the next record is visited.
    for (let slot = 0; slot < CAPACITY; slot++) {
      const fragment = this.slots[slot];
      if (!fragment) continue;
      // HW 4eff2d compares only the unsigned expiry (+8). A predicted clock
      // regression below birth (+0c) still visits and moves this live record.
      if (now >= fragment.endMs) {
        for (const member of this.slots)
          if (member?.groupId === fragment.groupId) this.removeFragment(member);
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
        if (Math.abs(omega * dt) >= ROTATION_EPSILON) {
          const rotation = new Quaternion().setFromAxisAngle(
            new Vector3(
              Math.fround(x / omega),
              Math.fround(y / omega),
              Math.fround(z / omega),
            ),
            (Math.trunc(omega * dt * 10430.378350470453) * 2 * Math.PI) / 65536,
          );
          if (fragment.fullMatrix) {
            fragment.mesh.matrix.setPosition(0, 0, 0);
            fragment.mesh.matrix.premultiply(
              new Matrix4().makeRotationFromQuaternion(rotation),
            );
            fragment.mesh.matrix.elements.forEach(
              (value, index, elements) =>
                (elements[index] = Math.fround(value)),
            );
          } else fragment.mesh.quaternion.premultiply(rotation);
        }
        if (fragment.fullMatrix) {
          fragment.mesh.matrix.setPosition(fragment.mesh.position);
          fragment.mesh.matrixWorldNeedsUpdate = true;
        }
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
        name: fragment.mesh.name,
        slot: fragment.slot,
        priority: fragment.priority,
        position: fragment.mesh.position.toArray(),
        quaternion: fragment.mesh.quaternion.toArray(),
        matrix: fragment.fullMatrix
          ? fragment.mesh.matrix.elements.slice()
          : undefined,
        velocity: fragment.velocity.toArray(),
        spin: fragment.spin.toArray(),
        startMs: fragment.startMs,
        visibleUntilMs: fragment.visibleUntilMs,
        endMs: fragment.endMs,
        groupId: fragment.groupId,
      })),
    };
  }
  /** GetNextShrapnel4eade0: first inactive record, otherwise the first strictly
   * lowest priority, replaced only by a strictly higher requested priority. */
  private reserveSlot(priority: number): number | undefined {
    let lowest = Infinity,
      selected: number | undefined;
    for (let slot = 0; slot < CAPACITY; slot++) {
      const fragment = this.slots[slot];
      if (!fragment) return slot;
      if (fragment.priority < lowest) {
        lowest = fragment.priority;
        selected = slot;
      }
    }
    if (selected === undefined || lowest >= priority) return;
    this.removeFragment(this.slots[selected]!);
    return selected;
  }
  private insert(fragment: Fragment): void {
    if (this.slots[fragment.slot]) throw new Error("Occupied shrapnel slot");
    this.slots[fragment.slot] = fragment;
    this.fragments.push(fragment);
    this.fragments.sort((a, b) => a.slot - b.slot);
  }
  private removeFragment(fragment: Fragment): void {
    const index = this.fragments.indexOf(fragment);
    if (index < 0 || this.slots[fragment.slot] !== fragment)
      throw new Error("Invalid shrapnel pool membership");
    this.fragments.splice(index, 1);
    this.slots[fragment.slot] = undefined;
    fragment.mesh.removeFromParent();
    if (fragment.ownsGeometry) fragment.mesh.geometry.dispose();
  }
  clear(): void {
    for (const fragment of [...this.fragments]) this.removeFragment(fragment);
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
