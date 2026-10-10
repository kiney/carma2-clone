import type { SimulatedCar } from "./simulation";
import { setMotionSuspension } from "./motion";
import {
  setTemporaryMotionPowerup,
  resetTemporaryMotionPowerup,
} from "./upgrades";

/** Installed SetOpponentsSpeed4dcab0/Reset4de4b0 also change the first
 * catalog opponent29, using authored Hot rod powerup5, even for freeze0. */
export function applyOpponentHotrod(
  opponents: readonly { id: number; body: SimulatedCar }[],
  parameters: readonly number[],
  active: boolean,
): SimulatedCar | undefined {
  const body = opponents.find((opponent) => opponent.id === 29)?.body;
  if (!body) return;
  const suspension = active
    ? setTemporaryMotionPowerup(body.state, 9, parameters)
    : resetTemporaryMotionPowerup(body.state, 9);
  if (suspension) {
    body.suspensionPowerup = suspension;
    setMotionSuspension(body.motion, suspension);
  }
  return body;
}
