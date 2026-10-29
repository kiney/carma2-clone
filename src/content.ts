import { createModelGeometry } from "./render-geometry";
import { NativeResourceRegistry } from "./native-resource-registry";
import { NativeResourceArena } from "./native-resource-arena";
import { NativeGlobalResources } from "./native-global-resources";
import {
  createNativeRenderMaterial,
  nativeRenderMaterialSource,
  updateNativeRenderMaterial,
  type NativeMaterialRenderOptions,
} from "./native-material-render";
import * as THREE from "three";
import { parseDat, parseAct, parseMat, parsePix, decodeText } from "./formats";
import { parseTiff } from "./tiff";
import type { DatModel, ActNode, MatMaterial, PixMap } from "./formats";
import type { ModelPreparedOptions } from "./car-smoke";
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
  readonly materialArena = new NativeResourceArena();
  readonly nativeMaterialRegistry = new NativeGlobalResources<MatMaterial>(
    true,
  );
  readonly nativeModelRegistry = new NativeGlobalResources<DatModel>(false);
  private readonly nativeModelMaterialBindings = new Map<
    DatModel,
    readonly (MatMaterial | null)[]
  >();
  /** BufferGeometry.clone preserves this metadata object's identity. Keep the
   * resource crosswalk outside serializable ACT userData and render MAT copies. */
  private readonly nativePreparedModelSources = new WeakMap<object, DatModel>();
  private readonly startupStorage = {};
  private commonLoaded = false;
  private readonly renderedNativeMaterials = new Map<
    MatMaterial,
    THREE.MeshLambertMaterial
  >();
  private readonly nativeGeometries = new Map<
    DatModel,
    {
      geometry: THREE.BufferGeometry;
      materials: THREE.Material[];
      slots: number[];
      nullMaterialSlots: boolean[];
    }
  >();
  private readonly nativeStores = new Map<string, object>();
  private readonly storageCleanup = new Map<object, Set<() => void>>();
  private readonly storageReferences = new Map<object, number>();
  private readonly sceneReleases = new Set<() => void>();
  private readonly transientMaterialStores = new Map<MatMaterial, object>();
  private readonly retainedNativeMaterials = new Set<MatMaterial>();
  private readonly generatedStorage = {};
  private readonly generatedMaterials = new Map<string, MatMaterial>();
  registerGeneratedMaterial(source: MatMaterial, storageKey = source.name) {
    const existing = this.generatedMaterials.get(storageKey);
    if (existing) return existing;
    this.generatedMaterials.set(storageKey, source);
    this.materialArena.allocateMaterial(source);
    // BrMaterialAllocate(NULL) has no lookup identifier; keep its identity only.
    if (source.name)
      this.nativeMaterialRegistry.add(this.generatedStorage, source);
    this.renderedNativeMaterials.set(
      source,
      createNativeRenderMaterial(source, undefined, this.nativeRenderOptions),
    );
    return source;
  }
  private nativeRenderOptions: NativeMaterialRenderOptions = {};
  cloneNativeMaterial(render: THREE.Material): THREE.Material {
    const original = this.resolveNativeMaterial(render);
    if (!original) return render.clone();
    const runtime = render.userData.c2NativeState as MatMaterial | undefined;
    const source: MatMaterial = {
      ...(runtime ?? original),
      rgba: [...(runtime ?? original).rgba],
      uvTransform: [...(runtime ?? original).uvTransform],
    };
    const storage = {};
    this.materialArena.allocateMaterial(source);
    this.nativeMaterialRegistry.add(storage, source);
    this.transientMaterialStores.set(source, storage);
    const originalRender = render as THREE.MeshLambertMaterial;
    const cloned = createNativeRenderMaterial(
      source,
      originalRender.map ?? undefined,
      { ...this.nativeRenderOptions, depth: undefined },
    );
    cloned.color.copy(originalRender.color);
    cloned.emissive.copy(originalRender.emissive);
    cloned.emissiveIntensity = originalRender.emissiveIntensity;
    this.renderedNativeMaterials.set(source, cloned);
    return cloned;
  }
  /** Process-global copied MODELs borrow these exact MAT pointers. Native C2
   * can leave stale heap pointers; the host explicitly retains valid resources. */
  retainNativeMaterial(source: MatMaterial): void {
    if (
      !this.materialArena.materialAddress(source).resolved ||
      !this.renderedNativeMaterials.has(source)
    )
      throw new Error(
        "Native MAT retention requires an existing live source allocation and render wrapper",
      );
    this.retainedNativeMaterials.add(source);
  }
  isRetainedNativeMaterial(
    materialOrSource: THREE.Material | MatMaterial,
  ): boolean {
    const source =
      materialOrSource instanceof THREE.Material
        ? this.resolveNativeMaterial(materialOrSource)
        : materialOrSource;
    return source !== undefined && this.retainedNativeMaterials.has(source);
  }
  isRetainedNativeTexture(texture: THREE.Texture): boolean {
    for (const source of this.retainedNativeMaterials) {
      const map = this.renderedNativeMaterials.get(source)?.map;
      if (map && (map === texture || map.source === texture.source))
        return true;
    }
    return false;
  }
  getNativeRenderMaterial(source: MatMaterial) {
    return this.renderedNativeMaterials.get(source);
  }
  ownsNativeGeometry(geometry: THREE.BufferGeometry): boolean {
    for (const data of this.nativeGeometries.values())
      if (data.geometry === geometry) return true;
    return false;
  }
  /** Resolve this MODEL-load episode's raw face MAT bindings to live owned byte
   * addresses. These are our host allocator's pointers, not a Windows capture.
   * Geometry clones borrow the source MODEL; later registry registrations and
   * actor/render material overrides cannot rebind its raw faces. Explicit host
   * runtime-mutation metadata instead supplies the current raw MAT identities
   * and current MODEL inputs after clipping/migration; names never rebind them. */
  getNativeModelPreparedOptions(
    geometry: THREE.BufferGeometry,
  ): ModelPreparedOptions {
    const model = this.nativePreparedModelSources.get(geometry.userData);
    let bindings = model && this.nativeModelMaterialBindings.get(model);
    const faces = geometry.userData.sourceFaces as
      | DatModel["faces"]
      | undefined;
    let label = model?.name;
    if (geometry.userData.c2PreparedSourceKind === "runtime-mutation") {
      // Host clipping/migration creates a new current MODEL. Its explicit raw
      // MAT table owns identities directly; it has no DAT name-lookup episode.
      const source = geometry.userData.sourcePositions;
      const uvs = geometry.userData.sourceUVs;
      const flags = geometry.userData.modelFlags;
      const position = geometry.getAttribute("position");
      const uv = geometry.getAttribute("uv");
      const materials = geometry.userData.c2RawFaceMaterials;
      if (
        !(source instanceof Float32Array) ||
        source.length % 3 !== 0 ||
        source.length / 3 > 0xffff ||
        !Array.from(source).every(Number.isFinite) ||
        !(uvs instanceof Float32Array) ||
        uvs.length !== (source.length / 3) * 2 ||
        !Array.from(uvs).every(Number.isFinite) ||
        !Number.isInteger(flags) ||
        flags < 0 ||
        flags > 0xffff ||
        !Array.isArray(faces) ||
        faces.length > 0xffff ||
        !position ||
        position.itemSize !== 3 ||
        source.length !== position.count * 3 ||
        position.count !== faces.length * 3 ||
        !uv ||
        uv.itemSize !== 2 ||
        uv.count !== position.count ||
        !Array.isArray(materials)
      )
        throw new Error(
          "Native prepared runtime-mutation source is incomplete",
        );
      for (const face of faces)
        if (
          !face ||
          !Array.isArray(face.indices) ||
          face.indices.length !== 3 ||
          face.indices.some(
            (index) =>
              !Number.isInteger(index) ||
              index < 0 ||
              index >= source.length / 3,
          ) ||
          !Number.isInteger(face.smoothing) ||
          face.smoothing < 0 ||
          face.smoothing > 0xffff ||
          !Number.isInteger(face.flags) ||
          face.flags < 0 ||
          face.flags > 0xff
        )
          throw new Error("Native prepared runtime-mutation face is invalid");
      bindings = materials;
      label = "runtime-mutation";
    } else if (!model || !bindings || !this.nativeGeometries.has(model)) {
      throw new Error(
        "Native prepared MODEL resource is unavailable or released",
      );
    }
    if (!faces)
      throw new Error(`Native prepared MODEL faces missing: ${label}`);
    const materialPointers = new Map<number, number>([[0, 0]]);
    for (const face of faces) {
      const slot = face.material;
      if (materialPointers.has(slot)) continue;
      if (!Number.isInteger(slot) || slot < 1 || slot > bindings!.length)
        throw new Error(
          `Native prepared MODEL material slot out of bounds: ${label}:${slot}`,
        );
      const source = bindings![slot - 1];
      if (source === undefined)
        throw new Error(
          `Native prepared MODEL material binding missing: ${label}:${slot}`,
        );
      const allocation = this.materialArena.materialAddress(source);
      if (!allocation.resolved)
        throw new Error(
          `Native prepared MODEL material unavailable: ${label}:${slot}: ${allocation.requiredProvider}`,
        );
      materialPointers.set(slot, allocation.address);
    }
    return {
      materialPointers,
      materialPointerProvenance: "host-resource-addresses",
    };
  }
  ownsNativeTexture(texture: THREE.Texture): boolean {
    for (const render of this.renderedNativeMaterials.values())
      if (render.map?.source === texture.source) return true;
    return false;
  }
  resolveNativeMaterial(material: THREE.Material) {
    return nativeRenderMaterialSource(material);
  }
  updateNativeMaterial(source: MatMaterial) {
    const rendered = this.renderedNativeMaterials.get(source);
    if (rendered)
      updateNativeRenderMaterial(rendered, source, this.nativeRenderOptions);
    return rendered;
  }
  generatedTrackMaterials() {
    if (!this.palette || this.palette.length < 256 * 4)
      throw new Error(
        "Native generated track materials require the complete render palette",
      );
    const offset = 227 * 4;
    const common = {
      ambient: 1,
      diffuse: 0,
      specular: 0,
      power: 20,
      uvTransform: [1, 0, 0, 1, 0, 0],
      fogMin: 0,
      fogMax: 0,
      fogColor: 0,
    };
    const defaultTrackMaterial = this.registerGeneratedMaterial(
      {
        ...common,
        name: "gDefault_track_material",
        flags: 1,
        rgba: [
          this.palette[offset],
          this.palette[offset + 1],
          this.palette[offset + 2],
          255,
        ],
        indexBase: 227,
        indexRange: 1,
      },
      "default-track",
    );
    // GetSimpleMaterial selects by input M14, then allocates identifier Simple
    // and finds the first closest RGB palette entry (488d3e / 517f70..518033).
    let blackIndex = 127,
      nearest = Infinity;
    for (let index = 0; index < 256; index++) {
      const p = index * 4;
      const distance =
        (0x21 - this.palette[p]) ** 2 +
        (0x21 - this.palette[p + 1]) ** 2 +
        (0x21 - this.palette[p + 2]) ** 2;
      if (distance < nearest) {
        nearest = distance;
        blackIndex = index;
      }
    }
    const blackMaterial = this.registerGeneratedMaterial(
      {
        ...common,
        name: "Simple",
        flags: 5,
        rgba: [0x21, 0x21, 0x21, 255],
        indexBase: blackIndex,
        indexRange: 0,
      },
      "black",
    );
    return { defaultTrackMaterial, blackMaterial };
  }
  configureNativeRendering(options: NativeMaterialRenderOptions) {
    this.nativeRenderOptions = { ...options };
    for (const source of this.generatedMaterials.values())
      this.updateNativeMaterial(source);
  }
  /** Race storages are cleared together; startup texture libraries remain live. */
  releaseRaceResources() {
    for (const release of [...this.sceneReleases]) release();
    this.nativeStores.clear();
    for (const [source, storage] of this.transientMaterialStores) {
      this.nativeMaterialRegistry.removeStorage(storage);
      if (this.retainedNativeMaterials.has(source)) continue;
      const rendered = this.renderedNativeMaterials.get(source);
      rendered?.map?.dispose();
      rendered?.dispose();
      this.renderedNativeMaterials.delete(source);
      const allocation = this.materialArena.materialAddress(source);
      if (allocation.resolved && allocation.handle)
        this.materialArena.free(allocation.handle);
    }
    this.transientMaterialStores.clear();
  }
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
      const request = p;
      // Coalesce pending/successful reads, but let a later reload retry failures.
      // An older rejection must not remove a replacement cache entry.
      void request.catch(() => {
        if (this.cache.get(resolved) === request) this.cache.delete(resolved);
      });
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
    owned?: Set<THREE.Texture>,
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
      owned?.add(texture);
      target.set(key(identifier), texture);
    }
    return maps;
  }
  async common(progress: (text: string) => void) {
    if (this.commonLoaded) return;
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
    // LoadInRegistees loads REG/MATERIAL before REG/MODELS. Unlike track
    // AddMaterials, DRLoadMaterials directly registers every record, clears
    // LIGHT and never Glorifies it (installed 48f020..76 / 48f080..dd).
    for (const path of this.files("data/Reg/MATERIAL", /^[^/]+\.mat$/i)) {
      progress(`Registering original common materials: ${path}`);
      for (const source of parseMat(await this.bytes(path))) {
        source.flags &= ~1;
        this.materialArena.allocateMaterial(source);
        this.nativeMaterialRegistry.add(this.startupStorage, source, false);
        this.renderedNativeMaterials.set(
          source,
          createNativeRenderMaterial(
            source,
            source.texture ? this.textures.get(key(source.texture)) : undefined,
          ),
        );
      }
    }
    const defaultMaterial = createNativeRenderMaterial(
      {
        name: "default_mat",
        rgba: [255, 255, 255, 255],
        ambient: Math.fround(0.1),
        diffuse: Math.fround(0.7),
        specular: 0,
        power: 20,
        flags: 1,
        uvTransform: [1, 0, 0, 1, 0, 0],
      },
      undefined,
    );
    for (const path of this.files("data/Reg/MODELS", /^[^/]+\.dat$/i)) {
      progress(`Registering original common models: ${path}`);
      for (const model of parseDat(await this.bytes(path))) {
        // DRLoadModels overwrites flags, rather than ORing UPDATEABLE into the
        // file flags. Ordinary vertices follow its white RGB load path.
        model.flags = 0x80;
        this.nativeModelRegistry.add(this.startupStorage, model);
        this.bindModelMaterials(model);
        this.bindModelGeometry(model, defaultMaterial);
        this.warnings.push(...(model.warnings ?? []));
      }
    }
    this.commonLoaded = true;
  }
  private bindModelMaterials(model: DatModel): void {
    this.nativeModelMaterialBindings.set(
      model,
      model.materials.map(
        (name) => this.nativeMaterialRegistry.find(name) ?? null,
      ),
    );
  }
  private bindModelGeometry(model: DatModel, defaultMaterial: THREE.Material) {
    const geometry = createModelGeometry(model);
    // Pointer identity belongs to this load episode. Keep it off serialized
    // render metadata while allowing cloned geometry to borrow the same MODEL.
    Object.defineProperty(geometry.userData, "c2NativeModelIdentity", {
      value: model,
      configurable: true,
      writable: true,
    });
    try {
      const slots = [...new Set(model.faces.map((face) => face.material))];
      const bindings = this.nativeModelMaterialBindings.get(model);
      if (!bindings)
        throw new Error(`Native DAT material bindings missing: ${model.name}`);
      // Index zero and authoritative failed named lookups both hold native NULL.
      // Keep authored slot numbers, and defer NULL slots to actor inheritance.
      const resolvedMaterials = slots.map((index) =>
        index === 0 ? null : bindings[index - 1],
      );
      Object.defineProperty(geometry.userData, "c2RawFaceMaterials", {
        value: model.faces.map((face) =>
          face.material === 0 ? null : bindings[face.material - 1],
        ),
        writable: true,
        configurable: true,
      });
      const materials = resolvedMaterials.map((source) => {
        if (source === null) return defaultMaterial;
        if (!source)
          throw new Error(
            `Native DAT material slot out of bounds: ${model.name}`,
          );
        const rendered = this.renderedNativeMaterials.get(source);
        if (!rendered)
          throw new Error(`Native render MAT wrapper missing: ${source.name}`);
        return rendered;
      });
      const data = {
        geometry,
        materials,
        slots,
        nullMaterialSlots: resolvedMaterials.map((source) => source === null),
      };
      this.nativeGeometries.set(model, data);
      this.nativePreparedModelSources.set(geometry.userData, model);
      return data;
    } catch (error) {
      geometry.dispose();
      throw error;
    }
  }
  async scene(
    dir: string,
    stem: string,
    options: {
      storage?: string;
      shading?: number;
      defaultMaterial?: MatMaterial;
      /** Load the directory MODEL/MAT/PIX library without requiring an ACT. */
      resourceOnly?: boolean;
    } = {},
  ) {
    const storage = options.storage
      ? (this.nativeStores.get(options.storage) ?? {})
      : {};
    if (options.storage) this.nativeStores.set(options.storage, storage);
    this.storageReferences.set(
      storage,
      (this.storageReferences.get(storage) ?? 0) + 1,
    );
    const renderOptions = {
      ...this.nativeRenderOptions,
      ...(options.shading === undefined ? {} : { shading: options.shading }),
    };
    const local = new Map(this.textures);
    const ownedTextures = new Set<THREE.Texture>();
    const ownedMaterials = new Set<MatMaterial>();
    const ownedModels = new Set<DatModel>();
    let defaultMaterial: THREE.MeshLambertMaterial | undefined;
    const releaseLocal = () => {
      defaultMaterial?.dispose();
      const shared = new Set<THREE.Texture>(this.textures.values());
      for (const texture of ownedTextures)
        if (!shared.has(texture) && !this.isRetainedNativeTexture(texture))
          texture.dispose();
    };
    try {
      const loadedKeys = new Set<string>();
      const maps = this.files(dir, /(^|\/)(pixies\.p16|[^/]+\.pix)$/i);
      for (const p of maps) {
        try {
          for (const map of await this.pixelmaps(p, local, ownedTextures))
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
              ownedTextures.add(texture);
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
        materialArena = this.materialArena;
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
        const handles = batch.map((mat) => {
          const handle = materialArena.allocateMaterial(mat);
          ownedMaterials.add(mat);
          return handle;
        });
        for (const [recordIndex, mat] of batch.entries()) {
          const accepted =
            this.nativeMaterialRegistry.add(storage, mat) &&
            materialRegistry.add(mat);
          materialEpisodes.push({ path, recordIndex, material: mat, accepted });
          if (!accepted) {
            materialArena.free(handles[recordIndex]);
            const existing = this.nativeMaterialRegistry.find(mat.name);
            const rendered = existing
              ? this.renderedNativeMaterials.get(existing)
              : undefined;
            if (existing && rendered) {
              sourceMaterials.set(key(mat.name), existing);
              materials.set(key(mat.name), rendered);
            }
            continue;
          }
          sourceMaterials.set(key(mat.name), mat);
          let texture = mat.texture ? local.get(key(mat.texture)) : undefined;
          if (mat.texture && !texture) missingTextures++;
          const material = createNativeRenderMaterial(
            mat,
            texture,
            renderOptions,
          );
          this.renderedNativeMaterials.set(mat, material);
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
          ownedModels.add(model);
          modelRegistry.add(model);
          this.nativeModelRegistry.add(storage, model);
          this.bindModelMaterials(model);
          modelEpisodes.push({ path, recordIndex, model });
          models.set(key(model.name), model);
          this.warnings.push(...(model.warnings ?? []));
        }
      }
      const findSourceMaterial = (identifier: string) =>
        this.nativeMaterialRegistry.find(identifier);
      const findSourceModel = (identifier: string) =>
        this.nativeModelRegistry.find(identifier);
      const findRenderedMaterial = (identifier: string) => {
        const source = findSourceMaterial(identifier);
        return source ? this.renderedNativeMaterials.get(source) : undefined;
      };
      // BRender SetupDefaultMaterial: white, opaque and lit. DAT index0 means
      // actor/inherited material. A failed native named lookup also stores NULL.
      defaultMaterial = createNativeRenderMaterial(
        {
          name: "default_mat",
          rgba: [255, 255, 255, 255],
          ambient: Math.fround(0.1),
          diffuse: Math.fround(0.7),
          specular: 0,
          power: 20,
          flags: 1,
          uvTransform: [1, 0, 0, 1, 0, 0],
        },
        undefined,
        { ...renderOptions, shading: undefined },
      );
      defaultMaterial.name = "C2 default material";
      defaultMaterial.userData.c2Flags = 1;
      const geometries = new Map<
        DatModel,
        {
          geometry: THREE.BufferGeometry;
          materials: THREE.Material[];
          slots: number[];
          nullMaterialSlots: boolean[];
        }
      >();
      const sourceModelGeometries = new Map<DatModel, THREE.BufferGeometry>();
      for (const model of modelRegistry.accepted) {
        const data = this.bindModelGeometry(model, defaultMaterial);
        sourceModelGeometries.set(model, data.geometry);
        geometries.set(model, data);
      }
      const act =
        this.resolve(`${dir}/${stem}.act`) ??
        this.files(dir, /^[^/]+\.act$/i).find(
          (p) =>
            p.split("/").pop()?.toLowerCase() === stem.toLowerCase() + ".act",
        );
      if (!act && !options.resourceOnly)
        throw new Error(`Actor scene missing: ${dir}/${stem}.act`);
      const roots = options.resourceOnly
        ? []
        : parseAct(await this.bytes(act!));
      const group = new THREE.Group();
      group.name = stem;
      let missingModels = 0;
      const sourceActorObjects = new Map<ActNode, THREE.Group>();
      const nativeGeometries = this.nativeGeometries;
      const nativeRenderedMaterials = this.renderedNativeMaterials;
      function actor(
        node: ActNode,
        inheritedMaterial?: string | MatMaterial,
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
        object.matrix.decompose(
          object.position,
          object.quaternion,
          object.scale,
        );
        // An authored ACT material name may resolve to NULL; native inheritance
        // then keeps the parent material instead of creating a named placeholder.
        const mat =
            (node.material !== undefined
              ? findSourceMaterial(node.material)
              : undefined) ?? inheritedMaterial,
          style = node.renderStyle || inheritedStyle;
        object.userData.c2ActorMaterialName =
          typeof mat === "string" ? mat : (mat?.name ?? null);
        if (node.model && style !== 1) {
          const sourceModel = findSourceModel(node.model);
          const data = sourceModel
            ? nativeGeometries.get(sourceModel)
            : undefined;
          if (data) {
            const override =
              typeof mat === "string"
                ? findRenderedMaterial(mat)
                : mat
                  ? nativeRenderedMaterials.get(mat)
                  : undefined;
            const mesh = new THREE.Mesh(
              data.geometry,
              data.materials.map((material, index) =>
                data.nullMaterialSlots[index]
                  ? (override ?? material)
                  : material,
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
        group.add(
          actor(root, options.defaultMaterial, 4, index, sourceActorObjects),
        );
      group.updateMatrixWorld(true);
      const loadActorResource = async (path: string) => {
        const sourceActors = parseAct(await this.bytes(path));
        const sourceActorObjects = new Map<ActNode, THREE.Group>();
        const group = new THREE.Group();
        group.name = path.split("/").pop() ?? path;
        for (const [index, root] of sourceActors.entries())
          group.add(
            actor(root, options.defaultMaterial, 4, index, sourceActorObjects),
          );
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
      let disposed = false;
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        this.sceneReleases.delete(dispose);
        const refs = (this.storageReferences.get(storage) ?? 1) - 1;
        this.storageReferences.set(storage, refs);
        if (refs === 0) {
          this.storageReferences.delete(storage);
          for (const mat of this.nativeMaterialRegistry.removeStorage(
            storage,
          )) {
            if (this.retainedNativeMaterials.has(mat)) continue;
            const render = this.renderedNativeMaterials.get(mat);
            render?.map?.dispose();
            render?.dispose();
            this.renderedNativeMaterials.delete(mat);
            const allocation = materialArena.materialAddress(mat);
            if (allocation.resolved && allocation.handle)
              materialArena.free(allocation.handle);
          }
          for (const model of this.nativeModelRegistry.removeStorage(storage)) {
            this.nativeGeometries.get(model)?.geometry.dispose();
            this.nativeGeometries.delete(model);
            this.nativeModelMaterialBindings.delete(model);
          }
          if (options.storage) this.nativeStores.delete(options.storage);
        }
        if (refs === 0) {
          for (const cleanup of this.storageCleanup.get(storage) ?? [])
            cleanup();
          this.storageCleanup.delete(storage);
        }
      };
      const cleanup = this.storageCleanup.get(storage) ?? new Set<() => void>();
      this.storageCleanup.set(storage, cleanup);
      cleanup.add(releaseLocal);
      this.sceneReleases.add(dispose);
      const adaptMaterials = (
        shading: number,
        depth = this.nativeRenderOptions.depth,
      ) => {
        for (const mat of materialRegistry.accepted) {
          const rendered = this.renderedNativeMaterials.get(mat);
          if (rendered)
            updateNativeRenderMaterial(rendered, mat, {
              ...this.nativeRenderOptions,
              shading,
              depth,
            });
        }
      };
      return {
        group,
        dispose,
        adaptMaterials,
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
        /** Native MAT table pointers captured at each MODEL-load episode; later
         * registrations may change global name lookup but cannot rebind faces. */
        sourceModelMaterialBindings: this
          .nativeModelMaterialBindings as ReadonlyMap<
          DatModel,
          readonly (MatMaterial | null)[]
        >,
        sourceMaterialEpisodes: materialEpisodes,
        sourceModelEpisodes: modelEpisodes,
        materialArena,
        /** Actual MODEL-to-geometry ownership, before cloning or render batching. */
        sourceModelGeometries: sourceModelGeometries as ReadonlyMap<
          DatModel,
          THREE.BufferGeometry
        >,
        /** Rendering follows captured native MAT pointers, including failed
         * named lookups that became NULL at MODEL registration time. */
        modelMaterials: (model: DatModel, inherited: THREE.Material) => {
          const data = nativeGeometries.get(model);
          if (!data) throw new Error(`Native MODEL unavailable: ${model.name}`);
          return data.materials.map((material, slot) =>
            data.nullMaterialSlots[slot] ? inherited : material,
          );
        },
        /** Native replacement keeps the already loaded MODEL/MAT identities;
         * named registry lookups must not rebind raw face slots at smash time. */
        createModelInstance: (model: DatModel, inherited: THREE.Material) => {
          const data = nativeGeometries.get(model);
          if (!data)
            throw new Error(
              `Native replacement MODEL unavailable: ${model.name}`,
            );
          return {
            identity: model,
            geometry: data.geometry.clone(),
            materials: data.materials.map((material, slot) =>
              data.nullMaterialSlots[slot] ? inherited : material,
            ),
          };
        },
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
    } catch (error) {
      // Construction has not published an owner. Roll back this episode only;
      // other successful scenes may already use the same native storage.
      this.nativeMaterialRegistry.removeResources(storage, ownedMaterials);
      for (const source of ownedMaterials) {
        const render = this.renderedNativeMaterials.get(source);
        render?.map?.dispose();
        render?.dispose();
        this.renderedNativeMaterials.delete(source);
        const allocation = this.materialArena.materialAddress(source);
        if (allocation.resolved && allocation.handle)
          this.materialArena.free(allocation.handle);
      }
      this.nativeModelRegistry.removeResources(storage, ownedModels);
      for (const model of ownedModels) {
        this.nativeGeometries.get(model)?.geometry.dispose();
        this.nativeGeometries.delete(model);
        this.nativeModelMaterialBindings.delete(model);
      }
      releaseLocal();
      const refs = (this.storageReferences.get(storage) ?? 1) - 1;
      if (refs > 0) this.storageReferences.set(storage, refs);
      else {
        this.storageReferences.delete(storage);
        if (
          options.storage &&
          this.nativeStores.get(options.storage) === storage
        )
          this.nativeStores.delete(options.storage);
      }
      throw error;
    }
  }
}
