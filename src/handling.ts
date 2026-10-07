import type { CarConfig } from "./config";
import { DEFAULT_VEHICLE_CONFIG, WORLD_METRES_PER_UNIT } from "./gameplay";
import type { VehicleConfig } from "./gameplay";

const positive = (value: number | null | undefined, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

/** Convert the original mechanics fields into the independent arcade handler.
 * Acceleration is highest-gear m/s², not a 0–60 time. A constant 1.6 multiplier
 * approximates stronger lower gears while preserving engine-strength ordering.
 * Original mass is already part of specified acceleration; dividing by mass
 * again would double-count it. Downforce and full transmission are not modeled.
 */
export function physicsConfigFromCar(
  config: CarConfig,
): Partial<VehicleConfig> {
  const d = DEFAULT_VEHICLE_CONFIG;
  const wheelZ = config.wheels
    .map((wheel) => wheel.position[2])
    .filter(Number.isFinite);
  const inferredWheelbase =
    wheelZ.length >= 2
      ? Math.max(...wheelZ) - Math.min(...wheelZ)
      : d.wheelbase;
  const wheelbase = positive(
    config.wheelbase,
    positive(inferredWheelbase, d.wheelbase),
  );
  const width = positive(config.dimensions?.[0], d.radius * 2);
  const acceleration =
    config.acceleration === null
      ? d.acceleration
      : (positive(
          config.acceleration,
          (d.acceleration * WORLD_METRES_PER_UNIT) / 1.6,
        ) /
          WORLD_METRES_PER_UNIT) *
        1.6;
  const brakeMultiplier = positive(config.brakeMultiplier, 1);
  const strength = positive(config.brakingStrengthMultiplier, 1);
  return {
    wheelbase: clamp(wheelbase, 0.1, 3),
    radius: clamp(width / 2, 0.12, 0.6),
    maxSpeed: clamp(
      (positive(config.speedAtRedline, 200) * 0.44704) / WORLD_METRES_PER_UNIT,
      1,
      35,
    ),
    acceleration: clamp(acceleration, 0.2, 6),
    braking: clamp(d.braking * brakeMultiplier * strength, 0.5, 20),
  };
}
