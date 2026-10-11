import * as THREE from "three";

/** Installed GetSimpleMaterial488c70, packed code/RGB table655fc8. */
const colours = new Map([
  [0, 0x5d0303],
  [2, 0xa56e04],
  [3, 0xa9a905],
  [8, 0x006868],
  [13, 0x3c3626],
  [14, 0x212121],
  [21, 0x284c21],
  [25, 0x00326a],
  [26, 0x93491d],
  [30, 0xc0bfc0],
  [35, 0x141414],
]);

export function simpleMaterialColour(name: string) {
  const named = /^M(\d{2})(?:\.MAT)?(?:[\s,\/].*)?$/i.exec(name.trim());
  if (named) {
    const colour = colours.get(Number(named[1]));
    if (colour === undefined)
      throw new Error(`Obsolete simple material ${name}`);
    return colour;
  }
  const rgb = name
    .trim()
    .split(/\s*,\s*/)
    .map(Number);
  if (
    rgb.length !== 3 ||
    rgb.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
  )
    throw new Error(`Invalid simple material colour ${name}`);
  return rgb[0] * 65536 + rgb[1] * 256 + rgb[2];
}

/** The next authored block after mechanics is LoadCarShrapnelMaterials488da0.
 * Preserve order and duplicates; native loading does not cap its loop at the
 * three slots shown by rec2's structure declaration (stock data also uses4). */
export function parseCarShrapnelMaterials(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.split("//")[0].trim())
    .filter(Boolean);
  const start = lines.findIndex(
    (line) => line.toUpperCase() === "END OF MECHANICS STUFF",
  );
  if (start < 0) return [];
  const count = Number(lines[start + 1]);
  if (!Number.isInteger(count) || count < 0 || count > 256)
    throw new Error("Invalid car shrapnel material count");
  const names = lines.slice(start + 2, start + 2 + count);
  if (names.length !== count)
    throw new Error("Truncated car shrapnel materials");
  for (const name of names) simpleMaterialColour(name);
  return names;
}

/** Native 32-entry RGB cache: the first shading request wins. Materials are
 * borrowed by fragments, never by a car's disposal traversal. The existing
 * Three lighting bridge is a browser rendering approximation; native ka/kd/ks
 * are retained explicitly, with no gameplay effects attached to this shader. */
export class SimpleMaterialLibrary {
  readonly diagnostics: string[] = [];
  private cache = new Map<number, THREE.Material>();
  resolve(name: string, shading: 1 | 2 | 4) {
    const colour = simpleMaterialColour(name);
    const found = this.cache.get(colour);
    if (found) return found;
    if (this.cache.size === 32) {
      const message = "Native simple-material cache capacity32 reached";
      if (!this.diagnostics.includes(message)) this.diagnostics.push(message);
      return;
    }
    const coefficients =
      shading === 4
        ? [1, 0, 0]
        : shading === 2
          ? [0.6, 0.2, 0.8]
          : [0.2, 0.8, 0];
    const rgb = new THREE.Color(colour);
    const material = new THREE.MeshPhongMaterial({
      color: rgb.clone().multiplyScalar(coefficients[1]),
      emissive: rgb.clone().multiplyScalar(coefficients[0]),
      specular: new THREE.Color(
        coefficients[2],
        coefficients[2],
        coefficients[2],
      ),
    });
    material.name = `Simple #${colour.toString(16).padStart(6, "0")}`;
    material.userData.c2SimpleColour = colour;
    material.userData.c2Shading = shading;
    material.userData.c2Lighting = coefficients;
    this.cache.set(colour, material);
    return material;
  }
  dispose() {
    for (const material of this.cache.values()) material.dispose();
    this.cache.clear();
  }
}
