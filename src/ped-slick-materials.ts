/** Original corpse-slick resources and temporary MAT ownership. Registration
 * and later native Glorify/fog adaptation are separate source operations. */
import * as THREE from "three";
import type { Assets } from "./content";
import { parseMat, type MatMaterial } from "./formats";

export const NATIVE_TEMPORARY_MATERIAL_CAPACITY = 200;
export type NativePedSlickKind = "procedural-gibslick" | "authored-gibsmear";
export type NativePedSlickShading = 0 | 1 | 2 | 3 | 4;
export interface NativePedSlickTextureQuality {
  interpolation: boolean;
  antialiasing: boolean;
  perspective: boolean;
  /** Actual texture exception entry, or known absence. */
  exceptionFlags: (pixelmapIdentifier: string) => number | null;
}
export interface NativePedSlickMaterialResource {
  readonly identifier: string;
  readonly kind: NativePedSlickKind;
  readonly material: THREE.Material;
  /** Source PIX identity; any per-MAT THREE UV wrapper borrows its image. */
  readonly pixelmap: THREE.Texture;
  readonly materialPath: string | null;
  readonly pixelmapPath: string;
  /** Procedural pre-Glorify descriptor or actual parsed original MAT. */
  readonly source: MatMaterial;
  effective: MatMaterial;
  readonly owned: boolean;
}
export type NativePedSlickMappingResult =
  | {
      status: "complete";
      material: THREE.Material;
      /** Explicit lifetime; do not dispose a borrowed registered MAT. */
      owned: boolean;
      ownedTextures?: readonly THREE.Texture[];
      requiredProviders: [];
    }
  | {
      status: "provider-required";
      material: null;
      requiredProviders: string[];
    };
export interface NativePedSlickMaterialOptions {
  dataRoot: "data" | "adv_data";
  pixelmapDirectory: "PIX8" | "PIX16";
  /** Glorify reads actual renderer globals and texture exceptions. */
  textureQuality?: NativePedSlickTextureQuality;
  mapMaterial?: (
    source: MatMaterial,
    pixelmap: THREE.Texture,
    kind: NativePedSlickKind,
  ) => NativePedSlickMappingResult;
}
type Resolution = {
  status: "complete" | "provider-required";
  requiredProviders: string[];
};
export interface NativePedSlickPreparation extends Resolution {
  /** Normalized keys consumed by queueNativePedCorpseSlick; actual names remain
   * in resources. Native temporary lookup does not strip the MAT extension. */
  materials: ReadonlyMap<string, THREE.Material>;
  resources: readonly NativePedSlickMaterialResource[];
}
export interface NativeTemporaryMaterialLookup extends Resolution {
  resource: NativePedSlickMaterialResource | null;
  appended: boolean;
}
const f = Math.fround;
const renderKey = (name: string) => name.replace(/\.mat$/i, "").toLowerCase();
const copy = (m: MatMaterial): MatMaterial => ({
  ...m,
  rgba: [...m.rgba],
  uvTransform: [...m.uvTransform],
});
function validateSource(m: MatMaterial): void {
  if (
    !m.name ||
    /[\0/\\]/.test(m.name) ||
    m.rgba.length !== 4 ||
    m.rgba.some((n) => !Number.isInteger(n) || n < 0 || n > 255) ||
    !Number.isInteger(m.flags) ||
    m.flags < 0 ||
    m.flags > 0xffffffff ||
    m.uvTransform.length !== 6 ||
    [...m.uvTransform, m.ambient, m.diffuse, m.specular, m.power].some(
      (n) => !Number.isFinite(f(n)),
    )
  )
    throw new Error("Invalid native slick MAT descriptor");
}
function quality(q: NativePedSlickTextureQuality): void {
  if (
    [q.interpolation, q.antialiasing, q.perspective].some(
      (v) => typeof v !== "boolean",
    ) ||
    typeof q.exceptionFlags !== "function"
  )
    throw new Error("Invalid native slick texture globals");
}
/** Installed517d50: renderer globals/exception before the shading switch. */
export function glorifyNativePedSlickMaterial(
  original: MatMaterial,
  shading: NativePedSlickShading,
  q: NativePedSlickTextureQuality,
): MatMaterial {
  validateSource(original);
  quality(q);
  if (!Number.isInteger(shading) || shading < 0 || shading > 4)
    throw new Error("Invalid native slick shading type");
  const m = copy(original);
  if (m.texture) {
    const exception = q.exceptionFlags(m.texture);
    if (
      exception !== null &&
      (!Number.isInteger(exception) || exception < 0 || exception > 0xffffffff)
    )
      throw new Error("Invalid native slick texture exception flags");
    if (q.interpolation && !(exception !== null && exception & 1))
      m.flags |= 0x20000;
    if (q.interpolation && exception !== null && exception & 8)
      m.uvTransform[4] = m.uvTransform[5] = f(0.02);
    if (q.antialiasing) m.flags |= 0x10000;
    if (q.perspective) m.flags |= 0x20;
  }
  if (shading === 1 || shading === 2 || shading === 3 || shading === 4) {
    [m.ambient, m.diffuse, m.specular] =
      shading === 1
        ? [f(0.2), f(0.8), 0]
        : shading === 2
          ? [f(0.6), f(0.2), f(0.8)]
          : shading === 3
            ? [f(0.4), f(0.8), 0]
            : [1, 0, 0];
    m.flags = ((m.flags & ~2) | 1 | 4) >>> 0;
  } else [m.ambient, m.diffuse, m.specular] = [1, 0, 0];
  m.flags >>>= 0;
  return m;
}
/** Bounded unlit/ambient1 mapping; no generic Lambert coefficient substitution.
 * Later source LIGHT/diffuse/specular or fog needs an actual renderer provider. */
export function mapNativePedSlickMaterial(
  source: MatMaterial,
  pixelmap: THREE.Texture,
): NativePedSlickMappingResult {
  validateSource(source);
  if (!(pixelmap instanceof THREE.Texture))
    throw new Error("Invalid source slick PIX render resource");
  const unsupported = source.flags & ~0x00031825;
  if (
    unsupported ||
    source.flags & 2 ||
    (source.flags & 1 &&
      (source.ambient !== 1 || source.diffuse !== 0 || source.specular !== 0))
  )
    return {
      status: "provider-required",
      material: null,
      requiredProviders: ["native-slick-MAT-lighting-or-effect-mapping"],
    };
  const type = pixelmap.userData.c2PixelmapType;
  if (type !== 3 && type !== 18)
    return {
      status: "provider-required",
      material: null,
      requiredProviders: ["native-slick-PIX-alpha-mapping"],
    };
  const texture = pixelmap.clone(),
    uv = source.uvTransform;
  texture.matrixAutoUpdate = false;
  texture.matrix.set(uv[0], uv[2], uv[4], uv[1], uv[3], uv[5], 0, 0, 1);
  texture.magFilter =
    source.flags & 0x20000 ? THREE.LinearFilter : THREE.NearestFilter;
  texture.minFilter =
    source.flags & 0x10000
      ? THREE.LinearMipmapNearestFilter
      : texture.magFilter;
  texture.generateMipmaps = !!(source.flags & 0x10000);
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({
    // Source unlit texture replaces colour. Ambient-only lit white MATs use
    // their authored colour; all installed GIBSLICK/GIBSMEAR colours are white.
    color:
      source.flags & 1
        ? new THREE.Color(
            ...(source.rgba.slice(0, 3).map((n) => n / 255) as [
              number,
              number,
              number,
            ]),
          )
        : 0xffffff,
    map: texture,
    side: source.flags & 0x1800 ? THREE.DoubleSide : THREE.FrontSide,
    opacity: source.rgba[3] / 255,
    transparent: source.rgba[3] !== 255 || type === 18,
    // Source renderer depth write is independent of texture/material blending.
    depthWrite: true,
    // Zero key/alpha rejection, retaining the authored partial-alpha PIX16.
    alphaTest: 1 / 255,
  });
  material.name = source.name;
  material.userData.c2Flags = source.flags;
  material.userData.nativePedSlickSourceMaterial = copy(source);
  return {
    status: "complete",
    material,
    owned: true,
    ownedTextures: [texture],
    requiredProviders: [],
  };
}

/** One shared registry per actual asset installation/data tree/renderer mode.
 * The caller retains it across all pedestrians/spills. Its bounded temporary
 * list covers these registered resources; it does not replace a global engine
 * MAT table containing unrelated track/skid/effect resources. */
export class NativePedSlickMaterialRegistry {
  readonly materials = new Map<string, THREE.Material>();
  private readonly registered = new Map<
    string,
    NativePedSlickMaterialResource
  >();
  readonly temporaryMaterials: (NativePedSlickMaterialResource | null)[] = [];
  private readonly pixelmaps = new Map<string, THREE.Texture>();
  private readonly ownedMaterials = new Set<THREE.Material>();
  private readonly ownedTextures = new Set<THREE.Texture>();
  private preparation?: Promise<NativePedSlickPreparation>;
  private preparing = false;
  private disposed = false;
  constructor(
    readonly assets: Pick<
      Assets,
      "resolve" | "bytes" | "pixelmaps" | "palette"
    >,
    readonly options: NativePedSlickMaterialOptions,
  ) {
    if (
      !["data", "adv_data"].includes(options.dataRoot) ||
      !["PIX8", "PIX16"].includes(options.pixelmapDirectory)
    )
      throw new Error(
        "Native slick requires an explicit original tree and PIX mode",
      );
    if (options.textureQuality) quality(options.textureQuality);
  }
  private alive(): void {
    if (this.disposed)
      throw new Error("Native slick material registry disposed");
  }
  addBorrowed(resource: NativePedSlickMaterialResource): void {
    this.alive();
    validateSource(resource.source);
    validateSource(resource.effective);
    if (
      resource.owned ||
      !(resource.material instanceof THREE.Material) ||
      !(resource.pixelmap instanceof THREE.Texture) ||
      resource.identifier !== resource.source.name
    )
      throw new Error("Invalid borrowed native slick resource");
    const existing = this.registered.get(resource.identifier.toLowerCase());
    if (existing && existing !== resource)
      throw new Error("Conflicting registered native slick MAT identity");
    this.registered.set(resource.identifier.toLowerCase(), resource);
    this.materials.set(renderKey(resource.identifier), resource.material);
  }
  prepare(): Promise<NativePedSlickPreparation> {
    this.alive();
    if (this.preparation) return this.preparation;
    this.preparing = true;
    return (this.preparation = this.prepareResources().then(
      (result) => {
        this.preparing = false;
        if (result.status !== "complete") this.preparation = undefined;
        return result;
      },
      (error) => {
        this.preparing = false;
        this.preparation = undefined;
        throw error;
      },
    ));
  }
  private async prepareResources(): Promise<NativePedSlickPreparation> {
    const missing: string[] = [];
    for (const kind of ["procedural-gibslick", "authored-gibsmear"] as const) {
      const identifier =
        kind === "procedural-gibslick" ? "GIBSLICK" : "GIBSMEAR.MAT";
      if (this.registered.has(identifier.toLowerCase())) continue;
      const root = this.options.dataRoot,
        mode = this.options.pixelmapDirectory;
      const materialPath =
        kind === "authored-gibsmear" ? `${root}/MATERIAL/GIBSMEAR.MAT` : null;
      const pixelmapPath =
        kind === "procedural-gibslick"
          ? `${root}/PEDS/GIBLETS/${mode}/GIBSLICK.PIX`
          : `${root}/PIXELMAP/${mode}/GIBSMEAR.PIX`;
      if (materialPath && !this.assets.resolve(materialPath)) {
        missing.push(`source-slick-MAT:${materialPath}`);
        continue;
      }
      if (!this.assets.resolve(pixelmapPath)) {
        missing.push(`source-slick-PIX:${pixelmapPath}`);
        continue;
      }
      if (
        mode === "PIX8" &&
        (!this.assets.palette || this.assets.palette.length < 1024)
      ) {
        missing.push("source-slick-PIX8-render-palette");
        continue;
      }
      if (!this.options.textureQuality) {
        missing.push("native-slick-texture-glorification-state");
        continue;
      }
      const source: MatMaterial = materialPath
        ? parseMat(await this.assets.bytes(materialPath)).find(
            (m) => m.name.toLowerCase() === identifier.toLowerCase(),
          )!
        : {
            name: "GIBSLICK",
            texture: "GIBSLICK",
            rgba: [255, 255, 255, 255],
            ambient: f(0.99),
            diffuse: 0,
            specular: 0,
            power: 0,
            flags: 0x25,
            uvTransform: [1, 0, 0, 1, 0, 0],
          };
      if (!source) {
        missing.push(`source-registered-slick-MAT:${identifier}`);
        continue;
      }
      validateSource(source);
      if (
        source.texture?.toUpperCase() !==
        (kind === "procedural-gibslick" ? "GIBSLICK" : "GIBSMEAR")
      ) {
        missing.push(`source-slick-MAT-PIX-binding:${identifier}`);
        continue;
      }
      const textureName = source.texture.toLowerCase();
      if (!this.pixelmaps.has(textureName)) {
        await this.assets.pixelmaps(pixelmapPath, this.pixelmaps);
        for (const texture of this.pixelmaps.values())
          this.ownedTextures.add(texture);
      }
      const pixelmap = this.pixelmaps.get(textureName);
      if (!pixelmap) {
        missing.push(`source-registered-slick-PIX:${source.texture}`);
        continue;
      }
      const effective = glorifyNativePedSlickMaterial(
        source,
        kind === "procedural-gibslick" ? 0 : 4,
        this.options.textureQuality,
      );
      const mapped = (this.options.mapMaterial ?? mapNativePedSlickMaterial)(
        effective,
        pixelmap,
        kind,
      );
      if (
        !mapped ||
        !["complete", "provider-required"].includes(mapped.status) ||
        !Array.isArray(mapped.requiredProviders) ||
        mapped.requiredProviders.some(
          (key) => typeof key !== "string" || !key.trim(),
        ) ||
        (mapped.status === "provider-required" &&
          !mapped.requiredProviders.length)
      )
        throw new Error("Invalid native slick MAT mapping resolution");
      if (mapped.status !== "complete") {
        missing.push(...mapped.requiredProviders);
        continue;
      }
      if (
        !(mapped.material instanceof THREE.Material) ||
        typeof mapped.owned !== "boolean" ||
        mapped.requiredProviders.length ||
        (mapped.ownedTextures !== undefined &&
          (!Array.isArray(mapped.ownedTextures) ||
            mapped.ownedTextures.some(
              (texture) => !(texture instanceof THREE.Texture),
            )))
      )
        throw new Error("Invalid native slick MAT mapping result");
      const resource: NativePedSlickMaterialResource = {
        identifier,
        kind,
        source: copy(source),
        effective,
        material: mapped.material,
        pixelmap,
        pixelmapPath,
        materialPath,
        owned: mapped.owned,
      };
      this.registered.set(identifier.toLowerCase(), resource);
      this.materials.set(renderKey(identifier), mapped.material);
      if (mapped.owned) this.ownedMaterials.add(mapped.material);
      for (const texture of mapped.ownedTextures ?? []) {
        this.ownedTextures.add(texture);
      }
    }
    return {
      status: missing.length ? "provider-required" : "complete",
      requiredProviders: [...new Set(missing)],
      materials: this.materials,
      resources: [...this.registered.values()],
    };
  }
  /** Installed ReadSpillData inline LoadTemporaryMaterial: find only, no load,
   * clone or dedup. Full adaptation list still returns the same valid MAT. */
  loadTemporaryMaterial(name: string): NativeTemporaryMaterialLookup {
    this.alive();
    if (!name || /[\0/\\*?]/.test(name))
      throw new Error(
        "Native slick lookup requires a literal registered MAT identifier",
      );
    const resource = this.registered.get(name.toLowerCase()) ?? null;
    if (!resource)
      return {
        status: "provider-required",
        resource: null,
        appended: false,
        requiredProviders: [`source-registered-temporary-MAT:${name}`],
      };
    const appended =
      this.temporaryMaterials.length < NATIVE_TEMPORARY_MATERIAL_CAPACITY;
    if (appended) this.temporaryMaterials.push(resource);
    return { status: "complete", resource, appended, requiredProviders: [] };
  }
  /** Installed4ea5d0 removes matching adaptation entries without compacting. */
  removeFromAdaptation(resource: NativePedSlickMaterialResource): void {
    this.alive();
    for (let i = 0; i < this.temporaryMaterials.length; i++)
      if (this.temporaryMaterials[i] === resource)
        this.temporaryMaterials[i] = null;
  }
  /** The real host updates existing MAT render state/fog in place. Failure to
   * supply that owner retains the pending list, never fabricating completion. */
  adaptCachedMaterials(
    shading: NativePedSlickShading,
    adapt?: (
      resource: NativePedSlickMaterialResource,
      effective: MatMaterial,
    ) => void | readonly string[],
  ): Resolution {
    this.alive();
    if (!Number.isInteger(shading) || shading < 0 || shading > 4)
      throw new Error("Invalid native slick shading type");
    if (!this.temporaryMaterials.length)
      return { status: "complete", requiredProviders: [] };
    if (!adapt || !this.options.textureQuality)
      return {
        status: "provider-required",
        requiredProviders: ["native-temporary-MAT-glorify-and-fog-owner"],
      };
    for (const resource of this.temporaryMaterials) {
      if (!resource) continue;
      const next = glorifyNativePedSlickMaterial(
          resource.effective,
          shading,
          this.options.textureQuality,
        ),
        material = resource.material;
      const pending = adapt(resource, next) ?? [];
      if (resource.material !== material)
        throw new Error("Native temporary adaptation must retain MAT identity");
      if (
        !Array.isArray(pending) ||
        pending.some((key) => typeof key !== "string" || !key.trim())
      )
        throw new Error("Invalid native temporary adaptation result");
      if (pending.length)
        return {
          status: "provider-required",
          requiredProviders: [...new Set(pending)],
        };
      resource.effective = next;
    }
    this.temporaryMaterials.length = 0;
    return { status: "complete", requiredProviders: [] };
  }
  /** Spills/skids borrow these materials. Explicit host proof precedes disposal;
   * clearing adaptation pointers alone is not proof that render users released. */
  dispose(isReleased: () => boolean): void {
    if (this.disposed) return;
    if (this.preparing)
      throw new Error("Finish native slick preparation before disposal");
    if (typeof isReleased !== "function" || !isReleased())
      throw new Error(
        "Release native slick material borrowers before disposal",
      );
    for (const material of this.ownedMaterials) material.dispose();
    for (const texture of this.ownedTextures) texture.dispose();
    this.materials.clear();
    this.registered.clear();
    this.temporaryMaterials.length = 0;
    this.pixelmaps.clear();
    this.ownedMaterials.clear();
    this.ownedTextures.clear();
    this.disposed = true;
  }
}
