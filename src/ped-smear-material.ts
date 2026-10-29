/** LastChance4d5851 borrows registered PEDSMEAR, distinct from corpse-slick
 * GIBSMEAR. Load its original MAT/PIX16 through the native material mapper. */
import * as THREE from "three";
import type { Assets } from "./content";
import { parseMat, parsePix, type PixMap } from "./formats";
import {
  createNativeRenderMaterial,
  type NativeMaterialRenderOptions,
} from "./native-material-render";

export interface NativePedSmearMaterial {
  material: THREE.Material | null;
  requiredProviders: string[];
  /** Release skid borrowers before disposing this material. Idempotent. */
  dispose(): void;
}
type SmearAssets = Pick<Assets, "manifest" | "bytes"> & {
  readonly nativeRenderingOptions?: Readonly<NativeMaterialRenderOptions>;
};
const key = (value: string) => value.replace(/\.pix$/i, "").toLowerCase();

export async function loadNativePedSmearMaterial(
  assets: SmearAssets,
  dataRoot: "data" | "adv_data",
): Promise<NativePedSmearMaterial> {
  if (dataRoot !== "data" && dataRoot !== "adv_data")
    throw new Error("Native PEDSMEAR requires an explicit original data tree");
  const missing = (provider: string): NativePedSmearMaterial => ({
    material: null,
    requiredProviders: [provider],
    dispose() {},
  });
  const resolve = (path: string) =>
    assets.manifest.find(
      (entry) => entry.path.toLowerCase() === path.toLowerCase(),
    )?.path;
  const read = async (path: string) => {
    try {
      return await assets.bytes(path);
    } catch {
      return null;
    }
  };
  const wantedMat = `${dataRoot}/PEDS/GIBLETS/PEDSMEAR.MAT`;
  const materialPath = resolve(wantedMat);
  if (!materialPath) return missing(`source-ped-smear-MAT:${wantedMat}`);
  const materialBytes = await read(materialPath);
  if (!materialBytes) return missing(`source-ped-smear-MAT:${materialPath}`);
  let source;
  try {
    source = parseMat(materialBytes).find(
      (m) => m.name.toUpperCase() === "PEDSMEAR",
    );
  } catch (error) {
    throw new Error(`Native PEDSMEAR MAT ${materialPath}: ${String(error)}`);
  }
  if (!source) return missing("source-registered-ped-smear-MAT:PEDSMEAR");
  const reference = source.texture;
  if (!reference) return missing("source-ped-smear-MAT-PIX-binding:PEDSMEAR");
  if (!/^[\w.-]+$/.test(reference) || reference === "." || reference === "..")
    throw new Error("Native PEDSMEAR has an invalid PIX identifier");
  const wantedPix = `${dataRoot}/PEDS/GIBLETS/PIX16/${reference.replace(/\.pix$/i, "")}.PIX`;
  const pixelmapPath = resolve(wantedPix);
  if (!pixelmapPath) return missing(`source-ped-smear-PIX:${wantedPix}`);
  const pixelmapBytes = await read(pixelmapPath);
  if (!pixelmapBytes) return missing(`source-ped-smear-PIX:${pixelmapPath}`);
  let selected: PixMap | undefined;
  try {
    // Assets.pixelmaps uses filename identity for an unnamed standalone PIX.
    // Preserve source registration order if this file has duplicate identifiers.
    for (const p of parsePix(pixelmapBytes))
      if (key(p.name || pixelmapPath.split("/").pop()!) === key(reference))
        selected = p;
  } catch (error) {
    throw new Error(`Native PEDSMEAR PIX ${pixelmapPath}: ${String(error)}`);
  }
  if (!selected) return missing(`source-registered-ped-smear-PIX:${reference}`);
  const options = assets.nativeRenderingOptions ?? {};
  if (
    options.visualFogDistanceScale !== undefined &&
    (!Number.isFinite(options.visualFogDistanceScale) ||
      options.visualFogDistanceScale <= 0)
  )
    throw new Error("Invalid native PEDSMEAR renderer fog distance scale");
  const texture = new THREE.DataTexture(
    selected.rgba,
    selected.width,
    selected.height,
    THREE.RGBAFormat,
  );
  texture.name = selected.name || reference;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.flipY = false;
  texture.userData.c2PixelmapType = selected.format;
  texture.needsUpdate = true;
  const material = createNativeRenderMaterial(source, texture, options);
  // RGBA4444 partial texel alpha blends even when the MAT opacity is255.
  // The shared mapper already supplies zero-key alphaTest and native depth state.
  material.transparent ||= selected.rgba.some(
    (value, index) => index % 4 === 3 && value > 0 && value < 255,
  );
  material.userData.nativePedSmear = { materialPath, pixelmapPath };
  const ownedTextures = new Set<THREE.Texture>([texture]);
  if (material.map) ownedTextures.add(material.map);
  let disposed = false;
  return {
    material,
    requiredProviders: [],
    dispose() {
      if (disposed) return;
      disposed = true;
      material.dispose();
      for (const owned of ownedTextures) owned.dispose();
      ownedTextures.clear();
    },
  };
}
