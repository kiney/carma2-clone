import { Matrix4, Vector3 } from "three";
import type { GhostAssetSet } from "./ghost-assets";
import type { NonCarDebrisAssetSet } from "./noncar-debris-assets";
import type { NativeNonCarDebrisRuntime } from "./noncar-debris";
import type { ShardRuntime } from "./smash-shards";
import { nativeDirectSmashSeed, prepareNativeGhostFrame } from "./ghost-frame";
import type { WorldSmashContact } from "./world-destruction";
import type { SmashShrapnel } from "./world-smash";

export interface SmashDebrisAssets {
  ghosts: ReadonlyMap<SmashShrapnel, GhostAssetSet>;
  nonCars: ReadonlyMap<SmashShrapnel, NonCarDebrisAssetSet>;
}

export interface SmashDebrisOutlets {
  fragments?: Pick<ShardRuntime, "spawnGhosts">;
  nonCars?: Pick<NativeNonCarDebrisRuntime, "spawn">;
  abstract(spec: SmashShrapnel): void;
  shards?(spec: SmashShrapnel): void;
  isVisible(point: Vector3): boolean;
  /** The queued ACT remains live, independently of the retained car owner. */
  readActorMatrix(): Matrix4;
  timeMs: number;
  diagnose(message: string): void;
}

/** DoShrapnel4eb660 retains authored order and gates abstract/glass/ghost
 * production by the impact point BEFORE random consumption. Physical noncars
 * are not visual particles and take their separate native admission path. */
export function dispatchSmashDebris(
  specs: readonly SmashShrapnel[],
  contact: WorldSmashContact,
  assets: SmashDebrisAssets,
  outlets: SmashDebrisOutlets,
): void {
  for (const spec of specs) {
    if (!contact.point) {
      outlets.diagnose("Smash debris requires the native smash point");
      continue;
    }
    if (spec.kind !== "noncars" && !outlets.isVisible(contact.point)) continue;
    if (spec.kind === "abstract") outlets.abstract(spec);
    else if (spec.kind === "shards") outlets.shards?.(spec);
    else if (spec.kind === "ghostparts") {
      const templates = assets.ghosts.get(spec);
      if (!templates?.templates.length || !outlets.fragments) continue;
      const { frame, tinyFace } = prepareNativeGhostFrame(
        contact.ghostQuad ?? null,
        outlets.readActorMatrix(),
        [templates.boundsDX, templates.boundsDY, 0],
      );
      outlets.fragments.spawnGhosts(spec, {
        templates: templates.templates.map((template) => ({
          name: template.name,
          matrix: template.matrix,
          geometry: template.model.geometry,
          material: template.model.material,
        })),
        frame,
        tinyFace,
        point: contact.point.clone(),
        impacteeVelocity:
          contact.smashStartingVelocity?.clone() ?? new Vector3(0, 1, 0),
        timeMs: Math.round(contact.timeMs ?? outlets.timeMs) >>> 0,
        seed:
          contact.shrapnelSeed ??
          nativeDirectSmashSeed(contact.effectForce ?? new Vector3()),
        visible: true,
      });
    } else if (spec.kind === "noncars") {
      const templates = assets.nonCars.get(spec);
      if (!templates?.templates.length || !outlets.nonCars) continue;
      const { frame } = prepareNativeGhostFrame(
        contact.ghostQuad ?? null,
        outlets.readActorMatrix(),
      );
      outlets.nonCars.spawn(spec, templates, {
        frame,
        point: contact.point.clone(),
        impacteeVelocity:
          contact.smashStartingVelocity?.clone() ?? new Vector3(0, 1, 0),
      });
    }
  }
}
