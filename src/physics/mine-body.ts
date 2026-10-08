import { Box3, Object3D, Vector3 } from "three";
import type { RigidBody, RigidProperties } from "./contact";
import { buildHull, type CollisionHull } from "./geometry";
import { mineSphereProperties, type Mine, type MinePose } from "./mines";
import type { SpecialVolume } from "./volumes";

/** Native InitMine4dd1f0 copies water244..250 and volume258/25c.
 * Volume definitions remain shared; the per-object cache must be independent.
 * Depth254 is not copied by that function. */
export interface MineVolumeState {
  volume: SpecialVolume | null;
  automatic: SpecialVolume | null;
  depth: number;
  waterDistance: number;
  waterNormal?: Vector3;
}

export interface MineBody<T> extends RigidBody {
  kind: "mine";
  mine: Mine<T>;
  actor: Object3D;
  hulls: CollisionHull[];
  /** The solver and mine callbacks own the same pose, not copied vectors. */
  state: MinePose;
  properties: RigidProperties & {
    radius: number;
    bounds: Box3;
    forceOffset: Vector3;
  };
  specialVolume?: MineVolumeState;
  overlapRecovery: boolean;
  overlapDetected: boolean;
  worldRecovery: boolean;
  worldOverlapDetected: boolean;
}

/** Installed MungeSphereObject4da1d0 / InitMine4dd1f0.
 * Bounds and mass come from SHITMINE.ACT and GENERAL in model units/tonnes.
 * InitMine enables PHIL gravity(property0=1), special volumes(7) and forces(6).
 * PHY05 analytic sphere contacts remain unresolved: this uses exactly the
 * existing car/noncar sampled convex sphere approximation for the dispatcher.
 */
export function createMineBody<T>(
  mine: Mine<T>,
  actor: Object3D,
  modelBounds: Box3,
  mass: number,
  inheritedVolume?: MineVolumeState,
): MineBody<T> {
  const sphere = mineSphereProperties(modelBounds, mass);
  if (
    !Number.isFinite(sphere.radius) ||
    !Number.isFinite(mass) ||
    sphere.inertia
      .toArray()
      .some((value) => !(value > 0 && Number.isFinite(value)))
  )
    throw new Error("Invalid mine sphere properties");
  const points: Vector3[] = [];
  for (let ring = 0; ring <= 6; ring++)
    for (let azimuth = 0; azimuth < 12; azimuth++) {
      const latitude = (ring * Math.PI) / 6;
      const longitude = (azimuth * Math.PI) / 6;
      points.push(
        new Vector3(
          Math.sin(latitude) * Math.cos(longitude),
          Math.cos(latitude),
          Math.sin(latitude) * Math.sin(longitude),
        ).multiplyScalar(sphere.radius),
      );
    }
  actor.userData.dynamicBody = true;
  actor.position.copy(mine.position);
  actor.quaternion.copy(mine.orientation);
  actor.updateMatrixWorld(true);
  return {
    kind: "mine",
    mine,
    actor,
    hulls: [buildHull(points)],
    state: mine,
    properties: {
      mass: sphere.mass,
      radius: sphere.radius,
      bounds: sphere.bounds,
      inertia: sphere.inertia,
      centerOfMass: sphere.center,
      forceOffset: sphere.forceOffset,
      // BrMemAllocate526c00 zero-fills; sphere/mine initializers do not assign
      // friction60/64. Explicit zero avoids the solver's ordinary-car0.4 default.
      worldFriction: 0,
      objectFriction: 0,
      immovable: false,
    },
    specialVolume: inheritedVolume
      ? {
          volume: inheritedVolume.volume,
          automatic: inheritedVolume.automatic,
          waterDistance: inheritedVolume.waterDistance,
          waterNormal: inheritedVolume.waterNormal?.clone(),
          // InitMine does not inherit owner depth254. Native zero-initialized
          // mine objects acquire depth from their first volume update.
          depth: 0,
        }
      : undefined,
    overlapRecovery: true,
    overlapDetected: false,
    worldRecovery: true,
    worldOverlapDetected: false,
  };
}
