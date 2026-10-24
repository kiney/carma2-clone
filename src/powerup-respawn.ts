import {
  readSmashConnotations,
  SmashTextReader,
  type SmashConnotations,
} from "./world-smash";

const MAX_RESPAWN_SPECS = 256;
const MAX_GROUPS_PER_SPEC = 4096;
const NATIVE_RESPAWN_SLOTS = 100;

function parseInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new Error(`POWERUP.TXT: invalid ${label}: ${value}`);
  return parsed;
}

/** Parse the optional DATA/POWERUP.TXT respawn masks after the definitions. */
export function readPowerupRespawnSpecs(
  values: readonly string[],
  definitionCount: number,
): readonly Uint8Array[] {
  if (
    !Number.isSafeInteger(definitionCount) ||
    definitionCount < 0 ||
    definitionCount > 10000
  )
    throw new Error("POWERUP.TXT: invalid definition count for respawn specs");
  const lines = values.map((value) => value.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  let cursor = 0;
  const next = (label: string): string => {
    const value = lines[cursor++];
    if (value === undefined)
      throw new Error(`POWERUP.TXT: incomplete respawn ${label}`);
    return value;
  };
  const count = parseInteger(next("spec count"), "respawn spec count");
  if (count < 0 || count > MAX_RESPAWN_SPECS)
    throw new Error("POWERUP.TXT: invalid respawn spec count");
  const specs: Uint8Array[] = [];
  for (let specIndex = 0; specIndex < count; specIndex++) {
    const groupCount = parseInteger(
      next(`group count for spec ${specIndex}`),
      "respawn group count",
    );
    if (groupCount < 0 || groupCount > MAX_GROUPS_PER_SPEC)
      throw new Error(
        `POWERUP.TXT: invalid respawn group count for spec ${specIndex}`,
      );
    const enabled = new Uint8Array(definitionCount);
    for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
      const first = parseInteger(
        next(`group ${groupIndex} for spec ${specIndex}`),
        "respawn group",
      );
      if (first >= 0) {
        if (first >= definitionCount)
          throw new Error(
            `POWERUP.TXT: respawn index ${first} exceeds definition count ${definitionCount}`,
          );
        enabled[first] = 1;
        continue;
      }
      const start = parseInteger(
        next(`range start for group ${groupIndex} spec ${specIndex}`),
        "respawn range start",
      );
      const end = start - first;
      if (start < 0 || start >= definitionCount || end > definitionCount)
        throw new Error(
          `POWERUP.TXT: respawn range ${start}..${end - 1} exceeds definition count ${definitionCount}`,
        );
      for (let index = start; index < end; index++) enabled[index] = 1;
    }
    specs.push(enabled);
  }
  if (cursor !== lines.length)
    throw new Error("POWERUP.TXT: unexpected data after respawn specs");
  return specs;
}

export interface PowerupRespawnSettings {
  minimumMs: number;
  extraMs: number;
  connotations: SmashConnotations;
}

/** Read the two labelled general settings and the native respawn connotations. */
export function parsePowerupRespawnSettings(
  generalText: string,
): PowerupRespawnSettings {
  const setting = (label: string): number => {
    for (const line of generalText.split(/\r?\n/)) {
      const [value, comment] = line.split("//", 2);
      if (comment?.trim().toLowerCase() !== label.toLowerCase()) continue;
      const match = /^\s*([+-]?\d+)\s*$/.exec(value);
      if (!match) throw new Error(`GENERAL.TXT: invalid ${label}`);
      const seconds = Number(match[1]);
      if (
        !Number.isInteger(seconds) ||
        seconds < -0x80000000 ||
        seconds > 0x7fffffff
      )
        throw new Error(
          `GENERAL.TXT: ${label} is outside signed 32-bit seconds`,
        );
      return Math.imul(seconds, 1000);
    }
    throw new Error(`GENERAL.TXT: missing ${label}`);
  };
  const minimumMs = setting("Pickup respawn min time (seconds)");
  const extraMs = setting("Pickup respawn max extra time (seconds)");
  const marker = /^\s*\/\/\s*Powerup respawn connotations\s*$/im.exec(
    generalText,
  );
  if (!marker)
    throw new Error(
      "GENERAL.TXT: missing Powerup respawn connotations section",
    );
  const section = generalText.slice(marker.index + marker[0].length);
  const reader = new SmashTextReader(
    section,
    "GENERAL.TXT powerup respawn connotations",
  );
  const connotations = readSmashConnotations(reader);
  if (reader.cursor !== reader.lines.length)
    reader.fail("unexpected data after powerup respawn connotations");
  return {
    minimumMs,
    extraMs,
    connotations,
  };
}

interface PendingRespawn<Actor> {
  index: number;
  actor: Actor;
  dueMs: number;
}

/** Fixed 100-entry collection queue matching the native powerup respawn buffer. */
export class NativePowerupRespawns<Actor> {
  private readonly slots: (PendingRespawn<Actor> | undefined)[] =
    Array(NATIVE_RESPAWN_SLOTS).fill(undefined);

  constructor(
    private readonly enabled: Readonly<Uint8Array>,
    private readonly minimumMs: number,
    private readonly extraMs: number,
  ) {}

  queue(index: number, actor: Actor | null, nowMs: number): boolean {
    if (
      actor == null ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.enabled.length ||
      this.enabled[index] === 0
    )
      return false;
    const slot = this.slots.indexOf(undefined);
    if (slot < 0) return false;
    this.slots[slot] = {
      index,
      actor,
      dueMs: ((nowMs | 0) + this.minimumMs + Math.trunc(this.extraMs / 2)) | 0,
    };
    return true;
  }

  update(
    nowMs: number,
    onRespawn: (index: number, actor: Actor) => void,
  ): number {
    const current = nowMs | 0;
    let respawned = 0;
    for (let slot = 0; slot < this.slots.length; slot++) {
      const entry = this.slots[slot];
      if (!entry || current < entry.dueMs) continue;
      try {
        onRespawn(entry.index, entry.actor);
      } finally {
        this.slots[slot] = undefined;
      }
      respawned++;
    }
    return respawned;
  }

  clear(): void {
    this.slots.fill(undefined);
  }

  get pendingCount(): number {
    let count = 0;
    for (const slot of this.slots) if (slot) count++;
    return count;
  }
}
