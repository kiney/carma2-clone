import type { TrackPathSection } from "../config";
import { NativeProjectedRoute, type RaceRouteState } from "./path-route";
import type { ProjectedPathSection } from "./path-route";

export interface RaceRoutePreparation {
  sectionSlot: number;
  entries: readonly ProjectedPathSection[];
  foundRaceSection: boolean;
  finished: boolean;
  needsGetNearPlayer: boolean;
}

/** Coordinates the installed complete-race route shift and replenishment
 * branches around NativeProjectedRoute. Follower success remains external. */
export class NativeRaceRouteState {
  private readonly route: NativeProjectedRoute;
  private readonly random: () => number;
  private state: RaceRouteState = {
    foundRaceSection: false,
    finished: false,
  };

  constructor(
    nodeCount: number,
    sections: readonly TrackPathSection[],
    random = Math.random,
  ) {
    this.route = new NativeProjectedRoute(nodeCount, sections);
    this.random = random;
  }

  /** Start/restart after initialization or a give-up result. */
  start(nearestSection: number | undefined): readonly ProjectedPathSection[] {
    this.route.clear();
    this.state = { foundRaceSection: false, finished: false };
    this.state = this.route.extendRace(this.state, nearestSection, this.random);
    return this.route.entries;
  }

  /** Apply CompleteRace's cursor shift and its count<=10 refill gate. */
  prepare(followSlot: number): RaceRoutePreparation {
    if (!Number.isInteger(followSlot) || followSlot < 0)
      throw new Error("Invalid complete-race route cursor");
    let sectionSlot = followSlot;
    if (followSlot > 0) {
      this.route.shift(followSlot);
      // Native resets the follow-section value after the shift regardless of
      // whether ShiftProjectedRoute accepted the requested number of entries.
      sectionSlot = 0;
    }
    if (this.route.entries.length <= 10 && !this.state.finished) {
      this.state = this.route.extendRace(this.state, undefined, this.random);
    }
    const entries = this.route.entries;
    return {
      sectionSlot,
      entries,
      foundRaceSection: this.state.foundRaceSection,
      finished: this.state.finished,
      needsGetNearPlayer: entries.length === 0,
    };
  }
}
