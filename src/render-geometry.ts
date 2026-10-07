import * as THREE from "three";
import type { DatFace, DatModel } from "./formats";

type SourceFace = Pick<DatFace, "indices" | "smoothing" | "flags" | "material">;

/** Build render vertices per face corner so authored smoothing groups stay intact. */
export function createModelGeometry(model: DatModel): THREE.BufferGeometry {
  const faceCount = model.faces.length;
  const positions = new Float32Array(faceCount * 9);
  const uvs = new Float32Array(faceCount * 6);
  const sourceVertexIndices = new Uint32Array(faceCount * 3);
  const sourceFaces: SourceFace[] = model.faces.map((face) => ({
    indices: [...face.indices],
    smoothing: face.smoothing,
    flags: face.flags,
    material: face.material,
  }));
  const byMaterial = new Map<number, number[]>();

  for (let faceIndex = 0; faceIndex < faceCount; faceIndex++) {
    const face = model.faces[faceIndex];
    let indices = byMaterial.get(face.material);
    if (!indices) byMaterial.set(face.material, (indices = []));
    for (let corner = 0; corner < 3; corner++) {
      const sourceIndex = face.indices[corner];
      const renderIndex = faceIndex * 3 + corner;
      sourceVertexIndices[renderIndex] = sourceIndex;
      positions.set(
        model.positions.subarray(sourceIndex * 3, sourceIndex * 3 + 3),
        renderIndex * 3,
      );
      if (model.uvs.length >= sourceIndex * 2 + 2)
        uvs.set(
          model.uvs.subarray(sourceIndex * 2, sourceIndex * 2 + 2),
          renderIndex * 2,
        );
      indices.push(renderIndex);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute(
    "normal",
    new THREE.BufferAttribute(new Float32Array(positions.length), 3),
  );
  const orderedIndices: number[] = [];
  for (const indices of byMaterial.values()) {
    geometry.addGroup(
      orderedIndices.length,
      indices.length,
      geometry.groups.length,
    );
    orderedIndices.push(...indices);
  }
  geometry.setIndex(orderedIndices);
  geometry.userData.sourceVertexIndices = sourceVertexIndices;
  geometry.userData.sourcePositions = model.positions.slice();
  geometry.userData.sourceFaces = sourceFaces;
  updateModelNormals(geometry);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Recompute smooth normals from live render positions and original face masks. */
export function updateModelNormals(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const sourceVertexIndices = geometry.userData.sourceVertexIndices as
    | Uint32Array
    | undefined;
  const faces = geometry.userData.sourceFaces as SourceFace[] | undefined;
  if (!position || !normal || !sourceVertexIndices || !faces)
    throw new Error("Model geometry is missing source smoothing data");
  if (
    position.count !== faces.length * 3 ||
    sourceVertexIndices.length !== position.count
  )
    throw new Error(
      "Model geometry source smoothing data does not match vertices",
    );

  const faceNormals = new Array<THREE.Vector3>(faces.length);
  const vertexFaces = new Map<string, number[]>();
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const positionKey = (index: number) => {
    const x = position.getX(index),
      y = position.getY(index),
      z = position.getZ(index);
    return `${x === 0 ? 0 : x},${y === 0 ? 0 : y},${z === 0 ? 0 : z}`;
  };
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
    const first = faceIndex * 3;
    a.fromBufferAttribute(position, first);
    b.fromBufferAttribute(position, first + 1);
    c.fromBufferAttribute(position, first + 2);
    faceNormals[faceIndex] = b.sub(a).cross(c.sub(a)).normalize().clone();
    for (let corner = 0; corner < 3; corner++) {
      // BRender computes smoothing adjacency by exact XYZ, so authored duplicate
      // vertices at UV seams still contribute to the same corner normal.
      const key = positionKey(first + corner);
      let attached = vertexFaces.get(key);
      if (!attached) vertexFaces.set(key, (attached = []));
      attached.push(faceIndex);
    }
  }

  const masks = faces.map(({ smoothing }) =>
    smoothing === 0 ? 0xffff : smoothing & 0xffff,
  );
  const sum = new THREE.Vector3();
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
    const mask = masks[faceIndex];
    const face = faces[faceIndex];
    for (let corner = 0; corner < 3; corner++) {
      const renderIndex = faceIndex * 3 + corner;
      const attached = vertexFaces.get(positionKey(renderIndex))!;
      sum.set(0, 0, 0);
      for (const neighborIndex of attached) {
        if (neighborIndex === faceIndex || (mask & masks[neighborIndex]) !== 0)
          sum.add(faceNormals[neighborIndex]);
      }
      if (sum.lengthSq() > 0) sum.normalize();
      normal.setXYZ(renderIndex, sum.x, sum.y, sum.z);
    }
  }
  normal.needsUpdate = true;
}
