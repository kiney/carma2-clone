import * as THREE from "three";
import type { NonCarMechanics } from "./noncars";
import type { SmashShrapnel } from "./world-smash";

export interface NonCarDebrisTemplate {
  /** ACT identifier before native clone-name rewriting. */
  originalName: string;
  /** Detached, cloneable selected actor with its full local ACT transform. */
  actor: THREE.Object3D;
  nativeIdentifier: string;
  mechanics: NonCarMechanics;
}

export interface NonCarDebrisAssetSet {
  specIndex: number;
  actorFile: string;
  templates: NonCarDebrisTemplate[];
  diagnostics: string[];
}

/** Load the authored ACT and mechanics dependencies for noncar shrapnel. */
export async function loadNonCarDebrisAssets(
  specs: readonly SmashShrapnel[],
  loadActorFile: (name: string) => Promise<THREE.Object3D>,
  loadMechanics: (name: string) => Promise<NonCarMechanics>,
): Promise<Map<number, NonCarDebrisAssetSet>> {
  const result = new Map<number, NonCarDebrisAssetSet>();
  // rec2 ReadShrapnelSpec compares the actors' current identifiers. The
  // mechanics rewrite below changes those identifiers; an authored-name map
  // would incorrectly reuse templates from a later freshly loaded ACT file.
  const actorCache: THREE.Object3D[] = [];
  const mechanicsCache = new Map<string, Promise<NonCarMechanics>>();

  for (let specIndex = 0; specIndex < specs.length; specIndex++) {
    const spec = specs[specIndex];
    if (spec.kind !== "noncars") continue;
    const diagnostics: string[] = [];
    const templates: NonCarDebrisTemplate[] = [];
    const actorFile = spec.actorFile ?? "";
    let scene: THREE.Object3D | undefined;
    try {
      if (!actorFile) throw new Error("actorFile is absent");
      scene = await loadActorFile(actorFile);
    } catch (error) {
      diagnostics.push(
        `missingactorfile: ${actorFile || "<absent>"} (${String(error)})`,
      );
    }

    for (const entry of spec.nonCars ?? []) {
      const originalName = entry.actor;
      const mechanicsName = entry.mechanics;
      const found = scene && findActor(scene, originalName);
      if (!found) {
        diagnostics.push(`missingactor: ${originalName} in ${actorFile}`);
        continue;
      }
      let sourceActor = actorCache.find((actor) => actor.name === found.name);
      if (!sourceActor) {
        sourceActor = cloneActorWithMatrices(found);
        // The native cache has 100 slots. Once full, later selections still
        // work but are no longer entered into this identifier cache.
        if (actorCache.length < 100) actorCache.push(sourceActor);
      }

      let mechanics: NonCarMechanics;
      try {
        let promise = mechanicsCache.get(mechanicsName);
        if (!promise) {
          promise = loadMechanics(mechanicsName);
          mechanicsCache.set(mechanicsName, promise);
        }
        mechanics = await promise;
      } catch (error) {
        diagnostics.push(
          `missingmechanics: ${mechanicsName} (${String(error)})`,
        );
        continue;
      }

      const prefix = mechanicsName.slice(0, 2);
      if (prefix.length !== 2) {
        diagnostics.push(`invalidmechanicsname: ${mechanicsName}`);
        continue;
      }
      const nativeIdentifier = `&${prefix}!bbbb.ACT`;
      sourceActor.name = nativeIdentifier;
      templates.push({
        originalName,
        actor: sourceActor,
        nativeIdentifier,
        mechanics,
      });
    }
    result.set(specIndex, { specIndex, actorFile, templates, diagnostics });
  }
  return result;
}

/** The returned scene Group is only a browser wrapper, not an ACT actor. */
function findActor(
  scene: THREE.Object3D,
  name: string,
): THREE.Object3D | undefined {
  for (const root of scene.children) {
    if (root.name === name) return root;
    const found = root.getObjectByName(name);
    if (found) return found;
  }
  return undefined;
}

function cloneActorWithMatrices(source: THREE.Object3D): THREE.Object3D {
  const clone = source.clone(true);
  const originals = [source, ...source.children.flatMap(flattenChildren)];
  const clones = [clone, ...clone.children.flatMap(flattenChildren)];
  if (originals.length !== clones.length)
    throw new Error(`Actor clone hierarchy changed for ${source.name}`);
  for (let i = 0; i < originals.length; i++) {
    const original = originals[i];
    const copied = clones[i];
    const matrix = original.userData.c2ActorMatrix;
    if (matrix instanceof THREE.Matrix4) {
      copied.matrix.copy(matrix);
      copied.matrixAutoUpdate = false;
    } else if (original.matrixAutoUpdate) {
      copied.updateMatrix();
    } else {
      copied.matrix.copy(original.matrix);
      copied.matrixAutoUpdate = false;
    }
  }
  clone.parent = null;
  return clone;
}

function flattenChildren(object: THREE.Object3D): THREE.Object3D[] {
  return [object, ...object.children.flatMap(flattenChildren)];
}
