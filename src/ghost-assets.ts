import * as THREE from "three";
import type { SmashShrapnel } from "./world-smash";

export interface GhostTemplate {
  /** Name of the native ACT actor, retained for matching and diagnostics. */
  name: string;
  /** Actor transform from the ACT, before any captured smash frame is applied. */
  matrix: THREE.Matrix4;
  /** The single model mesh owned directly by the ACT actor. */
  model: THREE.Mesh;
}

export interface GhostAssetSet {
  specIndex: number;
  actorFile: string;
  /** ACT container extents, if selection came from a container actor. */
  containerSize?: [number, number, number];
  /** ReadShrapnelSpec bounds. Positive actor counts explicitly leave these zero. */
  boundsDX: number;
  boundsDY: number;
  templates: GhostTemplate[];
  diagnostics: string[];
}

/**
 * Resolve authored ghost templates from scene hierarchies produced by Assets.scene.
 * The scene Group is a browser wrapper. Its immediate children are ACT roots.
 * For count <= 0, the first ACT root is the container and only its immediate
 * children are candidates, in native BrActorEnum order (reverse parse order).
 */
export async function loadGhostAssets(
  specs: readonly SmashShrapnel[],
  loadActorFile: (name: string) => Promise<THREE.Object3D>,
): Promise<Map<number, GhostAssetSet>> {
  const result = new Map<number, GhostAssetSet>();
  for (let specIndex = 0; specIndex < specs.length; specIndex++) {
    const spec = specs[specIndex];
    if (spec.kind !== "ghostparts") continue;
    const names = spec.actors ?? [];
    const count = spec.actorCountSource ?? names.length;
    const diagnostics: string[] = [];
    const templates: GhostTemplate[] = [];
    let containerSize: [number, number, number] | undefined;
    let boundsDX = 0;
    let boundsDY = 0;
    if (count > 0) {
      for (const name of names.slice(0, count)) {
        let scene: THREE.Object3D;
        try {
          scene = await loadActorFile(name);
        } catch (error) {
          diagnostics.push(`missingactor: ${name} (${String(error)})`);
          continue;
        }
        const actor =
          scene.children.find((child) => child.name === name) ??
          scene.children[0];
        if (!actor) {
          diagnostics.push(`missingactor: ${name}`);
          continue;
        }
        const template = makeTemplate(actor);
        if (!template) {
          diagnostics.push(`missingmodel: ${name}`);
          continue;
        }
        templates.push(template);
      }
    } else {
      const name = names[0];
      if (!name) {
        diagnostics.push("missingactor: <container name absent>");
      } else {
        let scene: THREE.Object3D;
        try {
          scene = await loadActorFile(name);
        } catch (error) {
          diagnostics.push(`missingactor: ${name} (${String(error)})`);
          result.set(specIndex, {
            specIndex,
            actorFile: name,
            boundsDX,
            boundsDY,
            templates,
            diagnostics,
          });
          continue;
        }
        const container = scene.children[0];
        if (!container) diagnostics.push(`missingactor: ${name}`);
        else {
          container.updateMatrixWorld(true);
          const box = objectBounds(container);
          if (!box.isEmpty()) {
            containerSize = [
              box.max.x - box.min.x,
              box.max.y - box.min.y,
              box.max.z - box.min.z,
            ];
            boundsDX = containerSize[0];
            boundsDY = containerSize[1];
          }
          // Native enumeration walks head-inserted child links, the reverse of
          // parseAct's append order. Do not recurse through nested descendants.
          for (const actor of [...container.children].reverse()) {
            const template = makeTemplate(actor);
            if (!template) {
              diagnostics.push(
                `missingmodel: ${actor.name || "<unnamed actor>"}`,
              );
              continue;
            }
            templates.push(template);
          }
        }
      }
    }
    result.set(specIndex, {
      specIndex,
      actorFile: names[0] ?? "",
      containerSize,
      boundsDX,
      boundsDY,
      templates,
      diagnostics,
    });
  }
  return result;
}

function makeTemplate(actor: THREE.Object3D): GhostTemplate | undefined {
  const model = actor.children.find(
    (child): child is THREE.Mesh => (child as THREE.Mesh).isMesh === true,
  );
  if (!model) return undefined;
  if (!model.geometry.getAttribute("position")) return undefined;
  return {
    name: actor.name,
    matrix:
      actor.userData.c2ActorMatrix instanceof THREE.Matrix4
        ? actor.userData.c2ActorMatrix.clone()
        : actor.matrix.clone(),
    model,
  };
}

function objectBounds(object: THREE.Object3D) {
  const bounds = new THREE.Box3();
  const visit = (
    child: THREE.Object3D,
    parentMatrix: THREE.Matrix4,
    ignoreActorMatrix = false,
  ) => {
    const actorMatrix = child.userData.c2ActorMatrix;
    const local = ignoreActorMatrix
      ? new THREE.Matrix4()
      : actorMatrix instanceof THREE.Matrix4
        ? actorMatrix
        : child.matrix;
    const matrix = parentMatrix.clone().multiply(local);
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      const position = mesh.geometry.getAttribute("position");
      if (position) {
        const vertex = new THREE.Vector3();
        for (let i = 0; i < position.count; i++)
          bounds.expandByPoint(
            vertex.fromBufferAttribute(position, i).applyMatrix4(matrix),
          );
      }
      return;
    }
    for (const nested of child.children) visit(nested, matrix);
  };
  // BrActorToBounds seeds the root model's own bounds in identity space and
  // recurses into children; the root actor transform is not applied.
  visit(object, new THREE.Matrix4(), true);
  return bounds;
}
