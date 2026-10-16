import type { TrackPathSection } from "../config";

export interface ProjectedPathSection {
  section: number;
  /** Native direction1 travels from node0 to node1. */
  direction: 0 | 1;
}

export interface RaceRouteState {
  foundRaceSection: boolean;
  finished: boolean;
}

/** Installed GetNext4ae7d0 intentionally indexes global metadata by next
 * projected slot, not by the route entry's authored ID. Preserve that quirk. */
export function nextProjectedPathSlot(
  sections: readonly TrackPathSection[],
  route: readonly ProjectedPathSection[],
  current: number,
  cheating = false,
): number {
  if (!Number.isInteger(current) || current < 0 || current >= route.length)
    throw new Error("Invalid projected opponent path cursor");
  const next = current + 1;
  if (next >= route.length) return -1;
  if (!cheating) {
    // A valid small graph can still fill all twelve projected slots by
    // revisiting sections (Stock quarrynet has only one authored section).
    // Native indexing then reads beyond global metadata. End this traversal
    // at that undefined-read boundary instead of aborting the whole frame.
    if (!sections[next]) return -1;
    if (sections[next].type === 2) return -1;
  }
  return next;
}

/** Installed projected-route storage and TopUpRandomRoute0x4a9160.
 * Objective-specific acquisition and physical path following are separate. */
export class NativeProjectedRoute {
  private readonly incident: number[][];
  // Native BSS initializes all twelve entries. Clear changes only count;
  // target acquisition subsequently reads unused/stale backing slots.
  private readonly route: ProjectedPathSection[] = Array.from(
    { length: 12 },
    () => ({ section: 0, direction: 0 }),
  );
  private count = 0;
  private readonly sections: TrackPathSection[];

  constructor(nodeCount: number, sections: readonly TrackPathSection[]) {
    if (!Number.isInteger(nodeCount) || nodeCount < 0 || nodeCount > 65536)
      throw new Error("Invalid opponent path node count");
    this.incident = Array.from({ length: nodeCount }, () => []);
    this.sections = sections.map<TrackPathSection>((section, index) => {
      for (const node of section.nodeIndices) {
        if (!Number.isInteger(node) || !this.incident[node])
          throw new Error(`Opponent path section ${index} has an invalid node`);
        // Native LoadInOppoPaths retains the first eight incidences, including
        // both endpoint entries for a self-loop, in authored section order.
        if (this.incident[node].length < 8) this.incident[node].push(index);
      }
      return {
        ...section,
        nodeIndices: [...section.nodeIndices],
        minSpeed: [...section.minSpeed],
        maxSpeed: [...section.maxSpeed],
      };
    });
  }

  get entries(): readonly ProjectedPathSection[] {
    return this.route.slice(0, this.count).map((entry) => ({ ...entry }));
  }

  clear(): void {
    this.count = 0;
  }

  /** Read native backing storage, not just the logical route. Slot12 is an
   * adjacent opponent flags word in C2 and belongs to the acquisition caller. */
  storedEntry(slot: number): ProjectedPathSection {
    if (!Number.isInteger(slot) || slot < 0 || slot >= 12)
      throw new Error("Invalid projected opponent backing slot");
    return { ...this.route[slot] };
  }

  /** Acquisition4ac780 writes only the section ID, retaining the direction
   * and logical count even when the previous route entry is overwritten. */
  overwriteStoredSection(slot: number, section: number): void {
    if (!Number.isInteger(section) || !this.sections[section])
      throw new Error("Invalid projected opponent path section");
    this.storedEntry(slot); // Validate the native backing-store index.
    this.route[slot].section = section;
  }

  append(section: number, direction: 0 | 1): boolean {
    if (
      !Number.isInteger(section) ||
      !this.sections[section] ||
      (direction !== 0 && direction !== 1)
    )
      throw new Error("Invalid projected opponent path section");
    if (this.count >= 12) return false;
    this.route[this.count++] = { section, direction };
    return true;
  }

  shift(places: number): boolean {
    if (!Number.isInteger(places) || places < 0)
      throw new Error("Invalid projected opponent route shift");
    if (places >= this.count) return false;
    // Native shifts backing storage through slot11, including unused entries;
    // the trailing slots retain their previous contents.
    for (let index = places; index < 12; index++)
      this.route[index - places] = { ...this.route[index] };
    this.count -= places;
    return true;
  }

  endpoints(entry: ProjectedPathSection): [number, number] {
    const section = this.sections[entry.section];
    if (!section || (entry.direction !== 0 && entry.direction !== 1))
      throw new Error("Invalid projected opponent path section");
    return [
      section.nodeIndices[1 - entry.direction],
      section.nodeIndices[entry.direction],
    ];
  }

  topUpRandom(add: number, cheating: boolean, random = Math.random): void {
    if (!Number.isInteger(add) || add === 0 || this.count === 0)
      throw new Error(
        "Random opponent route requires a seed and nonzero count",
      );
    const target = add < 0 ? 12 : Math.min(12, this.count + add);
    while (this.count < target) {
      const previous = this.route[this.count - 1];
      const finish = this.endpoints(previous)[1];
      const eligible = this.incident[finish].filter((index) => {
        const section = this.sections[index];
        return (
          index !== previous.section &&
          (!section.oneWay || section.nodeIndices[1] !== finish) &&
          (cheating || section.type !== 2)
        );
      });
      if (!eligible.length) {
        // Native dead-end escape reverses even an authored one-way section.
        this.append(previous.section, previous.direction === 1 ? 0 : 1);
      } else {
        let index = 0;
        if (eligible.length > 1) {
          const sample = random();
          if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
            throw new Error("Opponent route random sample must be in [0, 1)");
          // Installed IRandomBetween uses the inclusive range and 15-bit rand.
          index = Math.trunc(
            (Math.floor(sample * 32768) * eligible.length) / 32768,
          );
        }
        const section = eligible[index];
        this.append(
          section,
          this.sections[section].nodeIndices[1] === finish ? 0 : 1,
        );
      }
    }
  }

  /** CalcRaceRoute4aabc0. Objective state survives ordinary route shifts;
   * an empty route starts a new calculation, seeded forwards regardless yaw. */
  extendRace(
    previousState: RaceRouteState,
    nearestSection: number | undefined,
    random = Math.random,
  ): RaceRouteState {
    let { foundRaceSection, finished } = previousState;
    if (this.count >= 12) return { foundRaceSection, finished };
    if (!this.count) {
      foundRaceSection = finished = false;
      if (nearestSection === undefined) return { foundRaceSection, finished };
      this.append(nearestSection, 1);
      foundRaceSection = this.sections[nearestSection].type === 1;
    }
    while (this.count < 12 && !finished) {
      const previous = this.route[this.count - 1];
      const finish = this.endpoints(previous)[1];
      const forwardRace: number[] = [];
      const forwardOther: number[] = [];
      const backward: number[] = [];
      for (const index of this.incident[finish]) {
        if (index === previous.section) continue;
        const section = this.sections[index];
        if (section.nodeIndices[0] === finish) {
          (section.type === 1 ? forwardRace : forwardOther).push(index);
        } else if (!section.oneWay || section.nodeIndices[1] !== finish) {
          backward.push(index);
        }
      }
      if (forwardRace.length) foundRaceSection = true;
      const selected = forwardRace.length
        ? forwardRace
        : forwardOther.length
          ? forwardOther
          : backward;
      if (selected.length) {
        // Native race-route tiers always sample, even when there is one choice.
        const sample = random();
        if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
          throw new Error("Opponent route random sample must be in [0, 1)");
        const index = Math.trunc(
          (Math.floor(sample * 32768) * selected.length) / 32768,
        );
        this.append(
          selected[index],
          forwardRace.length || forwardOther.length ? 1 : 0,
        );
      } else if (!foundRaceSection) {
        this.append(previous.section, previous.direction === 1 ? 0 : 1);
      } else {
        finished = true;
      }
    }
    return { foundRaceSection, finished };
  }
}
