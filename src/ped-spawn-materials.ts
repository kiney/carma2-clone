/** Installed ReadPedSpecs4caa43..4cab28 marker pass. All material pointers
 * must already be resolved; registry lookup and asset identifiers stay external. */
import type { MatMaterial } from "./formats";

export interface NativePedSpawnMaterialChange {
  material: MatMaterial;
  previousIdentifier: string;
  identifier: string;
}
export interface NativePedSpawnMaterialMarkResult {
  changes: NativePedSpawnMaterialChange[];
  requiredProviders: string[];
}

/** Mutates the actual live MAT identifiers in source spec order. Repeated MAT
 * pointers remain repeated visits; only writes changing a string are reported.
 * Malformed browser strings are rejected before any mutation, rather than
 * emulating the installed unchecked short-name/byte-addressing behavior. */
export function markNativePedSpawnMaterials(
  materials: readonly (MatMaterial | null)[],
): NativePedSpawnMaterialMarkResult {
  const missing = new Set<string>();
  for (const material of materials) {
    if (material === null) continue;
    if (typeof material !== "object" || typeof material.name !== "string") {
      missing.add("source-ped-spawn-MAT-identifier");
      continue;
    }
    if (!/^[\x01-\x7f]*$/.test(material.name))
      missing.add("source-ped-spawn-MAT-ASCII-identifier");
    if (material.name.length < 4)
      missing.add("source-ped-spawn-MAT-identifier-minimum-four-bytes");
  }
  if (missing.size) return { changes: [], requiredProviders: [...missing] };

  const changes: NativePedSpawnMaterialChange[] = [];
  for (const material of materials) {
    if (material === null) continue;
    const previousIdentifier = material.name;
    //4caa69 subtracts four from strlen, with an unsigned <=7 branch. The
    //padding stores at4caab6 use buffer+strlen-4, replacing the old suffix.
    let identifier = previousIdentifier;
    if ((identifier.length - 4) >>> 0 <= 7)
      identifier = identifier.slice(0, -4) + "xxxxxxxx.MAT";
    //4cab1d writes the marker even if no padding/reallocation was necessary.
    identifier = identifier.slice(0, 7) + "?" + identifier.slice(8);
    if (identifier === previousIdentifier) continue;
    material.name = identifier;
    changes.push({ material, previousIdentifier, identifier });
  }
  return { changes, requiredProviders: [] };
}
