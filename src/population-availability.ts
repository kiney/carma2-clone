import type { RaceCatalogEntry } from "./config";

export interface PopulationLoad {
  state: "loading" | "ready" | "failed";
  reason?: string;
}
export interface PopulationAvailabilityInput {
  opponents: PopulationLoad;
  pedestrians: PopulationLoad;
  opponentIds: readonly number[];
  pedestrianCount: number;
  groupCounts: ReadonlyMap<number, { total: number }>;
  checkpointRouteAvailable: boolean;
  /** Actual loader failures, distinguished from authored groups with no spawns. */
  pedestrianFailures?: readonly { group?: number; reason: string }[];
}
export interface PopulationAvailability {
  opponentsUsable: boolean;
  pedestriansUsable: boolean;
  /** Required populations still loading; never interpret these as empty goals. */
  pending: readonly string[];
  /** A required mission population is absent or incomplete after settling. */
  unavailable: readonly string[];
  /** Failed optional victory paths; other classic-race objectives can continue. */
  disabledAlternatives: readonly string[];
}

/** Browser load-failure policy, not an invented native victory rule.
 * Missing required targets must neither award a win nor leave a silent 0/0 goal.
 */
export function assessPopulationAvailability(
  definition: RaceCatalogEntry | undefined,
  input: PopulationAvailabilityInput,
): PopulationAvailability {
  const pending: string[] = [];
  const unavailable: string[] = [];
  const disabledAlternatives: string[] = [];
  const type = definition?.raceType;
  const opponentsRequired = type === "cars";
  const pedestriansRequired =
    type === "peds" ||
    (type === "smashAndPed" && !!definition?.pedGroupsToKill.length);
  const classic = type === "carma";
  const inspect = (
    name: string,
    load: PopulationLoad,
    required: boolean,
    absent: readonly string[],
  ): boolean => {
    if (load.state === "loading") {
      if (required || classic) pending.push(`${name} are still loading.`);
      return false;
    }
    const reasons =
      load.state === "failed"
        ? [
            `${name} could not finish loading${load.reason ? `: ${load.reason}` : "."}`,
          ]
        : absent;
    if (reasons.length) {
      if (required) unavailable.push(...reasons);
      else if (classic) disabledAlternatives.push(...reasons);
      return false;
    }
    return true;
  };
  const selectedIds = [...new Set(definition?.opponentsToKill ?? [])].filter(
    (id) => id >= 0,
  );
  const missingIds = selectedIds.filter(
    (id) => !input.opponentIds.includes(id),
  );
  const opponentProblems = selectedIds.length
    ? missingIds.map((id) => `Required opponent ${id} has no loaded vehicle.`)
    : input.opponentIds.length
      ? []
      : ["No opponent vehicles are available for this objective."];
  const requiredGroups = [...new Set(definition?.pedGroupsToKill ?? [])].filter(
    (id) => id >= 0,
  );
  const pedestrianProblems = (input.pedestrianFailures ?? [])
    .filter(
      (failure) =>
        failure.group === undefined ||
        !requiredGroups.length ||
        requiredGroups.includes(failure.group),
    )
    .map((failure) => failure.reason);
  // Native selected-group counting sums enrolled actors. An authored group
  // absent without a loader failure can legitimately contribute zero; do not
  // confuse it with a known missing actor package or invent target actors.
  const selectedPedestrianCount = requiredGroups.length
    ? requiredGroups.reduce(
        (sum, id) => sum + (input.groupCounts.get(id)?.total ?? 0),
        0,
      )
    : input.pedestrianCount;
  if (!(selectedPedestrianCount > 0) && !pedestrianProblems.length)
    pedestrianProblems.push("No pedestrians are available for this objective.");
  const opponentsUsable = inspect(
    "Opponents",
    input.opponents,
    opponentsRequired,
    opponentProblems,
  );
  const pedestriansUsable = inspect(
    "Pedestrians",
    input.pedestrians,
    pedestriansRequired,
    pedestrianProblems,
  );
  if (
    classic &&
    !input.checkpointRouteAvailable &&
    !pending.length &&
    !opponentsUsable &&
    !pedestriansUsable
  )
    unavailable.push(
      "No checkpoint route or complete combat population is available.",
    );
  return {
    pending,
    unavailable,
    disabledAlternatives,
    opponentsUsable,
    pedestriansUsable,
  };
}
