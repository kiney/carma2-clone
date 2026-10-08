import {
  BufferGeometry,
  Float32BufferAttribute,
  Material,
  Matrix4,
  Mesh,
  Object3D,
  Texture,
  Triangle,
  Vector2,
  Vector3,
} from "three";
import type { DatModel } from "./formats";
import type { WorldActivationContact } from "./world-activation";
import { createModelGeometry } from "./render-geometry";
import {
  numericSmashTriggerEligible,
  removalSmashTriggered,
  selectSmashLevel,
  smashContactAllowed,
  SMASH_BODY_IMPULSE_GATE,
  SMASH_TEXTURE_IMPULSE_GATE,
} from "./world-smash";
import type {
  SmashActivation,
  SmashCollisionMode,
  SmashConnotations,
  WorldSmashSpec,
} from "./world-smash";

export interface WorldSmashContact {
  actor: Object3D;
  /** Triangle in current rendered/index-buffer order, matching WorldCollision. */
  faceIndex?: number;
  material?: Material | string;
  /** Native solved model-unit normal impulse, before friction/application. */
  normalImpulse: number;
  kind: "body" | "wheel";
  bodyActor?: Object3D;
  /** Source delayed activation snapshots raw model-unit physics velocity. */
  impacteeVelocity?: Vector3;
  impacteeTransform?: Matrix4;
  point?: Vector3;
  timeMs?: number;
}
export interface DestructionModel {
  geometry: BufferGeometry;
  materials?: Material | Material[];
}
export type DestructionModelAsset = DatModel | DestructionModel | Mesh;
export interface WorldDestructionAssets {
  textures?: ReadonlyMap<string, Texture>;
  models?: ReadonlyMap<string, DestructionModelAsset>;
  materials?: ReadonlyMap<string, Material>;
  /** Synchronous resolver; callers can preload requiredModels before play. */
  resolveModel?: (name: string) => DestructionModelAsset | undefined;
  random?: () => number;
  onChange?: (change: WorldDestructionChange) => void;
  onConnotations?: (
    data: SmashConnotations,
    contact: WorldSmashContact,
  ) => void;
  /** Enqueue synchronously: native 0x4ed5d0 snapshots candidates/context now and
   * samples a separate authored delay for each actor. Caller owns due actions. */
  onActivation?: (
    activation: SmashActivation,
    contact: WorldActivationContact,
  ) => void;
}
export interface WorldDestructionChange {
  actor: Object3D;
  spec: WorldSmashSpec;
  mode: WorldSmashSpec["mode"];
  level?: number;
  affectedFaceIndices: number[];
  geometryChanged: boolean;
  requiresRebuild: boolean;
  collisionMode?: SmashCollisionMode;
  connotations?: SmashConnotations;
  /** Native queue may repeat final-level effects for crossed unflagged levels. */
  connotationRepeats?: number;
  decal?: Mesh;
}
export interface WorldDestructionResult {
  changed: boolean;
  /** Native cap returned by removal or non-solid texture modes. */
  threshold?: number;
  changes: WorldDestructionChange[];
  diagnostics: string[];
}
interface Vertex {
  position: Vector3;
  normal: Vector3;
  uv: Vector2;
}
interface Face {
  vertices: [Vertex, Vertex, Vertex];
  material: Material;
  originalMaterial: string;
  sourceFace: number;
  flags: number;
  collisionMode: SmashCollisionMode;
  patch?: string;
}
interface MeshData {
  original: Face[];
  faces: Face[];
  geometry: BufferGeometry;
  patches: Map<string, Patch>;
}
interface Patch {
  level: number;
  material: Material;
  faces: Face[];
  decal?: Mesh;
  bounds: [number, number, number, number];
}
const key = (name: string) =>
  name.replace(/\.(act|dat|mat|pix|tiff?)$/i, "").toLowerCase();
function lookup<T>(
  map: ReadonlyMap<string, T> | undefined,
  name: string,
): T | undefined {
  if (!map) return;
  const direct = map.get(key(name)) ?? map.get(name);
  if (direct) return direct;
  for (const [id, value] of map) if (key(id) === key(name)) return value;
}
function materials(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}
function mapOf(material: Material): Texture | null {
  return (material as Material & { map?: Texture | null }).map ?? null;
}
function cloneVertex(v: Vertex): Vertex {
  return {
    position: v.position.clone(),
    normal: v.normal.clone(),
    uv: v.uv.clone(),
  };
}
function mix(a: Vertex, b: Vertex, t: number): Vertex {
  return {
    position: a.position.clone().lerp(b.position, t),
    normal: a.normal.clone().lerp(b.normal, t).normalize(),
    uv: a.uv.clone().lerp(b.uv, t),
  };
}
function facesOf(mesh: Mesh): Face[] {
  const geometry = mesh.geometry,
    position = geometry.getAttribute("position"),
    uv = geometry.getAttribute("uv"),
    normal = geometry.getAttribute("normal"),
    index = geometry.index;
  if (!position) return [];
  const used = materials(mesh),
    count = index?.count ?? position.count;
  const faces: Face[] = [];
  for (let i = 0; i + 2 < count; i += 3) {
    const slot =
      geometry.groups.find((g) => i >= g.start && i < g.start + g.count)
        ?.materialIndex ?? 0;
    const material = used[slot];
    if (!material) continue;
    const corners = [0, 1, 2].map((c) => {
      const j = index ? index.getX(i + c) : i + c;
      return {
        position: new Vector3().fromBufferAttribute(position, j),
        normal: normal
          ? new Vector3().fromBufferAttribute(normal, j)
          : new Vector3(),
        uv: uv ? new Vector2(uv.getX(j), uv.getY(j)) : new Vector2(),
      };
    }) as [Vertex, Vertex, Vertex];
    if (!normal) {
      const n = new Triangle(
        ...(corners.map((v) => v.position) as [Vector3, Vector3, Vector3]),
      ).getNormal(new Vector3());
      for (const v of corners) v.normal.copy(n);
    }
    const sourceVertex = index ? index.getX(i) : i;
    const flags =
      geometry.userData.sourceFaceFlags?.[i / 3] ??
      geometry.userData.sourceFaces?.[Math.floor(sourceVertex / 3)]?.flags ??
      0;
    faces.push({
      vertices: corners,
      material,
      originalMaterial: material.name,
      sourceFace: i / 3,
      flags,
      collisionMode: geometry.userData.worldSmashFaceModes?.[i / 3] ?? "solid",
    });
  }
  return faces;
}
function sameVertex(a: Vertex, b: Vertex): boolean {
  return a.position.equals(b.position) && a.uv.equals(b.uv);
}
/** 0x4f1660 pairs the longest edge, not an entire material's faces. */
function pairFor(faces: Face[], face: Face): [Face, Face] | undefined {
  const edge = [
    [0, 1],
    [0, 2],
    [1, 2],
  ].sort(
    (a, b) =>
      face.vertices[b[0]].position.distanceToSquared(
        face.vertices[b[1]].position,
      ) -
      face.vertices[a[0]].position.distanceToSquared(
        face.vertices[a[1]].position,
      ),
  )[0];
  const a = face.vertices[edge[0]],
    b = face.vertices[edge[1]];
  for (const other of faces) {
    if (
      other === face ||
      key(other.originalMaterial) !== key(face.originalMaterial)
    )
      continue;
    if (
      other.vertices.some((v) => sameVertex(v, a)) &&
      other.vertices.some((v) => sameVertex(v, b))
    )
      return [face, other];
  }
}
function transformedUv(vertex: Vertex, material: Material): Vector2 {
  const uv = vertex.uv.clone(),
    map = mapOf(material);
  if (map) {
    if (map.matrixAutoUpdate) map.updateMatrix();
    uv.applyMatrix3(map.matrix);
  }
  return uv;
}
function uvAt(face: Face, point: Vector3): Vector2 | undefined {
  const bary = new Triangle(
    ...(face.vertices.map((v) => v.position) as [Vector3, Vector3, Vector3]),
  ).getBarycoord(point, new Vector3());
  if (!bary) return;
  const out = new Vector2();
  for (let i = 0; i < 3; i++)
    out.addScaledVector(
      transformedUv(face.vertices[i], face.material),
      bary.getComponent(i),
    );
  return out;
}
function cut(
  polygon: Vertex[],
  axis: 0 | 1,
  boundary: number,
  greater: boolean,
): [Vertex[], Vertex[]] {
  const inside: Vertex[] = [],
    outside: Vertex[] = [];
  if (!polygon.length) return [inside, outside];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length],
      av = a.uv.getComponent(axis) - boundary,
      bv = b.uv.getComponent(axis) - boundary;
    const ai = greater ? av >= 0 : av <= 0,
      bi = greater ? bv >= 0 : bv <= 0;
    (ai ? inside : outside).push(a);
    if (ai !== bi) {
      const v = mix(a, b, av / (av - bv));
      inside.push(v);
      outside.push(cloneVertex(v));
    }
  }
  return [inside, outside];
}
function triangulate(polygon: Vertex[], face: Face, patch?: string): Face[] {
  const out: Face[] = [];
  for (let i = 1; i + 1 < polygon.length; i++) {
    const vertices = [polygon[0], polygon[i], polygon[i + 1]].map(
      cloneVertex,
    ) as Face["vertices"];
    if (
      new Triangle(
        ...(vertices.map((v) => v.position) as [Vector3, Vector3, Vector3]),
      ).getArea() <= 1e-12
    )
      continue;
    out.push({ ...face, vertices, patch });
  }
  return out;
}
function clipTile(
  face: Face,
  bounds: Patch["bounds"],
  patch: string,
): { inside: Face[]; outside: Face[] } {
  let polygon = face.vertices.map((v) => ({
    ...cloneVertex(v),
    uv: transformedUv(v, face.material),
  }));
  const outside: Face[] = [];
  const cuts: [0 | 1, number, boolean][] = [
    [0, bounds[0], true],
    [1, bounds[1], true],
    [0, bounds[2], false],
    [1, bounds[3], false],
  ];
  for (const [axis, boundary, greater] of cuts) {
    const [keep, rest] = cut(polygon, axis, boundary, greater);
    outside.push(...triangulate(rest, face));
    polygon = keep;
  }
  // Outside pieces use the original material and therefore original UV space.
  const map = mapOf(face.material);
  if (map) {
    const inverse = map.matrix.clone().invert();
    for (const f of outside)
      for (const v of f.vertices) v.uv.applyMatrix3(inverse);
  }
  return { inside: triangulate(polygon, face, patch), outside };
}
function writeFaces(mesh: Mesh, data: MeshData): void {
  const geometry = new BufferGeometry(),
    positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    mats: Material[] = [];
  let runSlot = -1,
    runStart = 0;
  for (const [i, face] of data.faces.entries()) {
    let slot = mats.indexOf(face.material);
    if (slot < 0) {
      slot = mats.length;
      mats.push(face.material);
    }
    if (slot !== runSlot) {
      if (runSlot >= 0) geometry.addGroup(runStart, i * 3 - runStart, runSlot);
      runStart = i * 3;
      runSlot = slot;
    }
    for (const v of face.vertices) {
      positions.push(...v.position.toArray());
      normals.push(...v.normal.toArray());
      uvs.push(...v.uv.toArray());
    }
  }
  if (runSlot >= 0)
    geometry.addGroup(runStart, data.faces.length * 3 - runStart, runSlot);
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.userData.sourceFaceFlags = Uint8Array.from(
    data.faces.map((f) => f.flags),
  );
  geometry.userData.worldSmashFaceModes = data.faces.map(
    (f) => f.collisionMode,
  );
  geometry.userData.worldSmashSourceFaces = data.faces.map((f) => f.sourceFace);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  mesh.geometry = geometry;
  mesh.material = mats;
  data.geometry = geometry;
  mesh.userData.worldSmashFaceModes = geometry.userData.worldSmashFaceModes;
}

/** Independent original world destruction. Geometry/material changes are private
 * to an actor or UV tile; callbacks let the owner rebuild collision before retry.
 * Source: HW dispatcher0x4f0ec0, tile creation0x4f1660, threshold queue0x4ee010.
 */
export class WorldDestruction {
  readonly retainActors: Object3D[] = [];
  readonly requiredModels: string[];
  readonly diagnostics: string[] = [];
  private meshes = new WeakMap<Mesh, MeshData>();
  private actorSpecs = new WeakMap<Object3D, number[]>();
  private done = new WeakMap<Object3D, Set<number>>();
  private noChangeTime = new Map<number, number>();
  private modelCache = new Map<string, DestructionModelAsset>();
  private timeMs = 0;
  private bindings = new Map<string, number>();
  private ownedGeometry = new Set<BufferGeometry>();
  private ownedMaterials = new Set<Material>();
  private ownedTextures = new Set<Texture>();
  private decals = new Set<Mesh>();
  constructor(
    readonly root: Object3D,
    readonly specs: readonly WorldSmashSpec[],
    readonly assets: WorldDestructionAssets = {},
  ) {
    // HW0x4f0940 re-encodes each material identifier; duplicates are overwritten
    // in source order. ReadSmashableEnvironment does the same for numeric NN.
    for (const [i, spec] of specs.entries())
      this.bindings.set(`${spec.trigger.kind}:${key(spec.trigger.name)}`, i);
    this.requiredModels = [
      ...new Set(
        specs.flatMap((s) => (s.replacement ? [s.replacement.model] : [])),
      ),
    ];
    const retained = new Set<Object3D>();
    root.traverse((object) => {
      const indices: number[] = [];
      for (const [i, spec] of specs.entries()) {
        if (
          this.bindings.get(
            `${spec.trigger.kind}:${key(spec.trigger.name)}`,
          ) !== i
        )
          continue;
        if (spec.trigger.kind === "number") {
          if (
            /^&\d{2}/.test(object.name) &&
            Number(object.name.slice(1, 3)) === spec.trigger.index
          )
            indices.push(i);
        } else if (
          spec.trigger.kind === "model" &&
          key(object.name) === key(spec.trigger.name)
        )
          indices.push(i);
        else if (
          spec.trigger.kind === "material" &&
          (spec.mode === "remove" || spec.mode === "replacemodel") &&
          object instanceof Mesh &&
          materials(object).some((m) => key(m.name) === key(spec.trigger.name))
        )
          indices.push(i);
      }
      if (!indices.length) return;
      // A THREE mesh is the render model inside its ACT group. Retain the ACT
      // group so children, native identifiers and transforms remain available.
      const actor =
        object instanceof Mesh && object.parent && object.parent !== root
          ? object.parent
          : object;
      this.actorSpecs.set(actor, [
        ...new Set([...(this.actorSpecs.get(actor) ?? []), ...indices]),
      ]);
      actor.userData.worldSmashRetained = true;
      actor.userData.worldSmashSpecIndices = this.actorSpecs.get(actor);
      retained.add(actor);
    });
    this.retainActors.push(
      ...[...retained].filter(
        (actor) =>
          ![...retained].some(
            (other) => other !== actor && this.isDescendant(actor, other),
          ),
      ),
    );
  }
  private isDescendant(object: Object3D, parent: Object3D): boolean {
    for (let node: Object3D | null = object.parent; node; node = node.parent)
      if (node === parent) return true;
    return false;
  }
  async preload(
    load: (name: string) => Promise<DestructionModelAsset | undefined>,
  ): Promise<void> {
    for (const name of this.requiredModels)
      if (!this.resolveModel(name)) {
        const model = await load(name);
        if (model) this.modelCache.set(key(name), model);
        else this.diagnostics.push(`Missing replacement model '${name}'`);
      }
  }
  hasMaterialTrigger(name: string): boolean {
    return this.bindings.has(`material:${key(name)}`);
  }
  private resolveModel(name: string): DestructionModelAsset | undefined {
    return (
      this.modelCache.get(key(name)) ??
      this.assets.resolveModel?.(name) ??
      lookup(this.assets.models, name)
    );
  }
  private meshData(mesh: Mesh): MeshData {
    let data = this.meshes.get(mesh);
    if (!data || data.geometry !== mesh.geometry) {
      const faces = facesOf(mesh);
      data = {
        original: faces,
        faces: [...faces],
        geometry: mesh.geometry,
        patches: new Map(),
      };
      this.meshes.set(mesh, data);
    }
    return data;
  }
  private random(): number {
    const n = this.assets.random?.() ?? Math.random();
    if (!Number.isFinite(n) || n < 0 || n >= 1)
      throw new Error("World destruction random must be in [0,1)");
    return n;
  }
  private rewrite(mesh: Mesh, data: MeshData): void {
    const old = data.geometry;
    writeFaces(mesh, data);
    this.ownedGeometry.add(mesh.geometry);
    if (this.ownedGeometry.delete(old)) old.dispose();
  }
  dispose(): void {
    for (const decal of this.decals) decal.removeFromParent();
    for (const geometry of this.ownedGeometry) geometry.dispose();
    for (const material of this.ownedMaterials) material.dispose();
    for (const texture of this.ownedTextures) texture.dispose();
    this.ownedGeometry.clear();
    this.ownedMaterials.clear();
    this.ownedTextures.clear();
    this.decals.clear();
  }
  /** Fixed source tick clock; noncar delays belong to WorldActivationRuntime. */
  update(timeMs: number): void {
    if (!Number.isFinite(timeMs) || timeMs < this.timeMs)
      throw new Error("Invalid destruction time");
    this.timeMs = timeMs;
  }
  private effects(
    data: SmashConnotations | undefined,
    contact: WorldSmashContact,
    out: WorldDestructionResult,
  ): void {
    if (!data) return;
    this.assets.onConnotations?.(data, contact);
    if (data.activations.length && !this.assets.onActivation)
      out.diagnostics.push("Noncar activation requires onActivation callback");
    for (const activation of data.activations)
      this.assets.onActivation?.(activation, contact);
    this.update(Math.max(this.timeMs, contact.timeMs ?? this.timeMs));
  }
  private record(
    change: WorldDestructionChange,
    contact: WorldSmashContact,
    out: WorldDestructionResult,
  ): void {
    out.changed = true;
    out.changes.push(change);
    this.assets.onChange?.(change);
    for (let repeat = 0; repeat < (change.connotationRepeats ?? 1); repeat++)
      this.effects(change.connotations, contact, out);
  }
  private owner(
    contact: WorldSmashContact,
    specIndex: number,
  ): Object3D | undefined {
    for (let node: Object3D | null = contact.actor; node; node = node.parent)
      if (this.actorSpecs.get(node)?.includes(specIndex)) return node;
  }
  private contactMesh(contact: WorldSmashContact): Mesh | undefined {
    if (contact.actor instanceof Mesh) return contact.actor;
    return contact.actor.children.find((o) => o instanceof Mesh) as
      | Mesh
      | undefined;
  }
  private convertedModel(
    asset: DestructionModelAsset,
    inherited: Material,
  ): DestructionModel {
    if (asset instanceof Mesh)
      return { geometry: asset.geometry.clone(), materials: materials(asset) };
    if ("geometry" in asset)
      return {
        geometry: asset.geometry.clone(),
        materials: asset.materials ?? inherited,
      };
    const geometry = createModelGeometry(asset),
      slots = [...new Set(asset.faces.map((f) => f.material))];
    const used = slots.map((slot) =>
      slot === 0
        ? inherited
        : (lookup(this.assets.materials, asset.materials[slot - 1]) ??
          inherited),
    );
    return { geometry, materials: used };
  }
  handleContact(contact: WorldSmashContact): WorldDestructionResult {
    const out: WorldDestructionResult = {
      changed: false,
      changes: [],
      diagnostics: [],
    };
    if (!Number.isFinite(contact.normalImpulse) || contact.normalImpulse < 0)
      throw new Error("Invalid smash normal impulse");
    if (
      contact.timeMs !== undefined &&
      (!Number.isFinite(contact.timeMs) || contact.timeMs < 0)
    )
      throw new Error("Invalid destruction contact time");
    if (contact.point && !contact.point.toArray().every(Number.isFinite))
      throw new Error("Invalid destruction contact point");
    if (
      contact.kind === "body" &&
      !(contact.normalImpulse > SMASH_BODY_IMPULSE_GATE)
    )
      return out;
    const mesh = this.contactMesh(contact);
    const materialName =
      typeof contact.material === "string"
        ? contact.material
        : (contact.material?.name ??
          (mesh && contact.faceIndex !== undefined
            ? this.meshData(mesh).faces[contact.faceIndex]?.originalMaterial
            : undefined));
    for (const [i, spec] of this.specs.entries()) {
      if (
        this.bindings.get(`${spec.trigger.kind}:${key(spec.trigger.name)}`) !==
        i
      )
        continue;
      const owner =
        spec.trigger.kind === "material" ? mesh : this.owner(contact, i);
      if (!owner || !owner.visible) continue;
      if (spec.trigger.kind === "material") {
        if (
          !materialName ||
          key(materialName) !== key(spec.trigger.name) ||
          !smashContactAllowed(spec.flags, contact.kind)
        )
          continue;
      }
      if (
        spec.trigger.kind === "model" &&
        !smashContactAllowed(spec.flags, contact.kind)
      )
        continue;
      if (
        spec.trigger.kind === "number" &&
        !numericSmashTriggerEligible(spec.trigger, owner.name)
      )
        continue;
      if (spec.mode === "texturechange" || spec.mode === "decal") {
        if (spec.trigger.kind !== "material") {
          out.diagnostics.push(
            `Native actor-trigger ${spec.mode} has no handler for '${spec.trigger.name}'`,
          );
          continue;
        }
        if (
          !mesh ||
          contact.faceIndex === undefined ||
          contact.normalImpulse < SMASH_TEXTURE_IMPULSE_GATE
        )
          continue;
        this.texture(mesh, spec, i, contact, out);
        continue;
      }
      if (!removalSmashTriggered(spec, contact.normalImpulse, contact.kind))
        continue;
      if (spec.mode === "crush") {
        out.diagnostics.push(
          `Native world crush mode has no geometry handler for '${spec.trigger.name}'`,
        );
        continue;
      }
      if (spec.mode === "nochange") {
        const now = contact.timeMs ?? this.timeMs;
        if (this.noChangeTime.get(i) === now) continue;
        this.noChangeTime.set(i, now);
        const change: WorldDestructionChange = {
          actor: owner,
          spec,
          mode: spec.mode,
          affectedFaceIndices: [],
          geometryChanged: false,
          requiresRebuild: false,
          connotations: spec.connotations,
        };
        out.threshold ??= spec.removalThreshold;
        this.record(change, contact, out);
        continue;
      }
      if (this.done.get(owner)?.has(i)) continue;
      let change: WorldDestructionChange;
      if (spec.mode === "remove") {
        if (spec.trigger.kind === "material" && mesh) {
          const data = this.meshData(mesh);
          data.faces = data.faces.filter(
            (f) => key(f.originalMaterial) !== key(spec.trigger.name),
          );
          this.rewrite(mesh, data);
          if (!data.faces.length) mesh.visible = false;
        } else {
          owner.visible = false;
          owner.userData.worldSmashDisabled = true;
        }
        change = {
          actor: owner,
          spec,
          mode: spec.mode,
          affectedFaceIndices: [],
          geometryChanged: true,
          requiresRebuild: true,
          collisionMode: "passthrough",
          connotations: spec.connotations,
        };
      } else if (spec.mode === "replacemodel") {
        if (spec.trigger.kind === "material") {
          out.diagnostics.push(
            "Native material-trigger replacemodel has no replacement handler",
          );
          continue;
        }
        const replacement =
          spec.replacement && this.resolveModel(spec.replacement.model);
        if (!replacement || !mesh) {
          out.diagnostics.push(
            `Missing replacement model '${spec.replacement?.model ?? ""}'`,
          );
          continue;
        }
        const converted = this.convertedModel(replacement, materials(mesh)[0]);
        if (this.ownedGeometry.delete(mesh.geometry)) mesh.geometry.dispose();
        mesh.geometry = converted.geometry;
        this.ownedGeometry.add(converted.geometry);
        mesh.material = converted.materials ?? materials(mesh)[0];
        mesh.name = spec.replacement!.model;
        if (owner !== mesh)
          for (const child of owner.children)
            if (child !== mesh) {
              // Installed 0x4f4bc0 calls collision removal 0x4c8710(0) for
              // each sibling before hiding it. Visibility alone is not a
              // collider switch: retained dynamic actors may own descendants.
              child.userData.worldSmashDisabled = true;
              child.visible = false;
            }
        this.meshes.delete(mesh);
        change = {
          actor: owner,
          spec,
          mode: spec.mode,
          affectedFaceIndices: [],
          geometryChanged: true,
          requiresRebuild: true,
          connotations: spec.connotations,
        };
      } else continue;
      let done = this.done.get(owner);
      if (!done) this.done.set(owner, (done = new Set()));
      done.add(i);
      out.threshold ??= spec.removalThreshold;
      this.record(change, contact, out);
    }
    this.diagnostics.push(...out.diagnostics);
    if (this.diagnostics.length > 256)
      this.diagnostics.splice(0, this.diagnostics.length - 256);
    return out;
  }
  private texture(
    mesh: Mesh,
    spec: WorldSmashSpec,
    specIndex: number,
    contact: WorldSmashContact,
    out: WorldDestructionResult,
  ): void {
    const data = this.meshData(mesh),
      currentFace = data.faces[contact.faceIndex!];
    if (!currentFace) {
      out.diagnostics.push(
        "Smash contact has stale face index; rebuild collision",
      );
      return;
    }
    const original = data.original[currentFace.sourceFace],
      pair = original && pairFor(data.original, original);
    if (!pair) {
      out.diagnostics.push(
        `Smash '${spec.trigger.name}' requires a longest-edge triangle partner`,
      );
      return;
    }
    const uv = pair.flatMap((f) =>
      f.vertices.map((v) => transformedUv(v, f.material)),
    );
    let bounds: Patch["bounds"] = [
      Math.min(...uv.map((v) => v.x)),
      Math.min(...uv.map((v) => v.y)),
      Math.max(...uv.map((v) => v.x)),
      Math.max(...uv.map((v) => v.y)),
    ];
    // Native first damaged level bit2 expands from one integer UV tile to quad.
    if (!(spec.levels[0]?.flags & 2)) {
      if (!contact.point) {
        out.diagnostics.push(
          "Local UV-tile smash requires a world contact point",
        );
        return;
      }
      mesh.updateWorldMatrix(true, false);
      const hit = uvAt(original, mesh.worldToLocal(contact.point.clone()));
      if (!hit) {
        out.diagnostics.push("Smash UV mapping is degenerate");
        return;
      }
      bounds = [
        Math.max(bounds[0], Math.floor(hit.x)),
        Math.max(bounds[1], Math.floor(hit.y)),
        Math.min(bounds[2], Math.ceil(hit.x)),
        Math.min(bounds[3], Math.ceil(hit.y)),
      ];
    }
    if (!(bounds[2] > bounds[0] && bounds[3] > bounds[1])) {
      out.diagnostics.push("Native smash UV tile has zero area");
      return;
    }
    const patchId = `${specIndex}:${pair
      .map((f) => f.sourceFace)
      .sort((a, b) => a - b)
      .join(",")}:${bounds.join(",")}`;
    const old = data.patches.get(patchId),
      level = selectSmashLevel(spec, contact.normalImpulse, old?.level ?? 0);
    if (level === (old?.level ?? 0)) return;
    const authored = spec.levels[level - 1];
    if (!authored.pixelmaps.length) {
      out.diagnostics.push("Smash level has no pixelmaps");
      return;
    }
    const name =
        authored.pixelmaps[
          Math.floor(this.random() * authored.pixelmaps.length)
        ],
      texture = lookup(this.assets.textures, name);
    if (!texture) {
      out.diagnostics.push(`Missing smash pixelmap '${name}'`);
      return;
    }
    const material = (old?.material ?? original.material).clone();
    const map = texture.clone();
    map.matrixAutoUpdate = false;
    map.matrix.identity();
    map.needsUpdate = true;
    this.ownedMaterials.add(material);
    this.ownedTextures.add(map);
    (material as Material & { map: Texture }).map = map;
    material.needsUpdate = true;
    material.userData.worldSmashOriginalMaterial = original.originalMaterial;
    material.userData.worldSmashLevel = level;
    const selectedSources = new Set(pair.map((f) => f.sourceFace));
    let patch: Patch;
    if (old) {
      patch = { ...old, level, material };
      for (const face of patch.faces) {
        face.material = material;
        face.collisionMode = authored.collisionMode ?? "solid";
      }
    } else {
      const inside: Face[] = [],
        outside: Face[] = [];
      for (const face of data.faces) {
        if (!selectedSources.has(face.sourceFace) || face.patch) {
          outside.push(face);
          continue;
        }
        const clipped = clipTile(face, bounds, patchId);
        inside.push(...clipped.inside);
        outside.push(...clipped.outside);
      }
      if (!inside.length) {
        out.diagnostics.push(
          "Smash UV tile does not intersect source geometry",
        );
        return;
      }
      for (const face of inside) {
        face.material = material;
        face.collisionMode = authored.collisionMode ?? "solid";
        for (const v of face.vertices)
          v.uv.set(
            (v.uv.x - bounds[0]) / (bounds[2] - bounds[0]),
            (v.uv.y - bounds[1]) / (bounds[3] - bounds[1]),
          );
      }
      patch = { level, material, faces: inside, bounds };
      if (spec.mode === "decal") {
        const overlay = new Mesh();
        overlay.name = `smash decal ${spec.trigger.name}`;
        const overlayData: MeshData = {
          original: inside,
          faces: inside,
          geometry: overlay.geometry,
          patches: new Map(),
        };
        this.rewrite(overlay, overlayData);
        overlay.userData.worldSmashDecal = true;
        overlay.userData.skipWorldCollision = true;
        overlay.renderOrder = mesh.renderOrder + 1;
        (
          material as Material & {
            polygonOffset?: boolean;
            polygonOffsetFactor?: number;
          }
        ).polygonOffset = true;
        (
          material as Material & { polygonOffsetFactor?: number }
        ).polygonOffsetFactor = -1;
        mesh.add(overlay);
        this.decals.add(overlay);
        patch.decal = overlay;
      } else data.faces = [...outside, ...inside];
    }
    data.patches.set(patchId, patch);
    if (spec.mode === "decal") {
      if (patch.decal) patch.decal.material = material;
    } else this.rewrite(mesh, data);
    const affectedFaceIndices = data.faces.flatMap((f, i) =>
      f.patch === patchId ? [i] : [],
    );
    const collisionMode =
      spec.mode === "decal" ? undefined : authored.collisionMode;
    const change: WorldDestructionChange = {
      actor: mesh,
      spec,
      mode: spec.mode,
      level,
      affectedFaceIndices,
      geometryChanged: spec.mode !== "decal",
      requiresRebuild: spec.mode !== "decal",
      collisionMode,
      connotations: authored.connotations,
      // HW0x4ecd20 traverses crossed level flags but emits final-level data.
      connotationRepeats: spec.levels
        .slice(old?.level ?? 0, level)
        .filter((l) => !(l.flags & 1) || level - (old?.level ?? 0) === 1)
        .length,
      decal: patch.decal,
    };
    if (collisionMode === "passthrough" || collisionMode === "edges")
      out.threshold ??= authored.threshold;
    this.record(change, contact, out);
  }
}
