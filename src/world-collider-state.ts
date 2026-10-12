import { Mesh, type BufferGeometry, type Material } from "three";

/** RAW metadata arrays require explicit invalidation for in-place edits. Buffer
 * attributes use Three's needsUpdate/version contract. References and small
 * material/group fields are checked without mapping vertices or triangles. */
export interface ColliderMeshState {
  geometry: BufferGeometry;
  values: unknown[];
  groups: (number | undefined)[];
  materials: unknown[][];
  metadata: unknown[][];
}
function valueAt(mesh: Mesh, i: number): unknown {
  const g = mesh.geometry;
  if (i === 0) return g;
  if (i <= 4) {
    const p = g.getAttribute("position");
    switch (i) {
      case 1:
        return p;
      case 2:
        return p && ("data" in p ? p.data.version : p.version);
      case 3:
        return p?.array;
      case 4:
        return p?.count;
    }
  }
  if (i <= 8) {
    const n = g.index;
    switch (i) {
      case 5:
        return n;
      case 6:
        return n?.version;
      case 7:
        return n?.array;
      case 8:
        return n?.count;
    }
  }
  if (i <= 12) {
    const uv = g.getAttribute("uv");
    switch (i) {
      case 9:
        return uv;
      case 10:
        return uv && ("data" in uv ? uv.data.version : uv.version);
      case 11:
        return uv?.array;
      case 12:
        return uv?.count;
    }
  }
  switch (i) {
    case 13:
      return mesh.name;
    case 14:
      return g.userData.c2CollisionRevision;
    case 15:
      return g.userData.sourceFaceFlags;
    case 16:
      return g.userData.sourceFaces;
    case 17:
      return g.userData.worldSmashSourceFaces;
    case 18:
      return g.userData.worldSmashFaceModes;
    case 19:
      return g.userData.c2RawFaceMaterials;
  }
}
const materialCount = (mesh: Mesh) =>
  Array.isArray(mesh.material) ? mesh.material.length : 1;
const materialAt = (mesh: Mesh, i: number): Material =>
  Array.isArray(mesh.material) ? mesh.material[i] : mesh.material;
function materialValueAt(m: Material, i: number): unknown {
  switch (i) {
    case 0:
      return m;
    case 1:
      return m.name;
    case 2:
      return m.side;
    case 3:
      return m.userData.c2Flags;
    case 4:
      return (m as Material & { map?: { userData: Record<string, unknown> } })
        .map?.userData.c2PixelmapType;
  }
}
function same(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}
function metadata(mesh: Mesh): unknown[][] {
  const data = mesh.geometry.userData;
  return [
    Array.from(data.sourceFaceFlags ?? []),
    Array.from(data.worldSmashFaceModes ?? []),
    Array.from(data.worldSmashSourceFaces ?? []),
    Array.from(data.c2RawFaceMaterials ?? []),
  ];
}
export function captureColliderMesh(mesh: Mesh): ColliderMeshState {
  return {
    geometry: mesh.geometry,
    values: Array.from({ length: 20 }, (_, i) => valueAt(mesh, i)),
    groups: mesh.geometry.groups.flatMap((g) => [
      g.start,
      g.count,
      g.materialIndex,
    ]),
    materials: Array.from({ length: materialCount(mesh) }, (_, i) =>
      Array.from({ length: 5 }, (_, j) =>
        materialValueAt(materialAt(mesh, i), j),
      ),
    ),
    metadata: metadata(mesh),
  };
}
export function sameColliderMesh(
  mesh: Mesh,
  old: ColliderMeshState,
  deepMetadata = false,
): boolean {
  const g = mesh.geometry,
    p = g.getAttribute("position"),
    uv = g.getAttribute("uv"),
    n = g.index,
    v = old.values;
  if (
    g !== old.geometry ||
    p !== v[1] ||
    !Object.is(p && ("data" in p ? p.data.version : p.version), v[2]) ||
    p?.array !== v[3] ||
    p?.count !== v[4] ||
    n !== v[5] ||
    !Object.is(n?.version, v[6]) ||
    n?.array !== v[7] ||
    n?.count !== v[8] ||
    uv !== v[9] ||
    !Object.is(uv && ("data" in uv ? uv.data.version : uv.version), v[10]) ||
    uv?.array !== v[11] ||
    uv?.count !== v[12] ||
    mesh.name !== v[13] ||
    !Object.is(g.userData.c2CollisionRevision, v[14]) ||
    g.userData.sourceFaceFlags !== v[15] ||
    g.userData.sourceFaces !== v[16] ||
    g.userData.worldSmashSourceFaces !== v[17] ||
    g.userData.worldSmashFaceModes !== v[18] ||
    g.userData.c2RawFaceMaterials !== v[19] ||
    g.groups.length * 3 !== old.groups.length ||
    materialCount(mesh) !== old.materials.length
  )
    return false;
  for (let i = 0; i < mesh.geometry.groups.length; i++) {
    const g = mesh.geometry.groups[i];
    if (
      !Object.is(g.start, old.groups[3 * i]) ||
      !Object.is(g.count, old.groups[3 * i + 1]) ||
      !Object.is(g.materialIndex, old.groups[3 * i + 2])
    )
      return false;
  }
  for (let i = 0; i < old.materials.length; i++) {
    const material = materialAt(mesh, i);
    const v = old.materials[i];
    if (
      material !== v[0] ||
      material.name !== v[1] ||
      material.side !== v[2] ||
      !Object.is(material.userData.c2Flags, v[3]) ||
      !Object.is(
        (material as Material & { map?: { userData: Record<string, unknown> } })
          .map?.userData.c2PixelmapType,
        v[4],
      )
    )
      return false;
  }
  if (deepMetadata && !metadata(mesh).every((a, i) => same(a, old.metadata[i])))
    return false;
  return true;
}
