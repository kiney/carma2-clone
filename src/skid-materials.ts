import * as THREE from "three";
import type { Assets } from "./content";
import { parseMat } from "./formats";

const key = (name: string) => name.replace(/\.(mat|pix)$/i, "").toLowerCase();
/** Original tyre materials borrow asset-cache textures. Their fractional PIX
 * alpha matters even when authored MAT RGBA is fully opaque. */
export class SkidMaterialLibrary {
  readonly materials = new Map<string, THREE.Material>();
  readonly diagnostics: string[] = [];
  resolve = (name: string) => this.materials.get(key(name));

  async load(
    assets: Pick<Assets, "resolve" | "bytes" | "pixelmaps" | "textures">,
    names: readonly string[],
  ) {
    for (const name of new Set(names.map(key))) {
      if (["none", "0", "1", ""].includes(name) || this.materials.has(name))
        continue;
      const path = assets.resolve(`data/MATERIAL/${name}.MAT`);
      if (!path) {
        this.diagnostics.push(`Missing original skid material ${name}`);
        continue;
      }
      const definitions = parseMat(await assets.bytes(path));
      for (const definition of definitions) {
        const textureName = key(definition.texture ?? name);
        if (!assets.textures.has(textureName)) {
          const pix = assets.resolve(`data/PIXELMAP/PIX16/${textureName}.PIX`);
          if (pix) await assets.pixelmaps(pix);
        }
        const texture = assets.textures.get(textureName);
        if (!texture) {
          this.diagnostics.push(`Missing original skid texture ${textureName}`);
          continue;
        }
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          color: 0xffffff,
          side: definition.flags & 0x1800 ? THREE.DoubleSide : THREE.FrontSide,
          opacity: definition.rgba[3] / 255,
          transparent: true,
          depthWrite: false,
          // The original section is coplanar. Depth offset avoids browser depth
          // quantization flicker while preserving its exact marker coordinates.
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        material.name = definition.name;
        material.userData.c2Flags = definition.flags;
        this.materials.set(key(definition.name), material);
        this.materials.set(name, material);
      }
    }
  }
  dispose() {
    for (const material of new Set(this.materials.values())) material.dispose();
    this.materials.clear();
  }
}
