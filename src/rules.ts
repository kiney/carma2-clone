import type { RaceCatalogEntry } from "./config";
import type { RaceState } from "./gameplay";

export interface RaceProgress {
  opponentsTotal: number;
  opponentsWasted: number;
  pedestriansTotal: number;
  pedestriansKilled: number;
  /** When available, original opponent catalog IDs allow selected-target missions. */
  opponentsWastedIds?: ReadonlySet<number>;
  /** Counts for original pedestrian group IDs, restricted to this population. */
  groupCounts?: ReadonlyMap<number, { total: number; killed: number }>;
  /** False while asynchronous population loading is still in progress. */
  opponentsReady?: boolean;
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
  return ["carma", "cars", "peds", "checkpoints"].includes(
    String(raceType(definition)),
  );
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
    const requested = definition?.numberOfOpponentsToKill ?? -1;
    const total = progress
      ? count(progress.opponentsTotal)
      : count(definition?.numberOfOpponents ?? 0);
    const target =
      requested > 0
        ? total > 0
          ? Math.min(requested, total)
          : requested
        : total;
    return `Waste opponents${target > 0 ? ` · ${count(progress?.opponentsWasted ?? 0)}/${target}` : ""}`;
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
    return "Unsupported smash objective · free driving";
  return "Unsupported race objective · free driving";
}

/** Original broad victory categories with browser population approximations.
 * Classic races allow laps OR all opponents OR all pedestrians. Lap completion
 * and checkpoint bonuses belong to updateRace. Non-lap missions should use an
 * empty checkpoint list when constructed, even if their track contains gates.
 * Opponent IDs/group counts improve mission fidelity when provided; otherwise
 * totals refer to the browser's bounded visible population. Zero or still-
 * loading populations never count as a completed objective. Smash missions are
 * unsupported; the caller owns their free-driving mode and timer policy.
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
  if (race.status !== "racing" || !result.supported) return result;
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
    if (selected.length && progress.opponentsWastedIds) {
      won = selected.every((id) => progress.opponentsWastedIds!.has(id));
    } else {
      const requested = definition?.numberOfOpponentsToKill ?? -1;
      const target =
        requested > 0
          ? Math.min(count(requested), count(progress.opponentsTotal))
          : count(progress.opponentsTotal);
      won = target > 0 && count(progress.opponentsWasted) >= target;
    }
    message = "OPPONENT OBJECTIVE COMPLETE";
  } else if (type === "peds" && progress.pedestriansReady !== false) {
    const required = [...new Set(definition?.pedGroupsToKill ?? [])];
    if (required.length && progress.groupCounts) {
      won = required.every((id) => {
        const group = progress.groupCounts!.get(id);
        return !!group && allKilled(group.total, group.killed);
      });
    } else {
      won = allPedestrians;
    }
    message = "PEDESTRIAN OBJECTIVE COMPLETE";
  }
  if (won) {
    race.status = "completed";
    race.credits += race.completionCredits;
    result.completed = true;
    result.message = message;
  }
  return result;
}
