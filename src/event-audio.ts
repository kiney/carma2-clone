import type { RaceEvent } from "./gameplay";

/** Original race voice IDs (rec2 structur.c), with one voice per gate.
 * A final-lap announcement replaces the checkpoint voice; the finishing gate
 * uses completion rather than playing checkpoint + completion together. */
export function raceEventSoundIds(
  events: readonly RaceEvent[],
  totalLaps: number,
): number[] {
  const result: number[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i],
      next = events[i + 1];
    if (event.type === "checkpoint") {
      if (
        next?.type === "completed" ||
        (next?.type === "lap" && next.lap === totalLaps)
      )
        continue;
      result.push(8012);
    } else if (event.type === "lap" && event.lap === totalLaps)
      result.push(8014);
    else if (event.type === "completed") result.push(8011);
    else if (event.type === "failed") result.push(8010);
  }
  return result;
}

/** GENERAL's pickup connotation list, not a guessed positive/negative sound.
 * Installed HW0x4ef780 loads this record for world flask collection. */
export function parsePowerupPickupSounds(text: string): number[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const marker = lines.findIndex((line) =>
    /^\s*\/\/\s*Powerup connotations\s*$/i.test(line),
  );
  if (marker < 0)
    throw new Error("GENERAL.TXT: powerup connotations are missing");
  const rows = lines
    .slice(marker + 1)
    .map((line) => line.split("//")[0].trim())
    .filter(Boolean);
  const count = Number(rows[0]);
  if (
    !/^\d+$/.test(rows[0] ?? "") ||
    !Number.isSafeInteger(count) ||
    count > 100
  )
    throw new Error("GENERAL.TXT: invalid powerup sound count");
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const value = rows[i + 1],
      id = Number(value);
    if (!/^\d+$/.test(value ?? "") || !Number.isSafeInteger(id))
      throw new Error(`GENERAL.TXT: invalid powerup sound ID ${i + 1}`);
    ids.push(id);
  }
  return ids;
}
