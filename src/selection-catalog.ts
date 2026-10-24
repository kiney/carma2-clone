import type { RaceCatalogEntry, RaceType, TrackConfig } from "./config";

export interface RaceChoice {
  path: string;
  name: string;
  source: "data" | "adv_data";
  /** Position in the source RACES.TXT catalog, when known. */
  catalogOrder?: number;
  definition?: RaceCatalogEntry;
  config: TrackConfig;
}

export interface TrackGroup {
  /** Stable within source; derived from the first authored map family. */
  id: string;
  name: string;
  source: RaceChoice["source"];
  races: RaceChoice[];
  previewRace: RaceChoice;
}

function mapFamily(choice: RaceChoice): string | undefined {
  const map = choice.config.mapTexture?.replaceAll("\\", "/").split("/").at(-1);
  if (!map) return undefined;
  const stem = map.replace(/\.[^.]+$/, "").toLowerCase();
  // Observed original map series encode event variants as digits, M (mission),
  // or N (network), optionally combined as 1N. This installed-data naming
  // convention is not a universal guarantee for modified content.
  const family = stem.replace(/(?:\d+[mn]?|[mn])$/, "");
  return family || stem;
}

function humanizePath(path: string): string {
  const stem =
    path
      .split("/")
      .at(-1)
      ?.replace(/\.txt$/i, "") ?? path;
  return stem
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function groupName(races: RaceChoice[]): string {
  const primary =
    races.find((race) => race.definition && !race.definition.mission) ??
    races.find((race) => !race.definition) ??
    races[0];
  const location = primary?.definition?.description
    ?.match(/\bLOCATION:\s*(.*?)(?:@R|$)/i)?.[1]
    ?.trim();
  return (
    location ||
    primary?.name ||
    humanizePath(primary?.path ?? races[0]?.path ?? "") ||
    "Unknown track"
  );
}

function isMission(race: RaceChoice): boolean {
  return race.definition
    ? race.definition.mission
    : /^mission:/i.test(race.name);
}

/**
 * Group track TXT variants by their authored MAP DETAILS map series. The
 * original stock and Advanced configs use terminal digits for race variants
 * and M/N for mission/network variants (sometimes combined, as in 1N).
 * This is the strongest shared environment key currently parsed from the
 * configs. It is a heuristic for modified installs: unknown map naming schemes
 * may remain separate, while unrelated maps that reuse a series name could
 * co-group. Missing map identities stay isolated. Stock and Advanced remain
 * separate namespaces.
 */
export function groupRaceChoices(choices: readonly RaceChoice[]): TrackGroup[] {
  const groups = new Map<string, RaceChoice[]>();
  for (const choice of choices) {
    const family = mapFamily(choice);
    // No reliable authored environment key: keep the choice independently
    // selectable rather than guessing from race directory or nearby assets.
    const key = family
      ? `${choice.source}:map:${family}`
      : `${choice.source}:race:${choice.path.toLowerCase()}`;
    const members = groups.get(key);
    if (members) members.push(choice);
    else groups.set(key, [choice]);
  }

  return [...groups.entries()].map(([key, members]) => {
    const races = members.map((race, index) => ({ race, index }));
    races.sort((a, b) => {
      const mission = Number(isMission(a.race)) - Number(isMission(b.race));
      if (mission) return mission;
      const left = a.race.catalogOrder,
        right = b.race.catalogOrder;
      const order = (left ?? Infinity) - (right ?? Infinity);
      if (order && !Number.isNaN(order)) return order;
      return a.index - b.index;
    });
    const orderedRaces = races.map(({ race }) => race);
    const previewRace =
      orderedRaces.find((race) => !isMission(race)) ?? orderedRaces[0];
    return {
      id: key,
      name: groupName(orderedRaces) || humanizePath(orderedRaces[0].path),
      source: orderedRaces[0].source,
      races: orderedRaces,
      previewRace,
    };
  });
}

const raceTypeLabels = new Map<RaceType, string>([
  ["carma", "Standard race"],
  ["cars", "Destroy opponents"],
  ["peds", "Hit pedestrians"],
  ["checkpoints", "Checkpoint race"],
  ["smash", "Smash targets"],
  ["smashAndPed", "Smash targets and hit pedestrians"],
]);

/** Return user-facing objective text without leaking raw catalog type values. */
export function selectionRaceTypeLabel(
  definition?: RaceCatalogEntry,
): string | undefined {
  if (!definition) return undefined;
  return raceTypeLabels.get(definition.raceType) ?? "Special race";
}
