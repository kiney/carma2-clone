import * as THREE from "three";
interface Surface {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  normal: THREE.Vector3;
  minY: number;
  maxY: number;
}
/** A fixed broad phase over transformed original triangles. Geometry stays in C2 world units. */
export class WorldCollision {
  private cells = new Map<string, Surface[]>();
  private cellSize = 4;
  triangles = 0;
  constructor(group: THREE.Object3D) {
    group.updateMatrixWorld(true);
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geo = object.geometry as THREE.BufferGeometry;
      const pos = geo.getAttribute("position"),
        index = geo.index;
      if (!pos) return;
      const count = index ? index.count : pos.count;
      for (let i = 0; i < count; i += 3) {
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
        const s = {
          a,
          b,
          c,
          normal,
          minY: Math.min(a.y, b.y, c.y),
          maxY: Math.max(a.y, b.y, c.y),
        };
        const minX = Math.floor(Math.min(a.x, b.x, c.x) / 4),
          maxX = Math.floor(Math.max(a.x, b.x, c.x) / 4),
          minZ = Math.floor(Math.min(a.z, b.z, c.z) / 4),
          maxZ = Math.floor(Math.max(a.z, b.z, c.z) / 4);
        if ((maxX - minX + 1) * (maxZ - minZ + 1) > 25000) continue;
        for (let x = minX; x <= maxX; x++)
          for (let z = minZ; z <= maxZ; z++) {
            const k = `${x},${z}`;
            let cell = this.cells.get(k);
            if (!cell) {
              cell = [];
              this.cells.set(k, cell);
            }
            cell.push(s);
          }
        this.triangles++;
      }
    });
  }
  height(x: number, z: number, nearY: number) {
    let best: number | null = null;
    const cell = this.cells.get(`${Math.floor(x / 4)},${Math.floor(z / 4)}`);
    if (!cell) return null;
    for (const s of cell) {
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
export function batchStaticWorld(source: THREE.Group): THREE.Group {
  source.updateMatrixWorld(true);
  const batches = new Map<
    THREE.Material,
    { positions: number[]; normals: number[]; uvs: number[] }
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
        b = { positions: [], normals: [], uvs: [] };
        batches.set(mat, b);
      }
      for (let i = group.start; i < group.start + group.count; i++) {
        const relative = i - group.start;
        const sourceIndex = mirrored
          ? group.start + Math.floor(relative / 3) * 3 + [0, 2, 1][relative % 3]
          : i;
        const j = index ? index.getX(sourceIndex) : sourceIndex;
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
  const result = new THREE.Group();
  result.name = source.name;
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
  for (const geo of geometries) geo.dispose();
  return result;
}
