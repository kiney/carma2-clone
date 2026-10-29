import { Vector3 } from "three";
import type { RigidBody } from "./physics/contact";
import type { NativePedAwardContext } from "./ped-awards";

/** Source4cd010 geometry from the actual killer. The retained+1a8 provider is
 * supplied separately; missing data remains absent for award diagnostics. */
export function captureNativePedAwardGeometry(
  killer: RigidBody,
  pedestrianPosition: Vector3,
  driver: number | undefined,
  solverLocalVelocity: Vector3 | null,
): Partial<NativePedAwardContext> {
  const inverse = killer.state.orientation.clone().invert(),
    centre = killer.properties.centerOfMass
      .clone()
      .applyQuaternion(killer.state.orientation)
      .add(killer.state.position);
  return {
    ...(driver === undefined ? {} : { killerDriver: driver }),
    killerAngularVelocity: killer.state.angularVelocity
      .clone()
      .applyQuaternion(inverse),
    killerUpY: new Vector3(0, 1, 0).applyQuaternion(killer.state.orientation).y,
    killerActorOriginY: killer.state.position.y,
    pedestrianY: pedestrianPosition.y,
    localPedPosition: pedestrianPosition
      .clone()
      .sub(centre)
      .applyQuaternion(inverse),
    ...(solverLocalVelocity
      ? { killerLocalVelocity: solverLocalVelocity.clone() }
      : {}),
  };
}
