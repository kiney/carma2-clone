import * as THREE from "three";
import type { WamData } from "./damage";
import { loadGhostAssets, type GhostAssetSet } from "./ghost-assets";
import {
  loadNonCarDebrisAssets,
  type NonCarDebrisAssetSet,
} from "./noncar-debris-assets";
import type { NonCarMechanics } from "./noncars";
import type { SmashShrapnel } from "./world-smash";

export interface WamEffectAssets {
  /** Retains the original ACT scenes used by prepared ghost templates. */
  library: THREE.Group;
  ghosts: Map<SmashShrapnel, GhostAssetSet>;
  nonCars: Map<SmashShrapnel, NonCarDebrisAssetSet>;
  diagnostics: string[];
}

/** Preload vehicle-scoped ACT/mechanics dependencies for every WAM effect.
 * The exact authored spec object is the lookup key, matching world dispatch.
 * The caller owns the returned offscene library and its lifecycle. */
export async function loadWamEffectAssets(
  wam: WamData | undefined,
  loadActorFile: (name: string) => Promise<THREE.Object3D>,
  loadMechanics: (name: string) => Promise<NonCarMechanics>,
): Promise<WamEffectAssets> {
  const library = new THREE.Group();
  library.name = "WAM effect asset library";
  library.visible = false;
  const diagnostics: string[] = [];
  const specs: SmashShrapnel[] = [];
  const seen = new Set<SmashShrapnel>();
  for (const part of wam?.parts ?? [])
    for (const smash of part.smashes)
      for (const level of smash.levels)
        for (const spec of level.connotations.shrapnel)
          if (
            (spec.kind === "ghostparts" || spec.kind === "noncars") &&
            !seen.has(spec)
          ) {
            seen.add(spec);
            specs.push(spec);
          }

  const retainActorFile = async (name: string) => {
    const scene = await loadActorFile(name);
    library.add(scene);
    return scene;
  };
  // These loaders share mutable asset registries; preserve deterministic
  // ghost-before-noncar resource registration order.
  const ghostEntries = await loadGhostAssets(specs, retainActorFile);
  const nonCarEntries = await loadNonCarDebrisAssets(
    specs,
    retainActorFile,
    loadMechanics,
  );
  const ghosts = new Map<SmashShrapnel, GhostAssetSet>();
  const nonCars = new Map<SmashShrapnel, NonCarDebrisAssetSet>();
  for (let index = 0; index < specs.length; index++) {
    const spec = specs[index];
    const ghost = ghostEntries.get(index);
    if (ghost) {
      ghosts.set(spec, ghost);
      diagnostics.push(...ghost.diagnostics);
    }
    const nonCar = nonCarEntries.get(index);
    if (nonCar) {
      nonCars.set(spec, nonCar);
      diagnostics.push(...nonCar.diagnostics);
    }
  }
  return { library, ghosts, nonCars, diagnostics };
}
