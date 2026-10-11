import { readFile } from "node:fs/promises";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  Matrix4,
} from "three";
import { parseTwt } from "../../server/assets.mjs";
import { parseAct, parseDat } from "../../src/formats.ts";
/** Read-only stock asset adapter. Proprietary fixtures never enter the repository. */
export async function originalCar(name) {
  const buffer = await readFile(`carma2_orig/data/CARS/${name}.TWT`);
  const entries = parseTwt(buffer).entries;
  const read = (entry) =>
    buffer.subarray(entry.offset, entry.offset + entry.size);
  const entry = (filename) =>
    entries.find((e) => e.name.toLowerCase() === filename.toLowerCase());
  const text = read(entry(`${name}.TXT`)).toString("latin1");
  const models = new Map();
  for (const e of entries.filter((e) => /\.dat$/i.test(e.name)))
    for (const model of parseDat(read(e)))
      models.set(model.name.toLowerCase(), model);
  const actor = (node) => {
    const group = new Group();
    group.name = node.name;
    const m = node.transform;
    group.matrix.set(
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
    group.matrix.decompose(group.position, group.quaternion, group.scale);
    if (node.model) {
      const model = models.get(node.model.toLowerCase());
      if (model) {
        const geometry = new BufferGeometry();
        geometry.userData.sourcePositions = model.positions.slice();
        geometry.userData.modelFlags = model.flags;
        geometry.userData.c2VertexLayout = "source";
        geometry.setAttribute(
          "position",
          new BufferAttribute(model.positions.slice(), 3),
        );
        geometry.setIndex(model.faces.flatMap((f) => f.indices));
        geometry.computeVertexNormals();
        const mesh = new Mesh(geometry, new MeshLambertMaterial());
        mesh.name = node.model;
        group.add(mesh);
      }
    }
    for (const child of node.children) group.add(actor(child));
    return group;
  };
  const group = new Group();
  group.name = name;
  for (const node of parseAct(read(entry(`${name}.ACT`))))
    group.add(actor(node));
  const manifest = entries.map((e) => ({
    path: `data/CARS/${name}/${e.name}`,
  }));
  const assets = {
    manifest,
    warnings: [],
    resolve(path) {
      return manifest.find((e) => e.path.toLowerCase() === path.toLowerCase())
        ?.path;
    },
    async text(path) {
      const filename = path.split("/").pop();
      const e = entry(filename);
      if (!e) throw new Error(`Missing original car entry: ${filename}`);
      return read(e).toString("latin1");
    },
  };
  return { group, text, assets };
}
