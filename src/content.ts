import { createModelGeometry } from "./render-geometry";
import { NativeResourceRegistry } from "./native-resource-registry";
import { NativeResourceArena } from "./native-resource-arena";
import * as THREE from "three";
import { parseDat, parseAct, parseMat, parsePix, decodeText } from "./formats";
import { parseTiff } from "./tiff";
import type { DatModel, ActNode, MatMaterial, PixMap } from "./formats";
export interface AssetEntry {
  path: string;
  size: number;
  enumeration?:
    | { kind: "archive-table"; archive: string; index: number }
    | { kind: "host-directory"; index: number };
}
const key = (name: string) =>
  name.replace(/\.(pix|mat|dat|act|tif|tiff)$/i, "").toLowerCase();
export class Assets {
  manifest: AssetEntry[] = [];
  lookup = new Map<string, string>();
  cache = new Map<string, Promise<Uint8Array>>();
  textures = new Map<string, THREE.DataTexture>();
  palette?: Uint8Array;
  warnings: string[] = [];
  async init() {
    const r = await fetch("/api/manifest");
    if (!r.ok) throw new Error("Local asset server unavailable");
    this.manifest = (await r.json()).assets;
    for (const e of this.manifest)
      this.lookup.set(e.path.toLowerCase(), e.path);
  }
  resolve(path: string) {
    return this.lookup.get(path.toLowerCase());
  }
  async bytes(path: string) {
    const resolved = this.resolve(path);
    if (!resolved) throw new Error(`Asset missing: ${path}`);
    let p = this.cache.get(resolved);
    if (!p) {
      p = fetch(
        "/api/asset/" + resolved.split("/").map(encodeURIComponent).join("/"),
      ).then(async (r) => {
        if (!r.ok) throw new Error(`${resolved}: HTTP ${r.status}`);
        return new Uint8Array(await r.arrayBuffer());
      });
      this.cache.set(resolved, p);
    }
    return p;
  }
  async text(path: string) {
    return decodeText(await this.bytes(path));
  }
  files(dir: string, pattern: RegExp) {
    const prefix = dir.toLowerCase() + "/";
    return this.manifest
      .filter(
        (e) =>
          e.path.toLowerCase().startsWith(prefix) &&
          pattern.test(e.path.slice(prefix.length)),
      )
      .sort((a, b) => {
        // PFForEveryFile walks raw mounted-TWT entry order. A loose install
        // exposes the server's host enumeration, not an invented native order.
        const left = a.enumeration,
          right = b.enumeration;
        if (!left || !right) return 0;
        const sameDirectory =
          a.path.slice(0, a.path.lastIndexOf("/")).toLowerCase() ===
          b.path.slice(0, b.path.lastIndexOf("/")).toLowerCase();
        if (!sameDirectory) return 0;
        if (left.kind === "archive-table" && right.kind === "archive-table")
          return left.archive === right.archive ? left.index - right.index : 0;
        if (left.kind === right.kind) return left.index - right.index;
        return left.kind === "archive-table" ? -1 : 1;
      })
      .map((e) => e.path);
  }
  async pixelmaps(
    path: string,
    target: Map<string, THREE.Texture> = this.textures,
  ) {
    const maps = parsePix(await this.bytes(path), this.palette);
    for (const map of maps) {
      if (map.palette && !this.palette) this.palette = map.palette;
      const texture = new THREE.DataTexture(
        map.rgba,
        map.width,
        map.height,
        THREE.RGBAFormat,
      );
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      texture.flipY = false;
      texture.needsUpdate = true;
      // Standalone original PIX files (including OIL.PIX) may omit an
      // internal identifier; native lookup then uses the filename.
      const identifier = map.name || path.split("/").pop()!;
      texture.name = identifier;
      texture.userData.c2PixelmapType = map.format;
      target.set(key(identifier), texture);
    }
    return maps;
  }
  async common(progress: (text: string) => void) {
    const palette = this.resolve("data/Reg/PALETTES/DRRENDER.PAL");
    if (palette) {
      try {
        const maps = parsePix(await this.bytes(palette));
        this.palette = maps[0]?.palette ?? maps[0]?.rgba;
      } catch (e) {
        this.warnings.push(String(e));
      }
    }
    const prefixes = new Set(
      this.manifest
        .filter(
          (e) =>
            /^data\/races\//i.test(e.path) && /\/[^/]+\.txt$/i.test(e.path),
        )
        .map((e) => e.path.slice(0, e.path.lastIndexOf("/")).toLowerCase()),
    );
    const shared = this.manifest.filter(
      (e) =>
        /^data\/(races|reg|common|pixelmap)\//i.test(e.path) &&
        (/\.p16$/i.test(e.path) ||
          /^data\/pixelmap\/[^/]+\.pix$/i.test(e.path)) &&
        !prefixes.has(e.path.slice(0, e.path.lastIndexOf("/")).toLowerCase()),
    );
    for (const [i, e] of shared.entries()) {
      progress(`Loading original texture libraries ${i + 1}/${shared.length}`);
      try {
        await this.pixelmaps(e.path);
      } catch (error) {
        this.warnings.push(`${e.path}: ${error}`);
      }
    }
  }
  async scene(dir: string, stem: string) {
    const local = new Map(this.textures);
    const loadedKeys = new Set<string>();
    const maps = this.files(dir, /(^|\/)(pixies\.p16|[^/]+\.pix)$/i);
    for (const p of maps) {
      try {
        for (const map of await this.pixelmaps(p, local))
          loadedKeys.add(key(map.name));
      } catch (e) {
        this.warnings.push(`${p}: ${e}`);
      }
    }
    const tiffs = this.files(dir, /\.tiff?$/i).filter(
      (p) => !loadedKeys.has(key(p.split("/").pop()!)),
    );
    for (let i = 0; i < tiffs.length; i += 12)
      await Promise.all(
        tiffs.slice(i, i + 12).map(async (path) => {
          try {
            const image = parseTiff(await this.bytes(path));
            const texture = new THREE.DataTexture(
              image.rgba,
              image.width,
              image.height,
              THREE.RGBAFormat,
            );
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.generateMipmaps = true;
            texture.needsUpdate = true;
            local.set(key(path.split("/").pop()!), texture);
          } catch (error) {
            this.warnings.push(`${path}: ${error}`);
          }
        }),
      );
    // Storage retains actual resource episodes separately from legacy name maps.
    // Track AddMaterials rejects exact duplicate identifiers; registry lookup
    // folds case and visits newest accepted first. MODEL storage flags0 admits
    // every record, even repeated identifiers (500fe0 / 501e1a / 529300).
    const modelRegistry = new NativeResourceRegistry<DatModel>(false),
      materialRegistry = new NativeResourceRegistry<MatMaterial>(true),
      models = new Map<string, DatModel>(),
      materials = new Map<string, THREE.Material>(),
      renderedMaterials = new Map<MatMaterial, THREE.Material>(),
      sourceMaterials = new Map<string, MatMaterial>(),
      materialArena = new NativeResourceArena();
    const materialEpisodes: {
      path: string;
      recordIndex: number;
      material: MatMaterial;
      accepted: boolean;
    }[] = [];
    const mats = this.files(dir, /^[^/]+\.mat$/i);
    let missingTextures = 0;
    for (const path of mats) {
      const batch = parseMat(await this.bytes(path));
      // BrMaterialLoadMany allocates the WHOLE file before AddMaterials can
      // release rejected duplicates. Addresses describe our host arena only.
      const handles = batch.map((mat) => materialArena.allocateMaterial(mat));
      for (const [recordIndex, mat] of batch.entries()) {
        const accepted = materialRegistry.add(mat);
        materialEpisodes.push({ path, recordIndex, material: mat, accepted });
        if (!accepted) {
          materialArena.free(handles[recordIndex]);
          continue;
        }
        sourceMaterials.set(key(mat.name), mat);
        let texture = mat.texture ? local.get(key(mat.texture)) : undefined;
        if (mat.texture && !texture) missingTextures++;
        if (texture) {
          texture = texture.clone();
          const uv = mat.uvTransform;
          texture.matrixAutoUpdate = false;
          texture.matrix.set(uv[0], uv[2], uv[4], uv[1], uv[3], uv[5], 0, 0, 1);
          texture.needsUpdate = true;
        }
        const colour = texture
          ? 0xffffff
          : new THREE.Color(
              mat.rgba[0] / 255,
              mat.rgba[1] / 255,
              mat.rgba[2] / 255,
            );
        const opacity = mat.rgba[3] / 255;
        const material = new THREE.MeshLambertMaterial({
          color: colour,
          map: texture ?? null,
          side: mat.flags & 0x1800 ? THREE.DoubleSide : THREE.FrontSide,
          transparent: opacity < 0.99,
          opacity,
          alphaTest: texture ? 0.15 : 0,
          depthWrite: opacity >= 0.99,
        });
        material.name = mat.name;
        material.userData.c2Flags = mat.flags;
        renderedMaterials.set(mat, material);
        materials.set(key(mat.name), material);
      }
    }
    const modelEpisodes: {
      path: string;
      recordIndex: number;
      model: DatModel;
    }[] = [];
    for (const path of this.files(dir, /^[^/]+\.dat$/i)) {
      for (const [recordIndex, model] of parseDat(
        await this.bytes(path),
      ).entries()) {
        modelRegistry.add(model);
        modelEpisodes.push({ path, recordIndex, model });
        models.set(key(model.name), model);
        this.warnings.push(...(model.warnings ?? []));
      }
    }
    const findSourceMaterial = (identifier: string) =>
      materialRegistry.find(identifier);
    const findSourceModel = (identifier: string) =>
      modelRegistry.find(identifier);
    const findRenderedMaterial = (identifier: string) => {
      const source = findSourceMaterial(identifier);
      return source ? renderedMaterials.get(source) : undefined;
    };
    const fallback = new THREE.MeshLambertMaterial({
      color: 0xaaaaaa,
      side: THREE.DoubleSide,
    });
    // BRender SetupDefaultMaterial: white, opaque and lit. DAT index0 means
    // actor/inherited material; it does not mean an unresolved named material.
    const defaultMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
    defaultMaterial.name = "C2 default material";
    defaultMaterial.userData.c2Flags = 1;
    const geometries = new Map<
      DatModel,
      {
        geometry: THREE.BufferGeometry;
        materials: THREE.Material[];
        slots: number[];
      }
    >();
    const sourceModelGeometries = new Map<DatModel, THREE.BufferGeometry>();
    for (const model of modelRegistry.accepted) {
      const geometry = createModelGeometry(model);
      sourceModelGeometries.set(model, geometry);
      const slots = [...new Set(model.faces.map((f) => f.material))];
      const used = slots.map((index) =>
        index === 0
          ? defaultMaterial
          : (findRenderedMaterial(model.materials[index - 1] || "") ??
            fallback),
      );
      geometries.set(model, { geometry, materials: used, slots });
    }
    const act =
      this.resolve(`${dir}/${stem}.act`) ??
      this.files(dir, /^[^/]+\.act$/i).find(
        (p) =>
          p.split("/").pop()?.toLowerCase() === stem.toLowerCase() + ".act",
      );
    if (!act) throw new Error(`Actor scene missing: ${dir}/${stem}.act`);
    const roots = parseAct(await this.bytes(act));
    const group = new THREE.Group();
    group.name = stem;
    let missingModels = 0;
    const sourceActorObjects = new Map<ActNode, THREE.Group>();
    function actor(
      node: ActNode,
      inheritedMaterial?: string,
      inheritedStyle = 4,
      childIndex = 0,
      bindings?: Map<ActNode, THREE.Group>,
    ): THREE.Group {
      const object = new THREE.Group();
      bindings?.set(node, object);
      object.name = node.name;
      object.userData.c2ActorType = node.type;
      object.userData.c2ActorRenderStyle = node.renderStyle;
      object.userData.c2ActorName = node.name;
      object.userData.c2ActorChildIndex = childIndex;
      // Collector inheritance reads local NULL separately from inherited render state.
      object.userData.c2ActorLocalModelName = node.model ?? null;
      object.userData.c2ActorLocalMaterialName = node.material ?? null;
      if (node.bounds)
        object.userData.c2ActorBounds = {
          min: [...node.bounds.min],
          max: [...node.bounds.max],
        };
      const m = node.transform;
      object.matrix.set(
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
      // Debris templates need the full authored matrix, including any shear;
      // later render animation may update the decomposed visual transform.
      object.userData.c2ActorMatrix = object.matrix.clone();
      object.matrix.decompose(object.position, object.quaternion, object.scale);
      const mat = node.material ?? inheritedMaterial,
        style = node.renderStyle || inheritedStyle;
      object.userData.c2ActorMaterialName = mat ?? null;
      if (node.model && style !== 1) {
        const sourceModel = findSourceModel(node.model);
        const data = sourceModel ? geometries.get(sourceModel) : undefined;
        if (data) {
          const override = mat ? findRenderedMaterial(mat) : undefined;
          const mesh = new THREE.Mesh(
            data.geometry,
            data.materials.map((material, index) =>
              data.slots[index] === 0 ? (override ?? material) : material,
            ),
          );
          mesh.name = node.model;
          object.add(mesh);
        } else missingModels++;
      }
      for (const [index, child] of node.children.entries())
        object.add(actor(child, mat, style, index, bindings));
      return object;
    }
    for (const [index, root] of roots.entries())
      group.add(actor(root, undefined, 4, index, sourceActorObjects));
    group.updateMatrixWorld(true);
    const loadActorResource = async (path: string) => {
      const sourceActors = parseAct(await this.bytes(path));
      const sourceActorObjects = new Map<ActNode, THREE.Group>();
      const group = new THREE.Group();
      group.name = path.split("/").pop() ?? path;
      for (const [index, root] of sourceActors.entries())
        group.add(actor(root, undefined, 4, index, sourceActorObjects));
      group.updateMatrixWorld(true);
      return {
        group,
        sourceActors: sourceActors as readonly ActNode[],
        sourceActorObjects: sourceActorObjects as ReadonlyMap<
          ActNode,
          THREE.Group
        >,
      };
    };
    return {
      group,
      /** Authored ACT nodes before render defaults, batching or native load mutations.
       * Consumers borrow these source records; mutable native linked lists are separate. */
      sourceActors: roots as readonly ActNode[],
      /** Identity crosswalk for authored ACT nodes in THIS initial scene. Extra
       * actor templates borrow resources without replacing these live objects. */
      sourceActorObjects: sourceActorObjects as ReadonlyMap<
        ActNode,
        THREE.Group
      >,
      /** Compatibility name maps; native consumers use exact registry lookup
       * and ordered storage identities below, never extension-normalized keys. */
      sourceMaterials,
      findSourceMaterial,
      findSourceModel,
      sourceMaterialStorage:
        materialRegistry.accepted as readonly MatMaterial[],
      sourceModelStorage: modelRegistry.accepted as readonly DatModel[],
      sourceMaterialEpisodes: materialEpisodes,
      sourceModelEpisodes: modelEpisodes,
      materialArena,
      /** Actual MODEL-to-geometry ownership, before cloning or render batching. */
      sourceModelGeometries: sourceModelGeometries as ReadonlyMap<
        DatModel,
        THREE.BufferGeometry
      >,
      defaultMaterial,
      /** Separate original ACT identities and live object bindings for an extra
       * resource; never append them to the initial track's identity crosswalk. */
      loadActorResource,
      /** Additional authored ACTs share this scene's immutable DAT/MAT/PIX
       * resources. Debris loading must not reload every texture library. */
      loadActorFile: async (path: string): Promise<THREE.Group> => {
        return (await loadActorResource(path)).group;
      },
      textures: local,
      models,
      materials,
      stats: {
        models: modelRegistry.accepted.length,
        materials: materialRegistry.accepted.length,
        rejectedMaterials: materialEpisodes.filter(
          (episode) => !episode.accepted,
        ).length,
        missingTextures,
        missingModels,
      },
    };
  }
}
