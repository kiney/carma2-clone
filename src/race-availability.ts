import type { RaceCatalogEntry, TrackConfig, Vec3 } from "./config";

export interface RaceAvailability {
  mode: "race" | "combat" | "free-drive" | "unavailable";
  label: string;
  reasons: string[];
  usableGates: number;
}

const finitePoint = (point: Vec3 | null): point is Vec3 =>
  !!point && point.length === 3 && point.every(Number.isFinite);

/** Match the plane-degeneracy threshold used by checkpointCrossing. */
export function isUsableCheckpoint(points: readonly Vec3[]): boolean {
  if (points.length > 4 && points.length % 4 === 0)
    return Array.from({ length: points.length / 4 }, (_, i) =>
      isUsableCheckpoint(points.slice(i * 4, i * 4 + 4)),
    ).some(Boolean);
  if (points.length < 3 || !points.every(finitePoint)) return false;
  const [a, b, c] = points;
  const ux = b[0] - a[0],
    uy = b[1] - a[1],
    uz = b[2] - a[2];
  const vx = c[0] - a[0],
    vy = c[1] - a[1],
    vz = c[2] - a[2];
  const areaSquared =
    (uy * vz - uz * vy) ** 2 +
    (uz * vx - ux * vz) ** 2 +
    (ux * vy - uy * vx) ** 2;
  return Number.isFinite(areaSquared) && areaSquared >= 1e-12;
}

/** Static data availability, not a promise of ground clearance or complete scripts. */
export function assessRaceAvailability(
  config: TrackConfig,
  definition: RaceCatalogEntry | undefined,
  resources: { geometry: boolean; configurationError?: string },
): RaceAvailability {
  const reasons: string[] = [];
  if (resources.configurationError)
    reasons.push("The track configuration could not be read.");
  if (!resources.geometry) reasons.push("The track actor file is missing.");
  if (!finitePoint(config.start))
    reasons.push("No valid player start is defined.");
  const usableGates = config.checkpoints.filter((gate) =>
    isUsableCheckpoint(gate.points),
  ).length;
  if (reasons.length)
    return { mode: "unavailable", label: "Unavailable", reasons, usableGates };
  if (
    !definition ||
    !["carma", "cars", "peds", "checkpoints", "smash", "smashAndPed"].includes(
      String(definition.raceType),
    )
  )
    return {
      mode: "free-drive",
      label: "Free drive only",
      usableGates,
      reasons: [
        definition
          ? "This race objective is not supported."
          : "No single-player race rules are defined in this library.",
      ],
    };
  const routeUsable =
    config.checkpoints.length > 0 &&
    usableGates === config.checkpoints.length &&
    definition.laps !== null &&
    definition.laps > 0;
  if (definition.raceType === "checkpoints" && !routeUsable)
    return {
      mode: "free-drive",
      label: "Free drive only",
      usableGates,
      reasons: ["The checkpoint race has no complete usable checkpoint route."],
    };
  if (definition.raceType === "carma" && !routeUsable)
    return {
      mode: "combat",
      label: "Combat objectives only",
      usableGates,
      reasons: [
        "Checkpoint laps are unavailable; opponent and pedestrian objectives remain enabled.",
      ],
    };
  return {
    mode: "race",
    label: definition.mission ? "Mission" : "Race",
    reasons: [],
    usableGates,
  };
}
