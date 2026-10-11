import * as THREE from "three";
import type { NativeTrackLayoutResult } from "./native-track-layout";
import {
  prepareNativeModelFacePlane,
  type NativePreparedFacePlane,
} from "./physics/prepared-plane";

export interface WorldSourceColumns {
  readonly boundsSource: "native-initial-act" | "renderer-fallback";
  readonly countX: number;
  readonly countZ: number;
  readonly extraRoom: number;
  readonly originX: number;
  readonly originZ: number;
  readonly sizeX: number;
  readonly sizeZ: number;
  readonly bounds: Readonly<{
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  }>;
}

export interface WorldSourceActor {
  readonly object: THREE.Object3D;
  readonly identifier: string;
  readonly traversalOrder: number;
  readonly childPath: readonly number[];
  readonly column: Readonly<{ x: number; z: number }> | null;
}

export interface WorldSourceTriangle {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  readonly actor: THREE.Object3D;
  readonly actorOrder: number;
  readonly childPath: readonly number[];
  readonly modelName: string;
  readonly renderTriangleIndex: number;
  /** Original DatModel face-array index where available; this is not the
   * BRender prepared group/face order. */
  readonly sourceFaceIndex: number | null;
  readonly materialIndex: number;
  readonly materialName: string;
  readonly sourceFace: Readonly<Record<string, unknown>> | null;
  /** Geometry material-group ordinal only; native prepared group order remains unresolved. */
  readonly renderMaterialGroup: number;
  readonly preparedGroupIndex: null;
  /** Installed LoadTrackModels/AddSmoothModels preparation, not raw DAT flags. */
  readonly effectiveTrackModelFlags: number | null;
  /** Source-local equation before pivot subtraction or cached-world emission. */
  readonly nativeModelPlane: Readonly<NativePreparedFacePlane> | null;
}

export interface WorldSourceSnapshot {
  readonly root: THREE.Object3D;
  readonly ppRoot: THREE.Object3D | null;
  readonly columnIdentifier: string;
  readonly columnMetadataSource: "pp01" | "legacy-root" | "native-1x1-fallback";
  readonly columns: WorldSourceColumns;
  readonly actors: readonly WorldSourceActor[];
  readonly triangles: readonly WorldSourceTriangle[];
  readonly preparedGroupOrderResolved: false;
}

interface PP01 {
  countX: number;
  countZ: number;
  extraRoom: number;
}

interface ColumnConfig {
  countX: number;
  countZ: number;
  extraRoom: number;
  metadataSource: WorldSourceSnapshot["columnMetadataSource"];
}

function numericColumnConfig(identifier: string): ColumnConfig | null {
  const match =
    /^\s*(\d+)\s+(\d+)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(?:\s+([+-]?\d+))?/i.exec(
      identifier,
    );
  if (!match) return null;
  if (match[4] === undefined)
    throw new Error(
      "World source ACT has an obsolete three-field column identifier",
    );
  const countX = Number(match[1]);
  const countZ = Number(match[2]);
  const extraRoom = Number(match[3]);
  if (
    !Number.isSafeInteger(countX) ||
    countX < 1 ||
    countX > 255 ||
    !Number.isSafeInteger(countZ) ||
    countZ < 1 ||
    countZ > 255 ||
    !Number.isFinite(extraRoom) ||
    extraRoom < 0
  )
    throw new Error("World source ACT has invalid native column dimensions");
  return { countX, countZ, extraRoom, metadataSource: "legacy-root" };
}

function nativeColumnRoot(root: THREE.Object3D): {
  ppRoot: THREE.Object3D | null;
  identifier: string;
  config: ColumnConfig;
} {
  let ppRoot: THREE.Object3D | null = null;
  const actorRoots = [root, ...root.children];
  for (const object of actorRoots) {
    if (!object.name.startsWith("PP")) continue;
    // ExtractColumns checks identifier[3] and terminates on any other version.
    if (object.name[3] !== "1")
      throw new Error(
        `World source ACT has unsupported PP root identifier: ${object.name}`,
      );
    ppRoot = object;
    break;
  }
  if (ppRoot) {
    const identifier = ppRoot.name;
    const config = numericColumnConfig(identifier.slice(5));
    return {
      ppRoot,
      identifier,
      config: config
        ? { ...config, metadataSource: "pp01" }
        : {
            countX: 1,
            countZ: 1,
            extraRoom: 0,
            metadataSource: "native-1x1-fallback",
          },
    };
  }

  // ExtractColumns consumes the track's ACT root identifier directly. Assets.scene
  // wraps that root in a named scene group, so use its first ACT child when present.
  const actorRoot = root.children[0] ?? root;
  const identifier = actorRoot.name;
  const config = numericColumnConfig(identifier);
  return {
    ppRoot: null,
    identifier,
    config: config ?? {
      countX: 1,
      countZ: 1,
      extraRoom: 0,
      metadataSource: "native-1x1-fallback",
    },
  };
}

/** Parse the native track root identifier, e.g. "PP01 16 16 1.000 1126".
 * The trailing count is retained by the ACT name but is not a column field. */
export function parseWorldPP01(identifier: string): PP01 | null {
  const match =
    /^\s*PP01\s+(\d+)\s+(\d+)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\b/i.exec(
      identifier,
    );
  if (!match) return null;
  const countX = Number(match[1]);
  const countZ = Number(match[2]);
  const extraRoom = Number(match[3]);
  if (
    !Number.isSafeInteger(countX) ||
    countX < 1 ||
    countX > 255 ||
    !Number.isSafeInteger(countZ) ||
    countZ < 1 ||
    countZ > 255 ||
    !Number.isFinite(extraRoom) ||
    extraRoom < 0
  )
    return null;
  return { countX, countZ, extraRoom };
}

function tileCoordinate(identifier: string, countX: number, countZ: number) {
  const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(identifier);
  if (!match) return null;
  const x = Number(match[1]),
    z = Number(match[2]);
  return Number.isSafeInteger(x) &&
    Number.isSafeInteger(z) &&
    x < countX &&
    z < countZ
    ? Object.freeze({ x, z })
    : null;
}

function worldBounds(root: THREE.Object3D) {
  const bounds = new THREE.Box3();
  const position = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const geometry = mesh.geometry;
    if (!mesh.isMesh || !geometry) return;
    const attribute = geometry.getAttribute("position");
    if (!attribute) return;
    for (let i = 0; i < attribute.count; i++) {
      position
        .fromBufferAttribute(attribute, i)
        .applyMatrix4(object.matrixWorld);
      bounds.expandByPoint(position);
    }
  });
  if (
    bounds.isEmpty() ||
    !bounds.min.toArray().concat(bounds.max.toArray()).every(Number.isFinite)
  )
    throw new Error("World source snapshot requires finite track mesh bounds");
  return bounds;
}

interface FaceMapping {
  sourceFaceIndex: number | null;
  sourceFace: Readonly<Record<string, unknown>> | null;
}

function freezeFace(face: Record<string, unknown>) {
  const snapshot: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(face)) {
    snapshot[key] = Array.isArray(value) ? Object.freeze([...value]) : value;
  }
  return Object.freeze(snapshot);
}

function buildFaceResolver(geometry: THREE.BufferGeometry) {
  const faces = geometry.userData.sourceFaces as
    | Array<Record<string, unknown>>
    | undefined;
  if (!faces?.length)
    return (_triangle: number): FaceMapping => ({
      sourceFaceIndex: null,
      sourceFace: null,
    });
  const faceSnapshots = faces.map(freezeFace);
  const sourceVertexIndices = geometry.userData.sourceVertexIndices as
    | ArrayLike<number>
    | undefined;
  const positions = geometry.getAttribute("position");
  if (!sourceVertexIndices || !positions)
    return (_triangle: number): FaceMapping => ({
      sourceFaceIndex: null,
      sourceFace: null,
    });
  const renderIndices = geometry.getIndex();
  // createModelGeometry expands each DAT face to its own three render vertices.
  // Validate that invariant once per geometry; normal triangle lookup then
  // needs only three index reads, even when materials reorder the index list.
  if (
    renderIndices &&
    renderIndices.count === faces.length * 3 &&
    sourceVertexIndices.length === positions.count &&
    positions.count === faces.length * 3
  ) {
    const seen = new Uint8Array(positions.count);
    let expanded = true;
    for (let offset = 0; offset < renderIndices.count; offset += 3) {
      const ids = [0, 1, 2].map((corner) =>
        renderIndices.getX(offset + corner),
      );
      const face = Math.floor(ids[0] / 3);
      const authored = faces[face]?.indices;
      if (
        !ids.every(
          (id) =>
            Number.isSafeInteger(id) &&
            id >= 0 &&
            id < positions.count &&
            Math.floor(id / 3) === face,
        ) ||
        new Set(ids.map((id) => id % 3)).size !== 3 ||
        !Array.isArray(authored) ||
        authored.length !== 3 ||
        !ids.every((id) => sourceVertexIndices[id] === authored[id % 3])
      ) {
        expanded = false;
        break;
      }
      for (const id of ids) {
        if (seen[id]) expanded = false;
        seen[id] = 1;
      }
      if (!expanded) break;
    }
    if (expanded && seen.every((value) => value === 1)) {
      return (triangle: number): FaceMapping => {
        const renderFace = Math.floor(renderIndices.getX(triangle * 3) / 3);
        return renderFace >= 0 && renderFace < faceSnapshots.length
          ? {
              sourceFaceIndex: renderFace,
              sourceFace: faceSnapshots[renderFace],
            }
          : { sourceFaceIndex: null, sourceFace: null };
      };
    }
  }

  // Generic geometry may share render vertices. Build a directed source-index
  // lookup once; duplicated authored faces are marked ambiguous, never guessed.
  const sourceToFace = new Map<string, number | null>();
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
    const indices = faces[faceIndex].indices;
    if (
      !Array.isArray(indices) ||
      indices.length !== 3 ||
      !indices.every((value) => Number.isSafeInteger(value) && value >= 0)
    )
      continue;
    const key = indices.join(",");
    sourceToFace.set(key, sourceToFace.has(key) ? null : faceIndex);
  }
  return (triangle: number): FaceMapping => {
    const sourceIndices: number[] = [];
    for (let corner = 0; corner < 3; corner++) {
      const vertex = renderIndices
        ? renderIndices.getX(triangle * 3 + corner)
        : triangle * 3 + corner;
      if (
        !Number.isSafeInteger(vertex) ||
        vertex < 0 ||
        vertex >= positions.count ||
        vertex >= sourceVertexIndices.length
      )
        return { sourceFaceIndex: null, sourceFace: null };
      const source = sourceVertexIndices[vertex];
      if (!Number.isSafeInteger(source) || source < 0)
        return { sourceFaceIndex: null, sourceFace: null };
      sourceIndices.push(source);
    }
    const faceIndex = sourceToFace.get(sourceIndices.join(","));
    return faceIndex === undefined || faceIndex === null
      ? { sourceFaceIndex: null, sourceFace: null }
      : { sourceFaceIndex: faceIndex, sourceFace: faceSnapshots[faceIndex] };
  };
}

/** Capture immutable source identity/order before static batching moves or
 * disposes source objects. Mesh/Object3D references intentionally remain live. */
export function captureWorldSource(
  root: THREE.Object3D,
  options: {
    modelPreparation?: "track";
    initialNativeLayout?: Extract<NativeTrackLayoutResult, { resolved: true }>;
  } = {},
): WorldSourceSnapshot {
  const nativeColumns = nativeColumnRoot(root);
  const { ppRoot, identifier: columnIdentifier } = nativeColumns;
  const native = options.initialNativeLayout;
  const pp = native
    ? { ...native.header, metadataSource: nativeColumns.config.metadataSource }
    : nativeColumns.config;
  const bounds = native
    ? new THREE.Box3(
        new THREE.Vector3(...native.initialBounds.min),
        new THREE.Vector3(...native.initialBounds.max),
      )
    : worldBounds(root);
  const sizeX =
    native?.layout.columnSizeX ??
    (bounds.max.x - bounds.min.x + 2 * pp.extraRoom) / pp.countX;
  const sizeZ =
    native?.layout.columnSizeZ ??
    (bounds.max.z - bounds.min.z + 2 * pp.extraRoom) / pp.countZ;
  if (
    !(
      Number.isFinite(sizeX) &&
      sizeX > 0 &&
      Number.isFinite(sizeZ) &&
      sizeZ > 0
    )
  )
    throw new Error("World source PP01 columns have invalid dimensions");
  const columns = Object.freeze({
    boundsSource: native
      ? ("native-initial-act" as const)
      : ("renderer-fallback" as const),
    countX: pp.countX,
    countZ: pp.countZ,
    extraRoom: pp.extraRoom,
    metadataSource: pp.metadataSource,
    originX: native?.layout.originX ?? bounds.min.x - pp.extraRoom,
    originZ: native?.layout.originZ ?? bounds.min.z - pp.extraRoom,
    sizeX,
    sizeZ,
    bounds: Object.freeze({
      minX: bounds.min.x,
      maxX: bounds.max.x,
      minZ: bounds.min.z,
      maxZ: bounds.max.z,
    }),
  });

  const actors: WorldSourceActor[] = [];
  const actorByObject = new Map<THREE.Object3D, WorldSourceActor>();
  let order = 0;
  const visit = (
    object: THREE.Object3D,
    path: number[],
    inheritedColumn: WorldSourceActor["column"],
  ): void => {
    const column =
      tileCoordinate(object.name, pp.countX, pp.countZ) ?? inheritedColumn;
    const actor: WorldSourceActor = Object.freeze({
      object,
      identifier: object.name,
      traversalOrder: order++,
      childPath: Object.freeze([...path]),
      column,
    });
    actors.push(actor);
    actorByObject.set(object, actor);
    object.children.forEach((child, index) =>
      visit(child, [...path, index], column),
    );
  };
  visit(root, [], null);

  const triangles: WorldSourceTriangle[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry;
    const index = geometry.getIndex();
    const position = geometry.getAttribute("position");
    const count = index ? index.count : (position?.count ?? 0);
    const actorObject = mesh.parent ?? root;
    const actor = actorByObject.get(actorObject) ?? actors[0];
    const triangleCount = Math.floor(count / 3);
    const faceForTriangle = buildFaceResolver(geometry);
    for (let tri = 0; tri < triangleCount; tri++) {
      const offset = tri * 3;
      const groupIndex = geometry.groups.findIndex(
        (group) => offset >= group.start && offset < group.start + group.count,
      );
      const group = groupIndex >= 0 ? geometry.groups[groupIndex] : null;
      const materialIndex = group?.materialIndex ?? 0;
      const material = Array.isArray(mesh.material)
        ? mesh.material[materialIndex]
        : mesh.material;
      const face = faceForTriangle(tri);
      const rawModelFlags = geometry.userData.modelFlags;
      const effectiveTrackModelFlags =
        options.modelPreparation === "track" &&
        Number.isInteger(rawModelFlags) &&
        rawModelFlags >= 0 &&
        rawModelFlags <= 0xffff
          ? (rawModelFlags | 0x80) & 0xfdfe
          : null;
      let nativeModelPlane: Readonly<NativePreparedFacePlane> | null = null;
      const indexedPositions = geometry.userData.sourcePositions as
        | Float32Array
        | undefined;
      const sourceIndices = face.sourceFace?.indices;
      if (
        effectiveTrackModelFlags !== null &&
        indexedPositions instanceof Float32Array &&
        Array.isArray(sourceIndices) &&
        sourceIndices.length === 3 &&
        sourceIndices.every(
          (i) =>
            Number.isInteger(i) &&
            i >= 0 &&
            i * 3 + 2 < indexedPositions.length,
        )
      ) {
        const [a, b, c] = sourceIndices.map(
          (i) =>
            [
              indexedPositions[i * 3],
              indexedPositions[i * 3 + 1],
              indexedPositions[i * 3 + 2],
            ] as [number, number, number],
        );
        const plane = prepareNativeModelFacePlane(a, b, c);
        Object.freeze(plane.normal);
        nativeModelPlane = Object.freeze(plane);
      }
      triangles.push(
        Object.freeze({
          mesh,
          geometry,
          actor: actor.object,
          actorOrder: actor.traversalOrder,
          childPath: actor.childPath,
          modelName: mesh.name,
          renderTriangleIndex: tri,
          sourceFaceIndex: face.sourceFaceIndex,
          materialIndex,
          materialName: material?.name ?? "",
          sourceFace: face.sourceFace,
          renderMaterialGroup: groupIndex,
          preparedGroupIndex: null,
          effectiveTrackModelFlags,
          nativeModelPlane,
        }),
      );
    }
  });

  return Object.freeze({
    root,
    ppRoot,
    columnIdentifier,
    columnMetadataSource: pp.metadataSource,
    columns,
    actors: Object.freeze(actors),
    triangles: Object.freeze(triangles),
    preparedGroupOrderResolved: false as const,
  });
}
