import type { RaceCatalogEntry } from "./config";
import type { RaceState } from "./gameplay";
import { completeRace } from "./gameplay";

export interface RaceProgress {
  opponentsTotal: number;
  opponentsWasted: number;
  pedestriansTotal: number;
  pedestriansKilled: number;
  /** Separate instantiated cars: duplicate catalog IDs remain separate goals. */
  opponentInstances?: readonly { id: number; wasted: boolean }[];
  /** Counts for original pedestrian group IDs, restricted to this population. */
  groupCounts?: ReadonlyMap<number, { total: number; killed: number }>;
  /** False while asynchronous population loading is still in progress. */
  opponentsReady?: boolean;
  /** Signed native runtime byte, read after a full connotation or selected kill. */
  smashValue?: number;
  pedestriansReady?: boolean;
}
export interface ObjectiveResult {
  /** True only when this call newly completes a race and awards its bonus. */
  completed: boolean;
  message?: string;
  objectiveText: string;
  supported: boolean;
}
const count = (n: number) =>
  Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
const allKilled = (total: number, killed: number) =>
  count(total) > 0 && count(killed) >= count(total);
const raceType = (definition?: RaceCatalogEntry) =>
  definition?.raceType ?? "carma";

export function isSupportedRace(definition?: RaceCatalogEntry): boolean {
  return [
    "carma",
    "cars",
    "peds",
    "checkpoints",
    "smash",
    "smashAndPed",
  ].includes(String(raceType(definition)));
}

export function objectiveText(
  definition?: RaceCatalogEntry,
  progress?: RaceProgress,
): string {
  const type = raceType(definition);
  if (type === "carma")
    return "Finish laps · waste all opponents · hit all pedestrians";
  if (type === "checkpoints") return "Complete the checkpoint laps";
  if (type === "cars") {
    const selected = new Set(definition?.opponentsToKill ?? []);
    const targets = progress?.opponentInstances?.filter(
      (car) => !selected.size || selected.has(car.id),
    );
    const total =
      targets?.length ??
      (selected.size ? 0 : count(progress?.opponentsTotal ?? 0));
    const killed =
      targets?.filter((car) => car.wasted).length ??
      (selected.size ? 0 : count(progress?.opponentsWasted ?? 0));
    return `Waste mission opponents · ${killed}/${total}`;
  }
  if (type === "peds") {
    const required = definition?.pedGroupsToKill ?? [];
    if (progress?.groupCounts && required.length) {
      const groups = [...new Set(required)];
      const total = groups.reduce(
        (sum, id) => sum + count(progress.groupCounts!.get(id)?.total ?? 0),
        0,
      );
      const killed = groups.reduce(
        (sum, id) => sum + count(progress.groupCounts!.get(id)?.killed ?? 0),
        0,
      );
      return `Hit the mission pedestrian groups · ${killed}/${total}`;
    }
    return `Hit all mission pedestrians${progress ? ` · ${count(progress.pedestriansKilled)}/${count(progress.pedestriansTotal)}` : ""}`;
  }
  if (type === "smash" || type === "smashAndPed")
    return `${type === "smashAndPed" ? "Destroy targets / hit mission pedestrians" : "Destroy mission targets"} · ${progress?.smashValue ?? 0}/${definition?.smashTarget ?? 0}`;
  return "Unsupported race objective · free driving";
}

/** Original broad victory categories with browser population approximations.
 * Classic races allow laps OR all opponents OR all pedestrians. Lap completion
 * and checkpoint bonuses belong to updateRace. Non-lap missions should use an
 * empty checkpoint list when constructed, even if their track contains gates.
 * Opponent IDs/group counts improve mission fidelity when provided; otherwise
 * totals refer to the browser's bounded visible population. Zero or still-
 * loading populations never count as a completed objective. Smash missions use
 * the installed signed-byte >= target comparison, shared with selected kills.
 */
export function applyRaceObjectives(
  race: RaceState,
  definition: RaceCatalogEntry | undefined,
  progress: RaceProgress,
): ObjectiveResult {
  const result: ObjectiveResult = {
    completed: false,
    objectiveText: objectiveText(definition, progress),
    supported: isSupportedRace(definition),
  };
  if (race.status !== "racing" || race.awardsClosed || !result.supported)
    return result;
  const type = raceType(definition);
  const allOpponents =
    progress.opponentsReady !== false &&
    allKilled(progress.opponentsTotal, progress.opponentsWasted);
  const allPedestrians =
    progress.pedestriansReady !== false &&
    allKilled(progress.pedestriansTotal, progress.pedestriansKilled);
  let won = false;
  let message: string | undefined;
  if (type === "carma") {
    won = allOpponents || allPedestrians;
    message = allOpponents
      ? "ALL OPPONENTS WASTED · RACE COMPLETED"
      : "ALL PEDESTRIANS HIT · RACE COMPLETED";
  } else if (type === "cars" && progress.opponentsReady !== false) {
    const selected = [
      ...new Set((definition?.opponentsToKill ?? []).filter((id) => id >= 0)),
    ];
    if (selected.length && progress.opponentInstances) {
      const targets = progress.opponentInstances.filter((car) =>
        selected.includes(car.id),
      );
      won =
        selected.every((id) => targets.some((car) => car.id === id)) &&
        targets.length > 0 &&
        targets.every((car) => car.wasted);
    } else if (
      (definition?.numberOfOpponentsToKill ?? -1) < 0 &&
      !selected.length
    ) {
      won = allOpponents;
    }
    message = "OPPONENT OBJECTIVE COMPLETE";
  } else if (type === "peds" && progress.pedestriansReady !== false) {
    const required = [...new Set(definition?.pedGroupsToKill ?? [])];
    if (required.length && progress.groupCounts) {
      const total = required.reduce(
        (sum, id) => sum + count(progress.groupCounts!.get(id)?.total ?? 0),
        0,
      );
      const killed = required.reduce(
        (sum, id) => sum + count(progress.groupCounts!.get(id)?.killed ?? 0),
        0,
      );
      won = allKilled(total, killed);
    } else if (
      (definition?.numberOfPedGroupsToKill ?? -1) < 0 &&
      !required.length
    ) {
      won = allPedestrians;
    }
    message = "PEDESTRIAN OBJECTIVE COMPLETE";
  }
  if (type === "smash" || type === "smashAndPed") {
    won =
      Number.isInteger(progress.smashValue) &&
      definition?.smashTarget != null &&
      progress.smashValue! >= definition.smashTarget;
    message = "SMASH OBJECTIVE COMPLETE";
  }
  if (won) {
    completeRace(
      race,
      type === "smash" || type === "smashAndPed"
        ? 3
        : type === "peds" || (type === "carma" && !allOpponents)
          ? 1
          : 2,
    );
    result.completed = true;
    result.message = message;
  }
  return result;
}
